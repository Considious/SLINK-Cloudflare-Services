import { testing as core } from './monitor-core.js';

const LEGACY_STATE_KEY = 'mugging/state/v1.json';
const INDEX_KEY = 'mugging/state/v2/index.json';
const STATUS_KEY = 'mugging/status/v1.json';
const CATALOG_KEY = 'mugging/catalog/companies-v1.json';
const EVENT_PREFIX = 'mugging/events';
const PENDING_KEY = 'mugging/fair-fight/v2/pending.json';
const STATE_SHARD_COUNT = 15;
const FAIR_FIGHT_SHARD_COUNT = 14;
const STATE_SCHEMA = 2;
const CATALOG_RULESET_VERSION = 2;
const DEFAULT_MAX_CALLS_PER_RUN = 100;
const MAX_CALLS_PER_RUN = 10_000;
const CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
const RUN_LEASE_MS = 3 * 60 * 1000;
const FAIR_FIGHT_BATCH_SIZE = 25;
const FAIR_FIGHT_REQUEST_INTERVAL_MS = 10 * 60 * 1000;
const FAIR_FIGHT_REFRESH_MS = 14 * 24 * 60 * 60 * 1000;

export async function runMuggingMonitor(env, dependencies = {}, options = {}) {
    if (!env.MUGGING_DB || !env.MUGGING_BUCKET) {
        return { active:false, reason:!env.MUGGING_DB ? 'database_not_configured' : 'r2_not_configured' };
    }
    if (typeof dependencies.executePublicRequests !== 'function') {
        return { active:false, reason:'contribution_broker_not_configured' };
    }

    const now = Number(options.now) || Date.now();
    const lease = await claimMonitorRun(env, now);
    if (!lease.claimed) {
        return { active:true, deferred:true, reason:'monitor_already_running', retry_at:lease.retryAt };
    }

    try {
        const storage = await ensureShardedStorage(env.MUGGING_BUCKET, now);
        if (storage.migrated) {
            const migratedStatus = statusFromIndex(storage.index);
            await writeStatus(env.MUGGING_BUCKET, migratedStatus);
            await recordMonitorResult(env, now, now, 'partial');
            return {
                active:true,
                phase:storage.index.phase,
                migrated:true,
                state_shards:STATE_SHARD_COUNT,
                fair_fight_shards:FAIR_FIGHT_SHARD_COUNT,
                targets_total:migratedStatus.targets_total,
                external_calls:0
            };
        }

        const indexRecord = storage.record;
        const index = indexRecord.value;
        const maxCalls = boundedInteger(
            options.maxCalls ?? env.MUGGING_MAX_CALLS_PER_RUN,
            DEFAULT_MAX_CALLS_PER_RUN,
            0,
            MAX_CALLS_PER_RUN
        );
        const plannedCapacity = options.capacity && typeof options.capacity === 'object' ? options.capacity : {};
        let remainingCalls = maxCalls;
        let catalogUpdate = null;
        const scanResults = [];
        const eventRows = [];
        const newTargetIds = [];
        const dirtyShards = new Map();
        let contributionSummary = {
            key_count:Number(plannedCapacity.key_count) || 0,
            configured_capacity:Number(plannedCapacity.configured_capacity) || 0,
            available_capacity:Number(plannedCapacity.available_capacity) || 0
        };

        if (
            !index.company_ids.length ||
            Number(index.catalog_ruleset_version) !== CATALOG_RULESET_VERSION ||
            now - Number(index.catalog_updated_at || 0) >= CATALOG_REFRESH_MS
        ) {
            if (remainingCalls >= 2) {
                const response = await dependencies.executePublicRequests([
                    { request_id:'company-types', kind:'company.types' },
                    { request_id:'company-snapshot', kind:'company.snapshot' }
                ]);
                contributionSummary = mergeContributionSummary(contributionSummary, response);
                remainingCalls -= 2;
                const types = response.results?.find(row => row.request_id === 'company-types');
                const snapshot = response.results?.find(row => row.request_id === 'company-snapshot');
                if (!types?.ok || !snapshot?.ok) {
                    throw new Error(types?.error || snapshot?.error || 'Company catalog refresh failed.');
                }
                const catalog = {
                    schema:1,
                    ruleset_version:CATALOG_RULESET_VERSION,
                    generated_at:now,
                    companies:core.selectMuggingCompanies(String(snapshot.body || ''), types.body)
                };
                await env.MUGGING_BUCKET.put(CATALOG_KEY, JSON.stringify(catalog), jsonMetadata());
                applyCatalogToIndex(index, catalog, now);
                catalogUpdate = { companies:catalog.companies.length, generated_at:now };
            }
        }

        const visitedShards = new Set();
        while (remainingCalls > 0 && visitedShards.size < STATE_SHARD_COUNT) {
            const selected = selectNextStateShard(index);
            if (selected === null || visitedShards.has(selected)) break;
            visitedShards.add(selected);
            const shard = await getDirtyStateShard(env.MUGGING_BUCKET, dirtyShards, selected);
            const companyIds = companyIdsForShard(index, selected);
            const cursor = boundedInteger(
                index.shard_company_cursors[String(selected)],
                0,
                0,
                Math.max(0, companyIds.length)
            );
            const requests = [];
            for (let offset = 0; offset < companyIds.length && requests.length < remainingCalls; offset++) {
                const companyId = companyIds[(cursor + offset) % companyIds.length];
                requests.push({
                    request_id:'company-' + companyId,
                    kind:'company.employees',
                    company_id:companyId
                });
            }
            if (!requests.length) break;
            const response = await dependencies.executePublicRequests(requests);
            contributionSummary = mergeContributionSummary(contributionSummary, response);
            remainingCalls -= requests.length;
            const currentResults = [];
            for (const request of requests) {
                const row = response.results?.find(item => item.request_id === request.request_id);
                const company = index.companies[String(request.company_id)] || { id:request.company_id };
                const scan = {
                    company,
                    employees:row?.ok ? core.normalizeCompanyEmployees(row.body) : null,
                    error:row?.ok ? '' : String(row?.error || 'Company request failed.')
                };
                scanResults.push(scan);
                currentResults.push(scan);
            }
            const result = await mergeScansIntoShards(
                env.MUGGING_BUCKET,
                index,
                dirtyShards,
                currentResults,
                now
            );
            eventRows.push(...result.events);
            newTargetIds.push(...result.newTargetIds);
            const nextCursor = cursor + requests.length;
            if (nextCursor >= companyIds.length) {
                index.shard_company_cursors[String(selected)] = 0;
                index.shards_completed_in_cycle = Number(index.shards_completed_in_cycle || 0) + 1;
            } else {
                index.shard_company_cursors[String(selected)] = nextCursor;
            }
            index.monitor_shard_cursor = (selected + 1) % STATE_SHARD_COUNT;
            if (nextCursor < companyIds.length) break;
        }

        if (index.phase === 'baseline' && Number(index.shards_completed_in_cycle || 0) >= nonEmptyStateShardCount(index)) {
            index.phase = 'monitoring';
            index.last_cycle_completed_at = now;
            index.shards_completed_in_cycle = 0;
        } else if (index.phase === 'monitoring' && Number(index.shards_completed_in_cycle || 0) >= nonEmptyStateShardCount(index)) {
            index.last_cycle_completed_at = now;
            index.shards_completed_in_cycle = 0;
        }

        if (newTargetIds.length) {
            await registerNewFairFightTargets(env.MUGGING_BUCKET, index, newTargetIds, now);
        }

        const fairFight = await processFairFight(
            env,
            index,
            dirtyShards,
            dependencies,
            now
        );

        for (const [shardNumber, shard] of dirtyShards) {
            shard.updated_at = now;
            index.shard_summaries[String(shardNumber)] = summarizeShard(shard, now);
            await putJson(env.MUGGING_BUCKET, stateShardKey(shardNumber), shard);
        }

        index.updated_at = now;
        index.last_run = {
            started_at:now,
            completed_at:Date.now(),
            key_count:Number(contributionSummary.key_count) || 0,
            configured_capacity:Number(contributionSummary.configured_capacity) || 0,
            available_capacity_at_start:Number(contributionSummary.available_capacity) || 0,
            call_budget:maxCalls,
            external_calls:maxCalls - remainingCalls,
            companies_checked:scanResults.filter(row => row.employees).length,
            company_errors:scanResults.filter(row => !row.employees).length,
            state_shards:[...visitedShards]
        };
        index.summary = summarizeIndex(index, {
            keyCount:Number(contributionSummary.key_count) || 0,
            configuredCapacity:Number(contributionSummary.configured_capacity) || 0,
            availableAtStart:Number(contributionSummary.available_capacity) || 0,
            callBudget:maxCalls,
            callsUsed:maxCalls - remainingCalls
        });
        await writeIndex(env.MUGGING_BUCKET, indexRecord, index);
        if (eventRows.length) await writeEventBatch(env.MUGGING_BUCKET, 'company-status', eventRows, now);
        await writeStatus(env.MUGGING_BUCKET, statusFromIndex(index));
        await recordMonitorResult(env, now, now, scanResults.some(row => row.employees) ? 'completed' : 'partial');

        return {
            active:true,
            phase:index.phase,
            catalog:catalogUpdate,
            external_calls:maxCalls - remainingCalls,
            companies_checked:scanResults.filter(row => row.employees).length,
            company_errors:scanResults.filter(row => !row.employees).length,
            targets_total:Number(index.summary?.target_count) || 0,
            mug_events:eventRows.length,
            state_shards:[...visitedShards],
            calls:maxCalls - remainingCalls,
            keys_available:Number(contributionSummary.key_count) || 0,
            fair_fight_attempted:fairFight.attempted,
            fair_fight_checked:fairFight.checked,
            fair_fight_shard:fairFight.shard,
            fair_fight_next_request_at:Number(index.fair_fight_last_request_at)
                ? Number(index.fair_fight_last_request_at) + FAIR_FIGHT_REQUEST_INTERVAL_MS
                : 0,
            estimated_cycle_minutes:Number(index.summary?.estimated_cycle_minutes) || 0,
            target_cycle_minutes:15,
            capacity_meets_target:index.summary?.capacity_meets_target === true
        };
    } catch (error) {
        await recordMonitorResult(env, now, now, 'error').catch(() => {});
        throw error;
    }
}

