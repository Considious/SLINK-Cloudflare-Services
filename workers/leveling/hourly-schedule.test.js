import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    LEVELING_BACKUP_PREFIX,
    LEVELING_DORMANT_KEY,
    LEVELING_SCHEDULE_KEY,
    backupKeysToDelete,
    buildHourlySchedule,
    buildLevelingBackup,
    dueTimesForHour,
    hourlyWindow,
    publishDormantSnapshotIfChanged,
    publishHourlySchedule,
    readJsonObject,
    writeDailyBackupAndPrune
} from './hourly-schedule.js';


describe('hourly R2 leveling schedule', () => {
    it('builds the complete hour, balances checks, and separates dormant rows', () => {
        const now = Date.UTC(2026, 8, 15, 18, 0, 0);
        const hospitalDue = now + (37 * 60 * 1000);
        const { schedule, dormant } = buildHourlySchedule({
            now,
            collectors: [
                { user_id: 20, session_id: 'second' },
                { user_id: 10, session_id: 'first' }
            ],
            targets: [
                target(1, { status: 'Okay', competition_tier: 'Prime' }),
                target(2, { status: 'Okay', competition_tier: 'Warm' }),
                target(3, {
                    status: 'Hospital',
                    next_check_at_ms: hospitalDue,
                    status_until: Math.floor((hospitalDue - 60_000) / 1000)
                }),
                target(4, {
                    status: 'Federal',
                    permanent_federal: 1
                }),
                target(5, {
                    status: 'Hiding Out',
                    hiding_out: 1
                }),
                target(6, {
                    status: 'Okay',
                    activity_last_seen_at: Math.floor(now / 1000)
                })
            ]
        });

        assert.equal(schedule.generation, '2026-09-15T18:00:00.000Z');
        assert.equal(schedule.valid_from, now);
        assert.equal(schedule.valid_until, now + 3_600_000);
        assert.equal(schedule.counts.source_targets, 6);
        assert.equal(schedule.counts.scheduled_targets, 3);
        assert.equal(schedule.counts.dormant_targets, 2);
        assert.equal(schedule.counts.recently_active_targets, 1);
        assert.equal(schedule.counts.collectors, 2);
        assert.deepEqual(
            dormant.targets.map(row => [row.id, row.reason]),
            [
                [4, 'permanent_federal'],
                [5, 'hiding_out']
            ]
        );

        const assigned = Object.values(schedule.assignments).flat();
        assert.deepEqual(
            assigned.map(row => row.id).sort((left, right) => left - right),
            [1, 2, 3]
        );
        assert.deepEqual(assigned.find(row => row.id === 3).due_at, [hospitalDue]);

        const loads = Object.values(schedule.assignments).map(entries => {
            return entries.reduce((total, entry) => total + entry.due_at.length, 0);
        });
        assert.ok(Math.abs(loads[0] - loads[1]) <= 3);
    });


    it('preserves existing target timing and adds the daily freshness slots', () => {
        const normalHour = hourlyWindow(Date.UTC(2026, 8, 15, 18, 0, 0));
        const prime = dueTimesForHour(
            target(1, { status: 'Okay', competition_tier: 'Prime' }),
            normalHour
        );
        const warm = dueTimesForHour(
            target(2, { status: 'Okay', competition_tier: 'Warm' }),
            normalHour
        );
        const farmed = dueTimesForHour(
            target(3, { status: 'Okay', competition_tier: 'Farmed' }),
            normalHour
        );

        assert.equal(prime.length, 4);
        assert.equal(warm.length, 2);
        assert.ok(farmed.length <= 1);

        const resetHour = hourlyWindow(Date.UTC(2026, 8, 15, 23, 0, 0));
        const freshness = dueTimesForHour(
            target(4, { status: 'Okay', competition_tier: 'Farmed' }),
            resetHour
        );
        assert.ok(freshness.includes(Date.UTC(2026, 8, 15, 23, 50, 0)));
        const built = buildHourlySchedule({
            now: resetHour.validFrom,
            collectors: [{ user_id: 10, session_id: 'first' }],
            targets: [target(4, {
                status: 'Okay',
                competition_tier: 'Farmed'
            })]
        });
        assert.equal(
            built.schedule.assignments['10:first'][0].freshness_due_at,
            Date.UTC(2026, 8, 15, 23, 50, 0)
        );
    });


    it('publishes one current schedule and skips unchanged dormant writes', async () => {
        const bucket = new MemoryR2Bucket();
        const now = Date.UTC(2026, 8, 15, 18, 0, 0);
        const built = buildHourlySchedule({
            now,
            collectors: [{ user_id: 10, session_id: 'first' }],
            targets: [
                target(1),
                target(2, { permanent_federal: 1, status: 'Federal' })
            ]
        });

        await publishHourlySchedule(bucket, built.schedule);
        assert.deepEqual(
            await readJsonObject(bucket, LEVELING_SCHEDULE_KEY),
            built.schedule
        );

        const firstDormant = await publishDormantSnapshotIfChanged(
            bucket,
            built.dormant
        );
        const secondDormant = await publishDormantSnapshotIfChanged(
            bucket,
            buildHourlySchedule({
                now: now + 3_600_000,
                collectors: [{ user_id: 10, session_id: 'first' }],
                targets: [
                    target(1),
                    target(2, { permanent_federal: 1, status: 'Federal' })
                ]
            }).dormant
        );

        assert.equal(firstDormant.changed, true);
        assert.equal(secondDormant.changed, false);
        assert.equal(bucket.putKeys.filter(key => key === LEVELING_DORMANT_KEY).length, 1);
    });


    it('keeps exactly the newest 25 daily recovery backups', async () => {
        const bucket = new MemoryR2Bucket();
        const start = Date.UTC(2026, 7, 1, 23, 55, 0);

        for (let day = 0; day < 27; day++) {
            const now = start + (day * 86_400_000);
            const backup = buildLevelingBackup({
                now,
                workerVersion: 'test',
                targets: [target(day + 1)],
                hospitalEvents: [],
                targetActivity: [],
                dormant: { targets: [] }
            });
            await writeDailyBackupAndPrune(bucket, backup, 25);
        }

        const keys = [...bucket.objects.keys()]
            .filter(key => key.startsWith(LEVELING_BACKUP_PREFIX))
            .sort();
        assert.equal(keys.length, 25);
        assert.equal(keys[0], 'leveling/backups/2026-08-03.json');
        assert.equal(keys.at(-1), 'leveling/backups/2026-08-27.json');
        assert.match(
            bucket.objects.get(keys.at(-1)).customMetadata.fingerprint,
            /^[0-9a-f]{64}$/
        );
        assert.deepEqual(
            backupKeysToDelete(keys.map(key => ({ key })), 25),
            []
        );
    });
});


