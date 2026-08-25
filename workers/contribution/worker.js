/**
 * SLINK Contribution Service
 *
 * Release: 0.2.1-cloudflare-repo
 *
 * Stores only authenticated-encryption ciphertext in D1. Plaintext Torn API
 * keys exist only in request memory during donation validation or scheduled
 * execution and are never returned by an endpoint or written to logs.
 */

const WORKER_VERSION = '0.2.1-cloudflare-repo';
const TERMS_VERSION = '2026-08-23';
const TERMS_EFFECTIVE_AT = '2026-08-23';
const TERMS_URL =
    'https://github.com/Considious/SLINK-Cloudflare-Services/blob/main/' +
    'workers/contribution/terms/2026-08-23/' +
    'SLINK_API_Key_Donation_Terms.md';
const TERMS_DOCUMENT_SHA256 =
    '235789f3d858ce3cea62527fadbf249d13ecb6d7c00d0d83f25eb53026819739';
const DISCLOSURE_VERSION = '2026-08-23';
const DISCLOSURE_SHA256 =
    '62003b1c06ca2f9843e34bf72e44fe102f3856289a4f421fe9d8284c2c67b35a';
const TERMS_SUMMARY =
    'Donating a Public Only Torn API key stores it remotely with authenticated ' +
    'encryption so the SLINK Contribution Service can use it for allowlisted ' +
    'public Torn requests while your devices are offline. The key remains ' +
    'active until revoked or replaced. Product modules never receive the ' +
    'plaintext key. SLINK retains your Torn user ID, encrypted key material, ' +
    'consent record, validation and usage timestamps, and bounded contribution ' +
    'job records.';

const ENCRYPTION_VERSION = 1;
const MAX_JSON_BODY_BYTES = 32 * 1024;
const MAX_JOB_RESULT_BYTES = 128 * 1024;
const MAX_SCHEDULED_JOBS = 10;
const MAX_JOB_ATTEMPTS = 5;
const JOB_RETRY_MS = 60 * 60 * 1000;
const SERVICE_ACTIVITY_MS = 15 * 60 * 1000;
const SERVICE_COLLECTION_INTERVAL_MS = 5 * 60 * 1000;
const VIRTUAL_COLLECTOR_IDLE_MS = 20 * 60 * 1000;
const MAX_VIRTUAL_CHECKS = 10;
const textEncoder = new TextEncoder();


const worker = {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        const url = new URL(request.url);

        if (url.pathname === '/' && request.method === 'GET') {
            return jsonResponse({
                ok: true,
                service: 'SLINK Contribution Service',
                version: WORKER_VERSION
            });
        }

        if (url.pathname === '/api/health' && request.method === 'GET') {
            return handleHealth(env);
        }

        if (url.pathname === '/api/terms' && request.method === 'GET') {
            return handleTerms();
        }

        if (url.pathname === '/api/donations' && request.method === 'POST') {
            return handleDonation(request, env, ctx);
        }

        if (url.pathname === '/api/donations' && request.method === 'GET') {
            return handleDonationStatus(request, env);
        }

        if (url.pathname === '/api/donations' && request.method === 'DELETE') {
            return handleDonationRevocation(request, env);
        }

        if (url.pathname === '/api/internal/jobs' && request.method === 'POST') {
            return handleCreateJob(request, env, ctx);
        }

        if (
            url.pathname === '/api/internal/collect' &&
            request.method === 'POST'
        ) {
            return handleVirtualCollection(request, env);
        }

        if (
            url.pathname.startsWith('/api/internal/jobs/') &&
            request.method === 'GET'
        ) {
            return handleGetJob(request, env, url.pathname.slice(19));
        }

        return jsonResponse({ ok: false, error: 'Not found' }, 404);
    },

    async scheduled(controller, env) {
        const result = await runScheduledJobs(env, controller.scheduledTime);
        try {
            await cleanDemandState(env, controller.scheduledTime);
        } catch (error) {
            console.error(JSON.stringify({
                event: 'slink_contribution_demand_cleanup_failed',
                version: WORKER_VERSION,
                error: errorMessage(error)
            }));
        }
        console.log(JSON.stringify({
            event: 'slink_contribution_schedule',
            version: WORKER_VERSION,
            scheduled_at: controller.scheduledTime,
            ...result
        }));
    }
};

export default worker;


