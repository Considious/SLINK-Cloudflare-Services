import { factionWorkbook } from './faction-workbook.js';

const hex = /^[a-f0-9]{64}$/;
const secrets = { torn: 'TORN_API_KEY', kal: 'KAL_API_KEY', ffscouter: 'FFSCOUTER_API_KEY' };
const hosts = { torn: 'https://api.torn.com', kal: 'https://api.kalends.dev', ffscouter: 'https://ffscouter.com' };
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class ResearchError extends Error {
  constructor(status, code, message, details = {}) { super(message); this.status = status; this.code = code; this.details = details; }
  toJSON() { return { code: this.code, message: this.message, ...this.details }; }
}
const positive = value => /^[1-9][0-9]{0,14}$/.test(String(value)) && Number.isSafeInteger(Number(value));
const providerError = (provider, message, details = {}, status = 502) => new ResearchError(status, 'UPSTREAM_ERROR', message, { provider, ...details });
function redact(value, env) {
  let result = String(value);
  for (const name of Object.values(secrets)) {
    const key = env[name];
    if (key) result = result.split(key).join('[REDACTED]').split(encodeURIComponent(key)).join('[REDACTED]');
  }
  return result.replace(/([?&](?:key|api_key|apikey|token)=)[^&#\s]+/gi, '$1[REDACTED]');
}
function clean(value, env) {
  if (typeof value === 'string') return redact(value, env);
  if (Array.isArray(value)) return value.map(v => clean(v, env));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [redact(k, env), clean(v, env)]));
  return value;
}
async function authorized(request, expected) {
  const token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token || !hex.test(expected || '')) return false;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  const actual = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function paramsFor(url, omit = []) {
  const result = new URLSearchParams();
  for (const [k,v] of url.searchParams) {
    if (omit.includes(k)) continue;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(k) || /^(key|api_?key|authorization|token|access_?token)$/i.test(k) || v.length > 4096)
      throw new ResearchError(400, 'INVALID_PARAMETER', 'Invalid or credential-related query parameter; use the configured Worker secrets.');
    result.append(k,v);
  }
  return result;
}
async function upstream(provider, path, params, env, fetcher) {
  const key = env[secrets[provider]];
  if (!key) throw new ResearchError(503, 'MISSING_SECRET', 'Configure Worker secret ' + secrets[provider] + '.', { provider, secret: secrets[provider] });
  const url = new URL(path, hosts[provider]);
  url.search = params.toString();
  const headers = { Accept: 'application/json' };
  if (provider === 'ffscouter' || (provider === 'torn' && !path.startsWith('/v2/'))) url.searchParams.set('key',key);
  else headers.Authorization = 'ApiKey ' + key;
  let response, body;
  try { response = await fetcher(url.toString(), { method:'GET', headers, redirect:'error', signal:AbortSignal.timeout(15000) }); }
  catch (e) { throw providerError(provider, 'Request failed before a response: ' + redact(e?.message || e?.name || 'Network error',env).slice(0,300), { endpoint:path }, e?.name === 'TimeoutError' ? 504 : 502); }
  try { body = await response.json(); }
  catch { throw providerError(provider, 'Provider returned a non-JSON response.', { endpoint:path, upstream_status:response.status }, response.status === 429 ? 429 : 502); }
  if (!response.ok || body?.error) {
    const err = body?.error;
    const code = err?.code ?? body?.code;
    const message = redact(err?.error ?? err?.message ?? (typeof err === 'string' ? err : body?.message ?? 'Provider rejected the request.'),env).slice(0,500);
    const retry = response.headers.get('Retry-After');
    throw providerError(provider, message, { endpoint:path, upstream_status:response.status, upstream_code:code == null ? null : redact(code,env), retry_after:retry }, response.status === 429 || (provider === 'torn' && Number(code) === 5) ? 429 : response.status === 404 ? 404 : 502);
  }
  return clean(body, env);
}
function tornPath(path) {
  // Restrict to official read-only API sections, not arbitrary URLs or redirects.
  const v2 = /^\/v2\/(user|faction|company|market|torn|key|racing|forum|property)(?:\/[a-zA-Z0-9_,\-]+){0,4}$/;
  const v1 = /^\/(user|faction|company|market|torn|key|property)(?:\/[0-9]+)?$/;
  if (!(v2.test(path) || v1.test(path))) throw new ResearchError(400,'INVALID_TORN_PATH','Use an official Torn v1 or v2 API path, such as /v2/faction/46978/members.');
  return path;
}
function kalPath(path) {
  if (!/^\/(?:user\/[1-9]\d*\/(?:loadout|combat-specials)|faction\/[1-9]\d*\/loadouts|ranked-items|items\/(?:k[a-zA-Z0-9_-]{11}|[1-9]\d*)(?:\/history)?|check-key)$/.test(path))
    throw new ResearchError(400,'INVALID_KAL_PATH','Use a documented KAL JSON read endpoint.');
  return path;
}
function idsFrom(raw) {
  const ids = [...new Set(raw.map(String))];
  if (!ids.length || ids.length > 100 || ids.some(id => !positive(id))) throw new ResearchError(400,'INVALID_PLAYER_IDS','Supply 1–100 unique positive Torn player IDs.');
  return ids.map(Number);
}
async function ff(ids, env, fetcher) {
  const rows = await upstream('ffscouter','/api/v1/get-stats',new URLSearchParams({targets:ids.join(',')}),env,fetcher);
  if (!Array.isArray(rows)) throw providerError('ffscouter','Expected an array of player stat estimates.',{endpoint:'/api/v1/get-stats'});
  return rows;
}
const capture = async fn => { try { return { data:await fn() }; } catch(e) { if (!(e instanceof ResearchError)) throw e; return { error:e.toJSON() }; } };
async function faction(id, env, fetcher) {
  const roster = await upstream('torn','/v2/faction/'+id+'/members',new URLSearchParams({striptags:'true'}),env,fetcher);
  if (!Array.isArray(roster?.members)) throw providerError('torn','Faction members response does not contain a members array.',{endpoint:'/v2/faction/'+id+'/members'});
  const ids = roster.members.length ? idsFrom(roster.members.map(m=>m.id)) : [];
  const [stats,loadouts] = await Promise.all([
    ids.length ? capture(()=>ff(ids,env,fetcher)) : {data:[]},
    capture(async()=>{ const data=await upstream('kal','/faction/'+id+'/loadouts',new URLSearchParams(),env,fetcher); if(!Array.isArray(data?.members)) throw providerError('kal','Expected a faction members array.',{endpoint:'/faction/'+id+'/loadouts'}); return data; })
  ]);
  const ffMap = new Map((stats.data || []).map(x=>[Number(x.player_id),x]));
  const kalMap = new Map((loadouts.data?.members || []).map(x=>[Number(x.user_id),x]));
  // KAL stores its own roster. Use Torn as authority; do not silently add departed players.
  // Recover missing members from a lagging KAL roster with a bounded number of
  // requests. This keeps the export within the free Worker subrequest budget.
  const fallbackErrors = new Map();
  const missing = ids.filter(id=>!kalMap.has(id));
  const eligible = !loadouts.error || loadouts.error.upstream_status === 404;
  const candidates = eligible ? missing.slice(0,20) : [];
  for (let i=0;i<candidates.length;i+=4) {
    await Promise.all(candidates.slice(i,i+4).map(async id=>{
      const result=await capture(()=>upstream('kal','/user/'+id+'/loadout',new URLSearchParams(),env,fetcher));
      if (result.data && Number(result.data.user_id) === id && Array.isArray(result.data.equipment)) kalMap.set(id,{loadout:result.data});
      else if (result.error?.upstream_status === 404) kalMap.set(id,{loadout:null});
      else fallbackErrors.set(id,result.error || {provider:'kal',code:'INVALID_LOADOUT',message:'Expected matching player ID and equipment array.'});
    }));
    if ([...fallbackErrors.values()].some(e=>e.upstream_status===429 || e.upstream_code==='20')) break;
  }
  const members = roster.members.map(m=>{
    const stat=ffMap.get(Number(m.id)), entry=kalMap.get(Number(m.id));
    return { player_id:Number(m.id), name:m.name, level:m.level ?? null,
      position:m.position ?? null, status:m.status?.description ?? m.status?.state ?? null,
      stats:stat ?? null, stats_status:stats.error ? 'provider_error' : stat?.bs_estimate != null || stat?.bs_estimate_human ? 'available' : 'no_estimate',
      loadout:entry?.loadout ?? null, loadout_status:entry ? (entry.loadout ? 'available' : 'no_visible_loadout') : fallbackErrors.has(Number(m.id)) || (loadouts.error && !eligible) ? 'provider_error' : 'not_in_kal_roster' };
  });
  return { faction_id:Number(id), faction_name:loadouts.data?.name ?? null, fetched_at:new Date().toISOString(),
    kal_roster_observed_at:loadouts.data?.members_observed_at ?? null, player_ids:ids, members,
    warnings:[stats.error,loadouts.error,...[...fallbackErrors].map(([id,error])=>({...error,player_id:id})), ...(eligible && missing.some(id=>!kalMap.has(id)&&!fallbackErrors.has(id)) ? [{provider:'kal',code:'FALLBACK_LIMIT',message:'Some players were absent from KAL roster and not individually checked; use the single-player route.'}] : [])].filter(Boolean) };
}
export async function researchFetch(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!hex.test(env.RESEARCH_TOKEN_SHA256 || '')) return json({ok:false,error:{code:'RESEARCH_AUTH_NOT_CONFIGURED',message:'Configure RESEARCH_TOKEN_SHA256 to enable research routes.'}},503);
  if (!await authorized(request,env.RESEARCH_TOKEN_SHA256)) return json({ok:false,error:{code:'UNAUTHORIZED',message:'Supply the separate research bearer token.'}},401);
  if (request.method !== 'GET') return json({ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'Research endpoints are read-only; use GET.'}},405);
  const path = url.pathname.slice('/v1/research'.length);
  try {
    if (path === '/health') return json({ok:true,configured:Object.fromEntries(Object.entries(secrets).map(([p,k])=>[p,Boolean(env[k])]))});
    if (path.startsWith('/torn/')) return json(await upstream('torn',tornPath(path.slice(5)),paramsFor(url),env,fetcher));
    if (path.startsWith('/kal/')) return json(await upstream('kal',kalPath(path.slice(4)),paramsFor(url),env,fetcher));
    if (path === '/ffscouter/stats') return json(await ff(idsFrom((url.searchParams.get('ids')||'').split(',')),env,fetcher));
    const match = /^\/faction\/([1-9]\d*)(\/export\.xlsx)?$/.exec(path);
    if (match && positive(match[1])) {
      if (url.search) throw new ResearchError(400,'INVALID_PARAMETER','Faction export accepts only the faction ID in the path.');
      const data=await faction(match[1],env,fetcher);
      if (!match[2]) return json(data);
      return new Response(factionWorkbook(data),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="faction-'+match[1]+'-intelligence.xlsx"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    throw new ResearchError(404,'UNKNOWN_ROUTE','Unknown research endpoint.');
  } catch(e) {
    if (e instanceof ResearchError) return json({ok:false,error:e.toJSON()},e.status);
    return json({ok:false,error:{code:'RESEARCH_INTERNAL_ERROR',message:redact(e?.message || 'Unexpected research processing error',env).slice(0,300)}},500);
  }
}