async function mergeScansIntoShards(bucket, index, dirtyShards, scanResults, now) {
    const events = [];
    const newTargetIds = [];
    for (const result of scanResults) {
        const companyId = Number(result.company.id);
        const destinationNumber = stateShardForCompany(companyId);
        const destination = await getDirtyStateShard(bucket, dirtyShards, destinationNumber);
        const company = index.companies[String(companyId)] || { ...result.company, id:companyId };
        company.last_checked_at = now;
        company.last_error = result.error || '';
        if (!result.employees) {
            index.companies[String(companyId)] = company;
            continue;
        }
        company.employee_ids = result.employees.map(row => row.id);
        company.employee_count = result.employees.length;
        for (const employee of result.employees) {
            const key = String(employee.id);
            const previousNumber = Number(index.target_shards[key]);
            let target = destination.targets[key];
            if (!target && Number.isInteger(previousNumber) && previousNumber !== destinationNumber) {
                const previous = await getDirtyStateShard(bucket, dirtyShards, previousNumber);
                target = previous.targets[key];
                if (target) delete previous.targets[key];
            }
            const existed = Boolean(target);
            if (!target) {
                const shell = { targets:{} };
                target = core.ensureTarget(shell, employee.id, employee.name, now);
            }
            const signature = core.mugSignature(employee);
            const isMuggedNow = core.isMugHospital(employee);
            const mugged = index.phase === 'monitoring' && isMuggedNow && signature !== target.last_mug_signature;
            target.name = employee.name || target.name;
            target.company_id = companyId;
            target.company_name = company.name || 'Company ' + companyId;
            target.company_type = company.type_name || '';
            target.company_rating = Number(company.rating) || 0;
            target.position = employee.position;
            target.status_state = employee.status_state;
            target.status_description = employee.status_description;
            target.status_until = employee.status_until;
            target.last_checked_at = now;
            target.last_seen_at = now;
            if (mugged) core.recordMug(target, now, 'company_status', null, events);
            target.last_mug_signature = isMuggedNow ? signature : '';
            target.priority_multiplier = core.priorityMultiplier(target, now);
            destination.targets[key] = target;
            index.target_shards[key] = destinationNumber;
            if (!existed) newTargetIds.push(employee.id);
        }
        index.companies[String(companyId)] = company;
    }
    return { events, newTargetIds };
}

