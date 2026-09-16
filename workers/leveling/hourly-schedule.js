const FIVE_MINUTES_MS = 5 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;
const SEVEN_DAYS_MS = 7 * 24 * ONE_HOUR_MS;

export const HOURLY_SCHEDULE_SCHEMA_VERSION = 1;
export const LEVELING_SCHEDULE_KEY = 'leveling/schedule/current.json';
export const LEVELING_DORMANT_KEY = 'leveling/dormant/current.json';
export const LEVELING_BACKUP_PREFIX = 'leveling/backups/';
export const LEVELING_BACKUP_RETENTION = 25;


export function hourlyWindow(now = Date.now()) {
    const validFrom = Math.floor(Number(now) / ONE_HOUR_MS) * ONE_HOUR_MS;
    const validUntil = validFrom + ONE_HOUR_MS;

    return {
        generation: new Date(validFrom).toISOString().slice(0, 13) + ':00:00.000Z',
        validFrom,
        validUntil
    };
}


export function collectorKey(collector) {
    return `${positiveInteger(collector?.user_id)}:${String(
        collector?.session_id || ''
    )}`;
}


export function buildHourlySchedule({
    targets,
    collectors,
    now = Date.now(),
    activityWindowMs = SEVEN_DAYS_MS
}) {
    const window = hourlyWindow(now);
    const collectorRoster = normalizeCollectors(collectors);
    const activeEntries = [];
    const dormantTargets = [];
    let recentlyActiveCount = 0;

    for (const rawTarget of Array.isArray(targets) ? targets : []) {
        const target = normalizeScheduleTarget(rawTarget);
        if (!target) continue;

        if (target.permanent_federal || target.hiding_out) {
            dormantTargets.push(normalizeDormantTarget(target));
            continue;
        }

        if (isRecentlyActive(target, window.validFrom, activityWindowMs)) {
            recentlyActiveCount++;
            continue;
        }

        const dueAt = dueTimesForHour(target, window);
        if (!dueAt.length) continue;
        const freshnessDueAt = dailyFreshnessDueAt(target.id, window.validFrom);

        activeEntries.push({
            id: target.id,
            name: target.name,
            level: target.level,
            total_stats: target.total_stats,
            sources: target.sources,
            has_status: 1,
            previous_status: target.status,
            previous_status_until: target.status_until,
            previous_last_checked_at: target.last_checked_at,
            next_check_at: target.next_check_at_ms,
            competition_score: target.competition_score,
            competition_tier: target.competition_tier,
            recommendation_leased: target.recommendation_leased,
            due_at: dueAt,
            freshness_due_at: dueAt.includes(freshnessDueAt)
                ? freshnessDueAt
                : null
        });
    }

    activeEntries.sort(compareScheduleEntries);
    dormantTargets.sort((left, right) => left.id - right.id);

    const assignments = Object.fromEntries(
        collectorRoster.map(collector => [collector.key, []])
    );
    const collectorLoads = new Map(
        collectorRoster.map(collector => [collector.key, 0])
    );
    const unassigned = [];

    for (const entry of activeEntries) {
        const selected = leastLoadedCollector(collectorRoster, collectorLoads);

        if (!selected) {
            unassigned.push(entry);
            continue;
        }

        assignments[selected.key].push(entry);
        collectorLoads.set(
            selected.key,
            collectorLoads.get(selected.key) + entry.due_at.length
        );
    }

    const totalChecks = activeEntries.reduce(
        (total, entry) => total + entry.due_at.length,
        0
    );
    const dormant = {
        schema_version: HOURLY_SCHEDULE_SCHEMA_VERSION,
        generated_at: Number(now),
        targets: dormantTargets,
        counts: {
            total: dormantTargets.length,
            permanent_federal: dormantTargets.filter(target => {
                return target.reason === 'permanent_federal';
            }).length,
            hiding_out: dormantTargets.filter(target => {
                return target.reason === 'hiding_out';
            }).length
        }
    };

    return {
        schedule: {
            schema_version: HOURLY_SCHEDULE_SCHEMA_VERSION,
            generation: window.generation,
            generated_at: Number(now),
            valid_from: window.validFrom,
            valid_until: window.validUntil,
            fallback_until: window.validUntil + ONE_HOUR_MS,
            collector_roster: collectorRoster,
            assignments,
            unassigned,
            counts: {
                source_targets: Array.isArray(targets) ? targets.length : 0,
                scheduled_targets: activeEntries.length,
                scheduled_checks: totalChecks,
                dormant_targets: dormantTargets.length,
                recently_active_targets: recentlyActiveCount,
                collectors: collectorRoster.length,
                unassigned_targets: unassigned.length
            }
        },
        dormant
    };
}


