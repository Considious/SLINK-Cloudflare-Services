/**
 * SLINK Leveling API Worker
 *
 * Release: 0.15.3-consent-url-relocation
 *
 * Update WORKER_VERSION for every Worker code change that may be deployed.
 * It is returned by the root and health routes and included in every response
 * as X-Slinky-Worker-Version, making the active source easy to identify.
 */

const WORKER_VERSION = '0.15.3-consent-url-relocation';

const MASTER_CSV_URL =
    'https://raw.githubusercontent.com/Considious/Torn-Scripts/main/' +
    'Slinkies-Leveling-Targets/Master-Leveling-Targets.csv';
const FFSCOUTER_TARGETS_URL = 'https://ffscouter.com/api/v1/get-targets';

const TERMS_VERSION = '2026-08-24';
const TERMS_EFFECTIVE_AT = '2026-08-24';
const TERMS_URL =
    'https://github.com/Considious/SLINK-Cloudflare-Services/blob/main/' +
    'terms/2026-08-23/' +
    'SLINK_API_Data_Terms_of_Service.md';
const TERMS_DOCUMENT_SHA256 =
    '72a933d69ec99cabeb92b426208e9d0c47e90acaf960818e0b4da38f3f2f5b0a';
const LEVELING_SERVICE_ID = 'slink-leveling-service';
const CONTRIBUTION_LEVELING_SERVICE_ID = 'slink.level';
const LEVELING_DISCLOSURE_VERSION = '2026-08-23';
const LEVELING_DISCLOSURE_SHA256 =
    'e1d595a7c8c9e5a8f105bf52d7157c4d40b91314293725391422b14de97fd91d';
const LEVELING_TERMS_SUMMARY =
    'Your Torn API key is sent to SLINK only to verify your Torn identity and ' +
    'current faction and is otherwise used locally for assigned Torn requests; ' +
    'ordinary user keys are not stored remotely. Leveling access requires ' +
    'slink.level, granted automatically to current Slinky\'s members or through ' +
    'an active direct grant. SLINK persistently shares target status, hospital ' +
    'timing, activity matches, competition measurements, scheduling and ' +
    'coordination data with authorized slink.level users. Exact user battle ' +
    'stats and Fair Fight values stay in this browser. The permissions service ' +
    'retains your Torn user ID and effective grants; your accepted terms ' +
    'version, document fingerprint and acceptance time are retained in SLINK\'s ' +
    'separate consent ledger.';

const IMPORT_BATCH_SIZE = 50;
const FFSCOUTER_DISCOVERY_LIMIT = 50;
const DEFAULT_FFSCOUTER_LEVELING_MIN_LEVEL = 30;
const DEFAULT_FFSCOUTER_LEVELING_MAX_LEVEL = 100;
const DEFAULT_FFSCOUTER_LEVELING_MAX_STATS = 2_000;
const FFSCOUTER_SOURCE_LABEL = 'FFScouter discovery';
const DEFAULT_TARGET_LIMIT = 50;
const MAX_TARGET_LIMIT = 200;
const DEFAULT_RECOMMENDATION_LIMIT = 40;
const MAX_RECOMMENDATION_LIMIT = 40;
const MAX_TARGET_STATS_FILTER = Number.MAX_SAFE_INTEGER;
// This is payload-abuse protection, not a Torn polling allowance. The client
// supplies its live request capacity from Considious Torn Core Lib.
const MAX_MEMBER_BATCH_ROWS = 200;
const MAX_CHECK_PLAN_ROWS = 300;
const MAX_CHECK_SNAPSHOT_ROWS = 2_000;
const MAX_VIRTUAL_CHECK_ROWS = 10;
const MAX_ACTIVITY_TARGETS_PER_REQUEST = 1_000;
const MAX_JSON_BODY_BYTES = 256 * 1024;
// D1 allows 100 bound parameters and 50 queries per Free-plan invocation.
// These sizes keep a worst-case 200-row observation upload within both limits.
const OBSERVATION_READ_CHUNK_SIZE = 50;
const STATUS_WRITE_CHUNK_SIZE = 10;
const HOSPITAL_WRITE_CHUNK_SIZE = 25;
const LEASE_DELETE_CHUNK_SIZE = 50;

const LEVELING_SCOPE = 'slink.level';
const CONTRIBUTOR_SCOPE = 'slink.contribute';
const ADMIN_SCOPE = 'admin.*';
const SOLE_ADMIN_USER_ID = 3853023;
const SESSION_LIFETIME_SECONDS = 12 * 60 * 60;
const USER_DEMAND_LIFETIME_MS = 20 * 60 * 1000;
const NO_DEMAND_POLL_SECONDS = 20 * 60;
const DEFAULT_CLIENT_POLL_SECONDS = 300;
const MIN_CLIENT_POLL_SECONDS = 60;
const MAX_CLIENT_POLL_SECONDS = 300;
// The normal recommendation/check exchange is the heartbeat. Another session
// may take over after the active collector misses two configured exchanges.
const COLLECTOR_MISSED_INTERVALS = 2;
const MIN_CHECK_CLAIM_LIFETIME_MS = 3 * 60 * 1000;
const CHECK_CLAIM_GRACE_MS = 2 * 60 * 1000;
// Recommendation assignments remain stable for the member session. Rebuilding
// 40 indexed lease rows every ten minutes created needless D1 write churn.
const TARGET_LEASE_LIFETIME_MS = SESSION_LIFETIME_SECONDS * 1000;
const ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HOSPITAL_24H_MS = 24 * 60 * 60 * 1000;
const HOSPITAL_7D_MS = 7 * 24 * 60 * 60 * 1000;
const NON_OKAY_RECHECK_MS = 10 * 60 * 1000;
const HOSPITAL_RECHECK_GRACE_MS = 60 * 1000;
const RAPID_REHOSP_WINDOW_MS = 60 * 60 * 1000;
const ROUTINE_CHECK_BUCKET_MS = 5 * 60 * 1000;
// Local retry queues may finish a batch up to 30 minutes after it was issued.
const CHECK_BATCH_MAX_AGE_BUCKETS = 6;
const DAILY_FRESHNESS_START_UTC_MINUTE = (23 * 60) + 45;
const DAILY_FRESHNESS_BUCKETS = 3;
const OKAY_RECHECK_PRIME_MS = 15 * 60 * 1000;
const OKAY_RECHECK_WARM_MS = 30 * 60 * 1000;
const OKAY_RECHECK_CROWDED_MS = 60 * 60 * 1000;
const OKAY_RECHECK_FARMED_MS = 6 * 60 * 60 * 1000;
const DEFERRED_CHECK_AT_MS = 8_640_000_000_000_000;

const textEncoder = new TextEncoder();


// ================================================================
// Worker
// ================================================================

const worker = {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);

        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders()
            });
        }

        if (url.pathname === '/') {
            return jsonResponse({
                ok: true,
                service: 'SLINK Leveling API',
                version: WORKER_VERSION,
                message: 'Worker is running.'
            });
        }

        if (
            url.pathname === '/api/health' &&
            request.method === 'GET'
        ) {
            return handleHealth(env);
        }

        if (
            url.pathname === '/api/terms' &&
            request.method === 'GET'
        ) {
            return handleTerms();
        }

        if (
            url.pathname === '/api/auth' &&
            request.method === 'POST'
        ) {
            return handleAuthentication(request, env);
        }

        if (
            url.pathname === '/api/session' &&
            request.method === 'GET'
        ) {
            return handleSessionCheck(request, env);
        }

        if (
            url.pathname === '/api/targets' &&
            request.method === 'GET'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleListTargets(url, env);
        }

        if (
            url.pathname === '/api/recommendations' &&
            request.method === 'GET'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleRecommendations(url, env, authorization.session);
        }

        if (
            url.pathname === '/api/user/activity' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;
            return handleUserDemandActivity(
                request,
                env,
                authorization.session,
                ctx
            );
        }

        if (
            url.pathname === '/api/collector/heartbeat' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleCollectorHeartbeat(env, authorization.session);
        }

        if (
            url.pathname === '/api/checks/claim' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleDemandAwareClaimChecks(
                request,
                env,
                authorization.session
            );
        }

        if (
            url.pathname === '/api/observations' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleObservations(request, env, authorization.session);
        }

        if (
            url.pathname === '/api/contributor/checks/claim' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeContributorRequest(request, env);
            if (authorization.response) return authorization.response;
            return handleDemandAwareClaimChecks(
                request,
                env,
                authorization.session
            );
        }

        if (
            url.pathname === '/api/contributor/observations' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeContributorRequest(request, env);
            if (authorization.response) return authorization.response;
            return handleObservations(request, env, authorization.session);
        }

        if (
            url.pathname === '/api/activity' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleActivityReport(request, env, authorization.session);
        }

        if (
            url.pathname === '/api/fair-fight' &&
            request.method === 'POST'
        ) {
            const authorization = await authorizeRequest(
                request,
                env,
                LEVELING_SCOPE
            );
            if (authorization.response) return authorization.response;

            return handleDeprecatedFairFightReport();
        }

        if (
            url.pathname === '/api/admin/bootstrap-targets' &&
            request.method === 'POST'
        ) {
            if (!await isAdminRequest(request, env)) {
                return unauthorizedAdminResponse();
            }

            return handleBootstrapTargets(env);
        }

        if (
            url.pathname === '/api/admin/discover-targets' &&
            request.method === 'POST'
        ) {
            if (!await isAdminRequest(request, env)) {
                return unauthorizedAdminResponse();
            }

            return handleDiscoverLevelingTargets(env);
        }

        if (
            url.pathname === '/api/admin/targets' &&
            request.method === 'GET'
        ) {
            if (!await isAdminRequest(request, env)) {
                return unauthorizedAdminResponse();
            }

            return handleListTargets(url, env);
        }

        return jsonResponse(
            {
                ok: false,
                error: 'Not found'
            },
            404
        );
    },

    async scheduled(controller, env) {
        try {
            const result = await discoverLevelingTargets(env);
            console.log(JSON.stringify({
                event: 'ffscouter_leveling_discovery',
                version: WORKER_VERSION,
                scheduled_at: controller.scheduledTime,
                ...result
            }));
        } catch (error) {
            controller.noRetry?.();
            console.error(JSON.stringify({
                event: 'ffscouter_leveling_discovery_failed',
                version: WORKER_VERSION,
                scheduled_at: controller.scheduledTime,
                error: errorMessage(error)
            }));
        }
    }
};

export default worker;


// ================================================================
// Health
// ================================================================