export async function ingestMuggingReports(env, rawReports, now = Date.now()) {
    if (!env.MUGGING_BUCKET) throw new Error('The MUGGING_BUCKET binding is required.');
    const reports = core.normalizeReports(rawReports, now);
    if (!reports.length) return { accepted:0, events:0, acknowledged_report_ids:[] };
    const storage = await ensureShardedStorage(env.MUGGING_BUCKET, now);
    const indexRecord = storage.record;
    const index = indexRecord.value;
    const dirtyShards = new Map();
    const fairFightUpdates = new Map();
    const events = [];
    const newTargetIds = [];

    for (const report of reports) {
        const key = String(report.target_id);
        let shardNumber = Number(index.target_shards[key]);
        if (!Number.isInteger(shardNumber)) {
            shardNumber = stateShardForTarget(report.target_id);
            index.target_shards[key] = shardNumber;
            newTargetIds.push(report.target_id);
        }
        const shard = await getDirtyStateShard(env.MUGGING_BUCKET, dirtyShards, shardNumber);
        const existed = Boolean(shard.targets[key]);
        const shell = { targets:shard.targets };
        const target = core.ensureTarget(shell, report.target_id, report.name, now);
        if (!existed && !newTargetIds.includes(report.target_id)) newTargetIds.push(report.target_id);
        const observedAt = Math.max(0, Number(report.observed_at) || now);
        const currentStatusAt = Math.max(0, Number(target.last_checked_at) || 0);
        if (report.name && (!target.name || observedAt >= Number(target.last_seen_at || 0))) target.name = report.name;
        if (observedAt >= currentStatusAt) {
            if (report.status_state) {
                target.status_state = report.status_state;
                target.status_description = report.status_description;
                target.status_until = report.status_until;
            }
            if (report.level !== null) target.level = report.level;
            if (report.bounty_count !== null) target.bounty_count = report.bounty_count;
            if (report.bounty_total !== null) target.bounty_total = report.bounty_total;
            target.last_checked_at = observedAt;
            target.last_seen_at = Math.max(Number(target.last_seen_at) || 0, observedAt);
        }
        if (report.mugged_at) core.recordMug(target, report.mugged_at, report.source, report.amount, events);
        if (report.amount !== null) core.recordMugValue(target, report.amount);
        core.applyBattleStats(target, report, now);
        target.priority_multiplier = core.priorityMultiplier(target, now);

        if (report.battle_stats_estimate !== null || report.fair_fight !== null) {
            const ffShardNumber = fairFightShardForTarget(report.target_id);
            if (!fairFightUpdates.has(ffShardNumber)) fairFightUpdates.set(ffShardNumber, []);
            fairFightUpdates.get(ffShardNumber).push(report);
        }
    }

    for (const [shardNumber, shard] of dirtyShards) {
        shard.updated_at = now;
        index.shard_summaries[String(shardNumber)] = summarizeShard(shard, now);
        await putJson(env.MUGGING_BUCKET, stateShardKey(shardNumber), shard);
    }
    if (newTargetIds.length) {
        await registerNewFairFightTargets(env.MUGGING_BUCKET, index, newTargetIds, now);
    }
    for (const [shardNumber, rows] of fairFightUpdates) {
        const record = await readJson(env.MUGGING_BUCKET, fairFightShardKey(shardNumber), emptyFairFightShard(shardNumber));
        for (const report of rows) {
            const key = String(report.target_id);
            const entry = record.value.targets[key] || { id:report.target_id, assigned_at:now };
            const observedAt = Number(report.observed_at) || now;
            const isCurrent = observedAt >= (Number(entry.observed_at) || 0);
            entry.observed_at = Math.max(Number(entry.observed_at) || 0, observedAt);
            if (isCurrent && report.battle_stats_estimate !== null) entry.battle_stats_estimate = report.battle_stats_estimate;
            if (isCurrent && report.fair_fight !== null) entry.fair_fight = report.fair_fight;
            record.value.targets[key] = entry;
        }
        record.value.updated_at = now;
        await putJson(env.MUGGING_BUCKET, fairFightShardKey(shardNumber), record.value);
    }

    index.updated_at = now;
    index.summary = summarizeIndex(index, {});
    await writeIndex(env.MUGGING_BUCKET, indexRecord, index);
    await writeEventBatch(env.MUGGING_BUCKET, 'client', reports, now);
    await writeStatus(env.MUGGING_BUCKET, statusFromIndex(index));
    return {
        accepted:reports.length,
        events:events.length,
        acknowledged_report_ids:reports.map(report => report.report_id).filter(Boolean)
    };
}

export async function muggingStatus(env) {
    if (!env.MUGGING_BUCKET) return { configured:false, reason:'r2_not_configured' };
    const compact = await env.MUGGING_BUCKET.get(STATUS_KEY);
    if (compact) return { configured:true, ...await compact.json() };
    const storage = await ensureShardedStorage(env.MUGGING_BUCKET, Date.now());
    return { configured:true, ...statusFromIndex(storage.index) };
}

