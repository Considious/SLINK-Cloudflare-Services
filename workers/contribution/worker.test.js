import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, it } from 'node:test';

import worker, { testing } from './worker.js';

const originalFetch = globalThis.fetch;
const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64url');
const SERVICE_TOKEN = 'test-contribution-service-token';
const TERMS_SHA256 =
    '235789f3d858ce3cea62527fadbf249d13ecb6d7c00d0d83f25eb53026819739';
const DISCLOSURE_SHA256 =
    '62003b1c06ca2f9843e34bf72e44fe102f3856289a4f421fe9d8284c2c67b35a';

afterEach(() => {
    globalThis.fetch = originalFetch;
});


describe('SLINK Contribution Service', () => {
    it('publishes fingerprinted donation terms and health', async () => {
        const env = createEnv();
        const health = await worker.fetch(
            new Request('https://contribution.example/api/health'),
            env
        );
        assert.deepEqual(await health.json(), {
            ok: true,
            version: '0.3.0-permission-gateway',
            database: 'connected',
            encryption_secret: 'configured',
            service_token: 'configured',
            active_donations: 0,
            queued_jobs: 0,
            active_services: 0,
            active_virtual_collectors: 0
        });

        const terms = await worker.fetch(
            new Request('https://contribution.example/api/terms'),
            env
        );
        const body = await terms.json();
        const published = readFileSync(
            new URL(
                './terms/2026-08-23/SLINK_API_Key_Donation_Terms.md',
                import.meta.url
            ),
            'utf8'
        ).replace(/\r\n/g, '\n');
        assert.equal(body.document_sha256, TERMS_SHA256);
        assert.equal(
            createHash('sha256').update(published).digest('hex'),
            TERMS_SHA256
        );
        assert.equal(
            createHash('sha256').update(body.summary).digest('hex'),
            DISCLOSURE_SHA256
        );
    });


    it('encrypts Public Only keys and never returns plaintext', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Public Only', accessLevel: 1 });
        const response = await worker.fetch(donationRequest('public-test-key'), env);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.user_id, 3853023);
        assert.ok(body.management_token);
        assert.ok(!JSON.stringify(body).includes('public-test-key'));

        const stored = env.PERMISSIONS_DB.sqlite
            .prepare('SELECT * FROM donated_api_keys WHERE user_id = 3853023')
            .get();
        assert.equal(stored.status, 'active');
        assert.ok(stored.encrypted_key);
        assert.ok(!stored.encrypted_key.includes('public-test-key'));
        assert.equal(
            await testing.decryptApiKey(
                stored.encrypted_key,
                stored.encryption_iv,
                stored.user_id,
                ENCRYPTION_KEY
            ),
            'public-test-key'
        );

        const status = await worker.fetch(
            new Request('https://contribution.example/api/donations', {
                headers: { Authorization: `Bearer ${body.management_token}` }
            }),
            env
        );
        const statusBody = await status.json();
        assert.equal(statusBody.donation.active, true);
        assert.ok(!JSON.stringify(statusBody).includes('encrypted_key'));
        assert.ok(!JSON.stringify(statusBody).includes('management_token'));
    });


    it('rejects keys with more than Public Only access', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Full Access', accessLevel: 4 });
        const response = await worker.fetch(donationRequest('overprivileged-key'), env);
        assert.equal(response.status, 400);
        assert.match((await response.json()).error, /Public Only/);
        assert.equal(
            env.PERMISSIONS_DB.sqlite
                .prepare('SELECT COUNT(*) AS count FROM donated_api_keys')
                .get().count,
            0
        );
    });


    it('owns general permission sessions and administrator grants', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Limited Access', accessLevel: 2 });
        const authenticated = await worker.fetch(
            jsonRequest('https://contribution.example/api/permissions/auth', {
                api_key: 'ordinary-local-key',
                terms_accepted: true,
                terms_version: '2026-08-24',
                terms_sha256: '72a933d69ec99cabeb92b426208e9d0c47e90acaf960818e0b4da38f3f2f5b0a'
            }),
            env
        );
        const session = await authenticated.json();
        assert.equal(authenticated.status, 200);
        assert.equal(session.user_id, 3853023);
        assert.ok(session.scopes.includes('admin.*'));
        assert.ok(session.scopes.includes('slink.adhd.alerts'));
        assert.ok(session.session_token);
        assert.ok(!JSON.stringify(session).includes('ordinary-local-key'));

        const scopes = await worker.fetch(
            new Request('https://contribution.example/api/admin/scopes', {
                headers: { Authorization: `Bearer ${session.session_token}` }
            }),
            env
        );
        assert.equal(scopes.status, 200);
        assert.ok((await scopes.json()).scopes.some(
            entry => entry.scope === 'slink.adhd.marketwatch.20'
        ));

        const updated = await worker.fetch(
            jsonRequest(
                'https://contribution.example/api/admin/users/4468681/permissions',
                {
                    scopes: ['slink.level', 'slink.adhd.alerts'],
                    hours: 24,
                    note: 'Permission gateway test'
                },
                { Authorization: `Bearer ${session.session_token}` }
            ),
            env
        );
        assert.equal(updated.status, 200);
        assert.equal(
            env.PERMISSIONS_DB.sqlite.prepare(`
                SELECT status FROM user_scope_grants
                WHERE user_id = 4468681 AND scope = 'slink.adhd.alerts'
            `).get().status,
            'active'
        );
    });


    it('revokes key material and allows a fresh donation', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Public Only', accessLevel: 1 });
        const first = await worker.fetch(donationRequest('first-key'), env);
        const token = (await first.json()).management_token;
        const revoked = await worker.fetch(
            new Request('https://contribution.example/api/donations', {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            }),
            env
        );
        assert.equal(revoked.status, 200);
        const row = env.PERMISSIONS_DB.sqlite
            .prepare('SELECT * FROM donated_api_keys WHERE user_id = 3853023')
            .get();
        assert.equal(row.status, 'revoked');
        assert.equal(row.encrypted_key, null);
        assert.equal(row.encryption_iv, null);

        const replacement = await worker.fetch(donationRequest('replacement-key'), env);
        assert.equal(replacement.status, 200);
        assert.notEqual((await replacement.json()).management_token, token);
    });


    it('executes allowlisted queued work with a rotated donated key', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Public Only', accessLevel: 1 });
        await worker.fetch(donationRequest('scheduler-key'), env);

        const created = await worker.fetch(
            jsonRequest(
                'https://contribution.example/api/internal/jobs',
                {
                    kind: 'torn.user.basic',
                    payload: { target_id: 123 },
                    requested_by: 'test.leveling'
                },
                { 'X-SLINK-Service-Token': SERVICE_TOKEN }
            ),
            env
        );
        const jobId = (await created.json()).job_id;
        assert.equal(created.status, 202);

        const result = await testing.runScheduledJobs(env, Date.now());
        assert.equal(result.completed, 1);
        const job = env.PERMISSIONS_DB.sqlite
            .prepare('SELECT * FROM contribution_jobs WHERE id = ?')
            .get(jobId);
        assert.equal(job.status, 'completed');
        assert.equal(job.donor_user_id, 3853023);
        assert.equal(JSON.parse(job.result_json).profile.status.state, 'Okay');
        const donor = env.PERMISSIONS_DB.sqlite
            .prepare('SELECT * FROM donated_api_keys WHERE user_id = 3853023')
            .get();
        assert.ok(donor.last_used_at);

        const fetched = await worker.fetch(
            new Request(`https://contribution.example/api/internal/jobs/${jobId}`, {
                headers: { 'X-SLINK-Service-Token': SERVICE_TOKEN }
            }),
            env
        );
        assert.equal((await fetched.json()).job.result.profile.status.state, 'Okay');
    });


    it('runs a donated key as a prioritized virtual collector only for non-admin demand', async () => {
        const env = createEnv();
        globalThis.fetch = tornFetch({ accessType: 'Public Only', accessLevel: 1 });
        await worker.fetch(donationRequest('virtual-key'), env);

        const admin = await worker.fetch(
            jsonRequest(
                'https://contribution.example/api/internal/collect',
                {
                    service_id: 'slink.level',
                    user_id: 3853023,
                    is_admin: true,
                    targets: [{ id: 123 }]
                },
                { 'X-SLINK-Service-Token': SERVICE_TOKEN }
            ),
            env
        );
        const adminBody = await admin.json();
        assert.equal(adminBody.reason, 'admin_activity_excluded');
        assert.equal(adminBody.observations.length, 0);

        const member = await worker.fetch(
            jsonRequest(
                'https://contribution.example/api/internal/collect',
                {
                    service_id: 'slink.level',
                    user_id: 1234567,
                    is_admin: false,
                    targets: [{ id: 123 }]
                },
                { 'X-SLINK-Service-Token': SERVICE_TOKEN }
            ),
            env
        );
        const memberBody = await member.json();
        assert.equal(member.status, 200);
        assert.equal(memberBody.active, true);
        assert.equal(memberBody.observations[0].target_id, 123);
        assert.equal(memberBody.observations[0].state, 'Okay');
        assert.ok(memberBody.virtual_session_id);

        const session = env.PERMISSIONS_DB.sqlite
            .prepare("SELECT * FROM virtual_collector_sessions WHERE status = 'active'")
            .get();
        assert.equal(session.service_id, 'slink.level');
        assert.equal(session.donor_user_id, 3853023);

        const now = Date.now();
        env.PERMISSIONS_DB.sqlite.prepare(`
            UPDATE contribution_services
            SET enabled = 1
            WHERE service_id = 'slink.mug-watch'
        `).run();
        env.PERMISSIONS_DB.sqlite.prepare(`
            INSERT INTO contribution_service_activity (
                service_id, user_id, is_admin, last_seen_at, active_until
            )
            VALUES ('slink.mug-watch', 2222, 0, ?, ?)
        `).run(now, now + 60_000);
        const deferred = await worker.fetch(
            jsonRequest(
                'https://contribution.example/api/internal/collect',
                {
                    service_id: 'slink.level',
                    user_id: 1234567,
                    is_admin: false,
                    targets: [{ id: 123 }]
                },
                { 'X-SLINK-Service-Token': SERVICE_TOKEN }
            ),
            env
        );
        const deferredBody = await deferred.json();
        assert.equal(deferredBody.deferred, true);
        assert.equal(deferredBody.selected_service, 'slink.mug-watch');
    });
});


