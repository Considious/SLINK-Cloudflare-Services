import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import worker, { testing } from './worker.js';

const originalFetch = globalThis.fetch;
const WORKER_VERSION = '0.15.4-permission-diagnostics';
const TERMS_VERSION = '2026-08-24';
const TERMS_DOCUMENT_SHA256 =
    '72a933d69ec99cabeb92b426208e9d0c47e90acaf960818e0b4da38f3f2f5b0a';
const LEVELING_DISCLOSURE_VERSION = '2026-08-23';
const LEVELING_DISCLOSURE_SHA256 =
    'e1d595a7c8c9e5a8f105bf52d7157c4d40b91314293725391422b14de97fd91d';
const SESSION_SECRET = 'test-session-secret';
const originalDateNow = Date.now;

afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
});


describe('SLINK Leveling Worker', () => {
    it('preserves root, health, admin, and CORS behavior', async () => {
        const db = createDatabase();
        const env = {
            DB: db,
            CONSENT_DB: createConsentDatabase(),
            PERMISSIONS_DB: createPermissionsDatabase(),
            ADMIN_TOKEN: 'correct-admin-token'
        };

        const rootResponse = await worker.fetch(
            new Request('https://worker.example/'),
            env
        );

        assert.equal(rootResponse.status, 200);
        assert.deepEqual(await rootResponse.json(), {
            ok: true,
                service: 'SLINK Leveling API',
            version: WORKER_VERSION,
            message: 'Worker is running.'
        });
        assert.equal(
            rootResponse.headers.get('X-Slinky-Worker-Version'),
            WORKER_VERSION
        );

        const healthResponse = await worker.fetch(
            new Request('https://worker.example/api/health'),
            env
        );

        assert.equal(healthResponse.status, 200);
        assert.deepEqual(await healthResponse.json(), {
            ok: true,
            version: WORKER_VERSION,
            database: 'connected',
            consent_database: 'connected',
            permissions_database: 'connected',
            automatic_access: {
                faction_id: 46978,
                slink_level: 'configured'
            },
            ffscouter_collector: 'not_configured',
            ffscouter_filters: {
                minimum_level: 30,
                maximum_level: 100,
                maximum_battle_stats: 2000,
                inactive_only: true
            },
            terms: {
                version: TERMS_VERSION,
                effective_at: TERMS_VERSION
            },
            tables: {
                targets: 6,
                target_status: 0,
                hospital_events: 0,
                scheduler_queue: 0,
                user_scope_grants: 1,
                faction_scope_grants: 1,
                ffscouter_targets: 0
            }
        });

        const deniedAdmin = await worker.fetch(
            new Request('https://worker.example/api/admin/targets'),
            env
        );
        assert.equal(deniedAdmin.status, 401);

        const allowedAdmin = await worker.fetch(
            new Request('https://worker.example/api/admin/targets?limit=2', {
                headers: { 'X-Admin-Token': 'correct-admin-token' }
            }),
            env
        );
        assert.equal(allowedAdmin.status, 200);
        assert.equal((await allowedAdmin.json()).count, 2);

        const optionsResponse = await worker.fetch(
            new Request('https://worker.example/api/recommendations', {
                method: 'OPTIONS'
            }),
            env
        );
        assert.equal(optionsResponse.status, 204);
        assert.equal(
            optionsResponse.headers.get('X-Slinky-Worker-Version'),
            WORKER_VERSION
        );

        const termsResponse = await worker.fetch(
            new Request('https://worker.example/api/terms'),
            env
        );
        const terms = await termsResponse.json();
        assert.equal(termsResponse.status, 200);
        assert.equal(terms.acceptance_required, true);
        assert.equal(terms.version, TERMS_VERSION);
        assert.equal(terms.document_sha256, TERMS_DOCUMENT_SHA256);
        assert.equal(terms.disclosure_version, LEVELING_DISCLOSURE_VERSION);
        assert.equal(terms.disclosure_sha256, LEVELING_DISCLOSURE_SHA256);
        assert.match(terms.document_url, /SLINK_API_Data_Terms_of_Service\.md$/);
        const publishedTerms = readFileSync(
            new URL(
                '../../terms/2026-08-23/SLINK_API_Data_Terms_of_Service.md',
                import.meta.url
            )
        );
        assert.equal(
            createHash('sha256')
                .update(publishedTerms.toString('utf8').replace(/\r\n/g, '\n'))
                .digest('hex'),
            TERMS_DOCUMENT_SHA256
        );
        assert.equal(
            createHash('sha256')
                .update(terms.leveling_service_summary, 'utf8')
                .digest('hex'),
            LEVELING_DISCLOSURE_SHA256
        );
    });


    it('authenticates from Torn info.user and verifies the issued session', async () => {
        let tornRequests = 0;
        globalThis.fetch = async () => {
            tornRequests++;
            return Response.json({
                info: {
                    user: {
                        id: 3853023,
                        faction_id: 46978
                    }
                }
            });
        };

        const consentDb = createConsentDatabase();
        const env = {
            DB: createDatabase(),
            SESSION_SECRET,
            CONSENT_DB: consentDb,
            PERMISSIONS_DB: createPermissionsDatabase()
        };
        const unconfiguredResponse = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                disclosure_version: LEVELING_DISCLOSURE_VERSION
            }),
            { SESSION_SECRET }
        );
        assert.equal(unconfiguredResponse.status, 500);
        assert.equal(tornRequests, 0, 'missing consent storage must fail closed');

        const refusedResponse = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key'
            }),
            env
        );
        assert.equal(refusedResponse.status, 428);
        assert.equal(tornRequests, 0, 'Torn must not be contacted before consent');

        const authResponse = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                terms_sha256: TERMS_DOCUMENT_SHA256,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
                client_name: 'SLINK Leveling Service',
                client_version: '0.11.0'
            }),
            env
        );
        const authBody = await authResponse.json();

        assert.equal(authResponse.status, 200);
        assert.equal(authBody.authenticated, true);
        assert.equal(authBody.user_id, 3853023);
        assert.equal(authBody.faction_id, 46978);
        assert.equal(authBody.terms_version, TERMS_VERSION);
        assert.equal(
            authBody.disclosure_version,
            LEVELING_DISCLOSURE_VERSION
        );
        assert.equal(authBody.expires_in, 43200);
        assert.deepEqual(authBody.roles, ['admin']);
        assert.deepEqual(authBody.scopes, ['admin.*', 'slink.level']);
        assert.ok(authBody.session_token);
        assert.equal(tornRequests, 1);

        const acceptance = consentDb.sqlite
            .prepare('SELECT * FROM terms_acceptances')
            .get();
        assert.equal(acceptance.user_id, 3853023);
        assert.equal(acceptance.faction_id, 46978);
        assert.equal(acceptance.terms_version, TERMS_VERSION);
        assert.equal(acceptance.document_sha256, TERMS_DOCUMENT_SHA256);
        assert.equal(acceptance.service_id, 'slink-leveling-service');
        assert.equal(
            acceptance.disclosure_version,
            LEVELING_DISCLOSURE_VERSION
        );
        assert.equal(
            acceptance.disclosure_sha256,
            LEVELING_DISCLOSURE_SHA256
        );
        assert.equal(acceptance.acceptance_method, 'explicit_checkbox');

        const repeatedResponse = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                terms_sha256: TERMS_DOCUMENT_SHA256,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
                client_name: 'SLINK Leveling Service',
                client_version: '0.11.0'
            }),
            env
        );
        assert.equal(repeatedResponse.status, 200);
        assert.equal(
            consentDb.sqlite
                .prepare('SELECT COUNT(*) AS count FROM terms_acceptances')
                .get().count,
            1,
            're-authentication must not overwrite or duplicate this version'
        );
        assert.throws(() => {
            consentDb.sqlite
                .prepare('UPDATE terms_acceptances SET client_version = ?')
                .run('changed');
        }, /append-only/);
        assert.throws(() => {
            consentDb.sqlite
                .prepare('DELETE FROM terms_acceptances')
                .run();
        }, /append-only/);

        const sessionResponse = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/session',
                authBody.session_token
            ),
            env
        );
        assert.equal(sessionResponse.status, 200);
        const sessionBody = await sessionResponse.json();
        assert.equal(sessionBody.authenticated, true);
        assert.deepEqual(sessionBody.roles, ['admin']);
        assert.deepEqual(sessionBody.scopes, ['admin.*', 'slink.level']);
        assert.equal(sessionBody.terms_version, TERMS_VERSION);
        assert.equal(
            sessionBody.disclosure_version,
            LEVELING_DISCLOSURE_VERSION
        );
    });


    it('keeps a valid acceptance when the published terms URL moves', async () => {
        globalThis.fetch = async () => Response.json({
            info: { user: { id: 3853023, faction_id: 46978 } }
        });

        const consentDb = createConsentDatabase();
        consentDb.sqlite.prepare(`
            INSERT INTO terms_acceptances (
                user_id,
                faction_id,
                terms_version,
                document_sha256,
                document_url,
                service_id,
                disclosure_version,
                disclosure_sha256,
                accepted_at,
                client_name,
                client_version,
                acceptance_method
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            3853023,
            46978,
            TERMS_VERSION,
            TERMS_DOCUMENT_SHA256,
            'https://github.com/Considious/Torn-Scripts/blob/main/old-terms-location.md',
            'slink-leveling-service',
            LEVELING_DISCLOSURE_VERSION,
            LEVELING_DISCLOSURE_SHA256,
            Date.now(),
            'SLINK Browser Extension',
            '0.7.0',
            'explicit_checkbox'
        );

        const response = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                terms_sha256: TERMS_DOCUMENT_SHA256,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
                client_name: 'SLINK Browser Extension',
                client_version: '0.8.0'
            }),
            {
                DB: createDatabase(),
                SESSION_SECRET,
                CONSENT_DB: consentDb,
                PERMISSIONS_DB: createPermissionsDatabase()
            }
        );

        assert.equal(response.status, 200);
        assert.equal((await response.json()).authenticated, true);
        assert.equal(
            consentDb.sqlite
                .prepare('SELECT COUNT(*) AS count FROM terms_acceptances')
                .get().count,
            1,
            'moving an unchanged terms document must not require a new row'
        );
    });


    it('issues restricted contributor sessions and pauses claims without user demand', async () => {
        globalThis.fetch = async () => Response.json({
            info: { user: { id: 7001, faction_id: 46978 } }
        });
        const db = createDatabase();
        const env = {
            DB: db,
            SESSION_SECRET,
            CONSENT_DB: createConsentDatabase(),
            PERMISSIONS_DB: createPermissionsDatabase()
        };
        const response = await worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                terms_sha256: TERMS_DOCUMENT_SHA256,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
                contributor_only: true,
                client_name: 'Contributor test',
                client_version: '0.14.0'
            }),
            env
        );
        const auth = await response.json();
        assert.equal(response.status, 200);
        assert.equal(auth.session_kind, 'contributor');
        assert.deepEqual(auth.roles, ['contributor']);
        assert.deepEqual(auth.scopes, ['slink.contribute']);

        const deniedRecommendations = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=1',
                auth.session_token
            ),
            env
        );
        assert.equal(deniedRecommendations.status, 403);

        db.sqlite.prepare('DELETE FROM leveling_user_activity').run();
        const idleClaim = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/contributor/checks/claim',
                auth.session_token,
                { interval_capacity: 60, poll_seconds: 300 }
            ),
            env
        );
        const idle = await idleClaim.json();
        assert.equal(idleClaim.status, 200);
        assert.equal(idle.demand_active, false);
        assert.equal(idle.poll_seconds, 1200);
        assert.deepEqual(idle.checks, []);
        assert.equal(
            db.sqlite.prepare('SELECT COUNT(*) AS count FROM client_user_collectors').get().count,
            0,
            'idle contributors must not create collector writes'
        );
    });


    it('uses faction membership as a free grant and permits active paid non-members', async () => {
        const now = 1_800_000_000_000;
        Date.now = () => now;
        let tornIdentity = { id: 7001, faction_id: 46978 };
        globalThis.fetch = async () => Response.json({
            info: { user: tornIdentity }
        });

        const permissionsDb = createPermissionsDatabase();
        const env = {
            DB: createDatabase(),
            SESSION_SECRET,
            CONSENT_DB: createConsentDatabase(),
            PERMISSIONS_DB: permissionsDb
        };
        const authenticate = () => worker.fetch(
            jsonRequest('https://worker.example/api/auth', {
                api_key: 'test-torn-key',
                terms_accepted: true,
                terms_version: TERMS_VERSION,
                terms_sha256: TERMS_DOCUMENT_SHA256,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
                client_name: 'Permission model test',
                client_version: '0.13.3'
            }),
            env
        );

        const factionResponse = await authenticate();
        assert.equal(factionResponse.status, 200);
        assert.deepEqual((await factionResponse.json()).scopes, ['slink.level']);

        tornIdentity = { id: 7002, faction_id: 12345 };
        const unentitledResponse = await authenticate();
        assert.equal(unentitledResponse.status, 403);
        assert.equal(
            (await unentitledResponse.json()).required_scope,
            'slink.level'
        );

        permissionsDb.sqlite.prepare(`
            INSERT INTO user_scope_grants (
                user_id, scope, source, status, starts_at, expires_at,
                granted_by, external_reference, note, created_at, updated_at
            )
            VALUES (?1, 'slink.level', 'purchase', 'active', ?2, ?3,
                3853023, 'ORDER-7002', '30 minute test access', ?2, ?2)
        `).run(7002, now - 1_000, now + (30 * 60 * 1000));
        permissionsDb.sqlite.prepare(`
            INSERT INTO user_scope_grants (
                user_id, scope, source, status, starts_at, expires_at,
                granted_by, note, created_at, updated_at
            )
            VALUES (?1, 'admin.*', 'manual', 'active', ?2, NULL,
                3853023, 'Must be ignored for non-owner', ?2, ?2)
        `).run(7002, now - 1_000);

        const paidResponse = await authenticate();
        const paidBody = await paidResponse.json();
        assert.equal(paidResponse.status, 200);
        assert.equal(paidBody.faction_id, 12345);
        assert.deepEqual(paidBody.roles, ['member']);
        assert.deepEqual(paidBody.scopes, ['slink.level']);
        assert.equal(paidBody.expires_in, 30 * 60);

        tornIdentity = { id: 7003, faction_id: 0 };
        permissionsDb.sqlite.prepare(`
            INSERT INTO user_scope_grants (
                user_id, scope, source, status, starts_at, expires_at,
                granted_by, external_reference, note, created_at, updated_at
            )
            VALUES (?1, 'slink.level', 'purchase', 'active', ?2, ?3,
                3853023, 'ORDER-EXPIRED', 'Expired test access', ?2, ?2)
        `).run(7003, now - 10_000, now - 1_000);
        assert.equal((await authenticate()).status, 403);

        tornIdentity = { id: 7004, faction_id: 0 };
        permissionsDb.sqlite.prepare(`
            INSERT INTO user_scope_grants (
                user_id, scope, source, status, starts_at, expires_at,
                granted_by, external_reference, note, created_at, updated_at
            )
            VALUES (?1, 'slink.level', 'manual', 'revoked', ?2, NULL,
                3853023, NULL, 'Revoked test access', ?2, ?2)
        `).run(7004, now - 10_000);
        assert.equal((await authenticate()).status, 403);
    });


    it('protects every thin-client route behind a member session', async () => {
        const env = { DB: createDatabase(), SESSION_SECRET };
        const requests = [
            new Request('https://worker.example/api/recommendations'),
            jsonRequest('https://worker.example/api/collector/heartbeat', {}),
            jsonRequest('https://worker.example/api/checks/claim', { capacity: 2 }),
            jsonRequest('https://worker.example/api/observations', {
                observations: [{ target_id: 1, state: 'Okay' }]
            }),
            jsonRequest('https://worker.example/api/activity', {
                active_targets: { 1: Math.floor(Date.now() / 1000) }
            }),
            jsonRequest('https://worker.example/api/fair-fight', {
                targets: [{ target_id: 1, fair_fight: 2 }]
            })
        ];

        for (const request of requests) {
            const response = await worker.fetch(request, env);
            assert.equal(response.status, 401);
        }
    });


    it('enforces slink.level and reserves zero contribution for the sole admin', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const noLevelToken = await sessionToken(
            9001,
            crypto.randomUUID(),
            []
        );
        const deniedLevel = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/targets',
                noLevelToken
            ),
            env
        );
        assert.equal(deniedLevel.status, 403);
        assert.equal((await deniedLevel.json()).required_scope, 'slink.level');

        const memberToken = await sessionToken(9002);
        const deniedZero = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                memberToken,
                { interval_capacity: 0, poll_seconds: 300 }
            ),
            env
        );
        assert.equal(deniedZero.status, 403);
        assert.equal((await deniedZero.json()).required_scope, 'admin.*');

        const forgedAdmin = await sessionToken(
            9002,
            crypto.randomUUID(),
            ['admin.*', 'slink.level']
        );
        const deniedForgedAdmin = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/admin/targets?limit=1',
                forgedAdmin
            ),
            env
        );
        assert.equal(deniedForgedAdmin.status, 401);

        const adminToken = await sessionToken(
            3853023,
            crypto.randomUUID(),
            ['admin.*', 'slink.level']
        );
        const allowedZero = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                adminToken,
                { interval_capacity: 0, poll_seconds: 300 }
            ),
            env
        );
        assert.equal(allowedZero.status, 200);
        assert.equal((await allowedZero.json()).admin_zero_contribution, true);

        const bearerAdmin = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/admin/targets?limit=1',
                adminToken
            ),
            env
        );
        assert.equal(bearerAdmin.status, 200);
    });


    it('runs donated collection in the background for members but never for admin-only use', async () => {
        const db = createDatabase();
        const contributionRequests = [];
        const env = {
            DB: db,
            SESSION_SECRET,
            CONTRIBUTION_SERVICE_TOKEN: 'shared-service-token',
            CONTRIBUTION_SERVICE: {
                async fetch(request) {
                    contributionRequests.push(await request.clone().json());
                    assert.equal(
                        request.headers.get('X-SLINK-Service-Token'),
                        'shared-service-token'
                    );
                    return Response.json({
                        ok: true,
                        donor_user_id: 7777,
                        virtual_session_id: 'virtual-test-session',
                        observations: [{
                            target_id: 1,
                            state: 'Hospital',
                            description: 'In hospital',
                            until: Math.floor(Date.now() / 1000) + 600,
                            source: 'donated_torn_api'
                        }]
                    });
                }
            }
        };

        const adminBackground = [];
        const adminToken = await sessionToken(
            3853023,
            'admin-virtual-test',
            ['admin.*', 'slink.level']
        );
        const adminActivity = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/user/activity',
                adminToken,
                {}
            ),
            env,
            { waitUntil: promise => adminBackground.push(promise) }
        );
        assert.equal((await adminActivity.json()).admin_excluded, true);
        assert.equal(adminBackground.length, 0);
        assert.equal(contributionRequests.length, 0);

        const memberBackground = [];
        const memberToken = await sessionToken(9002, 'member-virtual-test');
        const memberActivity = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/user/activity',
                memberToken,
                {}
            ),
            env,
            { waitUntil: promise => memberBackground.push(promise) }
        );
        assert.equal((await memberActivity.json()).active, true);
        assert.equal(memberBackground.length, 1);
        await Promise.all(memberBackground);
        assert.equal(contributionRequests.length, 1);
        assert.equal(contributionRequests[0].service_id, 'slink.level');
        assert.equal(contributionRequests[0].user_id, 9002);
        assert.equal(contributionRequests[0].is_admin, false);
        assert.ok(contributionRequests[0].targets.length > 0);
        assert.equal(
            db.sqlite
                .prepare('SELECT status FROM target_status WHERE target_id = 1')
                .get().status,
            'Hospital'
        );
    });


    it('deduplicates hospital observations and owns scheduling/scoring', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(3853023);
        const until = Math.floor(Date.now() / 1000) + 900;
        db.sqlite.prepare(`
            INSERT INTO client_target_leases (
                target_id,
                user_id,
                session_id,
                leased_at,
                expires_at
            )
            VALUES (1, 3853023, 'hospital-test', ?1, ?2)
        `).run(Date.now(), Date.now() + 60_000);

        const firstResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: [{
                        target_id: 1,
                        state: 'Okay',
                        description: `In hospital until ${until}`,
                        until,
                        source: 'torn_api'
                    }]
                }
            ),
            env
        );
        const firstBody = await firstResponse.json();

        assert.equal(firstResponse.status, 200);
        assert.equal(firstBody.accepted[0].status, 'Hospital');
        assert.equal(firstBody.accepted[0].hospital_event_inserted, true);
        assert.equal(firstBody.accepted[0].schedule_reason, 'hospital_release_plus_1m');
        assert.equal(firstBody.accepted[0].competition_score, 12);
        assert.equal(
            db.sqlite
                .prepare(`
                    SELECT COUNT(*) AS count
                    FROM client_target_leases
                    WHERE target_id = 1
                `)
                .get().count,
            0,
            'an unavailable target should release its recommendation lease'
        );

        const secondResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: [{
                        target_id: 1,
                        state: 'Hospital',
                        description: 'Still in hospital',
                        until,
                        source: 'attack_page'
                    }]
                }
            ),
            env
        );
        const secondBody = await secondResponse.json();

        assert.equal(secondBody.accepted[0].hospital_event_inserted, false);
        assert.equal(
            db.sqlite.prepare('SELECT COUNT(*) AS count FROM hospital_events').get().count,
            1
        );

        const status = db.sqlite
            .prepare('SELECT * FROM target_status WHERE target_id = 1')
            .get();
        assert.equal(status.status, 'Hospital');
        assert.equal(Number(status.status_until), until);
        assert.equal(status.competition_tier, 'Prime');
    });


    it('returns a shared scheduling snapshot without per-target claim writes', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const firstToken = await sessionToken(1001);
        const secondToken = await sessionToken(1002);
        const assignedToken = await sessionToken(9001);

        const assignedResponse = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2',
                assignedToken
            ),
            env
        );
        const assignedIds = (await assignedResponse.json())
            .targets
            .map(row => row.id);
        db.sqlite.prepare(`
            UPDATE client_user_collectors
            SET expires_at = 0
            WHERE user_id = 9001
        `).run();

        for (const token of [firstToken, secondToken]) {
            const response = await worker.fetch(
                authenticatedJsonRequest(
                    'https://worker.example/api/collector/heartbeat',
                    token,
                    {}
                ),
                env
            );
            assert.equal((await response.json()).collector, true);
        }

        const writesBeforePlans = db.writeChanges;

        const firstResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                firstToken,
                { capacity: 2 }
            ),
            env
        );
        const secondResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                secondToken,
                { capacity: 2 }
            ),
            env
        );
        const firstPlan = await firstResponse.json();
        const secondPlan = await secondResponse.json();
        const firstIds = firstPlan.targets.map(row => row.id);
        const secondIds = secondPlan.targets.map(row => row.id);

        assert.equal(db.writeChanges, writesBeforePlans);
        assert.equal(firstPlan.coordination, 'client_rendezvous_hash');
        assert.equal(firstPlan.schedule, 'client_deterministic_time_bucket');
        assert.equal(firstPlan.capacity, 2);
        assert.equal(firstPlan.count, 6);
        assert.deepEqual(firstPlan.checks, []);
        assert.deepEqual(firstIds, [1, 2, 3, 4, 5, 6]);
        assert.deepEqual(secondIds, firstIds);
        assert.deepEqual(secondPlan.collector_roster, firstPlan.collector_roster);
        assert.deepEqual(
            firstPlan.targets
                .filter(row => Number(row.recommendation_leased) === 1)
                .map(row => row.id),
            assignedIds
        );
        assert.equal(
            db.sqlite
                .prepare('SELECT COUNT(*) AS count FROM client_check_claims')
                .get().count,
            0
        );

        const observationResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                firstToken,
                {
                    observations: [{
                        target_id: firstIds[0],
                        state: 'Okay',
                        description: 'Okay',
                        until: 0,
                        source: 'torn_api'
                    }]
                }
            ),
            env
        );
        assert.equal(observationResponse.status, 200);
        assert.equal(db.writeChanges, writesBeforePlans + 1);
    });


    it('returns stable snapshots and accepts client retry batch IDs', async () => {
        const now = Date.UTC(2026, 7, 15, 12, 0, 0);
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(1099, 'edge-batch-session');

        await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/collector/heartbeat',
                token,
                {}
            ),
            env
        );

        const claimRequest = () => authenticatedJsonRequest(
            'https://worker.example/api/checks/claim',
            token,
            { interval_capacity: 2, poll_seconds: 300 }
        );
        const firstResponse = await worker.fetch(claimRequest(), env);
        const first = await firstResponse.json();
        const secondResponse = await worker.fetch(claimRequest(), env);
        const second = await secondResponse.json();

        assert.equal(first.cache_status, undefined);
        assert.equal(second.cache_status, undefined);
        assert.deepEqual(second.targets, first.targets);
        assert.deepEqual(second.collector_roster, first.collector_roster);
        assert.equal(first.schedule, 'client_deterministic_time_bucket');

        const completed = first.targets[0];
        const observationResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: [{
                        target_id: completed.id,
                        state: 'Okay',
                        description: 'Okay',
                        until: 0,
                        source: 'torn_api',
                        check_batch_id: first.batch_id
                    }]
                }
            ),
            env
        );
        assert.equal(observationResponse.status, 200);

        const refreshedResponse = await worker.fetch(claimRequest(), env);
        const refreshed = await refreshedResponse.json();
        assert.equal(refreshed.count, first.count);
        assert.equal(
            refreshed.targets.find(row => row.id === completed.id).previous_status,
            'Okay'
        );
    });


    it('provides the state used for deterministic Okay time buckets', async () => {
        const now = Date.UTC(2026, 7, 15, 12, 0, 0);
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(1102, 'time-bucket-session');
        const insertStatus = db.sqlite.prepare(`
            INSERT INTO target_status (
                target_id,
                status,
                status_until,
                last_checked_at,
                next_check_at,
                competition_score,
                competition_tier
            )
            VALUES (?, 'Okay', 0, ?, ?, 0, 'Prime')
        `);

        for (let id = 1; id <= 6; id++) {
            insertStatus.run(id, now, now + (365 * 24 * 60 * 60 * 1000));
        }

        await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/collector/heartbeat',
                token,
                {}
            ),
            env
        );
        const response = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                token,
                { interval_capacity: 300, poll_seconds: 300 }
            ),
            env
        );
        const body = await response.json();
        const scheduleBucket = Math.floor(now / (5 * 60 * 1000));
        const expected = [1, 2, 3, 4, 5, 6].filter(id => {
            return id % 3 === scheduleBucket % 3;
        });

        assert.equal(response.status, 200);
        assert.equal(body.schedule, 'client_deterministic_time_bucket');
        assert.deepEqual(body.checks, []);
        assert.deepEqual(body.targets.map(row => row.id), [1, 2, 3, 4, 5, 6]);
        assert.deepEqual(
            body.targets
                .filter(row => row.id % 3 === scheduleBucket % 3)
                .map(row => row.id),
            expected
        );
    });


    it('skips unchanged Okay writes except during the daily freshness window', async () => {
        const midday = Date.UTC(2026, 7, 15, 12, 0, 0);
        Date.now = () => midday;
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(1100, 'bulk-observations');
        const insert = db.sqlite.prepare(`
            INSERT INTO targets (id, name, level, total_stats, sources)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (let id = 7; id <= 60; id++) {
            insert.run(id, `Target ${id}`, 30, 1000, 'Test source');
        }

        const writesBefore = db.writeChanges;
        const queriesBefore = db.queryCount;
        const response = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: Array.from({ length: 60 }, (_, index) => ({
                        target_id: index + 1,
                        state: 'Okay',
                        description: 'Okay',
                        until: 0,
                        source: 'torn_api'
                    }))
                }
            ),
            env
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.accepted_count, 60);
        assert.equal(db.writeChanges - writesBefore, 60);
        assert.equal(
            db.queryCount - queriesBefore,
            12,
            '60 normal observations should use six preload and six write queries'
        );
        assert.equal(
            db.sqlite
                .prepare('SELECT COUNT(*) AS count FROM client_check_claims')
                .get().count,
            0
        );

        const writesAfterInitialState = db.writeChanges;
        const repeatResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: Array.from({ length: 60 }, (_, index) => ({
                        target_id: index + 1,
                        state: 'Okay',
                        description: 'Still Okay',
                        until: 0,
                        source: 'torn_api'
                    }))
                }
            ),
            env
        );

        assert.equal(repeatResponse.status, 200);
        assert.equal(db.writeChanges, writesAfterInitialState);
        assert.equal(
            (await repeatResponse.json()).accepted.every(row => {
                return row.database_status_written === false;
            }),
            true
        );

        Date.now = () => Date.UTC(2026, 7, 15, 23, 46, 0);
        const freshnessResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: Array.from({ length: 60 }, (_, index) => ({
                        target_id: index + 1,
                        state: 'Okay',
                        description: 'Still Okay',
                        until: 0,
                        source: 'torn_api'
                    }))
                }
            ),
            env
        );
        const freshnessBody = await freshnessResponse.json();

        assert.equal(freshnessResponse.status, 200);
        assert.equal(db.writeChanges - writesAfterInitialState, 60);
        assert.equal(
            freshnessBody.accepted.every(row => row.freshness_checkpoint),
            true
        );
    });


    it('keeps a worst-case 200-observation upload below 50 D1 queries', async () => {
        const now = 1_800_000_000_000;
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(1101, 'maximum-observations');
        const insert = db.sqlite.prepare(`
            INSERT INTO targets (id, name, level, total_stats, sources)
            VALUES (?, ?, ?, ?, ?)
        `);

        for (let id = 7; id <= 200; id++) {
            insert.run(id, `Target ${id}`, 30, 1000, 'Test source');
        }

        const writesBefore = db.writeChanges;
        const queriesBefore = db.queryCount;
        const response = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/observations',
                token,
                {
                    observations: Array.from({ length: 200 }, (_, index) => ({
                        target_id: index + 1,
                        state: 'Hospital',
                        description: 'Hospitalized',
                        until: Math.floor(now / 1000) + 3600 + index,
                        source: 'torn_api'
                    }))
                }
            ),
            env
        );
        const body = await response.json();
        const usedQueries = db.queryCount - queriesBefore;

        assert.equal(response.status, 200);
        assert.equal(body.accepted_count, 200);
        assert.equal(body.rejected_count, 0);
        assert.equal(usedQueries, 44);
        assert.ok(usedQueries <= 50);
        assert.equal(db.writeChanges - writesBefore, 400);
    });


    it('discovers only changed high-level low-stat FFScouter targets', async () => {
        const db = createDatabase();
        const env = {
            DB: db,
            FFSCOUTER_API_KEY: 'abc123def456ghij'
        };
        let requests = 0;

        globalThis.fetch = async request => {
            requests++;
            const url = new URL(
                request instanceof Request ? request.url : request
            );
            assert.equal(url.origin, 'https://ffscouter.com');
            assert.equal(url.pathname, '/api/v1/get-targets');
            assert.equal(url.searchParams.get('key'), env.FFSCOUTER_API_KEY);
            assert.equal(url.searchParams.get('limit'), '50');
            assert.equal(url.searchParams.has('minlevel'), false);
            assert.equal(url.searchParams.has('maxff'), false);
            return Response.json({
                targets: [
                    {
                        player_id: 1,
                        name: 'Updated Target 1',
                        level: 60,
                        bs_estimate: 250
                    },
                    {
                        player_id: 7001,
                        name: 'Rare Outlier',
                        level: 95,
                        bs_estimate: 1999
                    },
                    {
                        player_id: 7002,
                        name: 'Too Strong',
                        level: 100,
                        bs_estimate: 2001
                    },
                    {
                        player_id: 7003,
                        name: 'Too Low Level',
                        level: 29,
                        bs_estimate: 100
                    }
                ]
            });
        };

        const first = await testing.discoverLevelingTargets(env);
        assert.deepEqual(first, {
            returned: 4,
            qualified: 2,
            inserted_or_updated: 2,
            unchanged: 0,
            filters: {
                minimum_level: 30,
                maximum_level: 100,
                maximum_battle_stats: 2000,
                inactive_only: true
            }
        });

        const existing = db.sqlite
            .prepare('SELECT * FROM targets WHERE id = 1')
            .get();
        assert.equal(existing.name, 'Updated Target 1');
        assert.equal(existing.level, 60);
        assert.equal(existing.total_stats, 250);
        assert.equal(existing.sources, 'Source 1 | FFScouter discovery');

        const discovered = db.sqlite
            .prepare('SELECT * FROM targets WHERE id = 7001')
            .get();
        assert.equal(discovered.name, 'Rare Outlier');
        assert.equal(discovered.level, 95);
        assert.equal(discovered.total_stats, 1999);
        assert.equal(discovered.sources, 'FFScouter discovery');

        const second = await testing.discoverLevelingTargets(env);
        assert.equal(second.inserted_or_updated, 0);
        assert.equal(second.unchanged, 2);
        assert.equal(requests, 2);

        const adminResponse = await worker.fetch(
            new Request(
                'https://worker.example/api/admin/discover-targets',
                {
                    method: 'POST',
                    headers: { 'X-Admin-Token': 'correct-admin-token' }
                }
            ),
            { ...env, ADMIN_TOKEN: 'correct-admin-token' }
        );
        assert.equal(adminResponse.status, 200);
        assert.equal((await adminResponse.json()).inserted_or_updated, 0);

        let retrySuppressed = false;
        await worker.scheduled(
            {
                scheduledTime: 1_800_000_000_000,
                noRetry() {
                    retrySuppressed = true;
                }
            },
            env
        );
        assert.equal(retrySuppressed, false);
        assert.equal(requests, 4);

        const expanded = await testing.discoverLevelingTargets({
            ...env,
            FFSCOUTER_LEVELING_MIN_LEVEL: '20',
            FFSCOUTER_LEVELING_MAX_LEVEL: '100',
            FFSCOUTER_LEVELING_MAX_STATS: '5000'
        });
        assert.equal(expanded.qualified, 4);
        assert.equal(expanded.inserted_or_updated, 2);
        assert.deepEqual(expanded.filters, {
            minimum_level: 20,
            maximum_level: 100,
            maximum_battle_stats: 5000,
            inactive_only: true
        });
        assert.equal(requests, 5);
    });


    it('elects one collector per user and fails over between devices', async () => {
        let now = 1_800_000_000_000;
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const pcToken = await sessionToken(3001, 'pc-session');
        const mobileToken = await sessionToken(3001, 'mobile-session');

        const pcRecommendations = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2&poll_seconds=90',
                pcToken
            ),
            env
        );
        const pcLease = await pcRecommendations.json();
        assert.equal(pcLease.collector, true);
        assert.equal(pcLease.poll_seconds, 90);
        assert.equal(pcLease.collector_lease_seconds, 180);

        const mobileRecommendations = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2',
                mobileToken
            ),
            env
        );
        const mobileLease = await mobileRecommendations.json();
        assert.equal(mobileLease.collector, false);
        assert.deepEqual(
            pcLease.targets.map(row => row.id),
            mobileLease.targets.map(row => row.id)
        );

        const pcChecks = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                pcToken,
                { capacity: 2, poll_seconds: 90 }
            ),
            env
        );
        const pcSnapshot = await pcChecks.json();
        assert.equal(pcSnapshot.count, 6);
        assert.equal(pcSnapshot.capacity, 2);
        assert.equal(pcSnapshot.collector_roster.length, 1);
        assert.deepEqual(pcSnapshot.checks, []);

        const mobileChecks = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                mobileToken,
                { capacity: 2, poll_seconds: 90 }
            ),
            env
        );
        const mobileStandby = await mobileChecks.json();
        assert.equal(mobileStandby.collector, false);
        assert.equal(mobileStandby.count, 0);

        now += (pcLease.collector_lease_seconds * 1000) + 1;

        const mobileTakeover = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2',
                mobileToken
            ),
            env
        );
        assert.equal((await mobileTakeover.json()).collector, true);

        const pcAfterTakeover = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2',
                pcToken
            ),
            env
        );
        assert.equal((await pcAfterTakeover.json()).collector, false);
    });


    it('returns one identical scheduling snapshot to all active collectors', async () => {
        let now = 1_800_000_000_000;
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const tokens = await Promise.all([
            sessionToken(4001, 'collector-one'),
            sessionToken(4002, 'collector-two'),
            sessionToken(4003, 'collector-three')
        ]);

        for (const token of tokens) {
            const response = await worker.fetch(
                authenticatedRequest(
                    'https://worker.example/api/recommendations?limit=2&poll_seconds=300',
                    token
                ),
                env
            );
            assert.equal((await response.json()).collector, true);
        }

        const plans = [];
        for (const token of tokens) {
            const response = await worker.fetch(
                authenticatedJsonRequest(
                    'https://worker.example/api/checks/claim',
                    token,
                    { interval_capacity: 300, poll_seconds: 300 }
                ),
                env
            );
            plans.push(await response.json());
        }

        for (const plan of plans) {
            assert.equal(plan.due_count, 0);
            assert.equal(plan.active_collectors, 3);
            assert.equal(plan.fair_share, 0);
            assert.equal(plan.capacity, 300);
            assert.equal(plan.interval_capacity, 300);
            assert.equal(plan.claim_seconds, 420);
            assert.equal(plan.count, 6);
            assert.equal(plan.coordination, 'client_rendezvous_hash');
            assert.equal(plan.collector_roster.length, 3);
            assert.deepEqual(plan.targets.map(row => row.id), [1, 2, 3, 4, 5, 6]);
            assert.deepEqual(plan.checks, []);
        }
        assert.deepEqual(plans[1].targets, plans[0].targets);
        assert.deepEqual(plans[2].targets, plans[0].targets);
        assert.deepEqual(plans[1].collector_roster, plans[0].collector_roster);
        assert.deepEqual(plans[2].collector_roster, plans[0].collector_roster);

        now += 420_001;
        const reclaimed = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/checks/claim',
                tokens[0],
                { interval_capacity: 300, poll_seconds: 300 }
            ),
            env
        );
        assert.equal(reclaimed.status, 200);
        assert.equal((await reclaimed.json()).count, 6);
    });


    it('leases different recommendations and applies shared activity filters', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const firstToken = await sessionToken(2001);
        const secondToken = await sessionToken(2002);
        const nowSeconds = Math.floor(Date.now() / 1000);

        const activityResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/activity',
                firstToken,
                { active_targets: { 1: nowSeconds } }
            ),
            env
        );
        assert.equal(activityResponse.status, 200);

        const firstResponse = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2&min_ff=1&max_ff=3',
                firstToken
            ),
            env
        );
        const secondResponse = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations?limit=2&min_ff=1&max_ff=3',
                secondToken
            ),
            env
        );
        const firstBody = await firstResponse.json();
        const secondBody = await secondResponse.json();
        const firstIds = firstBody.targets.map(row => row.id);
        const secondIds = secondBody.targets.map(row => row.id);

        assert.equal(firstResponse.status, 200);
        assert.equal(secondResponse.status, 200);
        assert.ok(!firstIds.includes(1), 'recently active target must be excluded');
        assert.ok(firstBody.targets.every(row => row.fair_fight === null));
        assert.ok(secondBody.targets.every(row => row.fair_fight === null));
        assert.deepEqual(firstIds.filter(id => secondIds.includes(id)), []);
    });


    it('keeps recommendation assignments without ten-minute lease churn', async () => {
        let now = 1_800_000_000_000;
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(2100, 'stable-recommendations');
        const url =
            'https://worker.example/api/recommendations?limit=2&poll_seconds=300';

        const firstResponse = await worker.fetch(
            authenticatedRequest(url, token),
            env
        );
        const first = await firstResponse.json();
        const leasesBefore = db.sqlite.prepare(`
            SELECT target_id, user_id, session_id, leased_at, expires_at
            FROM client_target_leases
            WHERE user_id = 2100
            ORDER BY target_id
        `).all();
        const writesAfterFirstLoad = db.writeChanges;

        now += 11 * 60 * 1000;
        const secondResponse = await worker.fetch(
            authenticatedRequest(url, token),
            env
        );
        const second = await secondResponse.json();
        const leasesAfter = db.sqlite.prepare(`
            SELECT target_id, user_id, session_id, leased_at, expires_at
            FROM client_target_leases
            WHERE user_id = 2100
            ORDER BY target_id
        `).all();

        assert.equal(first.lease_seconds, 43_200);
        assert.deepEqual(
            first.targets.map(row => row.id),
            second.targets.map(row => row.id)
        );
        assert.deepEqual(leasesAfter, leasesBefore);
        assert.equal(
            db.writeChanges - writesAfterFirstLoad,
            1,
            'only the single collector lease should renew'
        );
    });


    it('does not rewrite duplicate activity snapshots', async () => {
        let now = 1_800_000_000_000;
        Date.now = () => now;

        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(2200, 'activity-deduplication');
        const snapshot = Math.floor(now / 1000);
        const requestBody = { active_targets: { 1: snapshot } };

        const firstResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/activity',
                token,
                requestBody
            ),
            env
        );
        assert.equal(firstResponse.status, 200);
        const writesAfterFirstReport = db.writeChanges;

        now += 60_000;
        const duplicateResponse = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/activity',
                token,
                requestBody
            ),
            env
        );

        assert.equal(duplicateResponse.status, 200);
        assert.equal(db.writeChanges, writesAfterFirstReport);
    });


    it('ignores source labels and honors the local strength range', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(2050);

        db.sqlite.prepare(`
            UPDATE targets
            SET sources = ?
            WHERE id = 2
        `).run("Baldr's Extra List 1");

        const response = await worker.fetch(
            authenticatedRequest(
                'https://worker.example/api/recommendations' +
                    '?limit=3&min_target_stats=1500&max_target_stats=4500',
                token
            ),
            env
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(body.targets.map(row => row.id), [2, 3, 4]);
        assert.equal(body.targets[0].sources, "Baldr's Extra List 1");
        assert.equal(body.min_target_stats, 1500);
        assert.equal(body.max_target_stats, 4500);
    });


    it('keeps the legacy Fair Fight route as an authenticated no-op', async () => {
        const db = createDatabase();
        const env = { DB: db, SESSION_SECRET };
        const token = await sessionToken(4201);
        const response = await worker.fetch(
            authenticatedJsonRequest(
                'https://worker.example/api/fair-fight',
                token,
                {
                    targets: [{
                        target_id: 1,
                        fair_fight: 4.5,
                        bs_estimate: 5000
                    }]
                }
            ),
            env
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.accepted_count, 0);
        assert.equal(body.cache_scope, 'client');
        assert.equal(body.deprecated, true);
        assert.equal(
            db.sqlite.prepare(`
                SELECT COUNT(*) AS count
                FROM sqlite_master
                WHERE type = 'table'
                  AND name = 'user_target_fair_fight'
            `).get().count,
            0
        );
    });


    it('rejects expired/tampered sessions and preserves parsing helpers', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expiredToken = await testing.createSessionToken(
            {
                user_id: 3853023,
                faction_id: 46978,
                session_id: crypto.randomUUID(),
                terms_version: TERMS_VERSION,
                disclosure_version: LEVELING_DISCLOSURE_VERSION,
                roles: ['admin'],
                scopes: ['admin.*', 'slink.level'],
                iat: now - 43201,
                exp: now - 1
            },
            SESSION_SECRET
        );
        assert.equal(
            await testing.verifySessionToken(expiredToken, SESSION_SECRET),
            null
        );

        const preConsentToken = await testing.createSessionToken(
            {
                user_id: 3853023,
                faction_id: 46978,
                session_id: crypto.randomUUID(),
                iat: now,
                exp: now + 43200
            },
            SESSION_SECRET
        );
        assert.equal(
            await testing.verifySessionToken(preConsentToken, SESSION_SECRET),
            null,
            'sessions issued before required consent must stop working'
        );

        const validToken = await sessionToken(3853023);
        const [payload, signature] = validToken.split('.');
        const tamperedSignature =
            `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        assert.equal(
            await testing.verifySessionToken(
                `${payload}.${tamperedSignature}`,
                SESSION_SECRET
            ),
            null
        );

        assert.equal(testing.normalizeStatus('Okay but in hospital'), 'Hospital');
        assert.equal(testing.competitionTier(80), 'Farmed');
        assert.equal(testing.rapidPenalty(4 * 60 * 1000), 40);
        assert.equal(
            testing.dailyFreshnessSlot(Date.UTC(2026, 7, 15, 23, 44)),
            -1
        );
        assert.equal(
            testing.dailyFreshnessSlot(Date.UTC(2026, 7, 15, 23, 46)),
            0
        );
        assert.equal(
            testing.dailyFreshnessSlot(Date.UTC(2026, 7, 15, 23, 56)),
            2
        );
        assert.equal(testing.parseStatNumber('1.25m'), 1_250_000);
        assert.deepEqual(
            testing.parseCsv('id,name\r\n1,"Quoted, Name"\r\n'),
            [{ id: '1', name: 'Quoted, Name' }]
        );
    });
});


function createDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(BASE_SCHEMA);
    sqlite.exec(
        readFileSync(
            new URL('./migrations/0001-client-coordination.sql', import.meta.url),
            'utf8'
        )
    );
    sqlite.exec(
        readFileSync(
            new URL('./migrations/0002-user-collector-leases.sql', import.meta.url),
            'utf8'
        )
    );
    sqlite.exec(
        readFileSync(
            new URL('./migrations/0003-remove-unused-user-fair-fight-cache.sql', import.meta.url),
            'utf8'
        )
    );
    sqlite.exec(
        readFileSync(
            new URL('./migrations/0004-active-user-demand.sql', import.meta.url),
            'utf8'
        )
    );
    sqlite.prepare(`
        INSERT INTO leveling_user_activity (
            session_id,
            user_id,
            last_interaction_at,
            active_until
        ) VALUES (?, ?, ?, ?)
    `).run('test-active-demand', 9002, Date.now(), Date.now() + 86_400_000);

    const insert = sqlite.prepare(`
        INSERT INTO targets (id, name, level, total_stats, sources)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (let id = 1; id <= 6; id++) {
        insert.run(
            id,
            `Target ${id}`,
            50 - id,
            id * 1000,
            `Source ${id}`
        );
    }

    return new D1DatabaseAdapter(sqlite);
}


function createConsentDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(
        readFileSync(
            new URL(
                './consent-database/0001-terms-acceptances.sql',
                import.meta.url
            ),
            'utf8'
        )
    );
    return new D1DatabaseAdapter(sqlite);
}


function createPermissionsDatabase() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(
        readFileSync(
            new URL(
                '../../permissions/migrations/0001-permissions.sql',
                import.meta.url
            ),
            'utf8'
        )
    );
    return new D1DatabaseAdapter(sqlite);
}


class D1DatabaseAdapter {
    constructor(sqlite) {
        this.sqlite = sqlite;
        this.writeChanges = 0;
        this.queryCount = 0;
    }

    prepare(sql) {
        return new D1StatementAdapter(this, sql, []);
    }

    async batch(statements) {
        this.sqlite.exec('BEGIN');

        try {
            const results = [];

            for (const statement of statements) {
                results.push(await statement.run());
            }

            this.sqlite.exec('COMMIT');
            return results;
        } catch (error) {
            this.sqlite.exec('ROLLBACK');
            throw error;
        }
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

    async first(columnName) {
        this.database.queryCount++;
        const row = this.database.sqlite
            .prepare(this.sql)
            .get(...this.bindings) ?? null;
        return columnName && row ? row[columnName] ?? null : row;
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

    async run() {
        this.database.queryCount++;

        if (/^\s*SELECT\b/i.test(this.sql)) {
            return {
                success: true,
                results: this.database.sqlite
                    .prepare(this.sql)
                    .all(...this.bindings),
                meta: { changes: 0, last_row_id: 0 }
            };
        }

        const result = this.database.sqlite
            .prepare(this.sql)
            .run(...this.bindings);
        const changes = Number(result.changes || 0);
        this.database.writeChanges += changes;
        return {
            success: true,
            results: [],
            meta: {
                changes,
                last_row_id: Number(result.lastInsertRowid || 0)
            }
        };
    }
}


async function sessionToken(
    userId,
    sessionId = crypto.randomUUID(),
    scopes = ['slink.level']
) {
    const now = Math.floor(Date.now() / 1000);
    return testing.createSessionToken(
        {
            user_id: userId,
            faction_id: 46978,
            session_id: sessionId,
            terms_version: TERMS_VERSION,
            disclosure_version: LEVELING_DISCLOSURE_VERSION,
            roles: scopes.includes('admin.*') ? ['admin'] : ['member'],
            scopes,
            iat: now,
            exp: now + 43200
        },
        SESSION_SECRET
    );
}


function jsonRequest(url, body) {
    return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
}


function authenticatedRequest(url, token) {
    return new Request(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
}


function authenticatedJsonRequest(url, token, body) {
    return new Request(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
}


const BASE_SCHEMA = `
    PRAGMA foreign_keys = ON;

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
        competition_score INTEGER DEFAULT 0,
        competition_tier TEXT DEFAULT 'Prime',
        hiding_out INTEGER DEFAULT 0,
        permanent_federal INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (target_id) REFERENCES targets(id)
    );

    CREATE TABLE hospital_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_id INTEGER NOT NULL,
        hospitalized_at TEXT NOT NULL,
        hospital_until TEXT NOT NULL,
        reported_by INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(target_id, hospital_until),
        FOREIGN KEY (target_id) REFERENCES targets(id)
    );

    CREATE INDEX idx_hospital_events_target_time
        ON hospital_events(target_id, hospitalized_at);

    CREATE TABLE scheduler_queue (
        target_id INTEGER PRIMARY KEY,
        next_check_at TEXT,
        reason TEXT,
        priority INTEGER DEFAULT 0,
        claimed_by INTEGER,
        claim_expires_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (target_id) REFERENCES targets(id)
    );
`;

