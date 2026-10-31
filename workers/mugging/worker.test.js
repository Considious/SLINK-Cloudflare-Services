import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import vm from 'node:vm';

import worker, { testing as workerTesting } from './worker.js';
import { ingestMuggingReports, runMuggingMonitor, testing } from './monitor-core.js';
import {
    ingestMuggingReports as ingestShardedReports,
    muggingStatus,
    contributorTaskAssignments,
    roughMuggingAssignments,
    runMuggingMonitor as runShardedMonitor,
    testing as shardedTesting
} from './monitor-core-sharded.js';

describe('SLINK Mugging Intelligence Worker', () => {
    it('selects only the requested high-paying company tiers', () => {
        const csv = [
            'id,name,type,rating,employees_hired,employees_capacity',
            '1,Oil Seven,1,7,10,10',
            '2,Oil Ten,1,10,10,10',
            '3,Mine Eight,2,8,10,10',
            '4,Mine Seven,2,7,10,10',
            '5,TV Eight,3,8,10,10',
            '6,Logistics Eight,4,8,10,10',
            '7,Cruise Nine,5,9,10,10',
            '8,Cruise Eight,5,8,10,10',
            '9,Security Eight,6,8,10,10',
            '10,Security Ten,6,10,10,10',
            '11,Salon Ten,7,10,10,10'
        ].join('\n');
        const types = {
            companies:[
                { id:1, name:'Oil Rig' },
                { id:2, name:'Mining Corporation' },
                { id:3, name:'Television Network' },
                { id:4, name:'Logistics Management' },
                { id:5, name:'Cruise Line Agency' },
                { id:6, name:'Private Security Firm' },
                { id:7, name:'Hair Salon' }
            ]
        };
        assert.deepEqual(
            testing.selectMuggingCompanies(csv, types).map(row => row.id).sort((left, right) => left - right),
            [1, 2, 3, 5, 6, 7, 9, 10]
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

    it('limits Fair Fight candidates to targets not attempted or observed in the last week', () => {
        const now = Date.UTC(2026, 8, 19, 12, 0, 0);
        const day = 24 * 60 * 60 * 1000;
        const state = {
            targets:{
                '1':{ id:1, first_seen_at:now - 20 * day },
                '2':{ id:2, first_seen_at:now - 20 * day, ff_last_attempted_at:now - 6 * day },
                '3':{ id:3, first_seen_at:now - 20 * day, ff_last_attempted_at:now - 8 * day },
                '4':{ id:4, first_seen_at:now - 20 * day, battle_stats_checked_at:now - day }
            }
        };
        assert.deepEqual(testing.selectFairFightCandidates(state, now, 25), [1, 3]);
        assert.deepEqual(testing.selectFairFightCandidates(state, now, 1), [1]);
    });

    it('does not retry a failed Fair Fight request on the next scheduled run', async () => {
        const env = createEnv();
        env.FFSCOUTER_API_KEY = 'test-key';
        const now = Date.UTC(2026, 8, 19, 13, 0, 0);
        let fairFightRequests = 0;
        const executePublicRequests = async requests => ({
            key_count:1,
            results:requests.map(request => {
                if (request.kind === 'company.types') return { ...request, ok:true, body:{ companies:[{ id:1, name:'Oil Rig' }] } };
                if (request.kind === 'company.snapshot') return { ...request, ok:true, body:'id,name,type,rating,employees_hired,employees_capacity\n77,Test Rig,1,9,1,10\n' };
                return { ...request, ok:true, body:{ company_employees:[{ id:123, name:'Target', status:{ state:'Okay', description:'Okay', until:0 } }] } };
            })
        });
        const fetchFairFight = async () => {
            fairFightRequests++;
            throw new Error('Too many requests');
        };

        const first = await runMuggingMonitor(env, { executePublicRequests, fetchFairFight }, { now, maxCalls:10 });
        const second = await runMuggingMonitor(env, { executePublicRequests, fetchFairFight }, { now:now + 60_000, maxCalls:10 });
        const status = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/status/v1.json').body);
        assert.equal(first.fair_fight_attempted, 1);
        assert.equal(first.fair_fight_checked, 0);
        assert.equal(second.fair_fight_attempted, 0);
        assert.equal(fairFightRequests, 1);
        assert.equal(status.fair_fight.last_error, 'Too many requests');
        assert.equal(status.fair_fight.next_request_at, now + 10 * 60_000);
    });

    it('assigns cached targets by requesting-user rough Fair Fight without contributor polling', async () => {
        const env = createEnv();
        const now = Date.UTC(2026, 9, 5, 12, 0, 0);
        const shard = {
            schema:2,
            shard:0,
            company_ids:[30],
            targets:{
                '15':{
                    id:15, name:'Eligible', company_id:30, company_name:'Test Rig',
                    status_state:'Okay', status_until:0, priority_multiplier:1,
                    battle_stats_estimate:5_000_000, battle_stats_source:'fair_fight',
                    battle_stats_checked_at:now - 86_400_000
                },
                '30':{
                    id:30, name:'Unavailable', status_state:'Hospital',
                    status_until:Math.floor((now + 60_000) / 1000),
                    battle_stats_estimate:4_000_000
                },
                '45':{
                    id:45, name:'Far Above Maximum', status_state:'Okay',
                    status_until:0, priority_multiplier:1,
                    battle_stats_estimate:100_000_000, battle_stats_source:'fair_fight',
                    battle_stats_checked_at:now - 86_400_000
                }
            },
            updated_at:now
        };
        await env.MUGGING_BUCKET.put('mugging/state/v2/targets/shard-00.json', JSON.stringify(shard));
        await env.MUGGING_BUCKET.put('mugging/state/v2/index.json', JSON.stringify({
            schema:2, phase:'monitoring', company_ids:[30], companies:{}, target_shards:{ '15':0, '30':0, '45':0 },
            monitor_shard_cursor:0, catalog_ruleset_version:2, catalog_updated_at:now,
            cycle_started_at:now, shard_summaries:{}, shards_completed_in_cycle:0,
            last_cycle_completed_at:0, fair_fight_last_request_at:0, fair_fight_last_success_at:0,
            fair_fight_last_error_at:0, fair_fight_last_error:'', created_at:now, updated_at:now,
            last_run:null, summary:null
        }));

        const result = await roughMuggingAssignments(env, {
            user_battle_stats:10_000_000, min_fair_fight:1, max_fair_fight:3, limit:20
        }, now);
        assert.equal(result.estimate_kind, 'rough');
        assert.equal(result.targets.length, 1);
        assert.equal(result.targets[0].id, 15);
        assert.equal(result.targets[0].fair_fight, 2.33);
        assert.equal(result.targets[0].confidence, 'rough · recent estimate');
        assert.equal(result.targets.some(target => target.id === 45), false, 'max FF 3 must reject uncapped estimates above 3');
    });

    it('schedules ten active or five inactive contributor checks without known-timer waste', async () => {
        const env = createEnv();
        const now = Date.UTC(2026, 9, 5, 13, 0, 0);
        const targets = {};
        for (let index = 1; index <= 40; index++) {
            const id = index * 15;
            targets[String(id)] = {
                id, name:`Target ${id}`, status_state:index === 1 ? 'Hospital' : 'Okay',
                status_until:index === 1 ? Math.floor((now + 300_000) / 1000) : 0,
                last_checked_at:now - index * 60_000
            };
        }
        await env.MUGGING_BUCKET.put('mugging/state/v2/targets/shard-00.json', JSON.stringify({
            schema:2, shard:0, company_ids:[], targets, updated_at:now
        }));
        await env.MUGGING_BUCKET.put('mugging/state/v2/index.json', JSON.stringify({
            schema:2, phase:'monitoring', company_ids:[], companies:{}, target_shards:{},
            monitor_shard_cursor:0, catalog_ruleset_version:2, catalog_updated_at:now,
            cycle_started_at:now, shard_summaries:{}, shards_completed_in_cycle:0,
            last_cycle_completed_at:0, fair_fight_last_request_at:0, fair_fight_last_success_at:0,
            fair_fight_last_error_at:0, fair_fight_last_error:'', created_at:now, updated_at:now,
            last_run:null, summary:null
        }));
        const active = await contributorTaskAssignments(env, { client_id:'client-a', user_id:30, active:true, limit:40 }, now);
        const inactive = await contributorTaskAssignments(env, { client_id:'client-a', active:false, limit:40 }, now);
        assert.equal(active.mode, 'active');
        assert.equal(active.api_budget_per_minute, 10);
        assert.equal(active.personal_assignments_allowed, true);
        assert.equal(inactive.mode, 'inactive');
        assert.equal(inactive.api_budget_per_minute, 5);
        assert.equal(inactive.personal_assignments_allowed, false);
        assert.equal(active.tasks.some(task => task.player_id === 15), false);
        assert.equal(active.tasks.some(task => task.player_id === 30), false);
    });

    it('batches permission-gated contributor observations into shared R2 state', async () => {
        const env = createEnv();
        env.CONTRIBUTION_SERVICE = {
            async fetch() { return Response.json({ ok:true, user_id:999, scopes:['slink.mugging'] }); }
        };
        // This authenticated route clamps old observations against wall time.
        const observedAt = Date.now() - 1000;
        const response = await worker.fetch(new Request('https://mugging.example/api/contributor/reports', {
            method:'POST',
            headers:{ Authorization:'Bearer permission-session', 'Content-Type':'application/json' },
            body:JSON.stringify({
                client_id:'extension-test',
                reports:[{
                    report_id:'extension-test:123:' + observedAt,
                    player_id:123,
                    name:'Shared Target',
                    observed_at:observedAt,
                    state:'Hospital',
                    description:'In hospital',
                    until:Math.floor((observedAt + 60_000) / 1000),
                    level:42,
                    bountyCount:2,
                    bountyTotal:750000
                }, {
                    report_id:'self',
                    player_id:999,
                    observed_at:observedAt,
                    state:'Okay'
                }]
            })
        }), env);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.submitted, 2);
        assert.equal(body.accepted, 1);
        assert.equal(body.ignored, 1);
        assert.deepEqual(body.acknowledged_report_ids, ['extension-test:123:' + observedAt]);
        const index = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v2/index.json').body);
        const shardNumber = index.target_shards['123'];
        const shard = JSON.parse(env.MUGGING_BUCKET.values.get(
            `mugging/state/v2/targets/shard-${String(shardNumber).padStart(2, '0')}.json`
        ).body);
        assert.equal(shard.targets['123'].status_state, 'Hospital');
        assert.equal(shard.targets['123'].bounty_total, 750000);
        assert.equal(shard.targets['123'].last_checked_at, observedAt);
    });

    it('serves contributor tasks only through a live slink.mugging permission session', async () => {
        const env = createEnv();
        env.CONTRIBUTION_SERVICE = {
            async fetch() { return Response.json({ ok:true, user_id:999, scopes:['slink.mugging'] }); }
        };
        const response = await worker.fetch(new Request('https://mugging.example/api/contributor/tasks', {
            method:'POST',
            headers:{ Authorization:'Bearer permission-session', 'Content-Type':'application/json' },
            body:JSON.stringify({ client_id:'extension-test', active:false, limit:20 })
        }), env);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.mode, 'inactive');
        assert.equal(body.api_budget_per_minute, 5);
        assert.equal(body.personal_assignments_allowed, false);
    });

    it('serves rough assignments only through a live slink.mugging permission session', async () => {
        const env = createEnv();
        env.CONTRIBUTION_SERVICE = {
            async fetch(input, init = {}) {
                assert.equal(new URL(String(input)).pathname, '/api/internal/permissions/session');
                assert.equal(init.headers.Authorization, 'Bearer permission-session');
                assert.equal(init.headers['X-SLINK-Service-Token'], 'contribution-test-token');
                return Response.json({ ok:true, user_id:999, scopes:['slink.mugging'] });
            }
        };
        const response = await worker.fetch(new Request('https://mugging.example/api/assignments/rough', {
            method:'POST',
            headers:{ Authorization:'Bearer permission-session', 'Content-Type':'application/json' },
            body:JSON.stringify({ user_battle_stats:10_000_000 })
        }), env);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.estimate_kind, 'rough');
        assert.equal(body.user_battle_stats, 10_000_000);
    });

    it('keeps the health route read-only and authenticates manual runs', async () => {
        const env = createEnv();
        const health = await worker.fetch(new Request('https://mugging.example/api/health'), env);
        assert.equal(health.status, 200);
        assert.equal((await health.json()).storage, undefined);

        const denied = await worker.fetch(new Request('https://mugging.example/api/internal/run', { method:'POST' }), env);
        assert.equal(denied.status, 401);
    });


    it('uses the full aggregate donated-key capacity instead of a fixed 100-call ceiling', async () => {
        const env = createEnv();
        const companies = Array.from({ length:150 }, (_, index) => ({
            id:index + 1,
            name:`Rig ${index + 1}`,
            type:1,
            rating:9
        }));
        const csv = [
            'id,name,type,rating,employees_hired,employees_capacity',
            ...companies.map(row => `${row.id},${row.name},${row.type},${row.rating},1,10`)
        ].join('\n');
        let brokeredRequests = 0;
        env.CONTRIBUTION_SERVICE = {
            async fetch(input, init = {}) {
                const pathname = new URL(String(input)).pathname;
                if (pathname.endsWith('/capacity')) {
                    return Response.json({
                        ok:true,
                        key_count:10,
                        configured_capacity:200,
                        used_capacity:50,
                        available_capacity:150,
                        window_started_at:Date.now()
                    });
                }
                const requests = JSON.parse(init.body).requests;
                const allowedKinds = new Set(['company.types', 'company.snapshot', 'company.employees']);
                for (const request of requests) {
                    assert.equal(
                        allowedKinds.has(request.kind),
                        true,
                        'Mugging Worker sent unsupported Contribution request kind: ' + request.kind
                    );
                }
                brokeredRequests += requests.length;
                return Response.json({
                    ok:true,
                    key_count:10,
                    configured_capacity:200,
                    calls_reserved:requests.length,
                    available_capacity:Math.max(0, 150 - brokeredRequests),
                    results:requests.map(request => {
                        if (request.kind === 'company.types') {
                            return {
                                ...request,
                                ok:true,
                                body:{ companies:[{ id:1, name:'Oil Rig' }] }
                            };
                        }
                        if (request.kind === 'company.snapshot') {
                            return { ...request, ok:true, body:csv };
                        }
                        return { ...request, ok:true, body:{ company_employees:[] } };
                    })
                });
            }
        };

        const result = await workerTesting.runMonitor(env);
        assert.equal(result.calls, 150);
        assert.equal(brokeredRequests, 150);
        const status = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/status/v1.json').body);
        assert.equal(status.catalog_ruleset_version, 2);
        assert.equal(status.summary.configured_calls_per_minute, 200);
        assert.equal(status.summary.available_calls_at_run_start, 150);
        assert.equal(status.summary.calls_budgeted_this_run, 150);
        assert.equal(status.summary.calls_used_last_run, 150);
        assert.equal('max_calls_per_minute' in status.summary, false);
    });

    it('automatically migrates legacy state into target and Fair Fight shards without deleting it', async () => {
        const env = createEnv();
        const now = Date.UTC(2026, 8, 28, 12, 0, 0);
        const legacy = {
            schema:1,
            phase:'monitoring',
            catalog_ruleset_version:2,
            catalog_updated_at:now - 60_000,
            company_ids:[77],
            companies:{ '77':{ id:77, name:'Test Rig', rating:9 } },
            targets:{
                '123':{
                    id:123,
                    name:'Target',
                    company_id:77,
                    first_seen_at:now - 86_400_000,
                    battle_stats_estimate:1_000_000,
                    fair_fight:2.5,
                    fair_fight_checked_at:now - 60_000
                }
            }
        };
        await env.MUGGING_BUCKET.put('mugging/state/v1.json', JSON.stringify(legacy));

        const result = await shardedTesting.ensureShardedStorage(env.MUGGING_BUCKET, now);
        assert.equal(result.migrated, true);
        assert.equal(result.index.schema, 2);
        assert.equal(result.index.target_shards['123'], 77 % 15);
        assert.ok(env.MUGGING_BUCKET.values.has('mugging/state/v1.json'));
        assert.ok(env.MUGGING_BUCKET.values.has('mugging/state/v2/index.json'));
        assert.ok(env.MUGGING_BUCKET.values.has('mugging/state/v2/targets/shard-02.json'));
        assert.ok(env.MUGGING_BUCKET.values.has('mugging/fair-fight/v2/shards/shard-11.json'));
        assert.equal(
            JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/shards/shard-11.json').body)
                .targets['123'].battle_stats_estimate,
            1_000_000
        );
    });

    it('assigns each target to one stable Fair Fight shard out of fourteen', () => {
        const shards = new Set();
        for (let id = 1; id <= 140; id++) shards.add(shardedTesting.fairFightShardForTarget(id));
        assert.equal(shards.size, 14);
        assert.deepEqual([...shards].sort((a, b) => a - b), Array.from({ length:14 }, (_, index) => index));
    });

    it('checks a genuinely new target immediately, then leaves it in the 14-day rotation', async () => {
        const env = createEnv();
        env.FFSCOUTER_API_KEY = 'test-key';
        const now = Date.UTC(2026, 8, 28, 12, 0, 0);
        let fairFightRequests = 0;
        const executePublicRequests = async requests => ({
            key_count:1,
            configured_capacity:20,
            available_capacity:20,
            results:requests.map(request => {
                if (request.kind === 'company.types') {
                    return { ...request, ok:true, body:{ companies:[{ id:1, name:'Oil Rig' }] } };
                }
                if (request.kind === 'company.snapshot') {
                    return {
                        ...request,
                        ok:true,
                        body:'id,name,type,rating,employees_hired,employees_capacity\n77,Test Rig,1,9,1,10\n'
                    };
                }
                return {
                    ...request,
                    ok:true,
                    body:{ company_employees:[{ id:123, name:'Target', status:{ state:'Okay' } }] }
                };
            })
        });
        const fetchFairFight = async ids => {
            fairFightRequests++;
            return ids.map(id => ({ player_id:id, bs_estimate:1_000_000, fair_fight:2.5 }));
        };

        const first = await runShardedMonitor(
            env,
            { executePublicRequests, fetchFairFight },
            { now, maxCalls:20 }
        );
        const second = await runShardedMonitor(
            env,
            { executePublicRequests, fetchFairFight },
            { now:now + 10 * 60_000, maxCalls:20 }
        );
        const pending = JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/pending.json').body);
        const ffShard = JSON.parse(
            env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/shards/shard-11.json').body
        );

        assert.equal(first.fair_fight_attempted, 1);
        assert.equal(first.fair_fight_checked, 1);
        assert.equal(second.fair_fight_attempted, 0);
        assert.equal(fairFightRequests, 1);
        assert.deepEqual(pending.ids, []);
        assert.equal(ffShard.targets['123'].last_success_at, now);
    });
    it('preserves positive target estimates against old clients sending zero or missing values', async () => {
        const env=createEnv(),now=Date.now()-10000;
        env.CONTRIBUTION_SERVICE={fetch:async()=>Response.json({ok:true,user_id:999,scopes:['slink.mugging']})};
        await ingestShardedReports(env,[{target_id:123,name:'Test',source:'fair_fight',observed_at:now,battle_stats_estimate:500000}],now);
        for(const value of [null,0,-1,'',true]){
            const response=await worker.fetch(new Request('https://test/api/contributor/reports',{
                method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},
                body:JSON.stringify({client_id:'test',reports:[{player_id:123,observed_at:now+1000,state:'Okay',battleStatsEstimate:value}]})
            }),env);
            assert.equal(response.status,200);
        }
        const index=JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v2/index.json').body);
        const state=JSON.parse(env.MUGGING_BUCKET.values.get(`mugging/state/v2/targets/shard-${String(index.target_shards['123']).padStart(2,'0')}.json`).body);
        assert.equal(state.targets['123'].battle_stats_estimate,500000);
        assert.equal(state.targets['123'].battle_stats_checked_at,now);
        const ff=JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/shards/shard-11.json').body);
        assert.equal(ff.targets['123'].battle_stats_estimate,500000);
        const result=await roughMuggingAssignments(env,{user_battle_stats:1000000,min_fair_fight:1,max_fair_fight:3},now+2000);
        assert.equal(result.targets.length,1,'A status-only report must not remove an otherwise eligible target.');
        await ingestShardedReports(env,[
            {target_id:101,source:'fair_fight',observed_at:now,battle_stats_estimate:0},
            {target_id:102,source:'fair_fight',observed_at:now,battle_stats_estimate:500000,status_state:'Hospital',status_until:Math.floor((now+600000)/1000)},
            {target_id:103,source:'client_mug',observed_at:now,mugged_at:now,battle_stats_estimate:500000},
            {target_id:104,source:'fair_fight',observed_at:now,battle_stats_estimate:100000000},
            {target_id:106,source:'fair_fight',observed_at:now,battle_stats_estimate:500000,status_state:'Federal'}
        ],now+2000);
        const counted=await roughMuggingAssignments(env,{user_battle_stats:1000000,min_fair_fight:1,max_fair_fight:3},now+2000);
        assert.deepEqual(counted.pool.excluded,{invalid_or_self:0,no_estimate:1,federal:1,timed_unavailable:1,mug_cooldown:1,fair_fight_range:1});
        assert.equal(counted.pool.total,counted.pool.eligible+Object.values(counted.pool.excluded).reduce((sum,n)=>sum+n,0));
    });

    it('does not turn an old client estimate into a fresh one through a new status check',async()=>{
        const env=createEnv(),now=Date.now()-20000;
        await ingestShardedReports(env,[{target_id:123,source:'fair_fight',observed_at:now,battle_stats_estimate:500000}],now);
        await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now+10000,battle_stats_estimate:300000,battle_stats_observed_at:now-1000}],now+10000);
        const index=JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v2/index.json').body);
        const state=JSON.parse(env.MUGGING_BUCKET.values.get(`mugging/state/v2/targets/shard-${String(index.target_shards['123']).padStart(2,'0')}.json`).body);
        assert.equal(state.targets['123'].battle_stats_estimate,500000);
        assert.equal(state.targets['123'].battle_stats_checked_at,now);
        const status=await muggingStatus(env);
        assert.equal(status.client_contributions.reports_accepted,1);
        assert.equal(status.client_contributions.requires_donated_keys,false);
        assert.equal(status.client_contributions.last_received_at,now+10000);
        assert.ok(status.summary.estimate_coverage.counted_shards>0);
    });

    it('keeps failed and partial FF work queued and retries at the normal ten-minute interval',async()=>{
        const env=createEnv(),now=Date.now();env.FFSCOUTER_API_KEY='synthetic';
        await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now},{target_id:124,source:'contributor_status',observed_at:now}],now);
        const index=JSON.parse(env.MUGGING_BUCKET.values.get('mugging/state/v2/index.json').body),dirty=new Map();
        const first=await shardedTesting.processFairFight(env,index,dirty,{fetchFairFight:async()=>{throw Error('synthetic outage');}},now);
        assert.equal(first.checked,0);
        assert.deepEqual(JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/pending.json').body).ids.sort(),[123,124]);
        const early=await shardedTesting.processFairFight(env,index,dirty,{fetchFairFight:async()=>{throw Error('must not retry early');}},now+60000);
        assert.equal(early.attempted,0);
        const partial=await shardedTesting.processFairFight(env,index,dirty,{fetchFairFight:async()=>[{player_id:123,bs_estimate:500000}]},now+600000);
        assert.equal(partial.checked,1);
        assert.deepEqual(JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/pending.json').body).ids,[124]);
        const lastSuccess=index.fair_fight_last_success_at;
        const missing=await shardedTesting.processFairFight(env,index,dirty,{fetchFairFight:async()=>[{player_id:124,bs_estimate:0}]},now+1200000);
        assert.equal(missing.checked,0);assert.equal(index.fair_fight_last_success_at,lastSuccess);
        assert.deepEqual(JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/pending.json').body).ids,[124]);
        const recovered=await shardedTesting.processFairFight(env,index,dirty,{fetchFairFight:async()=>[{player_id:124,bs_estimate:600000}]},now+1800000);
        assert.equal(recovered.checked,1);
        assert.deepEqual(JSON.parse(env.MUGGING_BUCKET.values.get('mugging/fair-fight/v2/pending.json').body).ids,[]);
    });

    it('can continue FF collection with zero donated Torn capacity',async()=>{
        const env=createEnv(),now=Date.now();env.FFSCOUTER_API_KEY='synthetic';
        await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now}],now);
        const result=await runShardedMonitor(env,{
            executePublicRequests:async()=>{throw Error('No donated Torn requests should be made.');},
            fetchFairFight:async()=>[{player_id:123,bs_estimate:500000}]
        },{now,maxCalls:0,capacity:{key_count:0}});
        assert.equal(result.external_calls,0);assert.equal(result.fair_fight_checked,1);
    });

    it('records client-observed mug transitions without donated keys or repeated false mugs',async()=>{
        const env=createEnv(),now=Date.now();
        await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now,status_state:'Okay'}],now);
        const key='mugging/state/v2/index.json';
        const index=JSON.parse(env.MUGGING_BUCKET.values.get(key).body);index.phase='monitoring';
        await env.MUGGING_BUCKET.put(key,JSON.stringify(index));
        const observation={target_id:123,source:'contributor_status',observed_at:now+1000,status_state:'Hospital',status_description:'Mugged by someone',status_until:Math.floor((now+600000)/1000)};
        const first=await ingestShardedReports(env,[observation],now+1000);
        const second=await ingestShardedReports(env,[{...observation,observed_at:now+2000}],now+2000);
        assert.equal(first.events,1);assert.equal(second.events,0);
        const state=JSON.parse(env.MUGGING_BUCKET.values.get(`mugging/state/v2/targets/shard-${String(index.target_shards['123']).padStart(2,'0')}.json`).body);
        assert.equal(state.targets['123'].last_mugged_at,now+1000);
        assert.equal(state.targets['123'].free_at,testing.earliestFreeAt(now+1000));
        const initial=await ingestShardedReports(env,[{...observation,target_id:456}],now+3000);
        assert.equal(initial.events,0,'A first-ever hospital observation is only a baseline.');
    });

    it('preserves concurrently enqueued FF IDs through conditional queue writes',async()=>{
        const env=createEnv(),bucket=env.MUGGING_BUCKET,key='mugging/fair-fight/v2/pending.json';
        await shardedTesting.updatePendingIds(bucket,{add:[123]},1);
        const original=bucket.put.bind(bucket);let injected=false;
        bucket.put=async(name,body,options)=>{
            if(name===key&&options?.onlyIf&&!injected){injected=true;await original(key,JSON.stringify({schema:1,ids:[123,456],updated_at:2}));}
            return original(name,body,options);
        };
        await shardedTesting.updatePendingIds(bucket,{remove:[123],add:[789]},3);
        assert.deepEqual(JSON.parse(bucket.values.get(key).body).ids,[456,789]);
    });
});


