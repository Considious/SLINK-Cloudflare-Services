import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import {
    loadHourlyScheduleSource,
    loadLevelingBackupSource,
    materializeDailyLevelingBackup,
    materializeHourlyLeveling,
    shouldMaterializeHourly,
    shouldWriteDailyBackup
} from './hourly-materializer.js';
import {
    LEVELING_BACKUP_PREFIX,
    LEVELING_DORMANT_KEY,
    LEVELING_SCHEDULE_KEY
} from './hourly-schedule.js';


describe('hourly Leveling materializer', () => {
    it('loads the entire D1 source in one two-statement batch', async () => {
        const db = createDatabase();
        const now = Date.UTC(2026, 8, 15, 18, 0, 0);
        const source = await loadHourlyScheduleSource(db, now);

        assert.equal(db.batchCount, 1);
        assert.equal(db.queryCount, 2);
        assert.deepEqual(source.collectors.map(row => ({ ...row })), [
            { user_id: 1001, session_id: 'desktop' },
            { user_id: 1002, session_id: 'mobile' }
        ]);
        assert.equal(source.targets.length, 4);
        assert.equal(source.targets[0].recommendation_leased, 1);
        assert.equal(source.targets[1].recommendation_leased, 0);
        assert.equal(source.targets[2].permanent_federal, 1);
        assert.equal(source.targets[3].hiding_out, 1);
    });


    it('publishes the hourly schedule and dormant snapshot without D1 writes', async () => {
        const db = createDatabase();
        const bucket = new MemoryR2Bucket();
        const now = Date.UTC(2026, 8, 15, 18, 0, 0);
        const result = await materializeHourlyLeveling({ db, bucket, now });

        assert.equal(db.writeChanges, 0);
        assert.equal(db.queryCount, 2);
        assert.ok(bucket.objects.has(LEVELING_SCHEDULE_KEY));
        assert.ok(bucket.objects.has(LEVELING_DORMANT_KEY));
        assert.equal(result.schedule.counts.source_targets, 4);
        assert.equal(result.schedule.counts.collectors, 2);
        assert.equal(result.schedule.counts.scheduled_targets, 2);
        assert.equal(result.dormant.counts.total, 2);
    });


    it('builds a complete recovery backup in one three-statement batch', async () => {
        const db = createDatabase();
        const bucket = new MemoryR2Bucket();
        const now = Date.UTC(2026, 8, 15, 23, 55, 0);
        const hourly = await materializeHourlyLeveling({ db, bucket, now });
        const queriesBeforeBackup = db.queryCount;
        const result = await materializeDailyLevelingBackup({
            db,
            bucket,
            dormant: hourly.dormant,
            workerVersion: 'test-version',
            now
        });

        assert.equal(db.queryCount - queriesBeforeBackup, 3);
        assert.equal(result.backup.counts.targets, 4);
        assert.equal(result.backup.counts.hospital_events, 1);
        assert.equal(result.backup.counts.target_activity, 1);
        assert.equal(result.backup.counts.dormant_targets, 2);
        assert.equal(result.backup.worker_version, 'test-version');
        assert.equal(
            [...bucket.objects.keys()].filter(key => {
                return key.startsWith(LEVELING_BACKUP_PREFIX);
            }).length,
            1
        );
        assert.match(result.write.fingerprint, /^[0-9a-f]{64}$/);
    });


    it('only runs on the intended five-minute cron boundaries', () => {
        assert.equal(
            shouldMaterializeHourly(Date.UTC(2026, 8, 15, 18, 0, 0)),
            true
        );
        assert.equal(
            shouldMaterializeHourly(Date.UTC(2026, 8, 15, 18, 5, 0)),
            false
        );
        assert.equal(
            shouldWriteDailyBackup(Date.UTC(2026, 8, 15, 23, 55, 0)),
            true
        );
        assert.equal(
            shouldWriteDailyBackup(Date.UTC(2026, 8, 15, 23, 50, 0)),
            false
        );
    });


    it('loads restore data without reshaping stored D1 values', async () => {
        const db = createDatabase();
        const backup = await loadLevelingBackupSource(db);

        assert.equal(backup.targets[2].status, 'Federal');
        assert.equal(backup.targets[3].status, 'Hiding Out');
        assert.equal(backup.hospitalEvents[0].target_id, 2);
        assert.equal(backup.targetActivity[0].target_id, 2);
    });
});


function createDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(SCHEMA);
    const now = Date.UTC(2026, 8, 15, 18, 0, 0);

    const insertTarget = sqlite.prepare(`
        INSERT INTO targets (id, name, level, total_stats, sources)
        VALUES (?, ?, ?, ?, ?)
    `);
    const insertStatus = sqlite.prepare(`
        INSERT INTO target_status (
            target_id,
            status,
            status_until,
            last_checked_at,
            next_check_at,
            last_checked_at_ms,
            next_check_at_ms,
            competition_score,
            competition_tier,
            hiding_out,
            permanent_federal
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let id = 1; id <= 4; id++) {
        insertTarget.run(id, `Target ${id}`, 50, id * 1000, `Source ${id}`);
    }
    insertStatus.run(1, 'Okay', '0', '0', '0', 0, 0, 0, 'Prime', 0, 0);
    insertStatus.run(2, 'Hospital', '0', '0', String(now), 0, now, 10, 'Warm', 0, 0);
    insertStatus.run(3, 'Federal', '0', '0', '0', 0, 0, 0, 'Farmed', 0, 1);
    insertStatus.run(4, 'Hiding Out', '0', '0', '0', 0, 0, 0, 'Farmed', 1, 0);
    sqlite.prepare(`
        INSERT INTO client_user_collectors (
            user_id, session_id, claimed_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(1001, 'desktop', now - 1000, now - 1000, now + 60_000);
    sqlite.prepare(`
        INSERT INTO client_user_collectors (
            user_id, session_id, claimed_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(1002, 'mobile', now - 1000, now - 1000, now + 60_000);
    sqlite.prepare(`
        INSERT INTO client_user_collectors (
            user_id, session_id, claimed_at, last_seen_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(1003, 'expired', now - 1000, now - 1000, now - 1);
    sqlite.prepare(`
        INSERT INTO client_target_leases (
            target_id, user_id, session_id, leased_at, expires_at
        ) VALUES (?, ?, ?, ?, ?)
    `).run(1, 1001, 'desktop', now - 1000, now + 60_000);
    sqlite.prepare(`
        INSERT INTO target_activity (
            target_id, last_seen_at, observed_at, reported_by
        ) VALUES (?, ?, ?, ?)
    `).run(2, Math.floor((now - (8 * 86_400_000)) / 1000), Math.floor(now / 1000), 1001);
    sqlite.prepare(`
        INSERT INTO hospital_events (
            target_id, hospitalized_at, hospital_until, reported_by
        ) VALUES (?, ?, ?, ?)
    `).run(2, String(now - 60_000), String(now + 60_000), 1001);

    return new D1DatabaseAdapter(sqlite);
}


class D1DatabaseAdapter {
    constructor(sqlite) {
        this.sqlite = sqlite;
        this.batchCount = 0;
        this.queryCount = 0;
        this.writeChanges = 0;
    }

    prepare(sql) {
        return new D1StatementAdapter(this, sql, []);
    }

    async batch(statements) {
        this.batchCount++;
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        return results;
    }
}


class D1StatementAdapter {
    constructor(database, sql, bindings) {
        this.database = database;
        this.sql = sql;
        this.bindings = bindings;
    }

    bind(...bindings) {
        return new D1StatementAdapter(this.database, this.sql, bindings);
    }

    async all() {
        this.database.queryCount++;
        return {
            success: true,
            results: this.database.sqlite
                .prepare(this.sql)
                .all(...this.bindings)
        };
    }
}


class MemoryR2Bucket {
    constructor() {
        this.objects = new Map();
    }

    async put(key, value, options = {}) {
        const object = {
            key,
            text: String(value),
            customMetadata: options.customMetadata || {},
            uploaded: new Date()
        };
        this.objects.set(key, object);
        return object;
    }

    async get(key) {
        const object = this.objects.get(key);
        if (!object) return null;
        return { ...object, json: async () => JSON.parse(object.text) };
    }

    async head(key) {
        return this.objects.get(key) || null;
    }

    async list({ prefix = '' } = {}) {
        return {
            objects: [...this.objects.values()].filter(object => {
                return object.key.startsWith(prefix);
            }),
            truncated: false
        };
    }

    async delete(keys) {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
            this.objects.delete(key);
        }
    }
}


const SCHEMA = `
    CREATE TABLE targets (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        level INTEGER,
        total_stats INTEGER,
        sources TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE target_status (
        target_id INTEGER PRIMARY KEY,
        status TEXT,
        status_until TEXT,
        last_checked_at TEXT,
        next_check_at TEXT,
        last_checked_at_ms INTEGER NOT NULL DEFAULT 0,
        next_check_at_ms INTEGER NOT NULL DEFAULT 0,
        competition_score INTEGER DEFAULT 0,
        competition_tier TEXT DEFAULT 'Prime',
        hiding_out INTEGER DEFAULT 0,
        permanent_federal INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE client_user_collectors (
        user_id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE client_target_leases (
        target_id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        leased_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE target_activity (
        target_id INTEGER PRIMARY KEY,
        last_seen_at INTEGER NOT NULL,
        observed_at INTEGER NOT NULL,
        reported_by INTEGER NOT NULL
    );
    CREATE TABLE hospital_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id INTEGER NOT NULL,
        hospitalized_at TEXT NOT NULL,
        hospital_until TEXT NOT NULL,
        reported_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
`;
