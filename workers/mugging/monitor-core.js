const STATE_KEY = 'mugging/state/v1.json';
const STATUS_KEY = 'mugging/status/v1.json';
const CATALOG_KEY = 'mugging/catalog/companies-v1.json';
const EVENT_PREFIX = 'mugging/events';
const STATE_SCHEMA = 1;
const DEFAULT_MAX_CALLS_PER_RUN = 100;
const MAX_CALLS_PER_RUN = 1_000;
const CATALOG_REFRESH_MS = 24 * 60 * 60 * 1000;
const RUN_LOCK_MS = 55 * 1000;
const MUG_COOLDOWN_MS = 11 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FAIR_FIGHT_BATCH_SIZE = 100;
const MAX_REPORTS_PER_REQUEST = 100;

const COMPANY_RULES = Object.freeze([
    { names: ['oil rig'], ratings: new Set([7, 8, 9]) },
    { names: ['mining corporation', 'mining corp'], ratings: new Set([9, 10]) },
    { names: ['television network', 'tv station', 'television'], ratings: new Set([9, 10]) },
    { names: ['logistics management', 'logistics'], ratings: new Set([9, 10]) }
]);


export async function runMuggingMonitor(env, dependencies = {}, options = {}) {
    if (!env.MUGGING_DB || !env.MUGGING_BUCKET) {
        return {
            active: false,
            reason: !env.MUGGING_DB ? 'database_not_configured' : 'r2_not_configured'
        };
    }
    const executePublicRequests = dependencies.executePublicRequests;
    if (typeof executePublicRequests !== 'function') {
        return { active: false, reason: 'contribution_broker_not_configured' };
    }

    const now = Number(options.now) || Date.now();
    const lock = await claimMonitorRun(env, now);
    if (!lock.claimed) {
        return { active: true, deferred: true, reason: 'monitor_already_running', retry_at: lock.retryAt };
    }

    const maxCalls = boundedInteger(
        options.maxCalls ?? env.MUGGING_MAX_CALLS_PER_RUN,
        DEFAULT_MAX_CALLS_PER_RUN,
        1,
        MAX_CALLS_PER_RUN
    );

    let stateRecord = await readState(env.MUGGING_BUCKET);
    let state = stateRecord.state;
    let remainingCalls = maxCalls;
    let catalogUpdate = null;
    const scanResults = [];
    let contributionSummary = { key_count:0, configured_capacity:0, available_capacity:0 };

    if (!state.company_ids.length || now - Number(state.catalog_updated_at || 0) >= CATALOG_REFRESH_MS) {
        if (remainingCalls >= 2) {
            try {
                const response = await executePublicRequests([
                    { request_id:'company-types', kind:'company.types' },
                    { request_id:'company-snapshot', kind:'company.snapshot' }
                ]);
                contributionSummary = response || contributionSummary;
                const byId = new Map((response?.results || []).map(result => [result.request_id, result]));
                const typesResult = byId.get('company-types');
                const snapshotResult = byId.get('company-snapshot');
                if (!typesResult?.ok || !snapshotResult?.ok) {
                    throw new Error(typesResult?.error || snapshotResult?.error || 'Company catalog collection failed.');
                }
                remainingCalls -= 2;
                const companies = selectMuggingCompanies(snapshotResult.body, typesResult.body);
                catalogUpdate = { generated_at: now, companies };
                await env.MUGGING_BUCKET.put(CATALOG_KEY, JSON.stringify(catalogUpdate), jsonMetadata());
            } catch (error) {
                console.error(JSON.stringify({ event:'slink_mugging_catalog_failed', error:errorMessage(error) }));
            }
        }
    }

    const effectiveCompanies = catalogUpdate?.companies || state.company_ids.map(id => state.companies[String(id)]).filter(Boolean);
    const companyIds = effectiveCompanies.map(company => Number(company.id)).filter(Number.isInteger);
    let cursor = catalogUpdate ? 0 : Math.max(0, Number(state.company_cursor) || 0);
    let callsMade = maxCalls - remainingCalls;
    const requests = [];
    while (remainingCalls > 0 && companyIds.length && requests.length < companyIds.length) {
        const companyId = companyIds[cursor % companyIds.length];
        cursor = (cursor + 1) % companyIds.length;
        remainingCalls--;
        callsMade++;
        requests.push({ request_id:`company-${companyId}`, kind:'company.employees', company_id:companyId });
    }
    if (requests.length) {
        try {
            const response = await executePublicRequests(requests);
            contributionSummary = response || contributionSummary;
            for (const result of response?.results || []) {
                const companyId = positiveInteger(String(result.request_id || '').replace('company-', ''));
                const company = effectiveCompanies.find(row => Number(row.id) === companyId) || { id:companyId };
                if (result.ok) {
                    scanResults.push({ company, employees:normalizeCompanyEmployees(result.body), checked_at:now });
                } else {
                    scanResults.push({ company, employees:null, checked_at:now, error:result.error || 'Collection failed.' });
                }
            }
        } catch (error) {
            for (const request of requests) {
                const companyId = positiveInteger(String(request.request_id).replace('company-', ''));
                const company = effectiveCompanies.find(row => Number(row.id) === companyId) || { id:companyId };
                scanResults.push({ company, employees:null, checked_at:now, error:errorMessage(error) });
            }
        }
    }

    const initialFfIds = [];
    const commit = await mutateState(env.MUGGING_BUCKET, current => {
        if (catalogUpdate) applyCatalog(current, catalogUpdate, now);
        const events = [];
        for (const result of scanResults) {
            const merged = mergeCompanyScan(current, result, now);
            events.push(...merged.events);
            initialFfIds.push(...merged.newTargetIds);
        }
        if (current.company_ids.length) {
            current.company_cursor = cursor % current.company_ids.length;
            current.companies_checked_in_cycle = Number(current.companies_checked_in_cycle || 0) + scanResults.length;
            if (current.companies_checked_in_cycle >= current.company_ids.length) {
                current.companies_checked_in_cycle %= current.company_ids.length;
                current.last_cycle_completed_at = now;
                current.cycle_started_at = now;
                if (current.phase === 'baseline') current.phase = 'monitoring';
            }
        }
        current.updated_at = now;
        current.last_run = {
            at: now,
            companies_checked: scanResults.length,
            errors: scanResults.filter(row => row.error).length,
            external_calls: callsMade,
            key_count: Number(contributionSummary?.key_count) || 0
        };
        current.summary = summarizeState(
            current,
            Number(contributionSummary?.key_count) || 0,
            Math.min(
                maxCalls,
                Number(contributionSummary?.configured_capacity) || maxCalls
            ),
            now
        );
        return { events };
    });
    stateRecord = commit.record;
    state = stateRecord.state;

    let fairFightChecked = 0;
    if (env.FFSCOUTER_API_KEY) {
        const uniqueInitialIds = [...new Set(initialFfIds)]
            .filter(id => !state.targets[String(id)]?.ff_initial_attempted_at)
            .slice(0, FAIR_FIGHT_BATCH_SIZE);
        if (uniqueInitialIds.length) {
            try {
                const rows = await fetchFairFight(uniqueInitialIds, env.FFSCOUTER_API_KEY);
                await mutateState(env.MUGGING_BUCKET, current => {
                    applyFairFightRows(current, uniqueInitialIds, rows, now);
                    current.updated_at = now;
                    return {};
                });
                fairFightChecked = uniqueInitialIds.length;
                callsMade++;
            } catch (error) {
                console.error(JSON.stringify({ event:'slink_mugging_ffscouter_failed', error:errorMessage(error) }));
            }
        }
    }

    const events = commit.result.events || [];
    if (events.length) await writeEventBatch(env.MUGGING_BUCKET, 'status', events, now);
    await writeStatus(env.MUGGING_BUCKET, state);
    await recordMonitorResult(env, now, now + RUN_LOCK_MS, scanResults.some(row => row.error) ? 'partial' : 'completed');
    return {
        active: true,
        phase: state.phase,
        calls: callsMade,
        keys_available: Number(contributionSummary?.key_count) || 0,
        companies_checked: scanResults.length,
        companies_total: state.company_ids.length,
        targets_total: Object.keys(state.targets).length,
        mug_events: events.length,
        fair_fight_initial_checks: fairFightChecked,
        estimated_cycle_minutes: state.summary?.estimated_cycle_minutes || 0,
        target_cycle_minutes: 15,
        capacity_meets_target: state.summary?.capacity_meets_target === true
    };
}