async function handleHealth(env) {
    if (!env.PERMISSIONS_DB) {
        return jsonResponse({
            ok: false,
            version: WORKER_VERSION,
            database: 'not_configured',
            error: 'The PERMISSIONS_DB binding is required.'
        }, 500);
    }

    try {
        const now = Date.now();
        const [activeKeys, queuedJobs] = await Promise.all([
            env.PERMISSIONS_DB
                .prepare(`
                    SELECT COUNT(*) AS count
                    FROM donated_api_keys
                    WHERE status = 'active'
                `)
                .first(),
            env.PERMISSIONS_DB
                .prepare(`
                    SELECT COUNT(*) AS count
                    FROM contribution_jobs
                    WHERE status = 'queued'
                `)
                .first()
        ]);
        const [activeServices, virtualCollectors] = await Promise.all([
            optionalCount(
                env,
                `SELECT COUNT(DISTINCT service_id) AS count
                 FROM contribution_service_activity
                 WHERE is_admin = 0 AND active_until > ?1`,
                [now]
            ),
            optionalCount(
                env,
                `SELECT COUNT(*) AS count
                 FROM virtual_collector_sessions
                 WHERE status = 'active' AND last_used_at > ?1`,
                [now - VIRTUAL_COLLECTOR_IDLE_MS]
            )
        ]);

        return jsonResponse({
            ok: true,
            version: WORKER_VERSION,
            database: 'connected',
            encryption_secret: env.API_KEY_ENCRYPTION_KEY
                ? 'configured'
                : 'not_configured',
            service_token: env.CONTRIBUTION_SERVICE_TOKEN
                ? 'configured'
                : 'not_configured',
            active_donations: Number(activeKeys?.count) || 0,
            queued_jobs: Number(queuedJobs?.count) || 0,
            active_services: activeServices,
            active_virtual_collectors: virtualCollectors
        });
    } catch (error) {
        return jsonResponse({
            ok: false,
            version: WORKER_VERSION,
            database: 'error',
            error: errorMessage(error)
        }, 500);
    }
}


async function optionalCount(env, sql, bindings = []) {
    try {
        const row = await env.PERMISSIONS_DB
            .prepare(sql)
            .bind(...bindings)
            .first();
        return Number(row?.count) || 0;
    } catch {
        // Keeps the existing vault healthy during the migration rollout.
        return 0;
    }
}


function handleTerms() {
    return jsonResponse({
        ok: true,
        acceptance_required: true,
        version: TERMS_VERSION,
        effective_at: TERMS_EFFECTIVE_AT,
        document_url: TERMS_URL,
        document_sha256: TERMS_DOCUMENT_SHA256,
        disclosure_version: DISCLOSURE_VERSION,
        disclosure_sha256: DISCLOSURE_SHA256,
        summary: TERMS_SUMMARY
    });
}


