import { factionWorkbook } from './faction-workbook.js';

const hex = /^[a-f0-9]{64}$/;
const secrets = { torn: 'TORN_API_KEY', kal: 'KAL_API_KEY', ffscouter: 'FFSCOUTER_API_KEY', tornstats: 'TORNSTATS_API_KEY' };
const hosts = { torn: 'https://api.torn.com', kal: 'https://api.kalends.dev', ffscouter: 'https://ffscouter.com', tornstats: 'https://www.tornstats.com' };
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
  const url = new URL(provider==='tornstats' ? '/api/v2/'+encodeURIComponent(key)+path : path, hosts[provider]);
  url.search = params.toString();
  const headers = { Accept: 'application/json' };
  if (provider === 'tornstats') { /* Credential is in the documented path. */ }
  else if (provider === 'ffscouter' || (provider === 'torn' && !path.startsWith('/v2/'))) url.searchParams.set('key',key);
  else headers.Authorization = 'ApiKey ' + key;
  let response, body;
  try { response = await fetcher(url.toString(), { method:'GET', headers, redirect:'manual', signal:AbortSignal.timeout(15000) }); }
  catch (e) { throw providerError(provider, 'Request failed before a response: ' + redact(e?.message || e?.name || 'Network error',env).slice(0,300), { endpoint:path }, e?.name === 'TimeoutError' ? 504 : 502); }
  // Workers supports manual/follow, not redirect:'error'. Never forward credentials
  // to a redirect destination, even when the provider changes its URL.
  if (response.status >= 300 && response.status < 400) {
    throw providerError(provider, 'Provider returned a redirect; request stopped to protect credentials. Check the configured provider endpoint.', { endpoint:path, upstream_status:response.status, upstream_origin:hosts[provider] });
  }
  try { body = await response.json(); }
  catch { throw providerError(provider, 'Provider returned a non-JSON response.', { endpoint:path, upstream_status:response.status }, response.status === 429 ? 429 : 502); }
  if (!response.ok || body?.error || (provider==='tornstats' && body?.status===false)) {
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

const weapons=loadout=>(loadout?.equipment||[]).filter(x=>['primary','secondary','melee'].includes(String(x.slot_name).toLowerCase())||[1,2,3].includes(Number(x.slot)));
const pillowOnly=loadout=>{const items=weapons(loadout);return items.length===1 && String(items[0].name).trim().toLowerCase()==='pillow';};
const hasCombatWeapon=loadout=>weapons(loadout).some(x=>x.name && String(x.name).trim().toLowerCase()!=='pillow');
const timestamp=v=>{const n=Number(v);if(Number.isFinite(n)&&n>0)return n>=1e12?n/1000:n;if(typeof v!=='string'||!v)return 0;const parsed=Date.parse(v);return Number.isFinite(parsed)?parsed/1000:0;};
const numeric=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Number(v):null;
const objectRows=v=>Array.isArray(v)?v:v&&typeof v==='object'?Object.entries(v).filter(([,x])=>x&&typeof x==='object').map(([id,x])=>({...x,id:x.id??id})):null;
async function getWarHistory(id,env,fetcher) {
  const warnings=[];
  const list=await capture(()=>upstream('torn','/v2/faction/'+id+'/rankedwars',new URLSearchParams({limit:'20'}),env,fetcher));
  if(list.error)return {wars:[],warnings:[list.error]};
  const rows=objectRows(list.data?.rankedwars);
  if(!rows)return {wars:[],warnings:[{provider:'torn',code:'INVALID_WAR_HISTORY',message:'Expected rankedwars array or object.'}]};
  const wars=rows.map(x=>({id:Number(x.war_id??x.id),end:timestamp(x.end??x.war?.end),opponent:objectRows(x.factions)?.find(f=>Number(f.id)!==Number(id))?.name??null}))
    .filter(x=>positive(x.id)&&x.end>0&&x.end<=Date.now()/1000).sort((a,b)=>b.end-a.end||b.id-a.id);
  const selected=[...new Map(wars.map(x=>[x.id,x])).values()].slice(0,6);
  for(let i=0;i<selected.length;i+=3){
    await Promise.all(selected.slice(i,i+3).map(async war=>{
      const result=await capture(()=>upstream('torn','/v2/faction/'+war.id+'/rankedwarreport',new URLSearchParams(),env,fetcher));
      if(result.error){warnings.push({...result.error,war_id:war.id});return;}
      const report=result.data?.rankedwarreport;
      const sides=objectRows(report?.factions);
      const side=sides?.find(x=>Number(x.id??x.faction_id)===Number(id));
      const members=objectRows(side?.members);
      if(!members){warnings.push({provider:'torn',code:'INVALID_WAR_REPORT',message:'Expected target faction and member scores in ranked war report.',war_id:war.id});return;}
      war.scores=Object.fromEntries(members.filter(x=>positive(x.id??x.player_id??x.user_id)).map(x=>[Number(x.id??x.player_id??x.user_id),numeric(x.score)]));
      war.opponent=sides.find(x=>Number(x.id??x.faction_id)!==Number(id))?.name??war.opponent;
    }));
    if(warnings.some(e=>e.upstream_status===429||e.upstream_code==='5'))break;
  }
  return {wars:selected,warnings};
}
async function getSpies(id,env,fetcher){
  const data=await upstream('tornstats','/spy/faction/'+id,new URLSearchParams(),env,fetcher);
  const faction=data?.faction;
  const rows=objectRows(data?.members??faction?.members);
  if(!rows || (faction?.ID!=null&&Number(faction.ID)!==Number(id)))throw providerError('tornstats','Expected matching faction and members in Torn Stats spy response.',{endpoint:'/spy/faction/'+id});
  return Object.fromEntries(rows.filter(m=>positive(m.id)&&m.spy&&m.spy.status!==false).map(m=>{
    const s=m.spy, total=numeric(s.total);
    return [Number(m.id),{total:total!==null&&total>=0?total:null,timestamp:timestamp(s.timestamp??m.timestamp)||null}];
  }));
}
// Keep the existing JSON API lean; enrich the Excel export only.
// 3 base requests + up to 20 missing KAL + 8 spy/war requests + 16 pillow requests
// = 47 upstream requests, leaving room for R2 on the free Worker limit.
async function enrichExport(report,env,fetcher){
  const [history,spies]=await Promise.all([
    getWarHistory(report.faction_id,env,fetcher),
    capture(()=>getSpies(report.faction_id,env,fetcher))
  ]);
  report.wars=history.wars;
  report.warnings.push(...history.warnings,...[spies.error].filter(Boolean));
  for(const m of report.members){
    m.spy=spies.data?.[m.player_id]??null;
    m.war_scores=history.wars.map(w=>w.scores?.[m.player_id]??null);
  }
  const candidates=report.members.filter(m=>pillowOnly(m.loadout));
  if(candidates.length>8)report.warnings.push({provider:'kal',code:'PILLOW_HISTORY_LIMIT',message:'Only the first eight pillow-only loadouts were checked in this export.'});
  for(const m of candidates.slice(0,8)){
    const path='/user/'+m.player_id+'/loadout';
    let latest=m.loadout;
    if(!latest.pagination?.next_cursor){
      const res=await capture(()=>upstream('kal',path,new URLSearchParams(),env,fetcher));
      if(res.error){report.warnings.push({...res.error,player_id:m.player_id});if(res.error.upstream_status===429||res.error.upstream_code==='20')break;continue;}
      if(Number(res.data?.user_id)!==m.player_id||!Array.isArray(res.data?.equipment)){report.warnings.push({provider:'kal',code:'INVALID_LOADOUT',message:'Expected matching player and equipment.',player_id:m.player_id});continue;}
      latest=res.data;
      if(!pillowOnly(latest)){if(timestamp(latest.observed_at)>=timestamp(m.loadout.observed_at))m.loadout=latest;continue;}
      if(timestamp(latest.observed_at)>=timestamp(m.loadout.observed_at))m.loadout=latest;
    }
    const cursor=latest.pagination?.next_cursor;
    if(typeof cursor!=='string'||!cursor)continue;
    const older=await capture(()=>upstream('kal',path,new URLSearchParams({cursor}),env,fetcher));
    if(older.error){report.warnings.push({...older.error,player_id:m.player_id});if(older.error.upstream_status===429||older.error.upstream_code==='20')break;continue;}
    if(Number(older.data?.user_id)===m.player_id&&hasCombatWeapon(older.data)&&timestamp(older.data.observed_at)>0&&timestamp(older.data.observed_at)<timestamp(latest.observed_at)){
      m.latest_loadout=latest;m.loadout=older.data;m.historical_loadout=true;
      report.warnings.push({provider:'kal',code:'HISTORICAL_LOADOUT',message:'Latest observed weapon was a pillow; displayed the next older observed combat loadout.',player_id:m.player_id});
    }
  }
  return report;
}

export async function researchFetch(request, env, fetcher = fetch) {
  const url = new URL(request.url);
  if (!hex.test(env.RESEARCH_TOKEN_SHA256 || '')) return json({ok:false,error:{code:'RESEARCH_AUTH_NOT_CONFIGURED',message:'Configure RESEARCH_TOKEN_SHA256 to enable research routes.'}},503);
  if (!await authorized(request,env.RESEARCH_TOKEN_SHA256)) return json({ok:false,error:{code:'UNAUTHORIZED',message:'Supply the separate research bearer token.'}},401);
  if (request.method !== 'GET') return json({ok:false,error:{code:'METHOD_NOT_ALLOWED',message:'Research endpoints are read-only; use GET.'}},405);
  return researchRoute(url, env, fetcher);
}

// Internal entry point: callers must authenticate before invoking this function.
// Only the HTTP handler and Cloudflare Workflow entry point call it.
export async function researchRoute(url, env, fetcher = fetch) {
  const path = url.pathname.slice('/v1/research'.length);
  try {
    if (path === '/health') return json({ok:true,configured:Object.fromEntries(Object.entries(secrets).map(([p,k])=>[p,Boolean(env[k])]))});
    if (path.startsWith('/torn/')) return json(await upstream('torn',tornPath(path.slice(5)),paramsFor(url),env,fetcher));
    if (path.startsWith('/kal/')) return json(await upstream('kal',kalPath(path.slice(4)),paramsFor(url),env,fetcher));
    if (path === '/ffscouter/stats') return json(await ff(idsFrom((url.searchParams.get('ids')||'').split(',')),env,fetcher));
    const match = /^\/faction\/([1-9]\d*)(\/export\.xlsx)?$/.exec(path);
    if (match && positive(match[1])) {
      if (url.search && (!match[2] || url.searchParams.size !== 1 || !['true','false'].includes(url.searchParams.get('images')))) throw new ResearchError(400,'INVALID_PARAMETER','Only the Excel export supports the optional images=true or images=false query parameter.');
      const data=await faction(match[1],env,fetcher);
      if (!match[2]) return json(data);
      return new Response(factionWorkbook(await enrichExport(data,env,fetcher)),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="faction-'+match[1]+'-intelligence.xlsx"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    throw new ResearchError(404,'UNKNOWN_ROUTE','Unknown research endpoint.');
  } catch(e) {
    if (e instanceof ResearchError) return json({ok:false,error:e.toJSON()},e.status);
    return json({ok:false,error:{code:'RESEARCH_INTERNAL_ERROR',message:redact(e?.message || 'Unexpected research processing error',env).slice(0,300)}},500);
  }
}