export function dueTimesForHour(target, window) {
    const status = normalizeStatus(target?.status);
    const dueTimes = new Set();

    if (status === 'Okay') {
        const interval = okayInterval(target?.competition_tier);
        const bucketCount = Math.max(1, Math.round(interval / FIVE_MINUTES_MS));
        const targetSlot = Math.abs(Number(target?.id) || 0) % bucketCount;
        const firstBucket = Math.floor(window.validFrom / FIVE_MINUTES_MS);
        const finalBucket = Math.ceil(window.validUntil / FIVE_MINUTES_MS);

        for (let bucket = firstBucket; bucket < finalBucket; bucket++) {
            if (bucket % bucketCount !== targetSlot) continue;
            const dueAt = bucket * FIVE_MINUTES_MS;
            if (dueAt >= window.validFrom && dueAt < window.validUntil) {
                dueTimes.add(dueAt);
            }
        }

        const freshnessDueAt = dailyFreshnessDueAt(target.id, window.validFrom);
        if (
            freshnessDueAt >= window.validFrom &&
            freshnessDueAt < window.validUntil
        ) {
            dueTimes.add(freshnessDueAt);
        }

        return [...dueTimes].sort((left, right) => left - right);
    }

    const configuredDueAt = Number(target?.next_check_at_ms) ||
        Number(target?.next_check_at) || 0;
    const firstDueAt = Math.max(window.validFrom, configuredDueAt);

    if (firstDueAt >= window.validUntil) return [];

    if (status === 'Hospital' || status === 'Federal') {
        return [firstDueAt];
    }

    for (
        let dueAt = firstDueAt;
        dueAt < window.validUntil;
        dueAt += TEN_MINUTES_MS
    ) {
        dueTimes.add(dueAt);
    }

    return [...dueTimes].sort((left, right) => left - right);
}


export function buildLevelingBackup({
    now = Date.now(),
    workerVersion,
    targets,
    hospitalEvents,
    targetActivity,
    dormant
}) {
    const normalizedTargets = Array.isArray(targets) ? targets : [];
    const normalizedEvents = Array.isArray(hospitalEvents) ? hospitalEvents : [];
    const normalizedActivity = Array.isArray(targetActivity) ? targetActivity : [];
    const normalizedDormant = Array.isArray(dormant?.targets)
        ? dormant.targets
        : [];

    return {
        schema_version: HOURLY_SCHEDULE_SCHEMA_VERSION,
        backup_type: 'slink_leveling_full',
        generated_at: Number(now),
        generated_at_iso: new Date(Number(now)).toISOString(),
        worker_version: String(workerVersion || 'unknown'),
        counts: {
            targets: normalizedTargets.length,
            hospital_events: normalizedEvents.length,
            target_activity: normalizedActivity.length,
            dormant_targets: normalizedDormant.length
        },
        targets: normalizedTargets,
        hospital_events: normalizedEvents,
        target_activity: normalizedActivity,
        dormant: {
            ...dormant,
            targets: normalizedDormant
        }
    };
}


export function levelingBackupKey(now = Date.now()) {
    return `${LEVELING_BACKUP_PREFIX}${new Date(Number(now))
        .toISOString()
        .slice(0, 10)}.json`;
}


export function backupKeysToDelete(objects, retention = LEVELING_BACKUP_RETENTION) {
    const keep = Math.max(1, Math.trunc(Number(retention)) || 1);
    return (Array.isArray(objects) ? objects : [])
        .map(object => String(object?.key || ''))
        .filter(key => key.startsWith(LEVELING_BACKUP_PREFIX))
        .sort()
        .slice(0, -keep);
}