function target(id, overrides = {}) {
    return {
        id,
        name: `Target ${id}`,
        level: 50,
        total_stats: 1000,
        sources: 'Test',
        status: 'Okay',
        status_until: 0,
        last_checked_at_ms: 0,
        next_check_at_ms: 0,
        competition_score: 0,
        competition_tier: 'Prime',
        hiding_out: 0,
        permanent_federal: 0,
        activity_last_seen_at: 0,
        recommendation_leased: 0,
        ...overrides
    };
}


class MemoryR2Bucket {
    constructor() {
        this.objects = new Map();
        this.putKeys = [];
        this.deletedKeys = [];
    }

    async put(key, value, options = {}) {
        const text = typeof value === 'string'
            ? value
            : new TextDecoder().decode(value);
        const object = {
            key,
            text,
            customMetadata: options.customMetadata || {},
            uploaded: new Date()
        };
        this.objects.set(key, object);
        this.putKeys.push(key);
        return object;
    }

    async get(key) {
        const object = this.objects.get(key);
        if (!object) return null;
        return {
            ...object,
            async json() {
                return JSON.parse(object.text);
            }
        };
    }

    async head(key) {
        return this.objects.get(key) || null;
    }

    async list({ prefix = '', cursor } = {}) {
        assert.equal(cursor, undefined);
        return {
            objects: [...this.objects.values()]
                .filter(object => object.key.startsWith(prefix))
                .map(object => ({
                    key: object.key,
                    uploaded: object.uploaded,
                    customMetadata: object.customMetadata
                })),
            truncated: false
        };
    }

    async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            this.objects.delete(key);
            this.deletedKeys.push(key);
        }
    }
}