export async function roughMuggingAssignments(env, input = {}, now = Date.now()) {
    if (!env.MUGGING_BUCKET) throw new Error('The MUGGING_BUCKET binding is required.');
    const userBattleStats = finitePositive(input.user_battle_stats ?? input.userBattleStats);
    if (userBattleStats === null) throw new Error('A positive requesting-user battle-stat total is required.');
    const minimum = boundedNumber(input.min_fair_fight ?? input.minFairFight, 1, 1, 3);
    const maximum = boundedNumber(input.max_fair_fight ?? input.maxFairFight, 3, 1, 3);
    if (minimum > maximum) throw new Error('Minimum Fair Fight cannot be higher than maximum Fair Fight.');
    const limit = boundedInteger(input.limit, 50, 1, 100);
    const userId = positiveInteger(input.user_id ?? input.userId);
    await ensureShardedStorage(env.MUGGING_BUCKET, now);
    const shards = await Promise.all(
        Array.from({ length:STATE_SHARD_COUNT }, (_, shard) => loadStateShard(env.MUGGING_BUCKET, shard))
    );
    const allTargets = shards.flatMap(shard => Object.values(shard.targets || {}));
    let estimable = 0;
    const candidates = [];
    for (const target of allTargets) {
        const id = positiveInteger(target?.id);
        const targetBattleStats = finitePositive(target?.battle_stats_estimate);
        if (!id || id === userId || targetBattleStats === null) continue;
        estimable++;
        const state = String(target?.status_state || 'Unknown');
        if (/federal/i.test(state)) continue;
        const statusUntilSeconds = normalizeUnixSeconds(target?.status_until);
        const statusBlockedUntil = /hospital|jail/i.test(state) ? statusUntilSeconds * 1000 : 0;
        const freeAt = Math.max(0, Number(target?.free_at) || 0);
        if (Math.max(statusBlockedUntil, freeAt) > now) continue;
        const roughFairFight = roughFairFightValue(userBattleStats, targetBattleStats);
        if (roughFairFight < minimum || roughFairFight > maximum) continue;
        const priorityMultiplier = Math.max(0.05, Number(target?.priority_multiplier) || 1);
        const score = Number((priorityMultiplier * roughFairFight).toFixed(6));
        candidates.push({ target, id, targetBattleStats, roughFairFight, priorityMultiplier, score, statusUntilSeconds });
    }
    candidates.sort((left, right) =>
        right.score - left.score ||
        right.roughFairFight - left.roughFairFight ||
        right.targetBattleStats - left.targetBattleStats ||
        left.id - right.id
    );
    return {
        generated_at:now,
        estimate_kind:'rough',
        estimate_source:'cached battle-stat estimate',
        user_battle_stats:userBattleStats,
        pool:{ total:allTargets.length, estimable, eligible:candidates.length },
        targets:candidates.slice(0, limit).map(row => ({
            id:row.id,
            name:String(row.target?.name || `Player ${row.id}`).slice(0, 80),
            company_id:positiveInteger(row.target?.company_id) || 0,
            company_name:String(row.target?.company_name || ''),
            company_type:String(row.target?.company_type || ''),
            company_rating:Math.max(0, Number(row.target?.company_rating) || 0),
            position:String(row.target?.position || ''),
            status:{
                state:String(row.target?.status_state || 'Unknown'),
                description:String(row.target?.status_description || ''),
                until:row.statusUntilSeconds
            },
            fair_fight:row.roughFairFight,
            rough_fair_fight:row.roughFairFight,
            battle_stats_estimate:row.targetBattleStats,
            battle_stats_checked_at:Math.max(0, Number(row.target?.battle_stats_checked_at) || 0),
            estimate_kind:'rough',
            estimate_source:String(row.target?.battle_stats_source || 'cached'),
            confidence:assignmentConfidence(row.target, now),
            priority_multiplier:row.priorityMultiplier,
            mug_count_7d:Math.max(0, Number(row.target?.mug_count_7d) || 0),
            mug_count_30d:Math.max(0, Number(row.target?.mug_count_30d) || 0),
            mug_value_average:Math.max(0, Number(row.target?.mug_value_average) || 0),
            last_checked_at:Math.max(0, Number(row.target?.last_checked_at) || 0)
        }))
    };
}

export async function contributorTaskAssignments(env, input = {}, now = Date.now()) {
    if (!env.MUGGING_BUCKET) throw new Error('The MUGGING_BUCKET binding is required.');
    const clientId = String(input.client_id ?? input.clientId ?? '').trim().slice(0, 120);
    if (!clientId) throw new Error('A contributor client ID is required.');
    const active = input.active === true;
    const userId = positiveInteger(input.user_id ?? input.userId);
    const apiBudget = active ? 10 : 5;
    const limit = boundedInteger(input.limit, apiBudget * 4, 1, 40);
    await ensureShardedStorage(env.MUGGING_BUCKET, now);
    const minuteSlot = Math.floor(now / 60_000);
    const startShard = stableHash(`${clientId}:${minuteSlot}`) % STATE_SHARD_COUNT;
    let selectedShard = startShard;
    let shard = await loadStateShard(env.MUGGING_BUCKET, selectedShard);
    for (let offset = 1; offset < STATE_SHARD_COUNT && !Object.keys(shard.targets || {}).length; offset++) {
        selectedShard = (startShard + offset) % STATE_SHARD_COUNT;
        shard = await loadStateShard(env.MUGGING_BUCKET, selectedShard);
    }
    const candidates = [];
    for (const target of Object.values(shard.targets || {})) {
        const id = positiveInteger(target?.id);
        if (!id || id === userId) continue;
        const state = String(target?.status_state || 'Unknown');
        if (/federal/i.test(state)) continue;
        const statusUntilMs = normalizeUnixSeconds(target?.status_until) * 1000;
        const timedUntil = /hospital|jail|travel/i.test(state) ? statusUntilMs : 0;
        const freeAt = Math.max(0, Number(target?.free_at) || 0);
        const nextCheckAt = Math.max(timedUntil, freeAt);
        if (nextCheckAt > now) continue;
        const lastCheckedAt = Math.max(0, Number(target?.last_checked_at) || 0);
        candidates.push({ target, id, lastCheckedAt, order:stableHash(`${clientId}:${minuteSlot}:${id}`) });
    }
    candidates.sort((left, right) =>
        left.lastCheckedAt - right.lastCheckedAt ||
        left.order - right.order ||
        left.id - right.id
    );
    return {
        generated_at:now,
        mode:active ? 'active' : 'inactive',
        inactivity_threshold_ms:5 * 60 * 1000,
        api_budget_per_minute:apiBudget,
        personal_assignments_allowed:active,
        shard:selectedShard,
        tasks:candidates.slice(0, limit).map(row => ({
            kind:'player.status',
            player_id:row.id,
            name:String(row.target?.name || `Player ${row.id}`).slice(0, 80),
            last_checked_at:row.lastCheckedAt,
            status:{
                state:String(row.target?.status_state || 'Unknown'),
                description:String(row.target?.status_description || ''),
                until:normalizeUnixSeconds(row.target?.status_until)
            }
        }))
    };
}