export async function ingestMuggingReports(env, rawReports, now = Date.now()) {
    if (!env.MUGGING_BUCKET) throw new Error('The MUGGING_BUCKET binding is required.');
    const reports = normalizeReports(rawReports, now);
    if (!reports.length) return { accepted:0, events:0 };
    const commit = await mutateState(env.MUGGING_BUCKET, state => {
        const events = [];
        for (const report of reports) {
            const target = ensureTarget(state, report.target_id, report.name, now);
            if (report.mugged_at) {
                recordMug(target, report.mugged_at, report.source, report.amount, events);
            }
            if (report.amount !== null) recordMugValue(target, report.amount);
            applyBattleStats(target, report, now);
            target.priority_multiplier = priorityMultiplier(target, now);
        }
        state.updated_at = now;
        state.summary = summarizeState(state, 0, 0, now);
        return { events };
    });
    const events = commit.result.events || [];
    await writeEventBatch(env.MUGGING_BUCKET, 'client', reports, now);
    await writeStatus(env.MUGGING_BUCKET, commit.record.state);
    return { accepted:reports.length, events:events.length };
}


export async function muggingStatus(env) {
    if (!env.MUGGING_BUCKET) return { configured:false, reason:'r2_not_configured' };
    const compact = await env.MUGGING_BUCKET.get(STATUS_KEY);
    if (compact) return { configured:true, ...await compact.json() };
    const { state } = await readState(env.MUGGING_BUCKET);
    return { configured:true, ...statusFromState(state) };
}