export async function readJsonObject(bucket, key) {
    const object = await bucket.get(key);
    if (!object) return null;
    return object.json();
}


export async function writeJsonObject(bucket, key, value, metadata = {}) {
    const body = JSON.stringify(value);
    return bucket.put(key, body, {
        httpMetadata: {
            contentType: 'application/json; charset=utf-8',
            cacheControl: 'no-store'
        },
        customMetadata: Object.fromEntries(
            Object.entries(metadata).map(([name, metadataValue]) => [
                name,
                String(metadataValue)
            ])
        )
    });
}


export async function publishHourlySchedule(bucket, schedule) {
    await writeJsonObject(bucket, LEVELING_SCHEDULE_KEY, schedule, {
        schema_version: schedule.schema_version,
        generation: schedule.generation,
        valid_until: schedule.valid_until
    });

    return {
        key: LEVELING_SCHEDULE_KEY,
        generation: schedule.generation,
        scheduled_targets: schedule.counts?.scheduled_targets || 0,
        scheduled_checks: schedule.counts?.scheduled_checks || 0
    };
}


export async function publishDormantSnapshotIfChanged(bucket, dormant) {
    const fingerprint = await jsonFingerprint({
        schema_version: dormant.schema_version,
        targets: dormant.targets
    });
    const existing = await bucket.head(LEVELING_DORMANT_KEY);

    if (existing?.customMetadata?.fingerprint === fingerprint) {
        return {
            key: LEVELING_DORMANT_KEY,
            changed: false,
            fingerprint,
            count: dormant.targets.length
        };
    }

    await writeJsonObject(bucket, LEVELING_DORMANT_KEY, dormant, {
        schema_version: dormant.schema_version,
        fingerprint,
        count: dormant.targets.length
    });

    return {
        key: LEVELING_DORMANT_KEY,
        changed: true,
        fingerprint,
        count: dormant.targets.length
    };
}


export async function writeDailyBackupAndPrune(
    bucket,
    backup,
    retention = LEVELING_BACKUP_RETENTION
) {
    const key = levelingBackupKey(backup.generated_at);
    const fingerprint = await jsonFingerprint(backup);
    await writeJsonObject(bucket, key, backup, {
        schema_version: backup.schema_version,
        backup_type: backup.backup_type,
        generated_at: backup.generated_at,
        target_count: backup.counts?.targets || 0,
        fingerprint
    });

    const objects = await listAllObjects(bucket, LEVELING_BACKUP_PREFIX);
    const deleteKeys = backupKeysToDelete(objects, retention);
    if (deleteKeys.length) await bucket.delete(deleteKeys);

    return {
        key,
        fingerprint,
        retained: objects.length - deleteKeys.length,
        deleted: deleteKeys
    };
}