describe('Concurrent estimate protection',()=>{
 it('retains a positive estimate inserted between a status read and its conditional write',async()=>{
  const env=createEnv(),now=Date.now();await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now,status_state:'Okay'}],now);
  const key='mugging/state/v2/targets/shard-'+String(shardedTesting.stateShardForTarget(123)).padStart(2,'0')+'.json';
  const original=env.MUGGING_BUCKET.put.bind(env.MUGGING_BUCKET);let injected=false;
  env.MUGGING_BUCKET.put=async(name,body,options)=>{if(name===key&&options?.onlyIf&&!injected){injected=true;const current=JSON.parse(env.MUGGING_BUCKET.values.get(key).body);Object.assign(current.targets['123'],{battle_stats_estimate:777000,battle_stats_checked_at:now+1});await original(key,JSON.stringify(current));}return original(name,body,options);};
  await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now+2000,status_state:'Okay',battle_stats_estimate:0}],now+2000);
  assert.equal(injected,true);const saved=JSON.parse(env.MUGGING_BUCKET.values.get(key).body);assert.equal(saved.targets['123'].battle_stats_estimate,777000);assert.equal(saved.targets['123'].last_checked_at,now+2000);
 });
 it('estimate-only client reports do not fabricate a fresh status observation',async()=>{
  const env=createEnv(),now=Date.now();env.CONTRIBUTION_SERVICE={fetch:async()=>Response.json({ok:true,user_id:999,scopes:['admin.*']})};await ingestShardedReports(env,[{target_id:123,source:'contributor_status',observed_at:now-10000,status_state:'Okay',level:42}],now-10000);
  const response=await worker.fetch(new Request('https://mugging.example/api/contributor/reports',{method:'POST',headers:{Authorization:'Bearer existing'},body:JSON.stringify({client_id:'test',reports:[{player_id:123,estimate_only:true,observed_at:now,battleStatsEstimate:20000,battle_stats_observed_at:now-1000}]})}),env);assert.equal(response.status,200);
  const key='mugging/state/v2/targets/shard-'+String(shardedTesting.stateShardForTarget(123)).padStart(2,'0')+'.json',row=JSON.parse(env.MUGGING_BUCKET.values.get(key).body).targets['123'];assert.equal(row.level,42);assert.equal(row.last_checked_at,now-10000);assert.equal(row.battle_stats_estimate,20000);
 });
});

