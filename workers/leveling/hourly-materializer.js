import {
    buildHourlySchedule,
    buildLevelingBackup,
    publishDormantSnapshotIfChanged,
    publishHourlySchedule,
    writeDailyBackupAndPrune
} from './hourly-schedule.js';


export const HOURLY_MATERIALIZATION_MINUTE = 0;
export const DAILY_BACKUP_HOUR_UTC = 23;
export const DAILY_BACKUP_MINUTE_UTC = 55;


export async function loadHourlyScheduleSource(db, now = Date.now()) {
    requireD1(db);
    const statements = [
        db.prepare(HOURLY_TARGET_SOURCE_SQL).bind(Number(now)),
        db.prepare(ACTIVE_COLLECTOR_SOURCE_SQL).bind(Number(now))
    ];
    const [targetResult, collectorResult] = await db.batch(statements);

    return {
        targets: resultRows(targetResult),
        collectors: resultRows(collectorResult)
    };
}


export async function loadLevelingBackupSource(db) {
    requireD1(db);
    const [targetResult, eventResult, activityResult] = await db.batch([
        db.prepare(BACKUP_TARGET_SOURCE_SQL),
        db.prepare(BACKUP_HOSPITAL_EVENT_SOURCE_SQL),
        db.prepare(BACKUP_ACTIVITY_SOURCE_SQL)
    ]);

    return {
        targets: resultRows(targetResult),
        hospitalEvents: resultRows(eventResult),
        targetActivity: resultRows(activityResult)
    };
}


export async function materializeHourlyLeveling({
    db,
    bucket,
    now = Date.now()
}) {
    requireR2(bucket);
    const source = await loadHourlyScheduleSource(db, now);
    const built = buildHourlySchedule({ ...source, now });
    const [scheduleWrite, dormantWrite] = await Promise.all([
        publishHourlySchedule(bucket, built.schedule),
        publishDormantSnapshotIfChanged(bucket, built.dormant)
    ]);

    return {
        schedule: built.schedule,
        dormant: built.dormant,
        writes: {
            schedule: scheduleWrite,
            dormant: dormantWrite
        }
    };
}


export async function materializeDailyLevelingBackup({
    db,
    bucket,
    dormant,
    workerVersion,
    now = Date.now(),
    retention
}) {
    requireR2(bucket);
    const source = await loadLevelingBackupSource(db);
    const backup = buildLevelingBackup({
        now,
        workerVersion,
        targets: source.targets,
        hospitalEvents: source.hospitalEvents,
        targetActivity: source.targetActivity,
        dormant
    });
    const write = await writeDailyBackupAndPrune(
        bucket,
        backup,
        retention
    );

    return { backup, write };
}


export function shouldMaterializeHourly(scheduledTime) {
    const date = new Date(Number(scheduledTime));
    return (
        Number.isFinite(date.getTime()) &&
        date.getUTCMinutes() === HOURLY_MATERIALIZATION_MINUTE
    );
}


export function shouldWriteDailyBackup(scheduledTime) {
    const date = new Date(Number(scheduledTime));
    return (
        Number.isFinite(date.getTime()) &&
        date.getUTCHours() === DAILY_BACKUP_HOUR_UTC &&
        date.getUTCMinutes() === DAILY_BACKUP_MINUTE_UTC
    );
}


export const HOURLY_TARGET_SOURCE_SQL = `
    SELECT
        targets.id,
        targets.name,
        targets.level,
        targets.total_stats,
        targets.sources,
        target_status.status,
        CAST(target_status.status_until AS INTEGER) AS status_until,
        target_status.last_checked_at_ms,
        target_status.next_check_at_ms,
        target_status.competition_score,
        target_status.competition_tier,
        target_status.hiding_out,
        target_status.permanent_federal,
        target_activity.last_seen_at AS activity_last_seen_at,
        CASE WHEN client_target_leases.target_id IS NULL THEN 0 ELSE 1 END
            AS recommendation_leased
    FROM target_status
    INNER JOIN targets
        ON targets.id = target_status.target_id
    LEFT JOIN target_activity
        ON target_activity.target_id = targets.id
    LEFT JOIN client_target_leases
        ON client_target_leases.target_id = targets.id
       AND client_target_leases.expires_at > ?1
    ORDER BY targets.id ASC
`;


export const ACTIVE_COLLECTOR_SOURCE_SQL = `
    SELECT user_id, session_id
    FROM client_user_collectors
    WHERE expires_at > ?1
    ORDER BY user_id ASC, session_id ASC
`;


export const BACKUP_TARGET_SOURCE_SQL = `
    SELECT
        targets.id,
        targets.name,
        targets.level,
        targets.total_stats,
        targets.sources,
        targets.created_at,
        targets.updated_at,
        target_status.status,
        target_status.status_until,
        target_status.last_checked_at,
        target_status.next_check_at,
        target_status.last_checked_at_ms,
        target_status.next_check_at_ms,
        target_status.competition_score,
        target_status.competition_tier,
        target_status.hiding_out,
        target_status.permanent_federal,
        target_status.updated_at AS status_updated_at
    FROM targets
    LEFT JOIN target_status
        ON target_status.target_id = targets.id
    ORDER BY targets.id ASC
`;


export const BACKUP_HOSPITAL_EVENT_SOURCE_SQL = `
    SELECT
        id,
        target_id,
        hospitalized_at,
        hospital_until,
        reported_by,
        created_at
    FROM hospital_events
    ORDER BY id ASC
`;


export const BACKUP_ACTIVITY_SOURCE_SQL = `
    SELECT target_id, last_seen_at, observed_at, reported_by
    FROM target_activity
    ORDER BY target_id ASC
`;


function resultRows(result) {
    return Array.isArray(result?.results) ? result.results : [];
}


function requireD1(db) {
    if (!db?.prepare || !db?.batch) {
        throw new Error('The Leveling D1 database binding is not configured.');
    }
}


function requireR2(bucket) {
    if (!bucket?.get || !bucket?.put || !bucket?.list) {
        throw new Error('The Leveling R2 snapshot binding is not configured.');
    }
}