async function handleHealth(env) {
    try {
        const targetCount = await env.DB
            .prepare('SELECT COUNT(*) AS count FROM targets')
            .first();

        const statusCount = await env.DB
            .prepare('SELECT COUNT(*) AS count FROM target_status')
            .first();

        const hospitalCount = await env.DB
            .prepare('SELECT COUNT(*) AS count FROM hospital_events')
            .first();

        const queueCount = await env.DB
            .prepare('SELECT COUNT(*) AS count FROM scheduler_queue')
            .first();

        const ffscouterTargetCount = await env.DB
            .prepare(`
                SELECT COUNT(*) AS count
                FROM targets
                WHERE INSTR(COALESCE(sources, ''), ?1) > 0
            `)
            .bind(FFSCOUTER_SOURCE_LABEL)
            .first();

        if (!env.CONSENT_DB) {
            return jsonResponse(
                {
                    ok: false,
                    version: WORKER_VERSION,
                    database: 'connected',
                    consent_database: 'not_configured',
                    terms: {
                        version: TERMS_VERSION,
                        effective_at: TERMS_EFFECTIVE_AT
                    },
                    error: 'The CONSENT_DB binding is required.'
                },
                500
            );
        }

        try {
            await env.CONSENT_DB
                .prepare('SELECT id FROM terms_acceptances LIMIT 1')
                .first();
        } catch (error) {
            return jsonResponse(
                {
                    ok: false,
                    version: WORKER_VERSION,
                    database: 'connected',
                    consent_database: 'error',
                    terms: {
                        version: TERMS_VERSION,
                        effective_at: TERMS_EFFECTIVE_AT
                    },
                    error: errorMessage(error)
                },
                500
            );
        }

        if (!env.PERMISSIONS_DB) {
            return jsonResponse(
                {
                    ok: false,
                    version: WORKER_VERSION,
                    database: 'connected',
                    consent_database: 'connected',
                    permissions_database: 'not_configured',
                    terms: {
                        version: TERMS_VERSION,
                        effective_at: TERMS_EFFECTIVE_AT
                    },
                    error: 'The PERMISSIONS_DB binding is required.'
                },
                500
            );
        }

        let directGrantCount;
        let factionGrantCount;

        try {
            [directGrantCount, factionGrantCount] = await Promise.all([
                env.PERMISSIONS_DB
                    .prepare('SELECT COUNT(*) AS count FROM user_scope_grants')
                    .first(),
                env.PERMISSIONS_DB
                    .prepare('SELECT COUNT(*) AS count FROM faction_scope_grants')
                    .first()
            ]);
        } catch (error) {
            return jsonResponse(
                {
                    ok: false,
                    version: WORKER_VERSION,
                    database: 'connected',
                    consent_database: 'connected',
                    permissions_database: 'error',
                    terms: {
                        version: TERMS_VERSION,
                        effective_at: TERMS_EFFECTIVE_AT
                    },
                    error: errorMessage(error)
                },
                500
            );
        }

        return jsonResponse({
            ok: true,
            version: WORKER_VERSION,
            database: 'connected',
            consent_database: 'connected',
            permissions_database: 'connected',
            ffscouter_collector: env.FFSCOUTER_API_KEY
                ? 'configured'
                : 'not_configured',
            ffscouter_filters: levelingDiscoveryFilters(env),
            terms: {
                version: TERMS_VERSION,
                effective_at: TERMS_EFFECTIVE_AT
            },
            tables: {
                targets: targetCount?.count ?? 0,
                target_status: statusCount?.count ?? 0,
                hospital_events: hospitalCount?.count ?? 0,
                scheduler_queue: queueCount?.count ?? 0,
                user_scope_grants: directGrantCount?.count ?? 0,
                faction_scope_grants: factionGrantCount?.count ?? 0,
                ffscouter_targets: ffscouterTargetCount?.count ?? 0
            }
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                database: 'error',
                error: errorMessage(error)
            },
            500
        );
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
        service_id: LEVELING_SERVICE_ID,
        disclosure_version: LEVELING_DISCLOSURE_VERSION,
        disclosure_sha256: LEVELING_DISCLOSURE_SHA256,
        leveling_service_summary: LEVELING_TERMS_SUMMARY
    });
}


// ================================================================
// Torn identity, product authorization, and sessions
// ================================================================

async function handleAuthentication(request, env) {
    try {
        if (!env.SESSION_SECRET) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Session authentication is not configured.'
                },
                500
            );
        }

        if (!env.CONSENT_DB) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Terms acceptance storage is not configured.'
                },
                500
            );
        }

        let body;

        try {
            body = await readJsonBody(request);
        } catch (error) {
            return jsonResponse(
                {
                    ok: false,
                    error: errorMessage(error)
                },
                400
            );
        }

        if (
            body?.terms_accepted !== true ||
            body?.terms_version !== TERMS_VERSION ||
            body?.terms_sha256 !== TERMS_DOCUMENT_SHA256 ||
            body?.disclosure_version !== LEVELING_DISCLOSURE_VERSION ||
            body?.disclosure_sha256 !== LEVELING_DISCLOSURE_SHA256
        ) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'You must accept the current SLINK API & Data Terms before authentication.',
                    terms_required: true,
                    terms_version: TERMS_VERSION,
                    disclosure_version: LEVELING_DISCLOSURE_VERSION,
                    terms_url: TERMS_URL
                },
                428
            );
        }
        const contributorOnly = body?.contributor_only === true;

        /*
         * The Torn API key is used only by this request to verify identity.
         * It is never written to D1, placed in a session token, or logged.
         */
        const apiKey = String(body?.api_key || '').trim();

        if (!apiKey) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Torn API key is required.'
                },
                400
            );
        }

        const tornResponse = await fetch(
            'https://api.torn.com/v2/key/info',
            {
                method: 'GET',
                headers: {
                    'Authorization': `ApiKey ${apiKey}`,
                    'Accept': 'application/json',
                    'User-Agent': 'Slinky-Leveling-Service'
                }
            }
        );

        let tornData;

        try {
            tornData = await tornResponse.json();
        } catch {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Torn returned an unreadable authentication response.'
                },
                502
            );
        }

        if (!tornResponse.ok || tornData?.error) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Torn API key could not be validated.'
                },
                401
            );
        }

        const userId = Number(tornData?.info?.user?.id);
        const factionId = Number(tornData?.info?.user?.faction_id || 0);

        if (!Number.isInteger(userId) || userId <= 0) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Torn did not return a valid user ID.'
                },
                401
            );
        }

        if (!Number.isInteger(factionId) || factionId < 0) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Torn did not return a valid faction identity.'
                },
                401
            );
        }

        const acceptedAt = Date.now();
        if (!env.PERMISSIONS_DB) {
            return jsonResponse({
                ok: false,
                error: 'Permission storage is not configured.'
            }, 500);
        }
        const productPermissions = await loadUserPermissions(
            env,
            userId,
            factionId,
            acceptedAt
        );
        if (!hasSessionScope(productPermissions, LEVELING_SCOPE)) {
            return permissionDeniedResponse(LEVELING_SCOPE);
        }
        const permissions = contributorOnly
            ? {
                roles: ['contributor'],
                scopes: [CONTRIBUTOR_SCOPE],
                expiresAt: productPermissions.expiresAt
            }
            : productPermissions;

        const issuedAt = Math.floor(acceptedAt / 1000);
        const permissionExpiresAt = permissions.expiresAt === null
            ? Number.POSITIVE_INFINITY
            : Math.floor(permissions.expiresAt / 1000);
        const expiresAt = Math.min(
            issuedAt + SESSION_LIFETIME_SECONDS,
            permissionExpiresAt
        );

        if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
            return permissionDeniedResponse(LEVELING_SCOPE);
        }
        const sessionId = crypto.randomUUID();

        try {
            await recordTermsAcceptance(env, {
                userId,
                factionId,
                acceptedAt,
                clientName: String(body?.client_name || 'SLINK Leveling Service')
                    .trim()
                    .slice(0, 100) || 'SLINK Leveling Service',
                clientVersion: String(body?.client_version || 'unknown')
                    .trim()
                    .slice(0, 40) || 'unknown'
            });
        } catch (error) {
            return jsonResponse(
                {
                    ok: false,
                    error: 'Terms acceptance could not be recorded. Access was not granted.',
                    detail: errorMessage(error)
                },
                503
            );
        }

        const sessionPayload = {
            user_id: userId,
            faction_id: factionId,
            session_id: sessionId,
            terms_version: TERMS_VERSION,
            disclosure_version: LEVELING_DISCLOSURE_VERSION,
            roles: permissions.roles,
            scopes: permissions.scopes,
            session_kind: contributorOnly ? 'contributor' : 'product',
            iat: issuedAt,
            exp: expiresAt
        };

        const sessionToken = await createSessionToken(
            sessionPayload,
            env.SESSION_SECRET
        );

        return jsonResponse({
            ok: true,
            authenticated: true,
            user_id: userId,
            faction_id: factionId,
            terms_version: TERMS_VERSION,
            disclosure_version: LEVELING_DISCLOSURE_VERSION,
            roles: permissions.roles,
            scopes: permissions.scopes,
            session_kind: contributorOnly ? 'contributor' : 'product',
            terms_accepted_at: new Date(acceptedAt).toISOString(),
            expires_at: new Date(expiresAt * 1000).toISOString(),
            expires_in: expiresAt - issuedAt,
            session_token: sessionToken
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                error: 'Authentication failed.',
                detail: errorMessage(error)
            },
            500
        );
    }
}


async function recordTermsAcceptance(env, acceptance) {
    await env.CONSENT_DB
        .prepare(`
            INSERT OR IGNORE INTO terms_acceptances (
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
            )
            VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                'explicit_checkbox'
            )
        `)
        .bind(
            acceptance.userId,
            acceptance.factionId,
            TERMS_VERSION,
            TERMS_DOCUMENT_SHA256,
            TERMS_URL,
            LEVELING_SERVICE_ID,
            LEVELING_DISCLOSURE_VERSION,
            LEVELING_DISCLOSURE_SHA256,
            acceptance.acceptedAt,
            acceptance.clientName,
            acceptance.clientVersion
        )
        .run();

    const stored = await env.CONSENT_DB
        .prepare(`
            SELECT
                document_sha256,
                disclosure_sha256
            FROM terms_acceptances
            WHERE user_id = ?1
              AND terms_version = ?2
              AND service_id = ?3
              AND disclosure_version = ?4
        `)
        .bind(
            acceptance.userId,
            TERMS_VERSION,
            LEVELING_SERVICE_ID,
            LEVELING_DISCLOSURE_VERSION
        )
        .first();

    if (
        stored?.document_sha256 !== TERMS_DOCUMENT_SHA256 ||
        stored?.disclosure_sha256 !== LEVELING_DISCLOSURE_SHA256
    ) {
        throw new Error(
            'The stored acceptance does not match the current terms document.'
        );
    }
}


async function handleSessionCheck(request, env) {
    const session = await getAuthenticatedSession(request, env);

    if (!session) {
        return memberAuthenticationRequired();
    }

    return jsonResponse({
        ok: true,
        authenticated: true,
        user_id: session.user_id,
        faction_id: session.faction_id,
        session_id: session.session_id,
        terms_version: session.terms_version,
        disclosure_version: session.disclosure_version,
        roles: session.roles,
        scopes: session.scopes,
        session_kind: session.session_kind || 'product',
        issued_at: new Date(session.iat * 1000).toISOString(),
        expires_at: new Date(session.exp * 1000).toISOString()
    });
}


async function authorizeRequest(request, env, requiredScope) {
    const session = await getAuthenticatedSession(request, env);

    if (!session) {
        return { session: null, response: memberAuthenticationRequired() };
    }

    if (!hasSessionScope(session, requiredScope)) {
        return {
            session: null,
            response: permissionDeniedResponse(requiredScope)
        };
    }

    return { session, response: null };
}


async function authorizeContributorRequest(request, env) {
    const session = await getAuthenticatedSession(request, env);

    if (!session) {
        return { session: null, response: memberAuthenticationRequired() };
    }

    if (
        !hasSessionScope(session, CONTRIBUTOR_SCOPE) &&
        !hasSessionScope(session, LEVELING_SCOPE)
    ) {
        return {
            session: null,
            response: permissionDeniedResponse(CONTRIBUTOR_SCOPE)
        };
    }

    return { session, response: null };
}