function statusFromState(state) {
    return {
        phase: state.phase,
        catalog_updated_at: Number(state.catalog_updated_at) || 0,
        companies_total: state.company_ids.length,
        companies_checked_in_cycle: Number(state.companies_checked_in_cycle) || 0,
        company_cursor: Number(state.company_cursor) || 0,
        targets_total: Object.keys(state.targets).length,
        last_cycle_completed_at: Number(state.last_cycle_completed_at) || 0,
        updated_at: Number(state.updated_at) || 0,
        last_run: state.last_run || null,
        summary: state.summary || null
    };
}


async function writeStatus(bucket, state) {
    await bucket.put(STATUS_KEY, JSON.stringify(statusFromState(state)), jsonMetadata());
}


async function claimMonitorRun(env, now) {
    const retryAt = now + RUN_LOCK_MS;
    const result = await env.MUGGING_DB.prepare(`
        INSERT INTO mugging_runtime (
            singleton, next_run_at, last_run_at,
            last_completed_at, last_result, updated_at
        ) VALUES (1, ?1, ?2, NULL, 'running', ?2)
        ON CONFLICT(singleton) DO UPDATE SET
            next_run_at = excluded.next_run_at,
            last_run_at = excluded.last_run_at,
            last_result = 'running',
            updated_at = excluded.updated_at
        WHERE mugging_runtime.next_run_at <= ?2
    `).bind(retryAt, now).run();
    if (Number(result.meta?.changes)) return { claimed:true, retryAt };
    const row = await env.MUGGING_DB.prepare(`
        SELECT next_run_at FROM mugging_runtime WHERE singleton = 1
    `).first();
    return { claimed:false, retryAt:Number(row?.next_run_at) || retryAt };
}


async function recordMonitorResult(env, now, nextAttemptAt, result) {
    await env.MUGGING_DB.prepare(`
        UPDATE mugging_runtime
        SET next_run_at = ?2,
            last_completed_at = CASE WHEN ?3 IN ('completed', 'partial') THEN ?1 ELSE last_completed_at END,
            last_result = ?3,
            updated_at = ?1
        WHERE singleton = 1
    `).bind(now, nextAttemptAt, result).run();
}