export async function listAllObjects(bucket, prefix) {
    const objects = [];
    let cursor;

    do {
        const page = await bucket.list({
            prefix,
            limit: 1000,
            ...(cursor ? { cursor } : {})
        });
        objects.push(...page.objects);
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    return objects;
}


export async function jsonFingerprint(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}


function normalizeCollectors(collectors) {
    const byKey = new Map();

    for (const rawCollector of Array.isArray(collectors) ? collectors : []) {
        const userId = positiveInteger(rawCollector?.user_id);
        const sessionId = String(rawCollector?.session_id || '').trim();
        if (!userId || !sessionId) continue;

        const key = collectorKey({ user_id: userId, session_id: sessionId });
        byKey.set(key, {
            key,
            user_id: userId,
            session_id: sessionId
        });
    }

    return [...byKey.values()].sort((left, right) => {
        return left.key.localeCompare(right.key);
    });
}


function normalizeScheduleTarget(row) {
    const id = positiveInteger(row?.id ?? row?.target_id);
    if (!id) return null;

    return {
        id,
        name: String(row?.name || '').trim().slice(0, 100),
        level: nullableNumber(row?.level),
        total_stats: nullableNumber(row?.total_stats),
        sources: String(row?.sources || '').trim(),
        status: normalizeStatus(row?.status ?? row?.previous_status),
        status_until: Number(row?.status_until ?? row?.previous_status_until) || 0,
        last_checked_at: Number(
            row?.last_checked_at_ms ??
            row?.last_checked_at ??
            row?.previous_last_checked_at
        ) || 0,
        next_check_at_ms: Number(
            row?.next_check_at_ms ?? row?.next_check_at
        ) || 0,
        competition_score: Number(row?.competition_score) || 0,
        competition_tier: normalizeCompetitionTier(row?.competition_tier),
        hiding_out: Number(row?.hiding_out) === 1,
        permanent_federal: Number(row?.permanent_federal) === 1,
        activity_last_seen_at: Number(row?.activity_last_seen_at) || 0,
        recommendation_leased: Number(row?.recommendation_leased) === 1
    };
}


function normalizeDormantTarget(target) {
    return {
        id: target.id,
        name: target.name,
        level: target.level,
        total_stats: target.total_stats,
        sources: target.sources,
        status: target.status,
        status_until: target.status_until,
        last_checked_at: target.last_checked_at,
        competition_score: target.competition_score,
        competition_tier: target.competition_tier,
        activity_last_seen_at: target.activity_last_seen_at,
        reason: target.permanent_federal
            ? 'permanent_federal'
            : 'hiding_out'
    };
}


function isRecentlyActive(target, now, activityWindowMs) {
    if (!target.activity_last_seen_at) return false;
    const timestampMs = target.activity_last_seen_at < 10_000_000_000
        ? target.activity_last_seen_at * 1000
        : target.activity_last_seen_at;
    return timestampMs >= now - activityWindowMs;
}


function compareScheduleEntries(left, right) {
    const leftChecks = left.due_at.length;
    const rightChecks = right.due_at.length;
    if (leftChecks !== rightChecks) return rightChecks - leftChecks;
    if (left.due_at[0] !== right.due_at[0]) {
        return left.due_at[0] - right.due_at[0];
    }
    return left.id - right.id;
}


function leastLoadedCollector(collectors, loads) {
    let selected = null;
    let selectedLoad = Number.POSITIVE_INFINITY;

    for (const collector of collectors) {
        const load = loads.get(collector.key) || 0;
        if (
            load < selectedLoad ||
            (load === selectedLoad && collector.key < selected?.key)
        ) {
            selected = collector;
            selectedLoad = load;
        }
    }

    return selected;
}


function okayInterval(tier) {
    if (tier === 'Farmed') return SIX_HOURS_MS;
    if (tier === 'Crowded') return ONE_HOUR_MS;
    if (tier === 'Warm') return THIRTY_MINUTES_MS;
    return FIFTEEN_MINUTES_MS;
}


function dailyFreshnessDueAt(targetId, hourStart) {
    const date = new Date(hourStart);
    if (date.getUTCHours() !== 23) return -1;
    const base = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        45
    );
    return base + ((Math.abs(Number(targetId) || 0) % 3) * FIVE_MINUTES_MS);
}


function normalizeStatus(value) {
    const text = String(value || 'Unknown').trim();
    const lower = text.toLowerCase();
    if (lower.includes('federal')) return 'Federal';
    if (lower.includes('hiding out') || lower.includes('hiding')) {
        return 'Hiding Out';
    }
    if (lower.includes('hospital')) return 'Hospital';
    if (lower.includes('travel') || lower.includes('flying')) return 'Traveling';
    if (lower.includes('abroad')) return 'Abroad';
    if (lower.includes('jail')) return 'Jail';
    if (lower === 'okay' || lower.includes('okay')) return 'Okay';
    return 'Unknown';
}


function normalizeCompetitionTier(value) {
    const tier = String(value || 'Prime').trim().toLowerCase();
    if (tier === 'farmed') return 'Farmed';
    if (tier === 'crowded') return 'Crowded';
    if (tier === 'warm') return 'Warm';
    return 'Prime';
}


function positiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}


function nullableNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