async function handleDonation(request, env, ctx) {
    try {
        requireDonationConfiguration(env);
        const body = await readJsonBody(request);

        if (
            body?.terms_accepted !== true ||
            body?.terms_version !== TERMS_VERSION ||
            body?.terms_sha256 !== TERMS_DOCUMENT_SHA256 ||
            body?.disclosure_version !== DISCLOSURE_VERSION ||
            body?.disclosure_sha256 !== DISCLOSURE_SHA256
        ) {
            return jsonResponse({
                ok: false,
                error: 'Accept the current SLINK API Key Donation Terms.',
                terms_required: true,
                terms_version: TERMS_VERSION,
                terms_url: TERMS_URL
            }, 428);
        }

        const apiKey = String(body?.api_key || '').trim();
        if (!apiKey || apiKey.length > 256) {
            return jsonResponse({
                ok: false,
                error: 'A valid Torn Public Only API key is required.'
            }, 400);
        }

        const identity = await validatePublicOnlyTornKey(apiKey);
        const acceptedAt = Date.now();
        const encrypted = await encryptApiKey(
            apiKey,
            identity.userId,
            env.API_KEY_ENCRYPTION_KEY
        );
        const managementToken = randomToken();
        const managementTokenHash = await sha256Hex(managementToken);

        await env.PERMISSIONS_DB
            .prepare(`
                INSERT INTO donated_api_keys (
                    user_id,
                    encrypted_key,
                    encryption_iv,
                    encryption_version,
                    management_token_sha256,
                    access_type,
                    status,
                    terms_version,
                    terms_sha256,
                    terms_accepted_at,
                    created_at,
                    updated_at,
                    last_validated_at,
                    last_used_at,
                    failure_count,
                    last_error
                )
                VALUES (
                    ?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9,
                    ?9, ?9, ?9, NULL, 0, NULL
                )
                ON CONFLICT(user_id) DO UPDATE SET
                    encrypted_key = excluded.encrypted_key,
                    encryption_iv = excluded.encryption_iv,
                    encryption_version = excluded.encryption_version,
                    management_token_sha256 = excluded.management_token_sha256,
                    access_type = excluded.access_type,
                    status = 'active',
                    terms_version = excluded.terms_version,
                    terms_sha256 = excluded.terms_sha256,
                    terms_accepted_at = excluded.terms_accepted_at,
                    updated_at = excluded.updated_at,
                    last_validated_at = excluded.last_validated_at,
                    failure_count = 0,
                    last_error = NULL
            `)
            .bind(
                identity.userId,
                encrypted.ciphertext,
                encrypted.iv,
                ENCRYPTION_VERSION,
                managementTokenHash,
                identity.accessType,
                TERMS_VERSION,
                TERMS_DOCUMENT_SHA256,
                acceptedAt
            )
            .run();

        if (ctx?.waitUntil) {
            ctx.waitUntil(wakeContributionWork(env, acceptedAt));
        }

        return jsonResponse({
            ok: true,
            donated: true,
            user_id: identity.userId,
            access_type: identity.accessType,
            status: 'active',
            terms_version: TERMS_VERSION,
            donated_at: new Date(acceptedAt).toISOString(),
            management_token: managementToken
        });
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function handleDonationStatus(request, env) {
    try {
        requireDatabase(env);
        const donation = await authenticatedDonation(request, env);
        if (!donation) return managementAuthenticationRequired();
        return jsonResponse({ ok: true, donation: publicDonation(donation) });
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function handleDonationRevocation(request, env) {
    try {
        requireDatabase(env);
        const donation = await authenticatedDonation(request, env);
        if (!donation) return managementAuthenticationRequired();
        const now = Date.now();

        await env.PERMISSIONS_DB
            .prepare(`
                UPDATE donated_api_keys
                SET encrypted_key = NULL,
                    encryption_iv = NULL,
                    status = 'revoked',
                    updated_at = ?2,
                    last_error = 'Revoked by donor'
                WHERE user_id = ?1
            `)
            .bind(donation.user_id, now)
            .run();

        return jsonResponse({
            ok: true,
            revoked: true,
            user_id: Number(donation.user_id),
            revoked_at: new Date(now).toISOString()
        });
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function handleCreateJob(request, env, ctx) {
    try {
        if (!await isServiceRequest(request, env)) {
            return serviceAuthenticationRequired();
        }
        requireDatabase(env);
        const body = await readJsonBody(request);
        const job = validateJob(body);
        const now = Date.now();
        const id = crypto.randomUUID();

        await env.PERMISSIONS_DB
            .prepare(`
                INSERT INTO contribution_jobs (
                    id, kind, payload_json, requested_by, status,
                    available_at, attempts, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, 'queued', ?5, 0, ?5, ?5)
            `)
            .bind(
                id,
                job.kind,
                JSON.stringify(job.payload),
                job.requestedBy,
                now
            )
            .run();

        if (ctx?.waitUntil) {
            ctx.waitUntil(runScheduledJobs(env, now));
        }

        return jsonResponse({ ok: true, accepted: true, job_id: id }, 202);
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function handleVirtualCollection(request, env) {
    try {
        if (!await isServiceRequest(request, env)) {
            return serviceAuthenticationRequired();
        }
        requireDonationConfiguration(env);
        const body = await readJsonBody(request);
        const serviceId = String(body?.service_id || '').trim().slice(0, 100);
        const userId = positiveInteger(body?.user_id);
        const isAdmin = body?.is_admin === true;
        const targets = normalizeVirtualTargets(body?.targets);
        if (!serviceId || !userId) {
            throw new RequestValidationError('service_id and user_id are required.');
        }

        const now = Date.now();
        const service = await env.PERMISSIONS_DB
            .prepare(`
                SELECT service_id, display_name, priority, enabled
                FROM contribution_services
                WHERE service_id = ?1
            `)
            .bind(serviceId)
            .first();
        if (!service || Number(service.enabled) !== 1) {
            throw new RequestValidationError('The contribution service is not enabled.');
        }

        await env.PERMISSIONS_DB
            .prepare(`
                INSERT INTO contribution_service_activity (
                    service_id, user_id, is_admin, last_seen_at, active_until
                )
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(service_id, user_id) DO UPDATE SET
                    is_admin = excluded.is_admin,
                    last_seen_at = excluded.last_seen_at,
                    active_until = excluded.active_until
            `)
            .bind(
                serviceId,
                userId,
                isAdmin ? 1 : 0,
                now,
                now + SERVICE_ACTIVITY_MS
            )
            .run();

        if (isAdmin) {
            return jsonResponse({
                ok: true,
                active: false,
                reason: 'admin_activity_excluded',
                observations: []
            });
        }

        const selectedService = await highestPriorityActiveService(env, now);
        if (selectedService?.service_id !== serviceId) {
            return jsonResponse({
                ok: true,
                active: true,
                deferred: true,
                reason: 'higher_priority_service_active',
                selected_service: selectedService?.service_id || null,
                observations: []
            });
        }

        if (!targets.length) {
            return jsonResponse({ ok: true, active: true, observations: [] });
        }
        const attempt = await claimServiceAttempt(env, serviceId, now);
        if (!attempt.claimed) {
            return jsonResponse({
                ok: true,
                active: true,
                deferred: true,
                reason: 'service_cooldown',
                retry_at: attempt.retryAt,
                observations: []
            });
        }

        const donor = await nextDonatedKey(env);
        if (!donor) {
            await recordServiceState(
                env,
                serviceId,
                now,
                now + JOB_RETRY_MS,
                'waiting_for_key'
            );
            return jsonResponse({
                ok: true,
                active: true,
                waiting_for_key: true,
                retry_at: now + JOB_RETRY_MS,
                observations: []
            });
        }

        const sessionId = await activateVirtualCollector(
            env,
            serviceId,
            donor.user_id,
            now
        );
        try {
            const apiKey = await decryptApiKey(
                donor.encrypted_key,
                donor.encryption_iv,
                donor.user_id,
                env.API_KEY_ENCRYPTION_KEY
            );
            const observations = [];
            const failures = [];
            for (const target of targets) {
                try {
                    const data = await performTornBasicRequest(target.id, apiKey);
                    observations.push(tornBasicObservation(target.id, data));
                } catch (error) {
                    if (error?.code === 'TORN_KEY_INVALID') throw error;
                    failures.push({ target_id: target.id, error: errorMessage(error) });
                }
            }

            await env.PERMISSIONS_DB.batch([
                env.PERMISSIONS_DB
                    .prepare(`
                        UPDATE donated_api_keys
                        SET last_used_at = ?2,
                            last_validated_at = ?2,
                            failure_count = 0,
                            last_error = NULL,
                            updated_at = ?2
                        WHERE user_id = ?1
                    `)
                    .bind(donor.user_id, now),
                env.PERMISSIONS_DB
                    .prepare(`
                        UPDATE virtual_collector_sessions
                        SET last_used_at = ?2,
                            status = 'active',
                            ended_at = NULL
                        WHERE session_id = ?1
                    `)
                    .bind(sessionId, now)
            ]);
            await recordServiceState(
                env,
                serviceId,
                now,
                now + SERVICE_COLLECTION_INTERVAL_MS,
                'completed'
            );
            return jsonResponse({
                ok: true,
                active: true,
                service_id: serviceId,
                virtual_session_id: sessionId,
                donor_user_id: Number(donor.user_id),
                observations,
                failures
            });
        } catch (error) {
            const invalid = error?.code === 'TORN_KEY_INVALID';
            await env.PERMISSIONS_DB.batch([
                env.PERMISSIONS_DB
                    .prepare(`
                        UPDATE donated_api_keys
                        SET status = CASE WHEN ?3 = 1 THEN 'invalid' ELSE status END,
                            encrypted_key = CASE WHEN ?3 = 1 THEN NULL ELSE encrypted_key END,
                            encryption_iv = CASE WHEN ?3 = 1 THEN NULL ELSE encryption_iv END,
                            failure_count = failure_count + 1,
                            last_error = ?2,
                            updated_at = ?4
                        WHERE user_id = ?1
                    `)
                    .bind(donor.user_id, errorMessage(error).slice(0, 300), invalid ? 1 : 0, now),
                env.PERMISSIONS_DB
                    .prepare(`
                        UPDATE virtual_collector_sessions
                        SET status = 'ended', ended_at = ?2, last_used_at = ?2
                        WHERE session_id = ?1
                    `)
                    .bind(sessionId, now)
            ]);
            await recordServiceState(env, serviceId, now, now + JOB_RETRY_MS, 'collector_error');
            throw error;
        }
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function handleGetJob(request, env, jobId) {
    try {
        if (!await isServiceRequest(request, env)) {
            return serviceAuthenticationRequired();
        }
        requireDatabase(env);
        const id = String(jobId || '').trim();
        if (!id) throw new RequestValidationError('A contribution job ID is required.');
        const row = await env.PERMISSIONS_DB
            .prepare(`
                SELECT
                    id, kind, requested_by, status, available_at, claimed_at,
                    completed_at, attempts, donor_user_id, result_json, error,
                    created_at, updated_at
                FROM contribution_jobs
                WHERE id = ?1
            `)
            .bind(id)
            .first();
        if (!row) return jsonResponse({ ok: false, error: 'Job not found.' }, 404);
        return jsonResponse({
            ok: true,
            job: {
                ...row,
                result: safeJsonParse(row.result_json),
                result_json: undefined
            }
        });
    } catch (error) {
        return requestErrorResponse(error);
    }
}


async function wakeContributionWork(env, now = Date.now()) {
    try {
        await env.PERMISSIONS_DB
            .prepare(`
                UPDATE contribution_service_state
                SET next_attempt_at = 0,
                    updated_at = ?1
            `)
            .bind(now)
            .run();
    } catch {
        // Migration 0003 may not have been applied during a rolling deploy.
    }
    await env.PERMISSIONS_DB
        .prepare(`
            UPDATE contribution_jobs
            SET available_at = ?1,
                updated_at = ?1
            WHERE status = 'queued'
              AND available_at > ?1
        `)
        .bind(now)
        .run();
    return runScheduledJobs(env, now);
}


async function cleanDemandState(env, now = Date.now()) {
    await env.PERMISSIONS_DB.batch([
        env.PERMISSIONS_DB
            .prepare(`
                DELETE FROM contribution_service_activity
                WHERE active_until <= ?1
            `)
            .bind(now),
        env.PERMISSIONS_DB
            .prepare(`
                UPDATE virtual_collector_sessions
                SET status = 'idle',
                    ended_at = ?1
                WHERE status = 'active'
                  AND last_used_at <= ?2
            `)
            .bind(now, now - VIRTUAL_COLLECTOR_IDLE_MS)
    ]);
}


async function highestPriorityActiveService(env, now) {
    return env.PERMISSIONS_DB
        .prepare(`
            SELECT service.service_id, service.priority
            FROM contribution_services AS service
            WHERE service.enabled = 1
              AND EXISTS (
                    SELECT 1
                    FROM contribution_service_activity AS activity
                    WHERE activity.service_id = service.service_id
                      AND activity.is_admin = 0
                      AND activity.active_until > ?1
              )
            ORDER BY service.priority DESC, service.service_id ASC
            LIMIT 1
        `)
        .bind(now)
        .first();
}


async function claimServiceAttempt(env, serviceId, now) {
    const retryAt = now + SERVICE_COLLECTION_INTERVAL_MS;
    const result = await env.PERMISSIONS_DB
        .prepare(`
            INSERT INTO contribution_service_state (
                service_id, next_attempt_at, last_attempt_at,
                last_completed_at, last_result, updated_at
            )
            VALUES (?1, ?2, ?3, NULL, 'running', ?3)
            ON CONFLICT(service_id) DO UPDATE SET
                next_attempt_at = excluded.next_attempt_at,
                last_attempt_at = excluded.last_attempt_at,
                last_result = 'running',
                updated_at = excluded.updated_at
            WHERE contribution_service_state.next_attempt_at <= ?3
        `)
        .bind(serviceId, retryAt, now)
        .run();
    if (Number(result.meta?.changes)) {
        return { claimed: true, retryAt };
    }
    const state = await env.PERMISSIONS_DB
        .prepare(`
            SELECT next_attempt_at
            FROM contribution_service_state
            WHERE service_id = ?1
        `)
        .bind(serviceId)
        .first();
    return { claimed: false, retryAt: Number(state?.next_attempt_at) || retryAt };
}


async function recordServiceState(
    env,
    serviceId,
    now,
    nextAttemptAt,
    result
) {
    await env.PERMISSIONS_DB
        .prepare(`
            INSERT INTO contribution_service_state (
                service_id, next_attempt_at, last_attempt_at,
                last_completed_at, last_result, updated_at
            )
            VALUES (
                ?1, ?2, ?3,
                CASE WHEN ?4 = 'completed' THEN ?3 ELSE NULL END,
                ?4, ?3
            )
            ON CONFLICT(service_id) DO UPDATE SET
                next_attempt_at = excluded.next_attempt_at,
                last_attempt_at = excluded.last_attempt_at,
                last_completed_at = CASE
                    WHEN excluded.last_result = 'completed'
                        THEN excluded.last_attempt_at
                    ELSE contribution_service_state.last_completed_at
                END,
                last_result = excluded.last_result,
                updated_at = excluded.updated_at
        `)
        .bind(serviceId, nextAttemptAt, now, result)
        .run();
}


async function nextDonatedKey(env) {
    return env.PERMISSIONS_DB
        .prepare(`
            SELECT *
            FROM donated_api_keys
            WHERE status = 'active'
              AND encrypted_key IS NOT NULL
              AND encryption_iv IS NOT NULL
            ORDER BY COALESCE(last_used_at, 0) ASC, failure_count ASC, user_id ASC
            LIMIT 1
        `)
        .first();
}


async function activateVirtualCollector(env, serviceId, donorUserId, now) {
    const sessionId = `virtual:${serviceId}:${donorUserId}`;
    await env.PERMISSIONS_DB
        .prepare(`
            INSERT INTO virtual_collector_sessions (
                session_id, service_id, donor_user_id, status,
                started_at, last_used_at, ended_at
            )
            VALUES (?1, ?2, ?3, 'active', ?4, ?4, NULL)
            ON CONFLICT(session_id) DO UPDATE SET
                status = 'active',
                last_used_at = excluded.last_used_at,
                ended_at = NULL
        `)
        .bind(sessionId, serviceId, donorUserId, now)
        .run();
    return sessionId;
}


function normalizeVirtualTargets(value) {
    const seen = new Set();
    const targets = [];
    for (const row of Array.isArray(value) ? value : []) {
        const id = positiveInteger(row?.id ?? row?.target_id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        targets.push({ id });
        if (targets.length >= MAX_VIRTUAL_CHECKS) break;
    }
    return targets;
}


function tornBasicObservation(targetId, data) {
    const source = data?.profile ?? data?.basic ?? data?.user ?? data;
    const status = source?.status ?? data?.status ?? {};
    const state = status?.state ?? status?.description ??
        status?.details ?? source?.state ?? 'Unknown';
    return {
        target_id: targetId,
        state: String(state || 'Unknown').slice(0, 50),
        description: String(
            status?.description ?? status?.details ?? state ?? 'Unknown'
        ).slice(0, 500),
        until: Number(status?.until) || 0,
        source: 'donated_torn_api'
    };
}


async function runScheduledJobs(env, scheduledAt = Date.now()) {
    requireDonationConfiguration(env);
    const jobs = await env.PERMISSIONS_DB
        .prepare(`
            SELECT id, kind, payload_json, requested_by, attempts
            FROM contribution_jobs
            WHERE status = 'queued'
              AND available_at <= ?1
              AND attempts < ?2
            ORDER BY created_at ASC
            LIMIT ?3
        `)
        .bind(scheduledAt, MAX_JOB_ATTEMPTS, MAX_SCHEDULED_JOBS)
        .all();
    let completed = 0;
    let retried = 0;
    let failed = 0;
    let skipped = 0;

    for (const job of jobs.results || []) {
        const outcome = await executeContributionJob(env, job, scheduledAt);
        if (outcome === 'completed') completed++;
        else if (outcome === 'retried') retried++;
        else if (outcome === 'failed') failed++;
        else skipped++;
    }

    return {
        selected: jobs.results?.length || 0,
        completed,
        retried,
        failed,
        skipped
    };
}


async function executeContributionJob(env, job, now) {
    const claim = await env.PERMISSIONS_DB
        .prepare(`
            UPDATE contribution_jobs
            SET status = 'running',
                claimed_at = ?2,
                attempts = attempts + 1,
                updated_at = ?2
            WHERE id = ?1
              AND status = 'queued'
        `)
        .bind(job.id, now)
        .run();
    if (!Number(claim.meta?.changes)) return 'skipped';

    const donor = await nextDonatedKey(env);

    if (!donor) {
        const attempts = Number(job.attempts) + 1;
        await retryOrFailJob(env, job.id, attempts, now, 'No active donated API key is available.');
        return attempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'retried';
    }

    try {
        const apiKey = await decryptApiKey(
            donor.encrypted_key,
            donor.encryption_iv,
            donor.user_id,
            env.API_KEY_ENCRYPTION_KEY
        );
        const result = await performAllowlistedJob(job, apiKey);
        const encodedResult = JSON.stringify(result);
        if (textEncoder.encode(encodedResult).byteLength > MAX_JOB_RESULT_BYTES) {
            throw new Error('The contribution job result exceeded the storage limit.');
        }

        await env.PERMISSIONS_DB.batch([
            env.PERMISSIONS_DB
                .prepare(`
                    UPDATE contribution_jobs
                    SET status = 'completed',
                        completed_at = ?2,
                        donor_user_id = ?3,
                        result_json = ?4,
                        error = NULL,
                        updated_at = ?2
                    WHERE id = ?1
                `)
                .bind(job.id, now, donor.user_id, encodedResult),
            env.PERMISSIONS_DB
                .prepare(`
                    UPDATE donated_api_keys
                    SET last_used_at = ?2,
                        last_validated_at = ?2,
                        failure_count = 0,
                        last_error = NULL,
                        updated_at = ?2
                    WHERE user_id = ?1
                `)
                .bind(donor.user_id, now)
        ]);
        return 'completed';
    } catch (error) {
        const message = errorMessage(error).slice(0, 300);
        const authenticationFailure = error?.code === 'TORN_KEY_INVALID';

        await env.PERMISSIONS_DB
            .prepare(`
                UPDATE donated_api_keys
                SET status = CASE WHEN ?3 = 1 THEN 'invalid' ELSE status END,
                    encrypted_key = CASE WHEN ?3 = 1 THEN NULL ELSE encrypted_key END,
                    encryption_iv = CASE WHEN ?3 = 1 THEN NULL ELSE encryption_iv END,
                    failure_count = failure_count + 1,
                    last_error = ?2,
                    updated_at = ?4
                WHERE user_id = ?1
            `)
            .bind(donor.user_id, message, authenticationFailure ? 1 : 0, now)
            .run();
        const attempts = Number(job.attempts) + 1;
        await retryOrFailJob(env, job.id, attempts, now, message);
        return attempts >= MAX_JOB_ATTEMPTS ? 'failed' : 'retried';
    }
}


async function retryOrFailJob(env, jobId, attempts, now, message) {
    const terminal = attempts >= MAX_JOB_ATTEMPTS;
    await env.PERMISSIONS_DB
        .prepare(`
            UPDATE contribution_jobs
            SET status = ?2,
                available_at = ?3,
                completed_at = CASE WHEN ?2 = 'failed' THEN ?4 ELSE NULL END,
                error = ?5,
                updated_at = ?4
            WHERE id = ?1
        `)
        .bind(
            jobId,
            terminal ? 'failed' : 'queued',
            now + JOB_RETRY_MS,
            now,
            message
        )
        .run();
}


async function performAllowlistedJob(job, apiKey) {
    const payload = safeJsonParse(job.payload_json) || {};
    if (job.kind !== 'torn.user.basic') {
        throw new RequestValidationError(`Unsupported contribution job: ${job.kind}`);
    }
    const targetId = positiveInteger(payload.target_id);
    if (!targetId) throw new RequestValidationError('A valid target_id is required.');

    return performTornBasicRequest(targetId, apiKey);
}


async function performTornBasicRequest(targetId, apiKey) {
    const response = await fetch(
        `https://api.torn.com/v2/user/${encodeURIComponent(targetId)}/basic`,
        {
            method: 'GET',
            headers: {
                'Authorization': `ApiKey ${apiKey}`,
                'Accept': 'application/json',
                'User-Agent': 'SLINK-Contribution-Service'
            }
        }
    );
    const data = await response.json();

    if (!response.ok || data?.error) {
        const error = new Error('Torn rejected the donated API key or request.');
        if (response.status === 401 || response.status === 403 || data?.error?.code === 2) {
            error.code = 'TORN_KEY_INVALID';
        }
        throw error;
    }
    return data;
}


async function validatePublicOnlyTornKey(apiKey) {
    const response = await fetch('https://api.torn.com/v2/key/info', {
        method: 'GET',
        headers: {
            'Authorization': `ApiKey ${apiKey}`,
            'Accept': 'application/json',
            'User-Agent': 'SLINK-Contribution-Service'
        }
    });
    const data = await response.json();
    if (!response.ok || data?.error) {
        const error = new RequestValidationError('Torn could not validate this API key.');
        error.status = 401;
        throw error;
    }

    const userId = Number(data?.info?.user?.id);
    const accessType = String(data?.info?.access?.type || '').trim();
    const accessLevel = Number(data?.info?.access?.level);
    const publicOnly = accessType.toLowerCase() === 'public only' || accessLevel === 1;

    if (!Number.isInteger(userId) || userId <= 0) {
        throw new RequestValidationError('Torn did not return a valid user identity.');
    }
    if (!publicOnly) {
        throw new RequestValidationError(
            'Only Torn API keys with Public Only access may be donated.'
        );
    }
    return { userId, accessType: accessType || 'Public Only' };
}


async function authenticatedDonation(request, env) {
    const token = bearerToken(request);
    if (!token) return null;
    const tokenHash = await sha256Hex(token);
    return env.PERMISSIONS_DB
        .prepare(`
            SELECT
                user_id, access_type, status, terms_version,
                terms_accepted_at, created_at, updated_at,
                last_validated_at, last_used_at, failure_count, last_error
            FROM donated_api_keys
            WHERE management_token_sha256 = ?1
        `)
        .bind(tokenHash)
        .first();
}


function publicDonation(row) {
    return {
        user_id: Number(row.user_id),
        access_type: row.access_type,
        status: row.status,
        active: row.status === 'active',
        terms_version: row.terms_version,
        terms_accepted_at: Number(row.terms_accepted_at) || 0,
        created_at: Number(row.created_at) || 0,
        updated_at: Number(row.updated_at) || 0,
        last_validated_at: Number(row.last_validated_at) || 0,
        last_used_at: Number(row.last_used_at) || 0,
        failure_count: Number(row.failure_count) || 0,
        last_error: row.last_error || ''
    };
}


function validateJob(body) {
    const kind = String(body?.kind || '').trim();
    if (kind !== 'torn.user.basic') {
        throw new RequestValidationError('Unsupported contribution job kind.');
    }
    const targetId = positiveInteger(body?.payload?.target_id);
    if (!targetId) throw new RequestValidationError('A valid target_id is required.');
    const requestedBy = String(body?.requested_by || '').trim().slice(0, 100);
    if (!requestedBy) throw new RequestValidationError('requested_by is required.');
    return { kind, payload: { target_id: targetId }, requestedBy };
}


async function encryptApiKey(apiKey, userId, secret) {
    const key = await importEncryptionKey(secret, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv,
            additionalData: encryptionContext(userId)
        },
        key,
        textEncoder.encode(apiKey)
    );
    return {
        ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
        iv: base64UrlEncode(iv)
    };
}


async function decryptApiKey(ciphertext, iv, userId, secret) {
    const key = await importEncryptionKey(secret, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: base64UrlDecode(iv),
            additionalData: encryptionContext(userId)
        },
        key,
        base64UrlDecode(ciphertext)
    );
    return new TextDecoder().decode(plaintext);
}


function encryptionContext(userId) {
    return textEncoder.encode(`slink-donated-key:v${ENCRYPTION_VERSION}:${userId}`);
}


function importEncryptionKey(secret, usages) {
    const bytes = base64UrlDecode(String(secret || '').trim());
    if (bytes.byteLength !== 32) {
        throw new Error('API_KEY_ENCRYPTION_KEY must decode to exactly 32 bytes.');
    }
    return crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, usages);
}


function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return base64UrlEncode(bytes);
}


async function isServiceRequest(request, env) {
    const supplied = request.headers.get('X-SLINK-Service-Token');
    if (!supplied || !env.CONTRIBUTION_SERVICE_TOKEN) return false;
    const [left, right] = await Promise.all([
        crypto.subtle.digest('SHA-256', textEncoder.encode(supplied)),
        crypto.subtle.digest('SHA-256', textEncoder.encode(env.CONTRIBUTION_SERVICE_TOKEN))
    ]);
    return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}


function timingSafeEqual(left, right) {
    if (typeof crypto.subtle.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(left, right);
    }
    if (left.byteLength !== right.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
        difference |= left[index] ^ right[index];
    }
    return difference === 0;
}


async function sha256Hex(value) {
    const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
    return [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('');
}


function bearerToken(request) {
    const authorization = request.headers.get('Authorization') || '';
    return authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
}


async function readJsonBody(request) {
    const length = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
        throw new RequestValidationError('Request body is too large.');
    }
    const text = await request.text();
    if (textEncoder.encode(text).byteLength > MAX_JSON_BODY_BYTES) {
        throw new RequestValidationError('Request body is too large.');
    }
    try {
        return JSON.parse(text || '{}');
    } catch {
        throw new RequestValidationError('Request body must be valid JSON.');
    }
}


function requireDatabase(env) {
    if (!env.PERMISSIONS_DB) throw new Error('Permission storage is not configured.');
}


function requireDonationConfiguration(env) {
    requireDatabase(env);
    if (!env.API_KEY_ENCRYPTION_KEY) {
        throw new Error('API key encryption is not configured.');
    }
}


function positiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}


function safeJsonParse(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch { return null; }
}


function base64UrlEncode(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}


function base64UrlDecode(value) {
    const normalized = String(value || '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        '='
    );
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}


function managementAuthenticationRequired() {
    return jsonResponse({
        ok: false,
        error: 'A valid donation management token is required.'
    }, 401);
}


function serviceAuthenticationRequired() {
    return jsonResponse({ ok: false, error: 'Unauthorized service request.' }, 401);
}


function requestErrorResponse(error) {
    const status = Number(error?.status) ||
        (error instanceof RequestValidationError ? 400 : 500);
    if (status >= 500) {
        console.error(JSON.stringify({
            event: 'slink_contribution_error',
            error: errorMessage(error)
        }));
    }
    return jsonResponse({ ok: false, error: errorMessage(error) }, status);
}


function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
            'Content-Type, Authorization, X-SLINK-Service-Token',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Expose-Headers': 'X-SLINK-Contribution-Version',
        'X-SLINK-Contribution-Version': WORKER_VERSION
    };
}


function jsonResponse(data, status = 200) {
    return Response.json(data, { status, headers: corsHeaders() });
}


function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}


class RequestValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RequestValidationError';
    }
}


export const testing = {
    decryptApiKey,
    encryptApiKey,
    runScheduledJobs,
    sha256Hex,
    validatePublicOnlyTornKey
};