async function loadUserPermissions(env, userId, factionId, now = Date.now()) {
    const result = await env.PERMISSIONS_DB
        .prepare(`
            SELECT scope, expires_at
            FROM user_scope_grants
            WHERE user_id = ?1
              AND status = 'active'
              AND starts_at <= ?3
              AND (expires_at IS NULL OR expires_at > ?3)

            UNION ALL

            SELECT scope, expires_at
            FROM faction_scope_grants
            WHERE faction_id = ?2
              AND status = 'active'
              AND starts_at <= ?3
              AND (expires_at IS NULL OR expires_at > ?3)
            ORDER BY scope ASC
        `)
        .bind(userId, factionId, now)
        .all();
    const scopeExpirations = new Map();

    for (const row of result.results || []) {
        const scope = String(row?.scope || '').trim();
        if (!scope) continue;

        // admin.* is deliberately non-delegable even if an accidental row is
        // inserted into D1 for another Torn user.
        if (
            userId !== SOLE_ADMIN_USER_ID &&
            sessionScopeMatches(scope, ADMIN_SCOPE)
        ) continue;

        const expiration = row.expires_at === null || row.expires_at === undefined
            ? null
            : Number(row.expires_at);
        const current = scopeExpirations.get(scope);

        if (!scopeExpirations.has(scope)) {
            scopeExpirations.set(scope, expiration);
        } else if (current === null || expiration === null) {
            scopeExpirations.set(scope, null);
        } else {
            scopeExpirations.set(scope, Math.max(current, expiration));
        }
    }

    const scopes = [...scopeExpirations.keys()].sort();
    const levelingGrantExpirations = [...scopeExpirations.entries()]
        .filter(([scope]) => sessionScopeMatches(scope, LEVELING_SCOPE))
        .map(([, expiration]) => expiration);
    const levelingExpiresAt = levelingGrantExpirations.some(value => value === null)
        ? null
        : Math.max(...levelingGrantExpirations.filter(Number.isFinite));
    return {
        roles: scopes.includes(ADMIN_SCOPE) ? ['admin'] : ['member'],
        scopes,
        expiresAt: Number.isFinite(levelingExpiresAt)
            ? levelingExpiresAt
            : null
    };
}


function sessionScopeMatches(grantedScope, requiredScope) {
    if (grantedScope === '*' || grantedScope === requiredScope) return true;
    if (!grantedScope.endsWith('.*')) return false;
    return requiredScope.startsWith(grantedScope.slice(0, -1));
}


function hasSessionScope(session, requiredScope) {
    const required = String(requiredScope || '').trim();
    if (!required) return true;
    if (
        required === ADMIN_SCOPE &&
        session?.user_id !== SOLE_ADMIN_USER_ID
    ) return false;
    return (Array.isArray(session?.scopes) ? session.scopes : [])
        .some(scope => sessionScopeMatches(String(scope), required));
}


async function getAuthenticatedSession(request, env) {
    if (!env.SESSION_SECRET) {
        return null;
    }

    const authorization = request.headers.get('Authorization') || '';

    if (!authorization.startsWith('Bearer ')) {
        return null;
    }

    const token = authorization.slice(7).trim();

    if (!token) {
        return null;
    }

    return verifySessionToken(token, env.SESSION_SECRET);
}


async function createSessionToken(payload, secret) {
    const encodedPayload = base64UrlEncode(
        textEncoder.encode(JSON.stringify(payload))
    );

    const key = await importSessionKey(secret, ['sign']);
    const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        textEncoder.encode(encodedPayload)
    );

    return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}


async function verifySessionToken(token, secret) {
    const parts = token.split('.');

    if (parts.length !== 2) {
        return null;
    }

    const [encodedPayload, encodedSignature] = parts;

    try {
        const key = await importSessionKey(secret, ['verify']);
        const signature = base64UrlDecode(encodedSignature);
        const validSignature = await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            textEncoder.encode(encodedPayload)
        );

        if (!validSignature) {
            return null;
        }

        const payload = JSON.parse(
            new TextDecoder().decode(base64UrlDecode(encodedPayload))
        );

        const now = Math.floor(Date.now() / 1000);

        if (
            !Number.isInteger(payload.user_id) ||
            payload.user_id <= 0 ||
            !Number.isInteger(payload.faction_id) ||
            payload.faction_id < 0 ||
            typeof payload.session_id !== 'string' ||
            !payload.session_id ||
            payload.terms_version !== TERMS_VERSION ||
            payload.disclosure_version !== LEVELING_DISCLOSURE_VERSION ||
            !Array.isArray(payload.roles) ||
            !payload.roles.every(role => typeof role === 'string') ||
            !Array.isArray(payload.scopes) ||
            !payload.scopes.every(scope => typeof scope === 'string') ||
            !Number.isInteger(payload.iat) ||
            !Number.isInteger(payload.exp) ||
            payload.exp <= now ||
            payload.iat > now ||
            payload.exp - payload.iat <= 0 ||
            payload.exp - payload.iat > SESSION_LIFETIME_SECONDS
        ) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}


function importSessionKey(secret, keyUsages) {
    return crypto.subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        {
            name: 'HMAC',
            hash: 'SHA-256'
        },
        false,
        keyUsages
    );
}


// ================================================================
// Master target bootstrap
// ================================================================

async function handleBootstrapTargets(env) {
    try {
        const response = await fetch(MASTER_CSV_URL, {
            headers: {
                'User-Agent': 'Slinky-Leveling-Worker'
            }
        });

        if (!response.ok) {
            throw new Error(
                `GitHub master list request failed: HTTP ${response.status}`
            );
        }

        // The repository-owned master list is intentionally small and bounded.
        const csvText = await response.text();
        const rows = parseCsv(csvText);

        const targets = rows
            .map(normalizeMasterTarget)
            .filter(target => {
                return (
                    Number.isInteger(target.id) &&
                    target.id > 0 &&
                    target.name
                );
            });

        if (!targets.length) {
            throw new Error('Master CSV produced zero valid targets.');
        }

        const uniqueTargets = deduplicateTargets(targets);

        const upsertStatement = env.DB.prepare(`
            INSERT INTO targets (
                id,
                name,
                level,
                total_stats,
                sources,
                updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)

            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                level = excluded.level,
                total_stats = excluded.total_stats,
                sources = excluded.sources,
                updated_at = CURRENT_TIMESTAMP
            WHERE targets.name IS NOT excluded.name
               OR targets.level IS NOT excluded.level
               OR targets.total_stats IS NOT excluded.total_stats
               OR targets.sources IS NOT excluded.sources
        `);

        let processed = 0;

        for (
            let index = 0;
            index < uniqueTargets.length;
            index += IMPORT_BATCH_SIZE
        ) {
            const chunk = uniqueTargets.slice(
                index,
                index + IMPORT_BATCH_SIZE
            );

            const statements = chunk.map(target => {
                return upsertStatement.bind(
                    target.id,
                    target.name,
                    target.level,
                    target.totalStats,
                    target.sources
                );
            });

            await env.DB.batch(statements);
            processed += chunk.length;
        }

        const databaseCount = await env.DB
            .prepare('SELECT COUNT(*) AS count FROM targets')
            .first();

        return jsonResponse({
            ok: true,
            source: MASTER_CSV_URL,
            csv_rows: rows.length,
            valid_targets: targets.length,
            unique_targets: uniqueTargets.length,
            processed,
            targets_in_database: databaseCount?.count ?? 0
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                error: errorMessage(error)
            },
            500
        );
    }
}


// ================================================================
// Target listing (admin and authenticated members)
// ================================================================

async function handleListTargets(url, env) {
    try {
        const limit = boundedIntegerQueryParameter(
            url.searchParams.get('limit'),
            DEFAULT_TARGET_LIMIT,
            1,
            MAX_TARGET_LIMIT
        );

        const offset = boundedIntegerQueryParameter(
            url.searchParams.get('offset'),
            0,
            0,
            Number.MAX_SAFE_INTEGER
        );

        const result = await env.DB
            .prepare(`
                SELECT
                    id,
                    name,
                    level,
                    total_stats,
                    sources,
                    created_at,
                    updated_at
                FROM targets
                ORDER BY
                    level DESC,
                    total_stats ASC,
                    id ASC
                LIMIT ?1
                OFFSET ?2
            `)
            .bind(limit, offset)
            .all();

        return jsonResponse({
            ok: true,
            count: result.results?.length ?? 0,
            limit,
            offset,
            targets: result.results ?? []
        });
    } catch (error) {
        return jsonResponse(
            {
                ok: false,
                error: errorMessage(error)
            },
            500
        );
    }
}


// ================================================================
// Thin-client recommendations and distributed checks
// ================================================================

async function handleCollectorHeartbeat(env, session) {
    try {
        const lease = await claimUserCollector(
            env,
            session,
            Date.now(),
            DEFAULT_CLIENT_POLL_SECONDS
        );
        return collectorLeaseResponse(lease);
    } catch (error) {
        return workerErrorResponse('Could not renew the collector lease.', error);
    }
}


// ================================================================
// Scheduled FFScouter leveling-catalog discovery
// ================================================================

async function handleDiscoverLevelingTargets(env) {
    try {
        return jsonResponse({
            ok: true,
            version: WORKER_VERSION,
            ...await discoverLevelingTargets(env)
        });
    } catch (error) {
        return workerErrorResponse(
            'Could not discover FFScouter leveling targets.',
            error
        );
    }
}


async function discoverLevelingTargets(env) {
    const apiKey = String(env.FFSCOUTER_API_KEY || '').trim();
    const filters = levelingDiscoveryFilters(env);

    if (!/^[A-Za-z0-9]{16}$/.test(apiKey)) {
        throw new Error(
            'The FFSCOUTER_API_KEY secret is missing or invalid.'
        );
    }

    // Supplying only key and limit keeps FFScouter's randomized inactive
    // discovery mode. Level and battle-stat filtering happens locally so rare
    // high-level, low-stat outliers are not hidden by a ranked top-50 query.
    const discoveryUrl = new URL(FFSCOUTER_TARGETS_URL);
    discoveryUrl.search = new URLSearchParams({
        key: apiKey,
        limit: String(FFSCOUTER_DISCOVERY_LIMIT)
    }).toString();

    const response = await fetch(discoveryUrl, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'SLINK-Leveling-Catalog'
        }
    });

    if (!response.ok) {
        throw new Error(
            `FFScouter discovery failed with HTTP ${response.status}.`
        );
    }

    let payload;

    try {
        payload = await response.json();
    } catch {
        throw new Error('FFScouter returned an unreadable discovery response.');
    }

    if (payload?.error) {
        const code = Number.isInteger(Number(payload.code))
            ? ` (code ${Number(payload.code)})`
            : '';
        throw new Error(`FFScouter rejected the discovery request${code}.`);
    }

    const returnedTargets = Array.isArray(payload?.targets)
        ? payload.targets
        : [];
    const candidates = deduplicateTargets(
        returnedTargets
            .map(normalizeFFScouterTarget)
            .filter(target => isLevelingDiscoveryCandidate(target, filters))
    );

    const upsertStatement = env.DB.prepare(`
        INSERT INTO targets (
            id,
            name,
            level,
            total_stats,
            sources,
            updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            level = excluded.level,
            total_stats = excluded.total_stats,
            sources = CASE
                WHEN INSTR(
                    COALESCE(targets.sources, ''),
                    '${FFSCOUTER_SOURCE_LABEL}'
                ) > 0 THEN targets.sources
                WHEN TRIM(COALESCE(targets.sources, '')) = ''
                    THEN '${FFSCOUTER_SOURCE_LABEL}'
                ELSE targets.sources || ' | ${FFSCOUTER_SOURCE_LABEL}'
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE targets.name IS NOT excluded.name
           OR targets.level IS NOT excluded.level
           OR targets.total_stats IS NOT excluded.total_stats
           OR INSTR(
                COALESCE(targets.sources, ''),
                '${FFSCOUTER_SOURCE_LABEL}'
           ) = 0
    `);

    let changed = 0;

    for (
        let index = 0;
        index < candidates.length;
        index += IMPORT_BATCH_SIZE
    ) {
        const chunk = candidates.slice(index, index + IMPORT_BATCH_SIZE);
        const results = await env.DB.batch(
            chunk.map(target => upsertStatement.bind(
                target.id,
                target.name,
                target.level,
                target.totalStats,
                FFSCOUTER_SOURCE_LABEL
            ))
        );

        changed += results.reduce((total, result) => {
            return total + Number(result.meta?.changes || 0);
        }, 0);
    }

    return {
        returned: returnedTargets.length,
        qualified: candidates.length,
        inserted_or_updated: changed,
        unchanged: candidates.length - changed,
        filters
    };
}