function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export function roughFairFightValue(userBattleStats, targetBattleStats) {
    const own = finitePositive(userBattleStats);
    const opponent = finitePositive(targetBattleStats);
    if (own === null || opponent === null) return null;
    return Number(Math.min(3, Math.max(1, 1 + (8 / 3) * (opponent / own))).toFixed(2));
}

function assignmentConfidence(target, now) {
    const checkedAt = Math.max(0, Number(target?.battle_stats_checked_at) || 0);
    if (!checkedAt) return 'rough · age unknown';
    const ageDays = Math.max(0, (now - checkedAt) / (24 * 60 * 60 * 1000));
    if (ageDays <= 7) return 'rough · recent estimate';
    if (ageDays <= 21) return 'rough · aging estimate';
    return 'rough · stale estimate';
}

function normalizeUnixSeconds(value) {
    const number = Math.max(0, Number(value) || 0);
    return Math.trunc(number > 10_000_000_000 ? number / 1000 : number);
}

function finitePositive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
}

function boundedNumber(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
}

async function registerNewFairFightTargets(bucket, index, ids, now) {
    const pendingRecord = await readJson(bucket, PENDING_KEY, { schema:1, ids:[], updated_at:0 });
    const pending = new Set(pendingRecord.value.ids.map(Number).filter(Number.isInteger));
    const grouped = new Map();
    for (const rawId of ids) {
        const id = positiveInteger(rawId);
        if (!id) continue;
        const shardNumber = fairFightShardForTarget(id);
        if (!grouped.has(shardNumber)) grouped.set(shardNumber, []);
        grouped.get(shardNumber).push(id);
        pending.add(id);
    }
    for (const [shardNumber, targetIds] of grouped) {
        const record = await readJson(bucket, fairFightShardKey(shardNumber), emptyFairFightShard(shardNumber));
        for (const id of targetIds) {
            const key = String(id);
            if (!record.value.targets[key]) {
                record.value.targets[key] = { id, assigned_at:now, last_attempted_at:0, last_success_at:0 };
            }
        }
        record.value.updated_at = now;
        await putJson(bucket, fairFightShardKey(shardNumber), record.value);
    }
    pendingRecord.value.ids = [...pending];
    pendingRecord.value.updated_at = now;
    await putJson(bucket, PENDING_KEY, pendingRecord.value);
}

async function processFairFight(env, index, dirtyShards, dependencies, now) {
    const due = now - Number(index.fair_fight_last_request_at || 0) >= FAIR_FIGHT_REQUEST_INTERVAL_MS;
    if (!env.FFSCOUTER_API_KEY || !due) return { attempted:0, checked:0, shard:null };

    const pendingRecord = await readJson(env.MUGGING_BUCKET, PENDING_KEY, { schema:1, ids:[], updated_at:0 });
    const pendingIds = pendingRecord.value.ids.map(Number).filter(Number.isInteger);
    const dailyShard = Math.floor(now / (24 * 60 * 60 * 1000)) % FAIR_FIGHT_SHARD_COUNT;
    const records = new Map();
    const candidates = [];

    for (const id of pendingIds) {
        if (candidates.length >= FAIR_FIGHT_BATCH_SIZE) break;
        const shardNumber = fairFightShardForTarget(id);
        let record = records.get(shardNumber);
        if (!record) {
            record = await readJson(env.MUGGING_BUCKET, fairFightShardKey(shardNumber), emptyFairFightShard(shardNumber));
            records.set(shardNumber, record);
        }
        const entry = record.value.targets[String(id)];
        if (entry) candidates.push({ id, shardNumber, entry, pending:true });
    }

    if (candidates.length < FAIR_FIGHT_BATCH_SIZE) {
        let record = records.get(dailyShard);
        if (!record) {
            record = await readJson(env.MUGGING_BUCKET, fairFightShardKey(dailyShard), emptyFairFightShard(dailyShard));
            records.set(dailyShard, record);
        }
        const pendingSet = new Set(candidates.map(row => row.id));
        const stale = Object.values(record.value.targets)
            .filter(row => {
                const refreshedAt = Math.max(
                    Number(row.last_attempted_at) || 0,
                    Number(row.last_success_at) || 0,
                    Number(row.observed_at) || 0
                );
                return !pendingSet.has(Number(row.id)) && now - refreshedAt >= FAIR_FIGHT_REFRESH_MS;
            })
            .sort((left, right) => Number(left.last_attempted_at || 0) - Number(right.last_attempted_at || 0));
        for (const entry of stale) {
            if (candidates.length >= FAIR_FIGHT_BATCH_SIZE) break;
            candidates.push({ id:Number(entry.id), shardNumber:dailyShard, entry, pending:false });
        }
    }

    if (!candidates.length) return { attempted:0, checked:0, shard:dailyShard };

    index.fair_fight_last_request_at = now;
    const attemptedIds = new Set(candidates.map(row => row.id));
    pendingRecord.value.ids = pendingIds.filter(id => !attemptedIds.has(id));
    pendingRecord.value.updated_at = now;
    await putJson(env.MUGGING_BUCKET, PENDING_KEY, pendingRecord.value);
    for (const candidate of candidates) candidate.entry.last_attempted_at = now;
    for (const [shardNumber, record] of records) {
        record.value.updated_at = now;
        await putJson(env.MUGGING_BUCKET, fairFightShardKey(shardNumber), record.value);
    }

    const fetchFairFight = typeof dependencies.fetchFairFight === 'function'
        ? dependencies.fetchFairFight
        : core.fetchFairFight;
    try {
        const rows = await fetchFairFight(candidates.map(row => row.id), env.FFSCOUTER_API_KEY);
        const byId = new Map(rows.map(row => [positiveInteger(row?.player_id ?? row?.id ?? row?.user_id), row]));
        let checked = 0;
        for (const candidate of candidates) {
            const row = byId.get(candidate.id);
            if (!row) continue;
            candidate.entry.last_success_at = now;
            candidate.entry.battle_stats_estimate = finiteNumber(row?.bs_estimate ?? row?.battle_stats_estimate ?? row?.total_stats);
            candidate.entry.fair_fight = finiteNumber(row?.fair_fight ?? row?.fairFight ?? row?.ff);
            const stateShardNumber = Number(index.target_shards[String(candidate.id)]);
            if (Number.isInteger(stateShardNumber)) {
                const stateShard = await getDirtyStateShard(env.MUGGING_BUCKET, dirtyShards, stateShardNumber);
                const target = stateShard.targets[String(candidate.id)];
                if (target) {
                    if (candidate.entry.battle_stats_estimate !== null) {
                        target.battle_stats_estimate = candidate.entry.battle_stats_estimate;
                        target.battle_stats_source = 'fair_fight';
                        target.battle_stats_checked_at = now;
                    }
                    if (candidate.entry.fair_fight !== null) {
                        target.fair_fight = candidate.entry.fair_fight;
                        target.fair_fight_checked_at = now;
                    }
                }
            }
            checked++;
        }
        for (const [shardNumber, record] of records) {
            record.value.updated_at = now;
            await putJson(env.MUGGING_BUCKET, fairFightShardKey(shardNumber), record.value);
        }
        index.fair_fight_last_success_at = now;
        index.fair_fight_last_error = '';
        return { attempted:candidates.length, checked, shard:dailyShard };
    } catch (error) {
        index.fair_fight_last_error_at = now;
        index.fair_fight_last_error = errorMessage(error).slice(0, 500);
        return { attempted:candidates.length, checked:0, shard:dailyShard };
    }
}

