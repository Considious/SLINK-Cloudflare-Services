import {
    ingestMuggingReports,
    muggingStatus,
    runMuggingMonitor
} from './monitor-core.js';

const WORKER_VERSION = '0.2.0-capacity-expanded-catalog';
const CONTRIBUTION_BATCH_SIZE = 40;
const MAX_REPORTS = 100;
const textEncoder = new TextEncoder();

const worker = {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') {
            return new Response(null, { status:204, headers:corsHeaders() });
        }
        const url = new URL(request.url);
        if (url.pathname === '/' && request.method === 'GET') {
            return jsonResponse({
                ok:true,
                service:'SLINK Mugging Intelligence',
                version:WORKER_VERSION,
                storage:{ targets:'R2', coordination:'D1' }
            });
        }
        if (url.pathname === '/api/health' && request.method === 'GET') {
            try {
                return jsonResponse({ ok:true, version:WORKER_VERSION, ...await muggingStatus(env) });
            } catch (error) {
                return requestError(error);
            }
        }
        if (url.pathname === '/api/internal/status' && request.method === 'GET') {
            if (!await authorized(request, env)) return unauthorized();
            return jsonResponse({ ok:true, version:WORKER_VERSION, ...await muggingStatus(env) });
        }
        if (url.pathname === '/api/internal/run' && request.method === 'POST') {
            if (!await authorized(request, env)) return unauthorized();
            try {
                const result = await runMonitor(env);
                return jsonResponse({ ok:true, version:WORKER_VERSION, result });
            } catch (error) {
                return requestError(error);
            }
        }
        if (url.pathname === '/api/reports' && request.method === 'POST') {
            if (!await authorized(request, env)) return unauthorized();
            try {
                const body = await readJson(request);
                const reports = Array.isArray(body?.reports) ? body.reports.slice(0, MAX_REPORTS) : [];
                const result = await ingestMuggingReports(env, reports, Date.now());
                return jsonResponse({ ok:true, version:WORKER_VERSION, ...result });
            } catch (error) {
                return requestError(error);
            }
        }
        if (url.pathname === '/api/clients/heartbeat' && request.method === 'POST') {
            if (!await authorized(request, env)) return unauthorized();
            try {
                return handleHeartbeat(request, env);
            } catch (error) {
                return requestError(error);
            }
        }
        return jsonResponse({ ok:false, error:'Not found' }, 404);
    },

    async scheduled(controller, env, ctx) {
        const promise = runMonitor(env).then(result => {
            console.log(JSON.stringify({
                event:'slink_mugging_schedule',
                version:WORKER_VERSION,
                scheduled_at:controller.scheduledTime,
                ...result
            }));
        }).catch(error => {
            console.error(JSON.stringify({
                event:'slink_mugging_schedule_failed',
                version:WORKER_VERSION,
                error:errorMessage(error)
            }));
        });
        ctx.waitUntil(promise);
    }
};

export default worker;


async function runMonitor(env) {
    const capacity = await getPublicRequestCapacity(env);
    return runMuggingMonitor(
        env,
        { executePublicRequests:requests => executePublicRequests(env, requests) },
        {
            maxCalls:capacity.available_capacity,
            capacity
        }
    );
}


async function getPublicRequestCapacity(env) {
    if (!env.CONTRIBUTION_SERVICE || !env.CONTRIBUTION_SERVICE_TOKEN) {
        throw new Error('Contribution Worker binding and token are required.');
    }
    const response = await env.CONTRIBUTION_SERVICE.fetch(
        'https://slink-contribution.internal/api/internal/mugging/capacity',
        {
            method:'GET',
            headers:{ 'X-SLINK-Service-Token':env.CONTRIBUTION_SERVICE_TOKEN }
        }
    );
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
        throw new Error(data?.error || `Contribution capacity check failed with HTTP ${response.status}.`);
    }
    return {
        key_count:Math.max(0, Number(data.key_count) || 0),
        configured_capacity:Math.max(0, Number(data.configured_capacity) || 0),
        used_capacity:Math.max(0, Number(data.used_capacity) || 0),
        available_capacity:Math.max(0, Number(data.available_capacity) || 0),
        window_started_at:Math.max(0, Number(data.window_started_at) || 0)
    };
}