function normalizeFFScouterTarget(target) {
    const id = Number(target?.player_id);
    const level = Number(target?.level);
    const totalStats = Number(target?.bs_estimate);

    return {
        id: Number.isInteger(id) ? id : 0,
        name: String(target?.name || '').trim().slice(0, 100),
        level: Number.isInteger(level) ? level : 0,
        totalStats: Number.isFinite(totalStats)
            ? Math.round(totalStats)
            : null,
        sources: FFSCOUTER_SOURCE_LABEL
    };
}


function levelingDiscoveryFilters(env) {
    const minimumLevel = boundedInteger(
        env.FFSCOUTER_LEVELING_MIN_LEVEL,
        DEFAULT_FFSCOUTER_LEVELING_MIN_LEVEL,
        1,
        100
    );
    const maximumLevel = boundedInteger(
        env.FFSCOUTER_LEVELING_MAX_LEVEL,
        DEFAULT_FFSCOUTER_LEVELING_MAX_LEVEL,
        minimumLevel,
        100
    );
    const maximumBattleStats = boundedInteger(
        env.FFSCOUTER_LEVELING_MAX_STATS,
        DEFAULT_FFSCOUTER_LEVELING_MAX_STATS,
        1,
        Number.MAX_SAFE_INTEGER
    );

    return {
        minimum_level: minimumLevel,
        maximum_level: maximumLevel,
        maximum_battle_stats: maximumBattleStats,
        inactive_only: true
    };
}


function isLevelingDiscoveryCandidate(target, filters) {
    return (
        target.id > 0 &&
        target.name &&
        target.level >= filters.minimum_level &&
        target.level <= filters.maximum_level &&
        Number.isInteger(target.totalStats) &&
        target.totalStats > 0 &&
        target.totalStats <= filters.maximum_battle_stats
    );
}


async function claimUserCollector(env, session, now, pollSeconds) {
    const boundedPollSeconds = boundedInteger(
        pollSeconds,
        DEFAULT_CLIENT_POLL_SECONDS,
        MIN_CLIENT_POLL_SECONDS,
        MAX_CLIENT_POLL_SECONDS
    );
    const expiresAt = now + (
        boundedPollSeconds * COLLECTOR_MISSED_INTERVALS * 1000
    );

    await env.DB
        .prepare(`
            INSERT INTO client_user_collectors (
                user_id,
                session_id,
                claimed_at,
                last_seen_at,
                expires_at
            )
            VALUES (?1, ?2, ?3, ?3, ?4)
            ON CONFLICT(user_id) DO UPDATE SET
                session_id = excluded.session_id,
                claimed_at = CASE
                    WHEN client_user_collectors.session_id = excluded.session_id
                        THEN client_user_collectors.claimed_at
                    ELSE excluded.claimed_at
                END,
                last_seen_at = excluded.last_seen_at,
                expires_at = excluded.expires_at
            WHERE client_user_collectors.session_id = excluded.session_id
               OR client_user_collectors.expires_at <= excluded.last_seen_at
        `)
        .bind(
            session.user_id,
            session.session_id,
            now,
            expiresAt
        )
        .run();

    return readUserCollector(env, session, now);
}


async function readUserCollector(env, session, now) {
    const current = await env.DB
        .prepare(`
            SELECT session_id, claimed_at, last_seen_at, expires_at
            FROM client_user_collectors
            WHERE user_id = ?1
        `)
        .bind(session.user_id)
        .first();
    const expiresAt = Number(current?.expires_at) || 0;

    return {
        collector: (
            current?.session_id === session.session_id &&
            expiresAt > now
        ),
        claimedAt: Number(current?.claimed_at) || 0,
        lastSeenAt: Number(current?.last_seen_at) || 0,
        expiresAt,
        lifetimeMs: Math.max(
            0,
            expiresAt - (Number(current?.last_seen_at) || 0)
        )
    };
}


function collectorLeaseResponse(lease, extra = {}) {
    return jsonResponse({
        ok: true,
        collector: lease.collector,
        collector_lease_seconds: Math.floor(lease.lifetimeMs / 1000),
        collector_claimed_at: lease.collector ? lease.claimedAt : 0,
        collector_expires_at: lease.expiresAt,
        ...extra
    });
}


async function handleRecommendations(url, env, session) {
    try {
        const now = Date.now();
        const limit = boundedIntegerQueryParameter(
            url.searchParams.get('limit'),
            DEFAULT_RECOMMENDATION_LIMIT,
            1,
            MAX_RECOMMENDATION_LIMIT
        );
        const pollSeconds = boundedIntegerQueryParameter(
            url.searchParams.get('poll_seconds'),
            DEFAULT_CLIENT_POLL_SECONDS,
            MIN_CLIENT_POLL_SECONDS,
            MAX_CLIENT_POLL_SECONDS
        );
        const collectorLease = await claimUserCollector(
            env,
            session,
            now,
            pollSeconds
        );
        const minFairFight = boundedNumberQueryParameter(
            url.searchParams.get('min_ff'),
            1,
            1,
            3
        );
        const maxFairFight = boundedNumberQueryParameter(
            url.searchParams.get('max_ff'),
            3,
            minFairFight,
            3
        );
        const minTargetStats = boundedIntegerQueryParameter(
            url.searchParams.get('min_target_stats'),
            0,
            0,
            MAX_TARGET_STATS_FILTER
        );
        const maxTargetStats = boundedIntegerQueryParameter(
            url.searchParams.get('max_target_stats'),
            MAX_TARGET_STATS_FILTER,
            minTargetStats,
            MAX_TARGET_STATS_FILTER
        );

        await cleanExpiredCoordinationRows(env, now);
        await env.DB
            .prepare(`
                DELETE FROM client_target_leases
                WHERE user_id = ?1
                  AND (
                    expires_at <= ?2
                    OR EXISTS (
                        SELECT 1
                        FROM target_status AS invalid_status
                        WHERE invalid_status.target_id = client_target_leases.target_id
                          AND (
                            COALESCE(invalid_status.hiding_out, 0) = 1
                            OR COALESCE(invalid_status.permanent_federal, 0) = 1
                            OR LOWER(COALESCE(invalid_status.status, 'unknown'))
                                NOT IN ('unknown', 'okay')
                          )
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM target_activity AS active_target
                        WHERE active_target.target_id = client_target_leases.target_id
                          AND active_target.last_seen_at >= ?3
                    )
                    OR (
                        ?4 > 0
                        AND EXISTS (
                            SELECT 1
                            FROM targets AS weak_target
                            WHERE weak_target.id = client_target_leases.target_id
                              AND (
                                weak_target.total_stats IS NULL
                                OR weak_target.total_stats < ?4
                              )
                        )
                    )
                    OR (
                        ?5 < ${MAX_TARGET_STATS_FILTER}
                        AND EXISTS (
                            SELECT 1
                            FROM targets AS strong_target
                            WHERE strong_target.id = client_target_leases.target_id
                              AND (
                                strong_target.total_stats IS NULL
                                OR strong_target.total_stats > ?5
                              )
                        )
                    )
                  )
            `)
            .bind(
                session.user_id,
                now,
                Math.floor((now - ACTIVITY_WINDOW_MS) / 1000),
                minTargetStats,
                maxTargetStats
            )
            .run();

        const existing = await env.DB
            .prepare(`
                SELECT COUNT(*) AS count
                FROM client_target_leases
                WHERE user_id = ?1
                  AND expires_at > ?2
            `)
            .bind(session.user_id, now)
            .first();

        const needed = Math.max(0, limit - Number(existing?.count || 0));

        if (needed > 0) {
            const candidates = await env.DB
                .prepare(`
                    SELECT t.id
                    FROM targets AS t
                    LEFT JOIN target_status AS ts
                        ON ts.target_id = t.id
                    LEFT JOIN target_activity AS activity
                        ON activity.target_id = t.id
                    LEFT JOIN client_target_leases AS lease
                        ON lease.target_id = t.id
                       AND lease.expires_at > ?1
                    WHERE lease.target_id IS NULL
                      AND (
                        activity.last_seen_at IS NULL
                        OR activity.last_seen_at < ?2
                      )
                      AND COALESCE(ts.hiding_out, 0) = 0
                      AND COALESCE(ts.permanent_federal, 0) = 0
                      AND (
                        ts.target_id IS NULL
                        OR LOWER(COALESCE(ts.status, 'unknown'))
                            IN ('unknown', 'okay')
                      )
                      AND (
                        ?3 = 0
                        OR (
                            t.total_stats IS NOT NULL
                            AND t.total_stats >= ?3
                        )
                      )
                      AND (
                        ?4 = ${MAX_TARGET_STATS_FILTER}
                        OR (
                            t.total_stats IS NOT NULL
                            AND t.total_stats <= ?4
                        )
                      )
                    ORDER BY
                        COALESCE(ts.competition_score, 0) ASC,
                        CASE
                            WHEN ts.target_id IS NULL THEN 0
                            WHEN LOWER(COALESCE(ts.status, 'unknown')) = 'unknown' THEN 1
                            ELSE 2
                        END ASC,
                        t.level DESC,
                        COALESCE(t.total_stats, 9223372036854775807) ASC,
                        t.id ASC
                    LIMIT ?5
                `)
                .bind(
                    now,
                    Math.floor((now - ACTIVITY_WINDOW_MS) / 1000),
                    minTargetStats,
                    maxTargetStats,
                    needed
                )
                .all();

            const leaseUntil = now + TARGET_LEASE_LIFETIME_MS;
            const statements = (candidates.results || []).map(candidate => {
                return env.DB
                    .prepare(`
                        INSERT INTO client_target_leases (
                            target_id,
                            user_id,
                            session_id,
                            leased_at,
                            expires_at
                        )
                        VALUES (?1, ?2, ?3, ?4, ?5)
                        ON CONFLICT(target_id) DO NOTHING
                    `)
                    .bind(
                        Number(candidate.id),
                        session.user_id,
                        session.session_id,
                        now,
                        leaseUntil
                    );
            });

            if (statements.length) {
                await env.DB.batch(statements);
            }
        }

        const result = await env.DB
            .prepare(`
                SELECT
                    t.id,
                    t.name,
                    t.level,
                    t.total_stats,
                    t.sources,
                    COALESCE(ts.status, 'Unknown') AS status,
                    CAST(COALESCE(ts.status_until, '0') AS INTEGER) AS status_until,
                    CAST(COALESCE(ts.last_checked_at, '0') AS INTEGER) AS last_checked_at,
                    CAST(COALESCE(ts.next_check_at, '0') AS INTEGER) AS next_check_at,
                    COALESCE(ts.competition_score, 0) AS competition_score,
                    COALESCE(ts.competition_tier, 'Prime') AS competition_tier,
                    NULL AS fair_fight,
                    NULL AS bs_estimate,
                    NULL AS fair_fight_source,
                    0 AS fair_fight_checked_at,
                    (
                        SELECT COUNT(*)
                        FROM hospital_events AS recent_hospital
                        WHERE recent_hospital.target_id = t.id
                          AND CAST(recent_hospital.hospitalized_at AS INTEGER) >= ?3
                    ) AS hospitalizations_24h,
                    (
                        SELECT COUNT(*)
                        FROM hospital_events AS weekly_hospital
                        WHERE weekly_hospital.target_id = t.id
                          AND CAST(weekly_hospital.hospitalized_at AS INTEGER) >= ?4
                    ) AS hospitalizations_7d,
                    (
                        SELECT MAX(CAST(last_hospital.hospitalized_at AS INTEGER))
                        FROM hospital_events AS last_hospital
                        WHERE last_hospital.target_id = t.id
                    ) AS last_hospitalized_at,
                    lease.expires_at AS lease_expires_at
                FROM client_target_leases AS lease
                JOIN targets AS t
                    ON t.id = lease.target_id
                LEFT JOIN target_status AS ts
                    ON ts.target_id = t.id
                WHERE lease.user_id = ?1
                  AND lease.expires_at > ?2
                  AND (
                    ?5 = 0
                    OR (
                        t.total_stats IS NOT NULL
                        AND t.total_stats >= ?5
                    )
                  )
                  AND (
                    ?6 = ${MAX_TARGET_STATS_FILTER}
                    OR (
                        t.total_stats IS NOT NULL
                        AND t.total_stats <= ?6
                    )
                  )
                ORDER BY
                    COALESCE(ts.competition_score, 0) ASC,
                    t.level DESC,
                    t.id ASC
                LIMIT ?7
            `)
            .bind(
                session.user_id,
                now,
                now - HOSPITAL_24H_MS,
                now - HOSPITAL_7D_MS,
                minTargetStats,
                maxTargetStats,
                limit
            )
            .all();

        return collectorLeaseResponse(collectorLease, {
            version: WORKER_VERSION,
            count: result.results?.length ?? 0,
            limit,
            poll_seconds: pollSeconds,
            min_fair_fight: minFairFight,
            max_fair_fight: maxFairFight,
            min_target_stats: minTargetStats || null,
            max_target_stats: maxTargetStats === MAX_TARGET_STATS_FILTER
                ? null
                : maxTargetStats,
            lease_seconds: Math.floor(TARGET_LEASE_LIFETIME_MS / 1000),
            targets: (result.results || []).map(normalizeRecommendationRow)
        });
    } catch (error) {
        return workerErrorResponse('Could not build recommendations.', error);
    }
}