function createEnv() {
    const sqlite = new DatabaseSync(':memory:');
    for (const migration of [
        '0001-permissions.sql',
        '0002-donated-api-keys.sql',
        '0003-demand-driven-collectors.sql',
        '0004-war-service.sql',
        '0005-permission-catalog.sql',
        '0006-war-officer.sql',
        '0007-theme-permissions.sql',
        '0008-adhd-dashboard.sql'
    ]) {
        sqlite.exec(readFileSync(
            new URL(`../../permissions/migrations/${migration}`, import.meta.url),
            'utf8'
        ));
    }
    return {
        PERMISSIONS_DB: new D1DatabaseAdapter(sqlite),
        API_KEY_ENCRYPTION_KEY: ENCRYPTION_KEY,
        CONTRIBUTION_SERVICE_TOKEN: SERVICE_TOKEN
    };
}


function donationRequest(apiKey) {
    return jsonRequest('https://contribution.example/api/donations', {
        api_key: apiKey,
        terms_accepted: true,
        terms_version: '2026-08-23',
        terms_sha256: TERMS_SHA256,
        disclosure_version: '2026-08-23',
        disclosure_sha256: DISCLOSURE_SHA256
    });
}


function jsonRequest(url, body, headers = {}) {
    return new Request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
    });
}