function selectMuggingCompanies(snapshotText, typesPayload) {
    const typeNames = companyTypeNames(typesPayload);
    const companies = [];
    for (const row of parseCsv(snapshotText)) {
        const id = positiveInteger(row.id);
        const rating = boundedInteger(row.rating, 0, 0, 10);
        const rawType = String(row.type || '').trim();
        const typeId = positiveInteger(rawType) || 0;
        const typeName = normalizeText(typeNames.get(typeId) || rawType);
        const rule = COMPANY_RULES.find(candidate => candidate.names.some(name => typeName === name || typeName.includes(name)));
        if (!id || !rule || !rule.ratings.has(rating)) continue;
        companies.push({
            id,
            name:String(row.name || `Company ${id}`).trim().slice(0, 120),
            type_id:typeId,
            type_name:typeNames.get(typeId) || rawType,
            rating,
            employees_hired:boundedInteger(row.employees_hired, 0, 0, 10_000),
            employees_capacity:boundedInteger(row.employees_capacity, 0, 0, 10_000)
        });
    }
    return companies.sort((left, right) => left.type_name.localeCompare(right.type_name) || right.rating - left.rating || left.id - right.id);
}


function companyTypeNames(payload) {
    const source = payload?.companies ?? payload?.company_types ?? payload?.types ?? payload;
    const entries = Array.isArray(source) ? source.map(row => [row?.id ?? row?.type_id, row]) : Object.entries(source || {});
    const result = new Map();
    for (const [key, row] of entries) {
        const id = positiveInteger(row?.id ?? row?.type_id ?? key);
        const name = String(row?.name ?? row?.type ?? row?.title ?? '').trim();
        if (id && name) result.set(id, name);
    }
    return result;
}


function normalizeCompanyEmployees(payload) {
    const source = payload?.company_employees ?? payload?.employees ?? payload?.company?.employees ?? [];
    const rows = Array.isArray(source) ? source : Object.entries(source || {}).map(([id, row]) => ({ id, ...row }));
    return rows.map(row => {
        const id = positiveInteger(row?.id ?? row?.user_id ?? row?.player_id);
        if (!id) return null;
        const status = row?.status ?? row?.user?.status ?? {};
        return {
            id,
            name:String(row?.name ?? row?.user?.name ?? `Player ${id}`).trim().slice(0, 80),
            position:String(row?.position ?? row?.position_name ?? '').trim().slice(0, 100),
            status_state:String(status?.state ?? row?.state ?? 'Unknown').trim().slice(0, 50),
            status_description:String(status?.description ?? status?.details ?? row?.status_description ?? '').trim().slice(0, 500),
            status_until:Number(status?.until ?? row?.status_until) || 0
        };
    }).filter(Boolean);
}


function applyCatalog(state, catalog, now) {
    const previousCompanies = state.companies || {};
    state.companies = Object.fromEntries(catalog.companies.map(company => [String(company.id), {
        ...previousCompanies[String(company.id)],
        ...company,
        catalog_seen_at:now
    }]));
    state.company_ids = catalog.companies.map(company => Number(company.id));
    state.catalog_updated_at = now;
    state.company_cursor = 0;
    state.companies_checked_in_cycle = 0;
    state.cycle_started_at = now;
    if (!state.last_cycle_completed_at) state.phase = 'baseline';
}