async function handleClaimChecks(request, env, session) {
    try {
        const body = await readJsonBody(request);
        const intervalCapacity = boundedInteger(
            body?.interval_capacity ?? body?.capacity,
            0,
            0,
            MAX_CHECK_PLAN_ROWS
        );
        if (
            intervalCapacity === 0 &&
            !hasSessionScope(session, ADMIN_SCOPE)
        ) {
            return permissionDeniedResponse(ADMIN_SCOPE);
        }
        const pollSeconds = boundedInteger(
            body?.poll_seconds,
            DEFAULT_CLIENT_POLL_SECONDS,
            MIN_CLIENT_POLL_SECONDS,
            MAX_CLIENT_POLL_SECONDS
        );
        const now = Date.now();
        const scheduleBucket = routineCheckBucket(now);
        const batchId = checkBatchId(session, scheduleBucket);
        const claimLifetimeMs = Math.max(
            MIN_CHECK_CLAIM_LIFETIME_MS,
            (pollSeconds * 1000) + CHECK_CLAIM_GRACE_MS
        );

        // The recommendation exchange immediately precedes this request and
        // already renews the collector lease. Reading it here avoids a second
        // indexed collector write during every client cycle.
        let collectorLease = await readUserCollector(env, session, now);

        if (!collectorLease.expiresAt || collectorLease.expiresAt <= now) {
            collectorLease = await claimUserCollector(
                env,
                session,
                now,
                pollSeconds
            );
        }

        if (intervalCapacity === 0) {
            return collectorLeaseResponse(collectorLease, {
                count: 0,
                capacity: 0,
                interval_capacity: 0,
                due_count: 0,
                active_collectors: 0,
                fair_share: 0,
                claim_seconds: Math.floor(claimLifetimeMs / 1000),
                admin_zero_contribution: true,
                checks: []
            });
        }

        if (!collectorLease.collector) {
            return collectorLeaseResponse(collectorLease, {
                count: 0,
                capacity: 0,
                interval_capacity: intervalCapacity,
                due_count: 0,
                active_collectors: 0,
                fair_share: 0,
                claim_seconds: Math.floor(claimLifetimeMs / 1000),
                checks: []
            });
        }

        const activeCollectorResult = await env.DB
            .prepare(`
                SELECT user_id, session_id
                FROM client_user_collectors
                WHERE expires_at > ?1
                ORDER BY user_id ASC, session_id ASC
            `)
            .bind(now)
            .all();
        const activeCollectorList = activeCollectorResult.results || [];
        const activeCollectors = activeCollectorList.length;
        const collectorIsEligible = activeCollectorList.some(row => {
            return (
                Number(row.user_id) === Number(session.user_id) &&
                row.session_id === session.session_id
            );
        });

        if (!collectorIsEligible || activeCollectors < 1) {
            return collectorLeaseResponse(collectorLease, {
                count: 0,
                capacity: 0,
                interval_capacity: intervalCapacity,
                due_count: 0,
                active_collectors: activeCollectors,
                fair_share: 0,
                claim_seconds: Math.floor(claimLifetimeMs / 1000),
                schedule_bucket: scheduleBucket,
                batch_id: batchId,
                collector_user_id: session.user_id,
                collector_session_id: session.session_id,
                collector_roster: activeCollectorList,
                targets: [],
                checks: []
            });
        }

        // Return a compact state snapshot rather than constructing a complete
        // schedule once per collector. Every client receives the same inputs
        // and independently reaches the same owner for each due target.
        const freshnessSlot = dailyFreshnessSlot(now);
        const snapshotResult = await env.DB
            .prepare(`
                SELECT
                    t.id,
                    t.name,
                    t.level,
                    t.total_stats,
                    t.sources,
                    CASE WHEN ts.target_id IS NULL THEN 0 ELSE 1 END
                        AS has_status,
                    COALESCE(ts.status, 'Unknown') AS previous_status,
                    CAST(COALESCE(ts.status_until, '0') AS INTEGER)
                        AS previous_status_until,
                    CAST(COALESCE(ts.last_checked_at, '0') AS INTEGER)
                        AS previous_last_checked_at,
                    CAST(COALESCE(ts.next_check_at, '0') AS INTEGER)
                        AS next_check_at,
                    COALESCE(ts.competition_score, 0) AS competition_score,
                    COALESCE(ts.competition_tier, 'Prime') AS competition_tier,
                    COALESCE(ts.hiding_out, 0) AS hiding_out,
                    COALESCE(ts.permanent_federal, 0) AS permanent_federal,
                    activity.last_seen_at AS activity_last_seen_at,
                    CASE
                        WHEN assigned_target.target_id IS NULL THEN 0
                        ELSE 1
                    END AS recommendation_leased
                FROM targets AS t
                LEFT JOIN target_status AS ts
                    ON ts.target_id = t.id
                LEFT JOIN target_activity AS activity
                    ON activity.target_id = t.id
                LEFT JOIN client_target_leases AS assigned_target
                    ON assigned_target.target_id = t.id
                   AND assigned_target.expires_at > ?1
                ORDER BY t.id ASC
                LIMIT ?2
            `)
            .bind(
                now,
                MAX_CHECK_SNAPSHOT_ROWS
            )
            .all();
        const targets = snapshotResult.results || [];

        return collectorLeaseResponse(collectorLease, {
            count: targets.length,
            capacity: intervalCapacity,
            interval_capacity: intervalCapacity,
            due_count: 0,
            active_collectors: activeCollectors,
            fair_share: 0,
            claim_seconds: Math.floor(claimLifetimeMs / 1000),
            coordination: 'client_rendezvous_hash',
            schedule: 'client_deterministic_time_bucket',
            schedule_bucket: scheduleBucket,
            batch_id: batchId,
            daily_freshness_window: freshnessSlot >= 0,
            collector_user_id: session.user_id,
            collector_session_id: session.session_id,
            collector_roster: activeCollectorList,
            targets,
            checks: []
        });
    } catch (error) {
        return requestOrWorkerErrorResponse('Could not claim checks.', error);
    }
}


async function handleUserDemandActivity(request, env, session, ctx) {
    const now = Date.now();

    // Admin testing must never keep paid-user demand alive by itself.
    if (Number(session?.user_id) === SOLE_ADMIN_USER_ID) {
        return jsonResponse({
            ok: true,
            active: false,
            admin_excluded: true,
            active_until: null
        });
    }

    const body = await readJsonBody(request);
    if (body?.active === false) {
        await env.DB
            .prepare('DELETE FROM leveling_user_activity WHERE session_id = ?1')
            .bind(session.session_id)
            .run();
        return jsonResponse({
            ok: true,
            active: false,
            contributor_only: true,
            active_until: null
        });
    }
    const suppliedInteractionAt = Number(body?.last_interaction_at);
    const lastInteractionAt = Number.isFinite(suppliedInteractionAt)
        ? Math.min(now, Math.max(0, suppliedInteractionAt))
        : now;
    const activeUntil = lastInteractionAt + USER_DEMAND_LIFETIME_MS;

    if (activeUntil <= now) {
        await env.DB
            .prepare('DELETE FROM leveling_user_activity WHERE session_id = ?1')
            .bind(session.session_id)
            .run();
        return jsonResponse({
            ok: true,
            active: false,
            idle: true,
            active_until: null
        });
    }
    await env.DB
        .prepare(`
            INSERT INTO leveling_user_activity (
                session_id,
                user_id,
                last_interaction_at,
                active_until
            ) VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(session_id) DO UPDATE SET
                user_id = excluded.user_id,
                last_interaction_at = excluded.last_interaction_at,
                active_until = excluded.active_until
        `)
        .bind(session.session_id, session.user_id, lastInteractionAt, activeUntil)
        .run();

    scheduleVirtualCollector(ctx, env, session);

    return jsonResponse({
        ok: true,
        active: true,
        active_until: new Date(activeUntil).toISOString(),
        idle_after_seconds: Math.floor(USER_DEMAND_LIFETIME_MS / 1000)
    });
}


async function handleDemandAwareClaimChecks(request, env, session) {
    if (!(await hasActiveUserDemand(env, Date.now()))) {
        return jsonResponse({
            ok: true,
            demand_active: false,
            collector: false,
            count: 0,
            capacity: 0,
            due_count: 0,
            poll_seconds: NO_DEMAND_POLL_SECONDS,
            checks: [],
            targets: []
        });
    }

    return handleClaimChecks(request, env, session);
}


async function hasActiveUserDemand(env, now) {
    try {
        const row = await env.DB
            .prepare(`
                SELECT 1 AS active
                FROM leveling_user_activity
                WHERE active_until > ?1
                  AND user_id <> ?2
                LIMIT 1
            `)
            .bind(now, SOLE_ADMIN_USER_ID)
            .first();
        return row?.active === 1;
    } catch (error) {
        // Keep rolling deployments functional until migration 0004 is applied.
        if (String(errorMessage(error)).includes('leveling_user_activity')) {
            return true;
        }
        throw error;
    }
}


function routineCheckBucket(now = Date.now()) {
    return Math.floor(now / ROUTINE_CHECK_BUCKET_MS);
}


function checkBatchId(session, scheduleBucket) {
    return `${session.session_id}:${scheduleBucket}`;
}