async function ensureShardedStorage(bucket, now) {
    const existing = await readJson(bucket, INDEX_KEY, null);
    if (existing.value) {
        existing.value = normalizeIndex(existing.value);
        return { index:existing.value, record:existing, migrated:false };
    }

    const legacyObject = await bucket.get(LEGACY_STATE_KEY);
    const legacy = legacyObject ? await legacyObject.json() : null;
    const index = emptyIndex();
    index.created_at = now;
    index.updated_at = now;
    const stateShards = Array.from({ length:STATE_SHARD_COUNT }, (_, shard) => emptyStateShard(shard));
    const fairFightShards = Array.from({ length:FAIR_FIGHT_SHARD_COUNT }, (_, shard) => emptyFairFightShard(shard));
    const pendingIds = [];

    if (legacy && typeof legacy === 'object') {
        index.phase = String(legacy.phase || 'baseline');
        index.catalog_ruleset_version = Number(legacy.catalog_ruleset_version) || 0;
        index.catalog_updated_at = Number(legacy.catalog_updated_at) || 0;
        index.company_ids = Array.isArray(legacy.company_ids) ? legacy.company_ids.map(Number).filter(Number.isInteger) : [];
        index.companies = legacy.companies && typeof legacy.companies === 'object' ? legacy.companies : {};
        index.last_cycle_completed_at = Number(legacy.last_cycle_completed_at) || 0;
        index.fair_fight_last_request_at = Number(legacy.fair_fight_last_request_at) || 0;
        index.fair_fight_last_success_at = Number(legacy.fair_fight_last_success_at) || 0;
        index.fair_fight_last_error_at = Number(legacy.fair_fight_last_error_at) || 0;
        index.fair_fight_last_error = String(legacy.fair_fight_last_error || '');
        index.migrated_from_v1_at = now;
        for (const companyId of index.company_ids) {
            const shardNumber = stateShardForCompany(companyId);
            stateShards[shardNumber].company_ids.push(companyId);
        }
        for (const [key, rawTarget] of Object.entries(legacy.targets || {})) {
            const id = positiveInteger(rawTarget?.id ?? key);
            if (!id) continue;
            const companyId = positiveInteger(rawTarget?.company_id);
            const stateShardNumber = companyId ? stateShardForCompany(companyId) : stateShardForTarget(id);
            const fairFightShardNumber = fairFightShardForTarget(id);
            stateShards[stateShardNumber].targets[String(id)] = rawTarget;
            index.target_shards[String(id)] = stateShardNumber;
            const ffEntry = {
                id,
                assigned_at:Number(rawTarget.first_seen_at) || now,
                last_attempted_at:Math.max(
                    Number(rawTarget.ff_last_attempted_at) || 0,
                    Number(rawTarget.ff_initial_attempted_at) || 0,
                    Number(rawTarget.fair_fight_checked_at) || 0
                ),
                last_success_at:Number(rawTarget.fair_fight_checked_at) || 0,
                observed_at:Number(rawTarget.battle_stats_checked_at) || 0
            };
            if (finiteNumber(rawTarget.battle_stats_estimate) !== null) {
                ffEntry.battle_stats_estimate = Number(rawTarget.battle_stats_estimate);
            }
            if (finiteNumber(rawTarget.fair_fight) !== null) ffEntry.fair_fight = Number(rawTarget.fair_fight);
            fairFightShards[fairFightShardNumber].targets[String(id)] = ffEntry;
            if (!ffEntry.last_attempted_at && !ffEntry.observed_at) pendingIds.push(id);
        }
    }

    for (const shard of stateShards) {
        shard.updated_at = now;
        index.shard_summaries[String(shard.shard)] = summarizeShard(shard, now);
        await putJson(bucket, stateShardKey(shard.shard), shard);
    }
    for (const shard of fairFightShards) {
        shard.updated_at = now;
        await putJson(bucket, fairFightShardKey(shard.shard), shard);
    }
    await putJson(bucket, PENDING_KEY, { schema:1, ids:pendingIds, updated_at:now });
    index.summary = summarizeIndex(index, {});
    await putJson(bucket, INDEX_KEY, index);
    return { index, record:{ value:index, etag:null }, migrated:Boolean(legacy) };
}