function tornFetch({ accessType, accessLevel }) {
    return async input => {
        const url = new URL(String(input));
        if (url.pathname === '/v2/key/info') {
            return Response.json({
                info: {
            user: {
                id: 3853023,
                name: 'Considious',
                faction_id: 46978
            },
                    access: { type: accessType, level: accessLevel }
                }
            });
        }
        if (url.pathname === '/v2/user/123/basic') {
            return Response.json({
                profile: {
                    id: 123,
                    status: { state: 'Okay', description: 'Okay', until: 0 }
                }
            });
        }
        return Response.json({ error: { code: 404, error: 'Not found' } }, { status: 404 });
    };
}


class D1DatabaseAdapter {
    constructor(sqlite) {
        this.sqlite = sqlite;
    }

    prepare(sql) {
        return new D1StatementAdapter(this, sql, []);
    }

    async batch(statements) {
        this.sqlite.exec('BEGIN');
        try {
            const results = [];
            for (const statement of statements) results.push(await statement.run());
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

    async first() {
        return this.database.sqlite.prepare(this.sql).get(...this.bindings) ?? null;
    }

    async all() {
        return {
            success: true,
            results: this.database.sqlite.prepare(this.sql).all(...this.bindings)
        };
    }

    async run() {
        const result = this.database.sqlite.prepare(this.sql).run(...this.bindings);
        return {
            success: true,
            results: [],
            meta: {
                changes: Number(result.changes || 0),
                last_row_id: Number(result.lastInsertRowid || 0)
            }
        };
    }
}