function validateObservationBatchId(session, value, now) {
    const supplied = String(value || '').trim();

    if (!supplied) {
        return null;
    }

    const prefix = `${session.session_id}:`;

    if (!supplied.startsWith(prefix)) {
        return null;
    }

    const bucket = Number(supplied.slice(prefix.length));
    const currentBucket = routineCheckBucket(now);

    if (!Number.isInteger(bucket) || bucket > currentBucket + 1) {
        throw new RequestValidationError('check_batch_id is invalid.');
    }

    if (bucket < currentBucket - CHECK_BATCH_MAX_AGE_BUCKETS) {
        return null;
    }

    return supplied;
}


async function handleObservations(request, env, session) {
    try {
        const body = await readJsonBody(request);
        const observations = Array.isArray(body?.observations)
            ? body.observations
            : [];

        if (!observations.length) {
            throw new RequestValidationError(
                'At least one observation is required.'
            );
        }

        if (observations.length > MAX_MEMBER_BATCH_ROWS) {
            throw new RequestValidationError(
                `A maximum of ${MAX_MEMBER_BATCH_ROWS} rows is allowed per request.`
            );
        }

        const now = Date.now();
        const context = await loadObservationContext(env, observations, now);
        const accepted = [];
        const acceptedPlans = [];
        const rejected = [];

        for (let index = 0; index < observations.length; index++) {
            try {
                const plan = prepareTargetObservation(
                    session,
                    observations[index],
                    context,
                    now
                );
                accepted.push(plan.response);
                acceptedPlans.push(plan);
            } catch (error) {
                rejected.push({
                    index,
                    target_id: positiveIntegerOrNull(
                        observations[index]?.target_id
                    ),
                    error: errorMessage(error)
                });
            }
        }

        await persistTargetObservations(env, acceptedPlans);

        return jsonResponse({
            ok: rejected.length === 0,
            accepted_count: accepted.length,
            rejected_count: rejected.length,
            accepted,
            rejected
        }, accepted.length ? 200 : 400);
    } catch (error) {
        return requestOrWorkerErrorResponse(
            'Could not process observations.',
            error
        );
    }
}


async function loadObservationContext(env, observations, now) {
    const targetIds = [...new Set(
        observations
            .map(observation => positiveIntegerOrNull(observation?.target_id))
            .filter(Boolean)
    )];
    const targetById = new Map();
    const statusById = new Map();
    const eventsById = new Map(targetIds.map(targetId => [targetId, []]));

    for (
        let index = 0;
        index < targetIds.length;
        index += OBSERVATION_READ_CHUNK_SIZE
    ) {
        const chunk = targetIds.slice(index, index + OBSERVATION_READ_CHUNK_SIZE);
        const placeholders = orderedSqlParameters(chunk.length);
        const [targetResult, statusResult, eventResult] = await env.DB.batch([
            env.DB
                .prepare(`
                    SELECT id, name
                    FROM targets
                    WHERE id IN (${placeholders})
                `)
                .bind(...chunk),
            env.DB
                .prepare(`
                    SELECT
                        target_id,
                        status,
                        status_until,
                        last_checked_at,
                        next_check_at,
                        competition_score,
                        competition_tier,
                        hiding_out,
                        permanent_federal
                    FROM target_status
                    WHERE target_id IN (${placeholders})
                `)
                .bind(...chunk),
            env.DB
                .prepare(`
                    SELECT target_id, hospitalized_at, hospital_until
                    FROM hospital_events
                    WHERE target_id IN (${placeholders})
                      AND hospitalized_at >= ?${chunk.length + 1}
                    ORDER BY target_id, hospitalized_at ASC
                `)
                .bind(...chunk, now - HOSPITAL_7D_MS)
        ]);

        for (const target of targetResult.results || []) {
            targetById.set(Number(target.id), target);
        }

        for (const statusRow of statusResult.results || []) {
            statusById.set(Number(statusRow.target_id), {
                status: statusRow.status,
                status_until: statusRow.status_until,
                last_checked_at: statusRow.last_checked_at,
                next_check_at: statusRow.next_check_at,
                competition_score: statusRow.competition_score,
                competition_tier: statusRow.competition_tier,
                hiding_out: statusRow.hiding_out,
                permanent_federal: statusRow.permanent_federal
            });
        }

        for (const eventRow of eventResult.results || []) {
            const targetId = Number(eventRow.target_id);
            const targetEvents = eventsById.get(targetId) || [];
            targetEvents.push({
                at: Number(eventRow.hospitalized_at) || 0,
                until: Number(eventRow.hospital_until) || 0
            });
            eventsById.set(targetId, targetEvents);
        }
    }

    return { targetById, statusById, eventsById };
}


function prepareTargetObservation(session, observation, context, now) {
    const targetId = positiveIntegerOrNull(observation?.target_id);

    if (!targetId) {
        throw new RequestValidationError('target_id must be a positive integer.');
    }

    const target = context.targetById.get(targetId);

    if (!target) {
        throw new RequestValidationError('The target is not in the master list.');
    }

    const nowSeconds = Math.floor(now / 1000);
    const stateText = `${observation?.state || ''} ${observation?.description || ''}`;
    const status = normalizeStatus(stateText);
    const description = String(observation?.description || '')
        .trim()
        .slice(0, 500);
    const until = boundedInteger(
        observation?.until,
        0,
        0,
        nowSeconds + (5 * 365 * 24 * 60 * 60)
    );
    const source = normalizeObservationSource(observation?.source);
    const observationBatchId = validateObservationBatchId(
        session,
        observation?.check_batch_id,
        now
    );

    const previous = context.statusById.get(targetId);

    const previousStatus = normalizeStatus(previous?.status || 'Unknown');
    const previousUntil = Number(previous?.status_until) || 0;
    const newHospitalStay = status === 'Hospital' && (
        (until > 0 && until !== previousUntil) ||
        (until === 0 && previousStatus !== 'Hospital')
    );

    const targetEvents = context.eventsById.get(targetId) || [];
    let hospitalEvent = null;

    if (newHospitalStay) {
        const deduplicationUntil = until > 0
            ? until
            : -Math.floor(now / 60_000);

        if (!targetEvents.some(event => event.until === deduplicationUntil)) {
            hospitalEvent = {
                targetId,
                hospitalizedAt: now,
                hospitalUntil: deduplicationUntil,
                reportedBy: session.user_id
            };
            targetEvents.push({ at: now, until: deduplicationUntil });
            context.eventsById.set(targetId, targetEvents);
        }
    }

    const competition = calculateCompetitionFromEvents(targetEvents, now);
    const schedule = calculateNextCheck({
        targetId,
        status,
        description,
        until,
        competitionTier: competition.tier,
        now
    });

    const statusRow = {
        targetId,
        status,
        until,
        lastCheckedAt: now,
        nextCheckAt: schedule.nextCheckAt,
        competitionScore: competition.score,
        competitionTier: competition.tier,
        hidingOut: schedule.hidingOut ? 1 : 0,
        permanentFederal: schedule.permanentFederal ? 1 : 0
    };
    const freshnessCheckpoint = shouldWriteDailyFreshness(
        previous,
        statusRow,
        now
    );
    const persistStatus = shouldPersistStatusObservation(
        previous,
        statusRow,
        freshnessCheckpoint
    );

    context.statusById.set(targetId, {
        status,
        status_until: until,
        last_checked_at: persistStatus
            ? now
            : previous?.last_checked_at,
        next_check_at: schedule.nextCheckAt,
        competition_score: competition.score,
        competition_tier: competition.tier,
        hiding_out: statusRow.hidingOut,
        permanent_federal: statusRow.permanentFederal
    });

    return {
        statusRow,
        persistStatus,
        freshnessCheckpoint,
        hospitalEvent,
        checkBatchId: observationBatchId,
        releaseLease: status !== 'Okay' && status !== 'Unknown',
        response: {
            target_id: targetId,
            name: target.name,
            status,
            status_until: until,
            next_check_at: schedule.nextCheckAt,
            schedule_reason: schedule.reason,
            competition_score: competition.score,
            competition_tier: competition.tier,
            hospital_event_inserted: hospitalEvent !== null,
            database_status_written: persistStatus,
            freshness_checkpoint: freshnessCheckpoint,
            source
        }
    };
}


async function persistTargetObservations(env, plans) {
    if (!plans.length) {
        return;
    }

    const statements = [];
    const hospitalEvents = plans
        .map(plan => plan.hospitalEvent)
        .filter(Boolean);

    for (
        let index = 0;
        index < hospitalEvents.length;
        index += HOSPITAL_WRITE_CHUNK_SIZE
    ) {
        const chunk = hospitalEvents.slice(index, index + HOSPITAL_WRITE_CHUNK_SIZE);
        const bindings = chunk.flatMap(event => [
            event.targetId,
            event.hospitalizedAt,
            event.hospitalUntil,
            event.reportedBy
        ]);
        const rows = orderedValueRows(chunk.length, 4);
        statements.push(
            env.DB
                .prepare(`
                    INSERT OR IGNORE INTO hospital_events (
                        target_id,
                        hospitalized_at,
                        hospital_until,
                        reported_by
                    )
                    VALUES ${rows}
                `)
                .bind(...bindings)
        );
    }

    const statusRows = plans
        .filter(plan => plan.persistStatus)
        .map(plan => plan.statusRow);

    for (
        let index = 0;
        index < statusRows.length;
        index += STATUS_WRITE_CHUNK_SIZE
    ) {
        const chunk = statusRows.slice(index, index + STATUS_WRITE_CHUNK_SIZE);
        const bindings = chunk.flatMap(row => [
            row.targetId,
            row.status,
            row.until,
            row.lastCheckedAt,
            row.nextCheckAt,
            row.competitionScore,
            row.competitionTier,
            row.hidingOut,
            row.permanentFederal
        ]);
        const rows = orderedValueRows(chunk.length, 9, true);
        statements.push(
            env.DB
                .prepare(`
                    INSERT INTO target_status (
                        target_id,
                        status,
                        status_until,
                        last_checked_at,
                        next_check_at,
                        competition_score,
                        competition_tier,
                        hiding_out,
                        permanent_federal,
                        updated_at
                    )
                    VALUES ${rows}
                    ON CONFLICT(target_id) DO UPDATE SET
                        status = excluded.status,
                        status_until = excluded.status_until,
                        last_checked_at = excluded.last_checked_at,
                        next_check_at = excluded.next_check_at,
                        competition_score = excluded.competition_score,
                        competition_tier = excluded.competition_tier,
                        hiding_out = excluded.hiding_out,
                        permanent_federal = excluded.permanent_federal,
                        updated_at = CURRENT_TIMESTAMP
                `)
                .bind(...bindings)
        );
    }

    const releaseLeaseIds = [...new Set(
        plans
            .filter(plan => plan.releaseLease)
            .map(plan => plan.statusRow.targetId)
    )];

    for (
        let index = 0;
        index < releaseLeaseIds.length;
        index += LEASE_DELETE_CHUNK_SIZE
    ) {
        const chunk = releaseLeaseIds.slice(index, index + LEASE_DELETE_CHUNK_SIZE);
        statements.push(
            env.DB
                .prepare(`
                    DELETE FROM client_target_leases
                    WHERE target_id IN (${orderedSqlParameters(chunk.length)})
                `)
                .bind(...chunk)
        );
    }

    if (statements.length) {
        await env.DB.batch(statements);
    }
}


function orderedSqlParameters(count, startAt = 1) {
    return Array.from(
        { length: count },
        (_, index) => `?${startAt + index}`
    ).join(', ');
}


function orderedValueRows(count, width, appendCurrentTimestamp = false) {
    return Array.from({ length: count }, (_, rowIndex) => {
        const parameters = orderedSqlParameters(width, (rowIndex * width) + 1);
        return appendCurrentTimestamp
            ? `(${parameters}, CURRENT_TIMESTAMP)`
            : `(${parameters})`;
    }).join(', ');
}


