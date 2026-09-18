import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';

import worker from './worker.js';
import { ingestMuggingReports, runMuggingMonitor, testing } from './monitor-core.js';

describe('SLINK Mugging Intelligence Worker', () => {
    it('selects only the requested high-paying company tiers', () => {
        const csv = [
            'id,name,type,rating,employees_hired,employees_capacity',
            '1,Oil Nine,1,9,10,10',
            '2,Oil Ten,1,10,10,10',
            '3,Mine Nine,2,9,10,10',
            '4,TV Ten,3,10,10,10',
            '5,Logistics Eight,4,8,10,10',
            '6,Logistics Ten,4,10,10,10'
        ].join('\n');
        const types = {
            companies:[
                { id:1, name:'Oil Rig' },
                { id:2, name:'Mining Corporation' },
                { id:3, name:'Television Network' },
                { id:4, name:'Logistics Management' }
            ]
        };
        assert.deepEqual(
            testing.selectMuggingCompanies(csv, types).map(row => row.id).sort(),
            [1, 3, 4, 6]
        );
    });

    it('baselines first, then records a mug transition and its free time in R2', async () => {
        const env = createEnv();
        const now = Date.UTC(2026, 8, 17, 10, 0, 0);
        let hospital = false;
        const executePublicRequests = async requests => ({
            key_count:5,
            results:requests.map(request => {
                if (request.kind === 'company.types') {
                    return { request_id:request.request_id, kind:request.kind, ok:true, body:{ companies:[{ id:1, name:'Oil Rig' }] } };
                }
                if (request.kind === 'company.snapshot') {
                    return {
                        request_id:request.request_id,
                        kind:request.kind,
                        ok:true,
                        body:'id,name,type,rating,employees_hired,employees_capacity\n77,Test Rig,1,9,1,10\n'
                    };
                }
                return {
                    request_id:request.request_id,
                    kind:request.kind,
                    ok:true,
                    body:{ company_employees:[{
                        id:123,
                        name:'Target',
                        position:'Employee',
                        status:hospital
                            ? { state:'Hospital', description:'Mugged by Someone', until:Math.floor((now + 60_000) / 1000) }
                            : { state:'Okay', description:'Okay', until:0 }
                    }] }
                };
            })
        });

        const baseline = await runMuggingMonitor(
            env,
            { executePublicRequests },
            { now, maxCalls:10 }
        );
        assert.equal(baseline.phase, 'monitoring');
        assert.equal(baseline.mug_events, 0);

        hospital = true;
        const secondAt = now + 60_001;
        const detected = await runMuggingMonitor(
            env,
            { executePublicRequests },
            { now:secondAt, maxCalls:10 }
        );
        assert.equal(detected.mug_events, 1);
        const state = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v1.json').body);
        assert.equal(state.targets['123'].last_mugged_at, secondAt);
        assert.equal(state.targets['123'].free_at, testing.earliestFreeAt(secondAt));
        assert.ok([...env.MUGGING_BUCKET.values.keys()].some(key => key.includes('-status-')));
    });

    it('deprioritizes repeated low-value client mug reports without using D1 target rows', async () => {
        const env = createEnv();
        const now = Date.UTC(2026, 8, 17, 12, 0, 0);
        const reports = [0, 1, 2].map(index => ({
            target_id:999,
            name:'Careful Target',
            source:'client_mug',
            mugged_at:now + index,
            amount:100_000,
            battle_stats_estimate:2_000_000
        }));
        const result = await ingestMuggingReports(env, reports, now + 2);
        assert.equal(result.accepted, 3);
        const state = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v1.json').body);
        assert.equal(state.targets['999'].low_value_ratio, 1);
        assert.ok(state.targets['999'].priority_multiplier < 0.5);
        assert.equal(state.targets['999'].battle_stats_estimate, 2_000_000);
        assert.equal(
            env.MUGGING_DB.sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE '%target%'").get().count,
            0
        );
    });

    it('does not turn an unchanged baseline hospital status into a false mug', () => {
        const now = Date.UTC(2026, 8, 17, 12, 0, 0);
        const state = {
            phase:'baseline',
            companies:{ '77':{ id:77, name:'Test Rig', type_name:'Oil Rig', rating:9 } },
            targets:{}
        };
        const result = {
            company:{ id:77 },
            employees:[{
                id:123,
                name:'Already Hospitalized',
                position:'Employee',
                status_state:'Hospital',
                status_description:'Mugged by Someone',
                status_until:12345
            }]
        };
        assert.equal(testing.mergeCompanyScan(state, result, now).events.length, 0);
        state.phase = 'monitoring';
        assert.equal(testing.mergeCompanyScan(state, result, now + 60_000).events.length, 0);
    });

    it('keeps the health route read-only and authenticates manual runs', async () => {
        const env = createEnv();
        const health = await worker.fetch(new Request('https://mugging.example/api/health'), env);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).storage, undefined);

        const denied = await worker.fetch(new Request('https://mugging.example/api/internal/run', { method:'POST' }), env);
        assert.equal(denied.status, 401);
    });
});


function createEnv() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('./migrations/0001-mugging-coordination.sql', import.meta.url), 'utf8'));
    return {
        MUGGING_DB:new D1DatabaseAdapter(sqlite),
        MUGGING_BUCKET:new R2BucketAdapter(),
        MUGGING_SERVICE_TOKEN:'mugging-test-token',
        CONTRIBUTION_SERVICE_TOKEN:'contribution-test-token'
    };
}


class R2BucketAdapter {
    constructor() {
        this.values = new Map();
        this.revision = 0;
    }

    async get(key) {
        const value = this.values.get(key);
        if (!value) return null;
        return {
            etag:value.etag,
            json:async () => JSON.parse(value.body),
            text:async () => value.body
        };
    }

    async put(key, body, options = {}) {
        const current = this.values.get(key);
        if (options.onlyIf?.etagMatches && current?.etag !== options.onlyIf.etagMatches) return null;
        if (options.onlyIf?.etagDoesNotMatch === '*' && current) return null;
        const value = { body:String(body), etag:`etag-${++this.revision}` };
        this.values.set(key, value);
        return { etag:value.etag };
    }
}


class D1DatabaseAdapter {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }
    prepare(sql) {
        return new D1StatementAdapter(this, sql, []);
    }
    async batch(statements) {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
    }
}


class D1StatementAdapter {
    constructor(database, sql, bindings) {
        this.database = database;
        this.sql = sql;
        this.bindings = bindings;
    }
    bind(...values) {
        return new D1StatementAdapter(this.database, this.sql, values);
    }
    async first() {
        return this.database.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
    }
    async all() {
        return { success:true, results:this.database.sqlite.prepare(this.sql).all(...this.bindings) };
    }
    async run() {
        const result = this.database.sqlite.prepare(this.sql).run(...this.bindings);
        return {
            success:true,
            results:[],
            meta:{ changes:Number(result.changes || 0), last_row_id:Number(result.lastInsertRowid || 0) }
        };
    }
}