async function executePublicRequests(env, requests) {
    if (!env.CONTRIBUTION_SERVICE || !env.CONTRIBUTION_SERVICE_TOKEN) {
        throw new Error('Contribution Worker binding and token are required.');
    }
    const combined = {
        key_count:0,
        configured_capacity:0,
        calls_reserved:0,
        available_capacity:0,
        results:[]
    };
    for (let offset = 0; offset < requests.length; offset += CONTRIBUTION_BATCH_SIZE) {
        const batch = requests.slice(offset, offset + CONTRIBUTION_BATCH_SIZE);
        const response = await env.CONTRIBUTION_SERVICE.fetch(
            'https://slink-contribution.internal/api/internal/mugging/requests',
            {
                method:'POST',
                headers:{
                    'Content-Type':'application/json',
                    'X-SLINK-Service-Token':env.CONTRIBUTION_SERVICE_TOKEN
                },
                body:JSON.stringify({ requests:batch })
            }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) {
            throw new Error(data?.error || `Contribution broker failed with HTTP ${response.status}.`);
        }
        combined.key_count = Math.max(combined.key_count, Number(data.key_count) || 0);
        combined.configured_capacity = Math.max(
            combined.configured_capacity,
            Number(data.configured_capacity) || 0
        );
        combined.calls_reserved += Number(data.calls_reserved) || 0;
        combined.available_capacity = Math.max(
            combined.available_capacity,
            Number(data.available_capacity) || 0
        );
        combined.results.push(...(Array.isArray(data.results) ? data.results : []));
        if ((data.results || []).some(row => row?.error?.includes('capacity remains'))) break;
    }
    const completedIds = new Set(combined.results.map(row => row?.request_id));
    for (const request of requests) {
        if (completedIds.has(request.request_id)) continue;
        combined.results.push({
            request_id:request.request_id,
            kind:request.kind,
            ok:false,
            error:'No donated mugging-key capacity remains in the current minute.'
        });
    }
    return combined;
}


async function handleHeartbeat(request, env) {
    if (!env.MUGGING_DB) throw new Error('MUGGING_DB is not configured.');
    const body = await readJson(request);
    const clientId = String(body?.client_id || '').trim().slice(0, 120);
    if (!clientId) throw new RequestValidationError('client_id is required.');
    const userId = positiveInteger(body?.user_id) || null;
    const capacity = boundedInteger(body?.capacity_per_minute, 0, 0, 60);
    const now = Date.now();
    await env.MUGGING_DB.prepare(`
        INSERT INTO mugging_client_activity (
            client_id, user_id, last_seen_at, active_until,
            capacity_per_minute, metadata_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        ON CONFLICT(client_id) DO UPDATE SET
            user_id = excluded.user_id,
            last_seen_at = excluded.last_seen_at,
            active_until = excluded.active_until,
            capacity_per_minute = excluded.capacity_per_minute,
            metadata_json = excluded.metadata_json
    `).bind(
        clientId,
        userId,
        now,
        now + 15 * 60 * 1000,
        capacity,
        JSON.stringify(body?.metadata && typeof body.metadata === 'object' ? body.metadata : {})
    ).run();
    return jsonResponse({ ok:true, client_id:clientId, active_until:now + 15 * 60 * 1000 });
}


async function authorized(request, env) {
    const supplied = request.headers.get('X-SLINK-Service-Token') ||
        request.headers.get('X-Admin-Token') || '';
    const expected = request.headers.has('X-Admin-Token')
        ? String(env.ADMIN_TOKEN || '')
        : String(env.MUGGING_SERVICE_TOKEN || '');
    if (!supplied || !expected) return false;
    const [left, right] = await Promise.all([
        crypto.subtle.digest('SHA-256', textEncoder.encode(supplied)),
        crypto.subtle.digest('SHA-256', textEncoder.encode(expected))
    ]);
    return timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}


function timingSafeEqual(left, right) {
    if (left.byteLength !== right.byteLength) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
    return difference === 0;
}


async function readJson(request) {
    try {
        return JSON.parse(await request.text() || '{}');
    } catch {
        throw new RequestValidationError('Request body must be valid JSON.');
    }
}


function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}


function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
}


function unauthorized() {
    return jsonResponse({ ok:false, error:'Unauthorized' }, 401);
}


function requestError(error) {
    const status = error instanceof RequestValidationError ? 400 : 500;
    if (status >= 500) {
        console.error(JSON.stringify({ event:'slink_mugging_error', error:errorMessage(error) }));
    }
    return jsonResponse({ ok:false, error:errorMessage(error) }, status);
}


function jsonResponse(body, status = 200) {
    return Response.json(body, { status, headers:corsHeaders() });
}


function corsHeaders() {
    return {
        'Access-Control-Allow-Origin':'*',
        'Access-Control-Allow-Headers':'Content-Type, Authorization, X-SLINK-Service-Token, X-Admin-Token',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Expose-Headers':'X-SLINK-Mugging-Version',
        'X-SLINK-Mugging-Version':WORKER_VERSION
    };
}


function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}


class RequestValidationError extends Error {}

export const testing = Object.freeze({
    executePublicRequests,
    getPublicRequestCapacity,
    handleHeartbeat,
    runMonitor
});