async function handleActivityReport(request, env, session) {
    try {
        const body = await readJsonBody(request);
        const entries = Object.entries(body?.active_targets || {});

        if (!entries.length) {
            throw new RequestValidationError(
                'active_targets must contain at least one target.'
            );
        }

        if (entries.length > MAX_ACTIVITY_TARGETS_PER_REQUEST) {
            throw new RequestValidationError(
                `A maximum of ${MAX_ACTIVITY_TARGETS_PER_REQUEST} active targets is allowed.`
            );
        }

        const nowSeconds = Math.floor(Date.now() / 1000);
        const minimumSnapshot = nowSeconds - Math.floor(ACTIVITY_WINDOW_MS / 1000) - 86_400;
        const accepted = entries.map(([rawId, rawTimestamp]) => {
            const targetId = positiveIntegerOrNull(rawId);
            const snapshotAt = boundedInteger(
                rawTimestamp,
                0,
                minimumSnapshot,
                nowSeconds + 300
            );

            if (!targetId || !snapshotAt) {
                throw new RequestValidationError(
                    'Every active target must have a valid ID and recent snapshot timestamp.'
                );
            }

            return { targetId, snapshotAt };
        });

        for (let index = 0; index < accepted.length; index += IMPORT_BATCH_SIZE) {
            const chunk = accepted.slice(index, index + IMPORT_BATCH_SIZE);
            const statements = [];

            for (const entry of chunk) {
                statements.push(
                    env.DB
                        .prepare(`
                            INSERT INTO target_activity (
                                target_id,
                                last_seen_at,
                                observed_at,
                                reported_by
                            )
                            VALUES (?1, ?2, ?3, ?4)
                            ON CONFLICT(target_id) DO UPDATE SET
                                last_seen_at = MAX(
                                    target_activity.last_seen_at,
                                    excluded.last_seen_at
                                ),
                                observed_at = excluded.observed_at,
                                reported_by = excluded.reported_by
                            WHERE excluded.last_seen_at >
                                target_activity.last_seen_at
                        `)
                        .bind(
                            entry.targetId,
                            entry.snapshotAt,
                            nowSeconds,
                            session.user_id
                        )
                );
                statements.push(
                    env.DB
                        .prepare(`
                            UPDATE target_status
                            SET
                                status = CASE
                                    WHEN hiding_out = 1 THEN 'Unknown'
                                    ELSE status
                                END,
                                hiding_out = 0,
                                next_check_at = CASE
                                    WHEN hiding_out = 1 THEN '0'
                                    ELSE next_check_at
                                END,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE target_id = ?1
                              AND COALESCE(hiding_out, 0) = 1
                        `)
                        .bind(entry.targetId)
                );
            }

            await env.DB.batch(statements);
        }

        return jsonResponse({
            ok: true,
            accepted_count: accepted.length
        });
    } catch (error) {
        return requestOrWorkerErrorResponse(
            'Could not process activity data.',
            error
        );
    }
}


function handleDeprecatedFairFightReport() {
    return jsonResponse({
        ok: true,
        accepted_count: 0,
        cache_scope: 'client',
        deprecated: true,
        message: 'Fair Fight data is stored only in the member browser.'
    });
}


async function cleanExpiredCoordinationRows(env, now) {
    await env.DB.batch([
        env.DB
            .prepare(`
                DELETE FROM client_target_leases
                WHERE expires_at <= ?1
                   OR NOT EXISTS (
                        SELECT 1
                        FROM client_user_collectors AS active_collector
                        WHERE active_collector.user_id =
                            client_target_leases.user_id
                          AND active_collector.expires_at > ?1
                   )
            `)
            .bind(now),
        env.DB
            .prepare('DELETE FROM client_user_collectors WHERE expires_at <= ?1')
            .bind(now)
    ]);

    try {
        await env.DB
            .prepare('DELETE FROM leveling_user_activity WHERE active_until <= ?1')
            .bind(now)
            .run();
    } catch (error) {
        // Migration 0004 may briefly lag a rolling Worker deployment.
        if (!String(errorMessage(error)).includes('leveling_user_activity')) {
            throw error;
        }
    }
}


function calculateCompetitionFromEvents(eventRows, now = Date.now()) {
    const events = (eventRows || [])
        .map(event => ({
            at: Number(event.at) || 0,
            until: Number(event.until) || 0
        }))
        .filter(event => event.at > 0)
        .sort((left, right) => left.at - right.at);
    const cutoff24h = now - HOSPITAL_24H_MS;
    const count24h = events.filter(event => event.at >= cutoff24h).length;
    let rapidPenaltyTotal = 0;
    let rapidCount24h = 0;

    for (let index = 1; index < events.length; index++) {
        const current = events[index];
        const previous = events[index - 1];

        if (previous.until <= 0) {
            continue;
        }

        const gapMs = current.at - (previous.until * 1000);

        if (
            gapMs < 0 ||
            gapMs > RAPID_REHOSP_WINDOW_MS ||
            current.at < cutoff24h
        ) {
            continue;
        }

        rapidCount24h++;
        rapidPenaltyTotal += rapidPenalty(gapMs);
    }

    const score = (count24h * 10) + (events.length * 2) + rapidPenaltyTotal;

    return {
        score,
        tier: competitionTier(score),
        hospitalizations24h: count24h,
        hospitalizations7d: events.length,
        rapidRehospitalizations24h: rapidCount24h
    };
}


function dailyFreshnessSlot(now = Date.now()) {
    const date = new Date(now);
    const utcMinute = (date.getUTCHours() * 60) + date.getUTCMinutes();

    if (utcMinute < DAILY_FRESHNESS_START_UTC_MINUTE) {
        return -1;
    }

    return Math.min(
        DAILY_FRESHNESS_BUCKETS - 1,
        Math.floor(
            (utcMinute - DAILY_FRESHNESS_START_UTC_MINUTE) /
            (ROUTINE_CHECK_BUCKET_MS / 60_000)
        )
    );
}


function shouldWriteDailyFreshness(previous, statusRow, now) {
    const date = new Date(now);
    const freshnessWindowStart = Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
        23,
        45
    );

    return (
        statusRow.status === 'Okay' &&
        dailyFreshnessSlot(now) >= 0 &&
        Number(previous?.last_checked_at || 0) < freshnessWindowStart
    );
}


function shouldPersistStatusObservation(
    previous,
    statusRow,
    freshnessCheckpoint
) {
    if (!previous || statusRow.status !== 'Okay') {
        return true;
    }

    if (normalizeStatus(previous.status) !== 'Okay') {
        return true;
    }

    return (
        Number(previous.status_until || 0) !== statusRow.until ||
        Number(previous.competition_score || 0) !== statusRow.competitionScore ||
        String(previous.competition_tier || 'Prime') !== statusRow.competitionTier ||
        Number(previous.hiding_out || 0) !== statusRow.hidingOut ||
        Number(previous.permanent_federal || 0) !== statusRow.permanentFederal ||
        freshnessCheckpoint
    );
}


function calculateNextCheck({
    targetId = 0,
    status,
    description,
    until,
    competitionTier: tier,
    now = Date.now()
}) {
    const untilMs = until > 0 ? until * 1000 : 0;
    let nextCheckAt = now + NON_OKAY_RECHECK_MS;
    let reason = 'stale_status';
    let hidingOut = false;
    let permanentFederal = false;

    if (status === 'Hospital') {
        nextCheckAt = untilMs > now
            ? untilMs + HOSPITAL_RECHECK_GRACE_MS
            : now + NON_OKAY_RECHECK_MS;
        reason = untilMs > now
            ? 'hospital_release_plus_1m'
            : 'hospital_without_release_time';
    } else if (status === 'Federal') {
        permanentFederal = (
            String(description || '').toLowerCase().includes('permanent') ||
            untilMs <= now
        );

        if (permanentFederal) {
            nextCheckAt = DEFERRED_CHECK_AT_MS;
            reason = 'permanent_federal_jail';
        } else {
            nextCheckAt = untilMs + HOSPITAL_RECHECK_GRACE_MS;
            reason = 'temporary_federal_release_plus_1m';
        }
    } else if (status === 'Hiding Out') {
        hidingOut = true;
        nextCheckAt = DEFERRED_CHECK_AT_MS;
        reason = 'hiding_out_until_activity_snapshot';
    } else if (status === 'Okay') {
        nextCheckAt = nextDeterministicOkayCheckAt(targetId, tier, now);
        reason = `okay_${String(tier || 'Prime').toLowerCase()}_time_bucket`;
    } else if (status === 'Unknown') {
        nextCheckAt = now + NON_OKAY_RECHECK_MS;
        reason = 'unknown_recheck';
    }

    return {
        nextCheckAt,
        reason,
        hidingOut,
        permanentFederal
    };
}


function normalizeStatus(value) {
    const text = String(value || 'Unknown').trim();
    const lower = text.toLowerCase();

    if (lower.includes('federal')) return 'Federal';
    if (lower.includes('hiding out') || lower.includes('hiding')) {
        return 'Hiding Out';
    }
    if (lower.includes('hospital')) return 'Hospital';
    if (lower.includes('travel') || lower.includes('flying')) {
        return 'Traveling';
    }
    if (lower.includes('abroad')) return 'Abroad';
    if (lower.includes('jail')) return 'Jail';
    if (lower === 'okay' || lower.includes('okay')) return 'Okay';
    return 'Unknown';
}


function rapidPenalty(gapMs) {
    if (
        !Number.isFinite(gapMs) ||
        gapMs < 0 ||
        gapMs > RAPID_REHOSP_WINDOW_MS
    ) {
        return 0;
    }

    if (gapMs <= 5 * 60 * 1000) return 40;
    if (gapMs <= 15 * 60 * 1000) return 25;
    if (gapMs <= 30 * 60 * 1000) return 15;
    return 8;
}


function competitionTier(score) {
    if (score >= 80) return 'Farmed';
    if (score >= 40) return 'Crowded';
    if (score >= 20) return 'Warm';
    return 'Prime';
}


function okayRecheckInterval(tier) {
    if (tier === 'Farmed') return OKAY_RECHECK_FARMED_MS;
    if (tier === 'Crowded') return OKAY_RECHECK_CROWDED_MS;
    if (tier === 'Warm') return OKAY_RECHECK_WARM_MS;
    return OKAY_RECHECK_PRIME_MS;
}


function okayRecheckBucketCount(tier) {
    return Math.max(
        1,
        Math.round(okayRecheckInterval(tier) / ROUTINE_CHECK_BUCKET_MS)
    );
}


function nextDeterministicOkayCheckAt(targetId, tier, now = Date.now()) {
    const bucketCount = okayRecheckBucketCount(tier);
    const targetSlot = Math.abs(Number(targetId) || 0) % bucketCount;
    const firstFutureBucket = routineCheckBucket(now) + 1;
    const delta = (
        targetSlot - (firstFutureBucket % bucketCount) + bucketCount
    ) % bucketCount;

    return (firstFutureBucket + delta) * ROUTINE_CHECK_BUCKET_MS;
}