function emptyIndex() {
    return {
        schema:STATE_SCHEMA,
        phase:'catalog',
        catalog_ruleset_version:0,
        catalog_updated_at:0,
        company_ids:[],
        companies:{},
        target_shards:{},
        monitor_shard_cursor:0,
        shard_company_cursors:{},
        shard_summaries:{},
        shards_completed_in_cycle:0,
        last_cycle_completed_at:0,
        fair_fight_last_request_at:0,
        fair_fight_last_success_at:0,
        fair_fight_last_error_at:0,
        fair_fight_last_error:'',
        created_at:0,
        updated_at:0,
        last_run:null,
        summary:null
    };
}

function normalizeIndex(value) {
    const index = value && typeof value === 'object' ? value : {};
    return {
        ...emptyIndex(),
        ...index,
        company_ids:Array.isArray(index.company_ids) ? index.company_ids.map(Number).filter(Number.isInteger) : [],
        companies:index.companies && typeof index.companies === 'object' ? index.companies : {},
        target_shards:index.target_shards && typeof index.target_shards === 'object' ? index.target_shards : {},
        shard_company_cursors:index.shard_company_cursors && typeof index.shard_company_cursors === 'object'
            ? index.shard_company_cursors
            : {},
        shard_summaries:index.shard_summaries && typeof index.shard_summaries === 'object'
            ? index.shard_summaries
            : {}
    };
}

function emptyStateShard(shard) {
    return { schema:STATE_SCHEMA, shard, company_ids:[], targets:{}, updated_at:0 };
}

function emptyFairFightShard(shard) {
    return { schema:1, shard, targets:{}, updated_at:0 };
}

function applyCatalogToIndex(index, catalog, now) {
    const previous = index.companies || {};
    index.companies = Object.fromEntries(catalog.companies.map(company => [String(company.id), {
        ...previous[String(company.id)],
        ...company,
        catalog_seen_at:now
    }]));
    index.company_ids = catalog.companies.map(company => Number(company.id));
    index.catalog_ruleset_version = Number(catalog.ruleset_version) || CATALOG_RULESET_VERSION;
    index.catalog_updated_at = now;
    index.monitor_shard_cursor = 0;
    index.shard_company_cursors = {};
    index.shards_completed_in_cycle = 0;
    if (!index.last_cycle_completed_at) index.phase = 'baseline';
}

function selectNextStateShard(index) {
    if (!index.company_ids.length) return null;
    const start = boundedInteger(index.monitor_shard_cursor, 0, 0, STATE_SHARD_COUNT - 1);
    for (let offset = 0; offset < STATE_SHARD_COUNT; offset++) {
        const shard = (start + offset) % STATE_SHARD_COUNT;
        if (companyIdsForShard(index, shard).length) return shard;
    }
    return null;
}

function companyIdsForShard(index, shard) {
    return index.company_ids.filter(companyId => stateShardForCompany(companyId) === shard);
}

function nonEmptyStateShardCount(index) {
    const shards = new Set(index.company_ids.map(stateShardForCompany));
    return Math.max(1, shards.size);
}

function stateShardForCompany(companyId) {
    return positiveInteger(companyId) % STATE_SHARD_COUNT;
}

function stateShardForTarget(targetId) {
    return positiveInteger(targetId) % STATE_SHARD_COUNT;
}

function fairFightShardForTarget(targetId) {
    return positiveInteger(targetId) % FAIR_FIGHT_SHARD_COUNT;
}

function stateShardKey(shard) {
    return 'mugging/state/v2/targets/shard-' + String(shard).padStart(2, '0') + '.json';
}

function fairFightShardKey(shard) {
    return 'mugging/fair-fight/v2/shards/shard-' + String(shard).padStart(2, '0') + '.json';
}

async function loadStateShard(bucket, shardNumber) {
    const record = await readJson(bucket, stateShardKey(shardNumber), emptyStateShard(shardNumber));
    const shard = record.value && typeof record.value === 'object' ? record.value : emptyStateShard(shardNumber);
    shard.shard = shardNumber;
    shard.company_ids = Array.isArray(shard.company_ids) ? shard.company_ids.map(Number).filter(Number.isInteger) : [];
    shard.targets = shard.targets && typeof shard.targets === 'object' ? shard.targets : {};
    return shard;
}

async function getDirtyStateShard(bucket, dirtyShards, shardNumber) {
    if (!dirtyShards.has(shardNumber)) {
        dirtyShards.set(shardNumber, await loadStateShard(bucket, shardNumber));
    }
    return dirtyShards.get(shardNumber);
}

async function readJson(bucket, key, fallback) {
    const object = await bucket.get(key);
    if (!object) return { value:fallback, etag:null };
    try {
        return { value:await object.json(), etag:object.etag || null };
    } catch {
        throw new Error('The R2 object ' + key + ' is unreadable.');
    }
}

async function putJson(bucket, key, value) {
    return bucket.put(key, JSON.stringify(value), jsonMetadata());
}

async function writeIndex(bucket, record, index) {
    const options = jsonMetadata();
    if (record?.etag) options.onlyIf = { etagMatches:record.etag };
    const written = await bucket.put(INDEX_KEY, JSON.stringify(index), options);
    if (record?.etag && !written) throw new Error('The mugging shard index changed during this run.');
}

function summarizeShard(shard, now) {
    let unavailable = 0;
    let lowValue = 0;
    for (const target of Object.values(shard.targets || {})) {
        if (Number(target.free_at) > now) unavailable++;
        if (Number(target.low_value_ratio) >= 0.6 && Number(target.mug_report_count) >= 3) lowValue++;
    }
    return {
        target_count:Object.keys(shard.targets || {}).length,
        unavailable_count:unavailable,
        consistently_low_value_count:lowValue,
        updated_at:now
    };
}