describe('Full client Fair Fight recovery round trip',()=>{
 const extensionRoot=process.env.SLINK_EXTENSION_SOURCE_ROOT?pathToFileURL(resolve(process.env.SLINK_EXTENSION_SOURCE_ROOT)+'/'):new URL('../../../extension/',import.meta.url),pdaRoot=process.env.SLINK_PDA_SOURCE_ROOT?pathToFileURL(resolve(process.env.SLINK_PDA_SOURCE_ROOT)+'/'):new URL('../../../pda/SLINK-PDA/',import.meta.url);
 const available=existsSync(new URL('src/core/mugging-ff.js',extensionRoot))&&existsSync(new URL('src/30-dashboard-combat.part',pdaRoot));
 for(const platform of ['extension','pda'])for(const background of [false,true])it(`${platform}: ${background?'background checks without spare Torn calls':'assign unchecked → FF batch → ACK → R2 → refreshed assignment'}`,{skip:available?false:'Requires client source checkouts; set SLINK_EXTENSION_SOURCE_ROOT and SLINK_PDA_SOURCE_ROOT.'},async()=>{
  const env=createEnv(),now=Date.now();env.CONTRIBUTION_SERVICE={fetch:async()=>Response.json({ok:true,user_id:999,scopes:['admin.*']})};
  await ingestShardedReports(env,[{target_id:1,name:'Known',source:'contributor_status',observed_at:now,status_state:'Okay',battle_stats_estimate:10000},{target_id:2,name:'Unchecked',source:'contributor_status',observed_at:now,status_state:'Okay'},{target_id:3,name:'Too strong',source:'contributor_status',observed_at:now,status_state:'Okay',battle_stats_estimate:1e12},{target_id:4,name:'Hospital',source:'contributor_status',observed_at:now,status_state:'Hospital',status_until:Math.floor(now/1000)+3600}],now);
  const initial=await roughMuggingAssignments(env,{user_battle_stats:100000,limit:2},now);assert.equal(initial.targets[0].id,1);assert.equal(initial.targets[1].id,2);assert.equal(initial.targets[1].needs_estimate,true);assert.equal(initial.targets[1].fair_fight,undefined);
  let ffCalls=0,uploads=0,tornCalls=0;
  async function request(url,options={}){if(new URL(url).hostname==='ffscouter.com'){ffCalls++;const ids=new URL(url).searchParams.get('targets').split(',').map(Number);assert.ok(ids.length<=200);return ids.map(player_id=>({player_id,source:'bss',bs_estimate:20000,bss_public:400,last_updated:Math.floor(now/1000)}));}
   if(new URL(url).hostname==='api.torn.com'){tornCalls++;throw Error('No new Torn call permitted in this test');}
   if(url.endsWith('/api/contributor/tasks'))return {tasks:[{kind:'player.status',player_id:2,needs_estimate:true}]};
   if(url.endsWith('/api/contributor/reports'))uploads++;
   const response=await worker.fetch(new Request(url,{method:options.method||'GET',headers:{Authorization:'Bearer existing-session',...options.headers},body:options.body}),env);const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
  }
  const shared=readFileSync(new URL('src/core/mugging-ff.js',extensionRoot),'utf8');
  if(platform==='extension'){
   const storage=new Map([['mugging.settings.v1',{enabled:true,minFairFight:1,maxFairFight:3,limit:2}],['access.settings.v1',{ffKey:'existing-ff-key'}],['player.ownBattleStats.v1',{total:100000,level:50,checkedAt:now}]]);
   const S={core:{storage:{get:async(k,d)=>structuredClone(storage.get(k)??d),set:async(k,v)=>storage.set(k,structuredClone(v))},permissions:{hasScope:()=>true},http:{requestJson:(_cap,url,options)=>request(url,options)},tornApiLimiter:{getContributionCapacity:async()=>({available:0})}},services:{permissionAccess:{ensureSession:async()=>({token:'existing-session'})}},define(group,name,value){this[group][name]=value;}};
   const context=vm.createContext({SLINK_EXTENSION:S,URL,Date,AbortController,setTimeout,clearTimeout,console,crypto});vm.runInContext(shared,context);vm.runInContext(readFileSync(new URL('src/background/mugging-service.js',extensionRoot),'utf8'),context);
   if(background)await S.services.mugging.runContribution();else{const result=await S.services.mugging.refresh({userBattleStats:100000});assert.ok(result.targets.some(t=>t.id===2&&t.battleStatsEstimate===20000));assert.ok(!result.targets.some(t=>t.id===3||t.id===4));}
   assert.equal((storage.get('mugging.contribution.pending.v1')||[]).length,0);
  }else{
   const source=readFileSync(new URL('src/30-dashboard-combat.part',pdaRoot),'utf8');
   function extract(name){const start=source.search(new RegExp('(?:async )?function '+name+'\\('));assert.ok(start>=0,name);const tail=source.slice(start+1),match=/\n(?:async )?function /g.exec(tail);return source.slice(start,match?start+1+match.index:undefined);}
   const state={settings:{mugging:{enabled:true,minFairFight:1,maxFairFight:3,limit:2}},caches:{ownBattleStats:{total:100000,level:50,checkedAt:now}}};
   const context=vm.createContext({URL,Date,AbortController,setTimeout,clearTimeout,console,dataState:state,moduleState:{mugging:{}},muggingSyncBusy:false,muggingContributionBusy:false,
    MUGGING_SYNC_INTERVAL_MS:300000,MUGGING_SYNC_RETRY_MS:60000,MUGGING_SYNC_BATCH_SIZE:100,MUGGING_SYNC_MAX_BATCHES:5,MUGGING_CONTRIBUTION_INTERVAL_MS:60000,MUGGING_ASSIGNMENT_REFRESH_MS:300000,
    currentFfKey:()=> 'existing-ff-key',currentApiKey:()=> 'unused',requestJson:request,writeDataState:async()=>{},renderMugging:()=>{},hasScope:()=>true,muggingClientId:()=> 'pda-test',muggingContributionMode:()=> 'inactive',readApiLedger:()=>({}),contributionCapacity:()=>({available:0}),pdaStoredOwnBattleStats:()=>state.caches.ownBattleStats,touchMuggingActivity:()=>{},validPlayerIntelligenceId:v=>Number(v)>0?Number(v):null,finite:v=>v!=null&&Number.isFinite(Number(v))?Number(v):null,errorMessage:e=>e.message,
    muggingRequest:(path,options)=>request('https://mugging.example'+path,{method:options.method,body:JSON.stringify(options.body)})});
   context.global=context;vm.runInContext(shared,context);const declaration=source.slice(source.indexOf('const muggingFairFightChecks='),source.indexOf('\nfunction queueMuggingContributionObservation('));
   vm.runInContext(declaration+['queueMuggingContributionObservation','muggingContributorReport','syncMuggingContributorReports','muggingCache','refreshMugging','runMuggingContribution'].map(extract).join('\n'),context);
   if(background)await context.runMuggingContribution();else{await context.refreshMugging(false,{userBattleStats:100000,touch:false});assert.equal(context.moduleState.mugging.error,'');assert.ok(state.caches.mugging.targets.some(t=>t.id===2&&t.battle_stats_estimate===20000));}
   assert.equal(Object.keys(state.caches.muggingPendingSync||{}).length,0);
  }
  assert.equal(ffCalls,1);assert.equal(uploads,1);assert.equal(tornCalls,0);
  let result=await roughMuggingAssignments(env,{user_battle_stats:100000,limit:2},now+1000);assert.ok(result.targets.some(t=>t.id===2&&t.battle_stats_estimate===20000&&!t.needs_estimate));
  await ingestShardedReports(env,[{target_id:2,source:'contributor_status',observed_at:now+2000,status_state:'Okay',battle_stats_estimate:0}],now+2000);
  result=await roughMuggingAssignments(env,{user_battle_stats:100000,limit:2},now+3000);assert.equal(result.targets.find(t=>t.id===2).battle_stats_estimate,20000);
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


const levelCoreSource = readFileSync(new URL('./monitor-core.js', import.meta.url), 'utf8');
const levelShardedSource = readFileSync(new URL('./monitor-core-sharded.js', import.meta.url), 'utf8');
assert.match(levelCoreSource, /level:Math\.max\(0, Math\.trunc\(Number\(row\?\.level/);
assert.match(levelShardedSource, /level:Math\.max\(0, Math\.trunc\(Number\(row\.target\?\.level/);