function mergeCompanyScan(state, result, now) {
    const events = [];
    const newTargetIds = [];
    const companyId = Number(result.company.id);
    const company = state.companies[String(companyId)] || { ...result.company, id:companyId };
    company.last_checked_at = now;
    company.last_error = result.error || '';
    if (!result.employees) {
        state.companies[String(companyId)] = company;
        return { events, newTargetIds };
    }
    company.employee_ids = result.employees.map(row => row.id);
    company.employee_count = result.employees.length;
    for (const employee of result.employees) {
        const existed = Boolean(state.targets[String(employee.id)]);
        const target = ensureTarget(state, employee.id, employee.name, now);
        const signature = mugSignature(employee);
        const isMuggedNow = isMugHospital(employee);
        const mugged = state.phase === 'monitoring' && isMuggedNow && signature !== target.last_mug_signature;
        target.name = employee.name || target.name;
        target.company_id = companyId;
        target.company_name = company.name || `Company ${companyId}`;
        target.company_type = company.type_name || '';
        target.company_rating = Number(company.rating) || 0;
        target.position = employee.position;
        target.status_state = employee.status_state;
        target.status_description = employee.status_description;
        target.status_until = employee.status_until;
        target.last_checked_at = now;
        target.last_seen_at = now;
        if (mugged) recordMug(target, now, 'company_status', null, events);
        target.last_mug_signature = isMuggedNow ? signature : '';
        target.priority_multiplier = priorityMultiplier(target, now);
        if (!existed) newTargetIds.push(employee.id);
    }
    state.companies[String(companyId)] = company;
    return { events, newTargetIds };
}


function ensureTarget(state, id, name, now) {
    const key = String(id);
    if (!state.targets[key]) {
        state.targets[key] = {
            id:Number(id),
            name:String(name || `Player ${id}`).slice(0, 80),
            first_seen_at:now,
            last_seen_at:now,
            recent_mugs:[],
            mug_report_count:0,
            low_value_mug_count:0,
            mug_value_total:0,
            priority_multiplier:1
        };
    }
    return state.targets[key];
}


function isMugHospital(employee) {
    return normalizeText(employee.status_state).includes('hospital') && /\bmugg?(?:ed|ing)?\b/i.test(employee.status_description);
}


function mugSignature(employee) {
    return `${normalizeText(employee.status_state)}|${normalizeText(employee.status_description)}|${Number(employee.status_until) || 0}`;
}


function recordMug(target, muggedAt, source, amount, events) {
    const timestamp = Number(muggedAt) || Date.now();
    const recent = new Set((target.recent_mugs || []).map(Number).filter(value => value >= timestamp - 30 * DAY_MS));
    recent.add(timestamp);
    target.recent_mugs = [...recent].sort((a, b) => a - b).slice(-128);
    target.last_mugged_at = Math.max(Number(target.last_mugged_at) || 0, timestamp);
    target.free_at = earliestFreeAt(timestamp);
    if (amount !== null && amount !== undefined) recordMugValue(target, Number(amount));
    target.priority_multiplier = priorityMultiplier(target, timestamp);
    events.push({
        target_id:target.id,
        target_name:target.name,
        company_id:target.company_id || 0,
        detected_at:timestamp,
        free_at:target.free_at,
        source,
        amount:Number.isFinite(Number(amount)) ? Number(amount) : null
    });
}


function recordMugValue(target, amount) {
    if (!Number.isFinite(amount) || amount < 0) return;
    target.mug_report_count = Number(target.mug_report_count || 0) + 1;
    target.mug_value_total = Number(target.mug_value_total || 0) + amount;
    target.mug_value_average = Math.round(target.mug_value_total / target.mug_report_count);
    if (amount < 300_000) target.low_value_mug_count = Number(target.low_value_mug_count || 0) + 1;
    target.low_value_ratio = target.mug_report_count ? target.low_value_mug_count / target.mug_report_count : 0;
}


function priorityMultiplier(target, now) {
    const mugs = (target.recent_mugs || []).map(Number).filter(value => value >= now - 30 * DAY_MS);
    target.recent_mugs = mugs;
    target.mug_count_7d = mugs.filter(value => value >= now - 7 * DAY_MS).length;
    target.mug_count_30d = mugs.length;
    const heat = mugs.reduce((sum, value) => sum + Math.exp(-(now - value) / (7 * DAY_MS)), 0);
    target.mug_heat = Number(heat.toFixed(4));
    const lowValuePenalty = Number(target.low_value_ratio || 0) * Math.min(4, Number(target.mug_report_count || 0) / 2);
    return Number(Math.max(0.05, 1 / (1 + heat * 0.45 + lowValuePenalty)).toFixed(4));
}