function normalizeRecommendationRow(row) {
    const status = normalizeStatus(row.status);
    const nextCheckAt = status === 'Okay'
        ? nextDeterministicOkayCheckAt(
            Number(row.id),
            row.competition_tier,
            Date.now()
        )
        : Number(row.next_check_at) || 0;

    return {
        ...row,
        id: Number(row.id),
        level: nullableNumber(row.level),
        total_stats: nullableNumber(row.total_stats),
        status_until: Number(row.status_until) || 0,
        last_checked_at: Number(row.last_checked_at) || 0,
        next_check_at: nextCheckAt,
        competition_score: Number(row.competition_score) || 0,
        fair_fight: nullableNumber(row.fair_fight),
        bs_estimate: nullableNumber(row.bs_estimate),
        fair_fight_checked_at: Number(row.fair_fight_checked_at) || 0,
        hospitalizations_24h: Number(row.hospitalizations_24h) || 0,
        hospitalizations_7d: Number(row.hospitalizations_7d) || 0,
        last_hospitalized_at: Number(row.last_hospitalized_at) || 0,
        lease_expires_at: Number(row.lease_expires_at) || 0
    };
}


function normalizeObservationSource(value) {
    const source = String(value || '').trim().toLowerCase();

    if (source === 'attack_page') return 'attack_page';
    if (source === 'torn_api') return 'torn_api';
    if (source === 'donated_torn_api') return 'donated_torn_api';
    return 'client';
}


// ================================================================
// Admin authentication
// ================================================================

async function isAdminRequest(request, env) {
    const session = await getAuthenticatedSession(request, env);

    if (
        session?.user_id === SOLE_ADMIN_USER_ID &&
        hasSessionScope(session, ADMIN_SCOPE)
    ) {
        return true;
    }

    const suppliedToken = request.headers.get('X-Admin-Token');

    if (!suppliedToken || !env.ADMIN_TOKEN) {
        return false;
    }

    const [suppliedDigest, expectedDigest] = await Promise.all([
        crypto.subtle.digest('SHA-256', textEncoder.encode(suppliedToken)),
        crypto.subtle.digest('SHA-256', textEncoder.encode(env.ADMIN_TOKEN))
    ]);

    return timingSafeEqual(
        new Uint8Array(suppliedDigest),
        new Uint8Array(expectedDigest)
    );
}


function timingSafeEqual(left, right) {
    if (typeof crypto.subtle.timingSafeEqual === 'function') {
        return crypto.subtle.timingSafeEqual(left, right);
    }

    // Node's Web Crypto does not expose Cloudflare's timingSafeEqual extension.
    // Both inputs are fixed-size SHA-256 digests, so this fallback does not leak
    // the original secret length.
    let difference = 0;

    for (let index = 0; index < left.length; index++) {
        difference |= left[index] ^ right[index];
    }

    return difference === 0;
}


// ================================================================
// CSV handling
// ================================================================

function parseCsv(text) {
    const rawRows = [];

    let row = [];
    let cell = '';
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const character = text[index];

        if (quoted) {
            if (
                character === '"' &&
                text[index + 1] === '"'
            ) {
                cell += '"';
                index++;
                continue;
            }

            if (character === '"') {
                quoted = false;
                continue;
            }

            cell += character;
            continue;
        }

        if (character === '"') {
            quoted = true;
            continue;
        }

        if (character === ',') {
            row.push(cell);
            cell = '';
            continue;
        }

        if (character === '\n') {
            row.push(cell);
            rawRows.push(row);

            row = [];
            cell = '';
            continue;
        }

        if (character !== '\r') {
            cell += character;
        }
    }

    if (cell.length || row.length) {
        row.push(cell);
        rawRows.push(row);
    }

    if (!rawRows.length) {
        return [];
    }

    const headers = rawRows
        .shift()
        .map(header => String(header || '').trim());

    return rawRows
        .filter(values => {
            return values.some(value => String(value || '').trim());
        })
        .map(values => {
            const object = {};

            for (
                let index = 0;
                index < headers.length;
                index++
            ) {
                object[headers[index]] = values[index] ?? '';
            }

            return object;
        });
}


function normalizeMasterTarget(row) {
    const id = Number(row.id);
    const level = Number(row.level);

    return {
        id: Number.isInteger(id) ? id : 0,
        name: String(row.name || '').trim(),
        level: Number.isFinite(level) ? level : null,
        totalStats: parseStatNumber(row.total),
        sources: String(row.sources || '').trim()
    };
}


function parseStatNumber(value) {
    const text = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/,/g, '');

    if (
        !text ||
        text === 'unknown' ||
        text === 'null' ||
        text === '—'
    ) {
        return null;
    }

    let multiplier = 1;
    let numberText = text;

    if (text.endsWith('k')) {
        multiplier = 1_000;
        numberText = text.slice(0, -1);
    } else if (text.endsWith('m')) {
        multiplier = 1_000_000;
        numberText = text.slice(0, -1);
    } else if (text.endsWith('b')) {
        multiplier = 1_000_000_000;
        numberText = text.slice(0, -1);
    }

    const numeric = Number(numberText);

    if (!Number.isFinite(numeric)) {
        return null;
    }

    return Math.round(numeric * multiplier);
}


function deduplicateTargets(targets) {
    const byId = new Map();

    for (const target of targets) {
        byId.set(target.id, target);
    }

    return [...byId.values()];
}


// ================================================================
// Shared request/response helpers
// ================================================================

function boundedIntegerQueryParameter(value, fallback, minimum, maximum) {
    if (value === null || value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(
        Math.max(Math.trunc(parsed), minimum),
        maximum
    );
}


function boundedNumberQueryParameter(value, fallback, minimum, maximum) {
    if (value === null || value.trim() === '') {
        return fallback;
    }

    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, minimum), maximum);
}


function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(
        Math.max(Math.trunc(parsed), minimum),
        maximum
    );
}


function positiveIntegerOrNull(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}


function nullableNumber(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}


async function readJsonBody(request) {
    const declaredLength = Number(request.headers.get('Content-Length'));

    if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_JSON_BODY_BYTES
    ) {
        throw new RequestValidationError('Request body is too large.');
    }

    if (!request.body) {
        throw new RequestValidationError('A JSON request body is required.');
    }

    const reader = request.body.getReader();
    const chunks = [];
    let totalLength = 0;

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) {
                break;
            }

            totalLength += value.byteLength;

            if (totalLength > MAX_JSON_BODY_BYTES) {
                await reader.cancel('Request body is too large.');
                throw new RequestValidationError('Request body is too large.');
            }

            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(totalLength);
    let offset = 0;

    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }

    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        throw new RequestValidationError('Request body must be valid JSON.');
    }
}


function base64UrlEncode(bytes) {
    let binary = '';

    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}


function base64UrlDecode(value) {
    let base64 = value
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    while (base64.length % 4) {
        base64 += '=';
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}


function unauthorizedAdminResponse() {
    return jsonResponse(
        {
            ok: false,
            error: 'Unauthorized'
        },
        401
    );
}


function memberAuthenticationRequired() {
    return jsonResponse(
        {
            ok: false,
            authenticated: false,
            error: 'A valid SLINK Leveling session is required.'
        },
        401
    );
}


function scheduleVirtualCollector(ctx, env, session) {
    if (
        Number(session?.user_id) === SOLE_ADMIN_USER_ID ||
        !env.CONTRIBUTION_SERVICE ||
        !env.CONTRIBUTION_SERVICE_TOKEN
    ) return;

    const work = runVirtualCollectorCycle(env, session).catch(error => {
        console.error(JSON.stringify({
            event: 'slink_leveling_virtual_collector_failed',
            version: WORKER_VERSION,
            user_id: Number(session?.user_id) || 0,
            error: errorMessage(error)
        }));
    });
    if (ctx?.waitUntil) ctx.waitUntil(work);
}


async function runVirtualCollectorCycle(env, session) {
    const targets = await selectVirtualCheckTargets(env, Date.now());
    const response = await env.CONTRIBUTION_SERVICE.fetch(
        new Request('https://slink-contribution.internal/api/internal/collect', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-SLINK-Service-Token': env.CONTRIBUTION_SERVICE_TOKEN
            },
            body: JSON.stringify({
                service_id: CONTRIBUTION_LEVELING_SERVICE_ID,
                user_id: Number(session.user_id),
                is_admin: false,
                targets
            })
        })
    );
    const result = await response.json();
    if (!response.ok || result?.ok !== true) {
        throw new Error(
            result?.error ||
            'Contribution service rejected the collection request.'
        );
    }

    const observations = Array.isArray(result?.observations)
        ? result.observations.slice(0, MAX_VIRTUAL_CHECK_ROWS)
        : [];
    if (!observations.length) return result;

    const now = Date.now();
    const context = await loadObservationContext(env, observations, now);
    const virtualSession = {
        user_id: positiveIntegerOrNull(result?.donor_user_id) || session.user_id,
        session_id: String(result?.virtual_session_id || 'virtual-collector'),
        scopes: [LEVELING_SCOPE]
    };
    const plans = [];
    for (const observation of observations) {
        try {
            plans.push(prepareTargetObservation(
                virtualSession,
                observation,
                context,
                now
            ));
        } catch (error) {
            console.error(JSON.stringify({
                event: 'slink_leveling_virtual_observation_rejected',
                target_id: positiveIntegerOrNull(observation?.target_id),
                error: errorMessage(error)
            }));
        }
    }
    await persistTargetObservations(env, plans);
    return { ...result, persisted_count: plans.length };
}


async function selectVirtualCheckTargets(env, now) {
    const activityCutoff = Math.floor((now - ACTIVITY_WINDOW_MS) / 1000);
    const result = await env.DB
        .prepare(`
            SELECT t.id
            FROM targets AS t
            LEFT JOIN target_status AS status
                ON status.target_id = t.id
            LEFT JOIN target_activity AS activity
                ON activity.target_id = t.id
            WHERE (
                    activity.last_seen_at IS NULL
                    OR activity.last_seen_at < ?1
                  )
              AND COALESCE(status.hiding_out, 0) = 0
              AND COALESCE(status.permanent_federal, 0) = 0
              AND (
                    status.target_id IS NULL
                    OR CAST(COALESCE(status.next_check_at, '0') AS INTEGER) <= ?2
                  )
            ORDER BY
                CASE WHEN status.target_id IS NULL THEN 0 ELSE 1 END ASC,
                COALESCE(status.competition_score, 0) ASC,
                CAST(COALESCE(status.last_checked_at, '0') AS INTEGER) ASC,
                t.level DESC,
                t.id ASC
            LIMIT ?3
        `)
        .bind(activityCutoff, now, MAX_VIRTUAL_CHECK_ROWS)
        .all();
    return (result.results || []).map(row => ({ id: Number(row.id) }));
}


function permissionDeniedResponse(requiredScope) {
    return jsonResponse(
        {
            ok: false,
            error: `SLINK permission required: ${requiredScope}`,
            required_scope: requiredScope
        },
        403
    );
}


function corsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
            'Content-Type, X-Admin-Token, Authorization',
        'Access-Control-Allow-Methods':
            'GET, POST, OPTIONS',
        'Access-Control-Expose-Headers':
            'X-Slinky-Worker-Version',
        'X-Slinky-Worker-Version': WORKER_VERSION
    };
}


function jsonResponse(data, status = 200) {
    return Response.json(data, {
        status,
        headers: corsHeaders()
    });
}


function workerErrorResponse(message, error) {
    console.error(JSON.stringify({
        message,
        error: errorMessage(error)
    }));

    return jsonResponse(
        {
            ok: false,
            error: message
        },
        500
    );
}


function requestOrWorkerErrorResponse(message, error) {
    if (error instanceof RequestValidationError) {
        return jsonResponse(
            {
                ok: false,
                error: error.message
            },
            400
        );
    }

    return workerErrorResponse(message, error);
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
    calculateNextCheck,
    competitionTier,
    createSessionToken,
    dailyFreshnessSlot,
    discoverLevelingTargets,
    nextDeterministicOkayCheckAt,
    normalizeStatus,
    parseCsv,
    parseStatNumber,
    rapidPenalty,
    verifySessionToken
};