function summarizeIndex(index, capacity) {
    const shardSummaries = Object.values(index.shard_summaries || {});
    const companyCount = index.company_ids.length;
    const effectiveCalls = Number(capacity.callBudget) ||
        Number(index.last_run?.call_budget) ||
        Number(index.last_run?.external_calls) || 0;
    return {
        company_count:companyCount,
        target_count:shardSummaries.reduce((sum, row) => sum + Number(row.target_count || 0), 0),
        unavailable_count:shardSummaries.reduce((sum, row) => sum + Number(row.unavailable_count || 0), 0),
        consistently_low_value_count:shardSummaries.reduce(
            (sum, row) => sum + Number(row.consistently_low_value_count || 0),
            0
        ),
        configured_key_count:Number(capacity.keyCount) || Number(index.last_run?.key_count) || 0,
        configured_calls_per_minute:Number(capacity.configuredCapacity) ||
            Number(index.last_run?.configured_capacity) || 0,
        available_calls_at_run_start:Number(capacity.availableAtStart) || 0,
        calls_budgeted_this_run:Number(capacity.callBudget) || 0,
        calls_used_last_run:Number(capacity.callsUsed) || 0,
        estimated_cycle_minutes:companyCount && effectiveCalls
            ? Math.max(nonEmptyStateShardCount(index), Math.ceil(companyCount / effectiveCalls))
            : 0,
        target_cycle_minutes:15,
        capacity_meets_target:companyCount === 0 || (
            effectiveCalls > 0 &&
            Math.max(nonEmptyStateShardCount(index), Math.ceil(companyCount / effectiveCalls)) <= 15
        )
    };
}

function statusFromIndex(index) {
    return {
        storage_schema:STATE_SCHEMA,
        state_shards:STATE_SHARD_COUNT,
        fair_fight_shards:FAIR_FIGHT_SHARD_COUNT,
        phase:index.phase,
        catalog_ruleset_version:Number(index.catalog_ruleset_version) || 0,
        catalog_updated_at:Number(index.catalog_updated_at) || 0,
        companies_total:index.company_ids.length,
        companies_checked_in_cycle:Number(index.shards_completed_in_cycle) || 0,
        company_cursor:Number(index.monitor_shard_cursor) || 0,
        targets_total:Number(index.summary?.target_count) || 0,
        last_cycle_completed_at:Number(index.last_cycle_completed_at) || 0,
        updated_at:Number(index.updated_at) || 0,
        last_run:index.last_run || null,
        fair_fight:{
            batch_size:FAIR_FIGHT_BATCH_SIZE,
            request_interval_ms:FAIR_FIGHT_REQUEST_INTERVAL_MS,
            target_refresh_ms:FAIR_FIGHT_REFRESH_MS,
            shard_count:FAIR_FIGHT_SHARD_COUNT,
            daily_shard:true,
            new_targets_immediate:true,
            last_request_at:Number(index.fair_fight_last_request_at) || 0,
            next_request_at:Number(index.fair_fight_last_request_at)
                ? Number(index.fair_fight_last_request_at) + FAIR_FIGHT_REQUEST_INTERVAL_MS
                : 0,
            last_success_at:Number(index.fair_fight_last_success_at) || 0,
            last_error_at:Number(index.fair_fight_last_error_at) || 0,
            last_error:String(index.fair_fight_last_error || '')
        },
        summary:index.summary || null
    };
}

async function writeStatus(bucket, status) {
    await putJson(bucket, STATUS_KEY, status);
}

async function claimMonitorRun(env, now) {
    const retryAt = now + RUN_LEASE_MS;
    const sql = [
        'INSERT INTO mugging_runtime (',
        ' singleton, next_run_at, last_run_at,',
        " last_completed_at, last_result, updated_at",
        ") VALUES (1, ?1, ?2, NULL, 'running', ?2)",
        'ON CONFLICT(singleton) DO UPDATE SET',
        ' next_run_at = excluded.next_run_at,',
        ' last_run_at = excluded.last_run_at,',
        " last_result = 'running',",
        ' updated_at = excluded.updated_at',
        'WHERE mugging_runtime.next_run_at <= ?2'
    ].join('\n');
    const result = await env.MUGGING_DB.prepare(sql).bind(retryAt, now).run();
    if (Number(result.meta?.changes)) return { claimed:true, retryAt };
    const row = await env.MUGGING_DB.prepare(
        'SELECT next_run_at FROM mugging_runtime WHERE singleton = 1'
    ).first();
    return { claimed:false, retryAt:Number(row?.next_run_at) || retryAt };
}

async function recordMonitorResult(env, now, nextAttemptAt, result) {
    const sql = [
        'UPDATE mugging_runtime',
        'SET next_run_at = ?2,',
        " last_completed_at = CASE WHEN ?3 IN ('completed', 'partial') THEN ?1 ELSE last_completed_at END,",
        ' last_result = ?3,',
        ' updated_at = ?1',
        'WHERE singleton = 1'
    ].join('\n');
    await env.MUGGING_DB.prepare(sql).bind(now, nextAttemptAt, result).run();
}

function mergeContributionSummary(current, response) {
    return {
        key_count:Number(current.key_count) || Number(response?.key_count) || 0,
        configured_capacity:Number(current.configured_capacity) || Number(response?.configured_capacity) || 0,
        available_capacity:Number(current.available_capacity) || Number(response?.available_capacity) || 0
    };
}

async function writeEventBatch(bucket, kind, events, now) {
    if (!events.length) return;
    const date = new Date(now);
    const day = date.toISOString().slice(0, 10);
    const key = EVENT_PREFIX + '/' + day + '/' +
        date.toISOString().replace(/[:.]/g, '-') + '-' + kind + '-' + crypto.randomUUID() + '.json';
    await putJson(bucket, key, { schema:1, kind, generated_at:now, events });
}

function jsonMetadata() {
    return { httpMetadata:{ contentType:'application/json', cacheControl:'no-store' } };
}

function boundedInteger(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, Math.trunc(numeric))) : fallback;
}

function positiveInteger(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : 0;
}

function finiteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}

export const testing = Object.freeze({
    ...core,
    ensureShardedStorage,
    fairFightShardForTarget,
    contributorTaskAssignments,
    roughFairFightValue,
    roughMuggingAssignments,
    selectNextStateShard,
    stateShardForCompany,
    stateShardForTarget
});