function earliestFreeAt(muggedAt) {
    return Math.min(muggedAt + MUG_COOLDOWN_MS, nextPaydayAt(muggedAt));
}


function nextPaydayAt(from) {
    const date = new Date(from);
    const payday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 18, 5, 0, 0);
    return payday > from ? payday : payday + DAY_MS;
}


async function fetchFairFight(ids, apiKey) {
    const url = new URL('https://ffscouter.com/api/v1/get-stats');
    url.searchParams.set('key', String(apiKey));
    url.searchParams.set('targets', ids.join(','));
    const response = await fetch(url, { headers:{ Accept:'application/json', 'User-Agent':'SLINK-Mugging-Monitor' } });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `FFScouter returned HTTP ${response.status}.`);
    return Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : Array.isArray(body?.results) ? body.results : [];
}


function applyFairFightRows(state, requestedIds, rows, now) {
    const byId = new Map(rows.map(row => [positiveInteger(row?.player_id ?? row?.id ?? row?.user_id), row]));
    for (const id of requestedIds) {
        const target = state.targets[String(id)];
        if (!target || target.ff_initial_attempted_at) continue;
        const row = byId.get(id);
        target.ff_initial_attempted_at = now;
        if (!row) continue;
        const estimate = finiteNumber(row?.bs_estimate ?? row?.battle_stats_estimate ?? row?.total_stats);
        const fairFight = finiteNumber(row?.fair_fight ?? row?.fairFight ?? row?.ff);
        if (estimate !== null && !target.battle_stats_estimate) {
            target.battle_stats_estimate = estimate;
            target.battle_stats_source = 'fair_fight_initial';
            target.battle_stats_checked_at = now;
        }
        if (fairFight !== null) {
            target.fair_fight = fairFight;
            target.fair_fight_checked_at = now;
        }
    }
}


function applyBattleStats(target, report, now) {
    const estimate = finiteNumber(report.battle_stats_estimate);
    const observedAt = Number(report.observed_at) || now;
    if (estimate !== null && (!target.battle_stats_checked_at || observedAt >= target.battle_stats_checked_at)) {
        if (report.battle_stats_source !== 'fair_fight' || !target.battle_stats_estimate) {
            target.battle_stats_estimate = estimate;
            target.battle_stats_source = report.battle_stats_source;
            target.battle_stats_checked_at = observedAt;
        }
    }
    const fairFight = finiteNumber(report.fair_fight);
    if (fairFight !== null && !target.ff_initial_attempted_at) {
        target.fair_fight = fairFight;
        target.fair_fight_checked_at = observedAt;
        target.ff_initial_attempted_at = observedAt;
    }
}


function normalizeReports(value, now) {
    const reports = [];
    for (const row of Array.isArray(value) ? value : []) {
        const targetId = positiveInteger(row?.target_id ?? row?.id);
        if (!targetId) continue;
        const source = ['client_mug', 'attack_page', 'client_scrape', 'fair_fight'].includes(String(row?.source)) ? String(row.source) : 'client_mug';
        const amountValue = finiteNumber(row?.amount ?? row?.mug_amount);
        reports.push({
            target_id:targetId,
            name:String(row?.name || '').slice(0, 80),
            source,
            mugged_at:source === 'client_mug' ? Number(row?.mugged_at ?? row?.observed_at) || now : 0,
            amount:amountValue,
            observed_at:Number(row?.observed_at) || now,
            battle_stats_estimate:finiteNumber(row?.battle_stats_estimate ?? row?.battle_stats),
            battle_stats_source:source === 'fair_fight' ? 'fair_fight' : source,
            fair_fight:finiteNumber(row?.fair_fight)
        });
        if (reports.length >= MAX_REPORTS_PER_REQUEST) break;
    }
    return reports;
}


async function readState(bucket) {
    const object = await bucket.get(STATE_KEY);
    if (!object) return { state:emptyState(), etag:null };
    try {
        return { state:normalizeState(await object.json()), etag:object.etag };
    } catch {
        throw new Error('The mugging R2 state object is unreadable.');
    }
}


async function mutateState(bucket, mutate, attempts = 4) {
    for (let attempt = 0; attempt < attempts; attempt++) {
        const record = await readState(bucket);
        const result = mutate(record.state) || {};
        const options = jsonMetadata();
        options.onlyIf = record.etag ? { etagMatches:record.etag } : { etagDoesNotMatch:'*' };
        const written = await bucket.put(STATE_KEY, JSON.stringify(record.state), options);
        if (written) return { record:{ state:record.state, etag:written.etag }, result };
    }
    throw new Error('The mugging state changed repeatedly; retry the operation.');
}


function emptyState() {
    return {
        schema:STATE_SCHEMA,
        phase:'catalog',
        catalog_updated_at:0,
        company_ids:[],
        companies:{},
        targets:{},
        company_cursor:0,
        companies_checked_in_cycle:0,
        cycle_started_at:0,
        last_cycle_completed_at:0,
        updated_at:0,
        last_run:null,
        summary:null
    };
}


function normalizeState(value) {
    const state = value && typeof value === 'object' ? value : {};
    return {
        ...emptyState(),
        ...state,
        company_ids:Array.isArray(state.company_ids) ? state.company_ids.map(Number).filter(Number.isInteger) : [],
        companies:state.companies && typeof state.companies === 'object' ? state.companies : {},
        targets:state.targets && typeof state.targets === 'object' ? state.targets : {}
    };
}


function summarizeState(state, keyCount, maxCalls, now) {
    const companies = state.company_ids.length;
    const effectiveCalls = maxCalls || Number(state.last_run?.external_calls) || 0;
    const estimatedCycleMinutes = effectiveCalls > 0 ? Math.ceil(companies / effectiveCalls) : 0;
    let unavailable = 0;
    let lowValue = 0;
    for (const target of Object.values(state.targets)) {
        if (Number(target.free_at) > now) unavailable++;
        if (Number(target.low_value_ratio) >= 0.6 && Number(target.mug_report_count) >= 3) lowValue++;
    }
    return {
        company_count:companies,
        target_count:Object.keys(state.targets).length,
        unavailable_count:unavailable,
        consistently_low_value_count:lowValue,
        configured_key_count:Number(keyCount) || Number(state.last_run?.key_count) || 0,
        max_calls_per_minute:effectiveCalls,
        estimated_cycle_minutes:estimatedCycleMinutes,
        target_cycle_minutes:15,
        capacity_meets_target:companies === 0 || (estimatedCycleMinutes > 0 && estimatedCycleMinutes <= 15)
    };
}


async function writeEventBatch(bucket, kind, events, now) {
    if (!events.length) return;
    const date = new Date(now);
    const day = date.toISOString().slice(0, 10);
    const key = `${EVENT_PREFIX}/${day}/${date.toISOString().replace(/[:.]/g, '-')}-${kind}-${crypto.randomUUID()}.json`;
    await bucket.put(key, JSON.stringify({ schema:1, kind, generated_at:now, events }), jsonMetadata());
}


function jsonMetadata() {
    return { httpMetadata:{ contentType:'application/json', cacheControl:'no-store' } };
}


function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < String(text).length; index++) {
        const character = text[index];
        if (quoted) {
            if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; }
            else if (character === '"') quoted = false;
            else cell += character;
        } else if (character === '"') quoted = true;
        else if (character === ',') { row.push(cell); cell = ''; }
        else if (character === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else if (character !== '\r') cell += character;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows.shift().map(value => String(value).trim());
    return rows.filter(values => values.some(value => String(value).trim())).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
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


function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}


function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}


export const testing = Object.freeze({
    applyFairFightRows,
    earliestFreeAt,
    ingestMuggingReports,
    mergeCompanyScan,
    normalizeCompanyEmployees,
    parseCsv,
    priorityMultiplier,
    selectMuggingCompanies
});
