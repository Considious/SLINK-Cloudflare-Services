import {WorkError,need} from './model.js';

const PAGE=50, INTERVAL=12*60*60*1000;
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const epoch=v=>id(v);
const root=f=>`factions/${f}/ranked-war-archive/global-v1/`;
const schema=new WeakMap();
async function setup(db){
 if(!schema.has(db))schema.set(db,db.batch([
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_global_state(faction_id INTEGER PRIMARY KEY, cursor TEXT, position INTEGER NOT NULL DEFAULT 0, backfilled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, next_run INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, error TEXT)'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_global_wars(faction_id INTEGER NOT NULL, war_id INTEGER NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(faction_id,war_id))'),
  db.prepare('CREATE INDEX IF NOT EXISTS officer_ranked_global_wars_by_end ON officer_ranked_global_wars(faction_id,ended DESC,war_id DESC)'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_helpers(faction_id INTEGER NOT NULL,user_id INTEGER NOT NULL,credential_id TEXT NOT NULL,PRIMARY KEY(faction_id,user_id))'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_archive_upgrade(version INTEGER PRIMARY KEY)'),
  db.prepare('UPDATE officer_ranked_global_state SET cursor=NULL,position=0,backfilled=0,next_run=0,lease=NULL,lease_until=0,error=NULL WHERE NOT EXISTS(SELECT 1 FROM officer_ranked_archive_upgrade WHERE version=2)'),
  db.prepare('INSERT OR IGNORE INTO officer_ranked_archive_upgrade VALUES(2)'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_calls(user_id INTEGER NOT NULL, at INTEGER NOT NULL)'),
  db.prepare('CREATE INDEX IF NOT EXISTS officer_ranked_calls_user_time ON officer_ranked_calls(user_id,at)'),
  db.prepare('CREATE INDEX IF NOT EXISTS officer_ranked_calls_time ON officer_ranked_calls(at)'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_key_state(credential_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, verified_at INTEGER, position TEXT, blocked_until INTEGER NOT NULL DEFAULT 0, error TEXT)')
 ]).catch(e=>{schema.delete(db);throw e;}));
 await schema.get(db);
}
export function rankedSummary(report){
 const warId=id(report?.id??report?.war_id), start=epoch(report?.start), end=epoch(report?.end);
 const factions=Array.isArray(report?.factions)?report.factions:[];
 const [own,opponent]=factions;
 if(!warId||!start||!end||end<start||factions.length!==2||!id(own?.id)||!id(opponent?.id)||id(own.id)===id(opponent.id))return null;
 const stat=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const winner=typeof report.winner==='object'?id(report.winner?.id):id(report.winner);
 const rank=v=>typeof v==='string'&&v.trim()?v.trim():null;
 const side=f=>({id:id(f.id),name:f.name??null,score:stat(f.score),attacks:stat(f.attacks),members:Array.isArray(f.members)?f.members.length:null,rankBefore:rank(f.rank?.before),rankAfter:rank(f.rank?.after)});
 const a=side(own),b=side(opponent);
 return {warId,start,end,durationSeconds:end-start,factionA:a.name,factionAId:a.id,factionB:b.name,factionBId:b.id,winner:winner===a.id?a.name:winner===b.id?b.name:null,forfeit:typeof report.forfeit==='boolean'?(report.forfeit?'Yes':'No'):null,scoreA:a.score,scoreB:b.score,attacksA:a.attacks,attacksB:b.attacks,membersA:a.members,membersB:b.members,rankBeforeA:a.rankBefore,rankAfterA:a.rankAfter,rankBeforeB:b.rankBefore,rankAfterB:b.rankAfter};
}
function nextCursor(raw,current){
 if(!raw)return null;
 const url=new URL(raw,'https://api.torn.com');
 need(url.origin==='https://api.torn.com'&&url.pathname==='/v2/faction/warfareranked'&&!url.username&&!url.password,'UNSAFE_PAGINATION','Torn returned an unexpected global history link.',503);
 const out={};
 for(const name of ['from','to','offset'])if(url.searchParams.has(name)){
  const value=url.searchParams.get(name);need(/^\d{1,14}$/.test(value),'UNSAFE_PAGINATION','Torn returned an invalid global history cursor.',503);out[name]=Number(value);
 }
 const next={...(current.from!=null?{from:current.from}:{}),to:out.to??current.to,...(out.offset!=null?{offset:out.offset}:{})};
 need(Object.keys(out).length&&next.to<=current.to&&(next.to<current.to||(next.offset??0)>(current.offset??0)),'UNSAFE_PAGINATION','Torn did not advance global history.',503);
 return next;
}
function olderCursor(list,cursor){
 if(!list.length)return null;
 const starts=list.map(row=>epoch(row?.start));
 need(starts.every(Boolean)&&starts.every(start=>start<=cursor.to),'TORN_PAGINATION','Torn did not honor the ranked war history date window.',503);
 const oldest=Math.min(...starts);
 const lower=cursor.from!=null?{from:cursor.from}:{};
 if(oldest===cursor.to){
  need(list.length<PAGE,'TORN_PAGINATION','Torn returned a full ranked war history page at one timestamp without a continuation.',503);
  if(oldest<=1||oldest===cursor.from)return null;
  return {...lower,to:oldest-1};
 }
 return {...lower,to:oldest};
}
export async function readRankedArchive(env,actor,path,params,now=Date.now()){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID),db=env.PERMISSIONS_DB;
 need(factionId&&actor.factionId===factionId,'ARCHIVE_FACTION_REQUIRED','The global archive is restricted to the configured officer faction.',403);await setup(db);
 const detail=path.match(/^\/ranked-archive\/(\d+)$/);
 if(detail){
  const warId=id(detail[1]);
  const row=warId&&await db.prepare('SELECT war_id FROM officer_ranked_global_wars WHERE faction_id=? AND war_id=?').bind(factionId,warId).first();
  need(row,'WAR_NOT_ARCHIVED','That war is not archived for your faction.',404);
  const obj=await env.USER_BACKUPS.get(root(factionId)+warId+'.json');
  need(obj,'ARCHIVE_MISSING','The archived report is temporarily unavailable.',503);
  return obj.json();
 }
 const before=params.get('before'),parts=before?.match(/^(\d+):(\d+)$/);
 need(!before||parts&&id(parts[1])&&id(parts[2]),'INVALID_PAGE','Invalid archive page.');
 const filters=['faction_id=?'],values=[factionId];
 if(parts){filters.push('(ended<? OR (ended=? AND war_id<?))');values.push(Number(parts[1]),Number(parts[1]),Number(parts[2]));}
 const rows=(await db.prepare('SELECT war_id,ended,summary FROM officer_ranked_global_wars WHERE '+filters.join(' AND ')+' ORDER BY ended DESC,war_id DESC LIMIT 101').bind(...values).all()).results;
 const state=await db.prepare('SELECT backfilled,updated_at,error,next_run FROM officer_ranked_global_state WHERE faction_id=?').bind(factionId).first();
 const cutoff=Math.floor(now/1000)-30*86400;
 const to=Math.floor(now/1000);
 const recent=await db.prepare("SELECT count(*) AS wars, sum(CASE WHEN json_extract(summary,'$.forfeit')='Yes' THEN 1 ELSE 0 END) AS forfeits, avg(abs(json_extract(summary,'$.scoreA')-json_extract(summary,'$.scoreB'))) AS averageScoreMargin FROM officer_ranked_global_wars WHERE faction_id=? AND ended>=? AND ended<=?").bind(factionId,cutoff,to).first();
 const last=rows[99];
 return {rows:rows.slice(0,100).map(r=>JSON.parse(r.summary)),next:rows.length>100?`${last.ended}:${last.war_id}`:null,updatedAt:state?.updated_at??null,backfilled:Boolean(state?.backfilled),paused:Boolean(state?.error),errorCode:state?.error??null,retryAt:state?.error?state.next_run||null:null,analysis:{from:cutoff,to,wars:recent.wars,forfeits:recent.forfeits??0,averageScoreMargin:recent.averageScoreMargin,coverageComplete:Boolean(state?.backfilled&&!state?.error&&now-state.updated_at<INTERVAL+60*60000)}};
}
export async function rankedHelp(env,actor,credential,enabled){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID),db=env.PERMISSIONS_DB;
 need(factionId&&actor.factionId===factionId,'ARCHIVE_FACTION_REQUIRED','Backfill assistance is restricted to the archive faction.',403);
 await setup(db);
 if(enabled===true){
  need(credential&&!credential.startsWith('session-'),'SAVED_KEY_REQUIRED','Save an encrypted Officer Work key before volunteering.',400);
  await db.prepare('INSERT INTO officer_ranked_helpers VALUES(?,?,?) ON CONFLICT(faction_id,user_id) DO UPDATE SET credential_id=excluded.credential_id').bind(factionId,actor.userId,credential).run();
 }else if(enabled===false)await db.prepare('DELETE FROM officer_ranked_helpers WHERE faction_id=? AND user_id=?').bind(factionId,actor.userId).run();
 const row=await db.prepare('SELECT credential_id FROM officer_ranked_helpers WHERE faction_id=? AND user_id=?').bind(factionId,actor.userId).first();
 return {enabled:Boolean(row)};
}
export async function collectRankedArchive(env,deps,now=Date.now()){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID),primary=env.RANKED_ARCHIVE_CREDENTIAL_ID;
 if(env.RANKED_ARCHIVE_ENABLED!=='true'||!factionId||!primary)return;
 // Standalone callers can run one slice; the Worker supplies the consented pool.
 if(!deps.pool)return collectSlice(env,deps,now,primary);
 const db=env.PERMISSIONS_DB;await setup(db);
 const state=await db.prepare('SELECT backfilled,next_run FROM officer_ranked_global_state WHERE faction_id=?').bind(factionId).first();
 if(state?.next_run>now)return;
 const pool=await deps.pool(factionId,primary,Boolean(state?.backfilled));
 await db.prepare('DELETE FROM officer_ranked_calls WHERE at<=?').bind(Date.now()-60000).run();
 if(!pool.length){
  await db.prepare("INSERT INTO officer_ranked_global_state(faction_id,next_run,error) VALUES(?,?,'ARCHIVE_NO_CREDENTIAL') ON CONFLICT(faction_id) DO UPDATE SET next_run=excluded.next_run,error=excluded.error WHERE lease_until<=?").bind(factionId,now+300000,Date.now()).run();
 }
 for(const entry of pool){
  const outcome=await collectSlice(env,deps,now,entry.id,true);
  if(outcome==='stop')break;
 }
}
async function collectSlice(env,{verify,request,clean},now,credentialId,pooled=false){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID);
 if(env.RANKED_ARCHIVE_ENABLED!=='true'||!factionId||!credentialId)return;
 const db=env.PERMISSIONS_DB;await setup(db);
 await db.prepare('INSERT OR IGNORE INTO officer_ranked_global_state(faction_id) VALUES(?)').bind(factionId).run();
 const lease=crypto.randomUUID();
 const leaseTime=pooled?Date.now():now;
 const state=await db.prepare('UPDATE officer_ranked_global_state SET lease=?,lease_until=? WHERE faction_id=? AND next_run<=? AND lease_until<=? RETURNING *').bind(lease,leaseTime+300000,factionId,now,leaseTime).first();
 if(!state)return 'stop';
 try{
  const limitedRequest=pooled?async(key,userId,path,params)=>{
   const at=Date.now();
   const slot=await db.prepare('INSERT INTO officer_ranked_calls(user_id,at) SELECT ?,? WHERE (SELECT count(*) FROM officer_ranked_calls WHERE user_id=? AND at>?)<5 RETURNING at').bind(userId,at,userId,at-60000).first();
   if(!slot)throw new WorkError('ARCHIVE_MINUTE_BUDGET','Ranked War archive has used this officer’s rolling minute allowance.',429);
   return request(key,userId,path,params);
  }:request;
  const verified=await verify(credentialId,factionId,limitedRequest);
  if(verified.blockedUntil){
   await db.prepare('UPDATE officer_ranked_global_state SET lease=NULL,lease_until=0,error=? WHERE faction_id=? AND lease=?').bind(verified.error,factionId,lease).run();
   return;
  }
  const {actor,key}=verified;
  need(actor.factionId===factionId,'FACTION_CHANGED','The archive credential does not match the archive faction.',403);
  const cursor=state.cursor?JSON.parse(state.cursor):{to:Math.floor(now/1000),...(state.backfilled?{from:Math.floor(now/1000)-30*86400}:{})};
  const history=await limitedRequest(key,actor.userId,'/v2/faction/warfareranked',{...cursor,sort:'DESC',limit:PAGE});
  const list=history.data?.warfareranked;
  need(Array.isArray(list)&&list.length<=PAGE,'TORN_SCHEMA','Torn returned an invalid ranked war history page.',503);
  need(list.length||!history.data?._metadata?.links?.next,'TORN_SCHEMA','Torn returned an empty page with a continuation.',503);
  let position=state.position,nextPage=cursor,backfilled=state.backfilled,next=pooled&&!state.backfilled?now:now+60000,checked=0;
  while(position<list.length&&checked<4-(verified.verificationCalls??2)){
   const listing=list[position],warId=id(listing?.id??listing?.war_id);
   need(warId,'TORN_SCHEMA','Torn returned a war without an ID.',503);
   if(!epoch(listing.end)){position++;continue;}
   const existing=await db.prepare('SELECT war_id FROM officer_ranked_global_wars WHERE faction_id=? AND war_id=?').bind(factionId,warId).first();
   if(!existing){
    checked++;
    const report=await limitedRequest(key,actor.userId,`/v2/faction/${warId}/rankedwarreport`,{});
    const summary=rankedSummary(report.data?.rankedwarreport);
    need(summary?.warId===warId,'TORN_SCHEMA','Torn returned a mismatched or incomplete ranked war report.',503);
    await env.USER_BACKUPS.put(root(factionId)+warId+'.json',JSON.stringify(clean({schema:1,warId,factionId,observedAt:report.observedAt,listing,report:report.data},key)),{httpMetadata:{contentType:'application/json'}});
    await db.prepare('INSERT INTO officer_ranked_global_wars(faction_id,war_id,started,ended,summary) VALUES(?,?,?,?,?) ON CONFLICT(faction_id,war_id) DO UPDATE SET started=excluded.started,ended=excluded.ended,summary=excluded.summary').bind(factionId,warId,summary.start,summary.end,JSON.stringify(summary)).run();
   }
   position++;
   if(!existing)await db.prepare('UPDATE officer_ranked_global_state SET cursor=?,position=? WHERE faction_id=? AND lease=?').bind(JSON.stringify(cursor),position,factionId,lease).run();
  }
  if(position>=list.length){
   nextPage=nextCursor(history.data?._metadata?.links?.next,cursor)||olderCursor(list,cursor);
   position=0;
   if(!nextPage){backfilled=1;next=now+INTERVAL;}
  }
  await db.prepare('UPDATE officer_ranked_global_state SET cursor=?,position=?,backfilled=?,updated_at=?,next_run=?,lease=NULL,lease_until=0,error=NULL WHERE faction_id=? AND lease=?').bind(nextPage?JSON.stringify(nextPage):null,position,backfilled,now,next,factionId,lease).run();
  if(next>now)return 'stop';
 }catch(error){
  if(error?.code==='ARCHIVE_MINUTE_BUDGET'){
   await db.prepare('UPDATE officer_ranked_global_state SET lease=NULL,lease_until=0 WHERE faction_id=? AND lease=?').bind(factionId,lease).run();
   return;
  }
  const delay=Math.max(300000,Number(error?.retryAfter||0)*1000,error?.status===403?3600000:0);
  const code=error instanceof WorkError?error.code:'ARCHIVE_RETRY';
  const keyFailure=pooled&&(error?.status===403||error?.status===401||error?.status===429||['TORN_5','RATE_BUDGET'].includes(error?.code));
  if(keyFailure)await db.prepare('INSERT INTO officer_ranked_key_state(credential_id,revision,blocked_until,error) SELECT id,updated_at,?,? FROM officer_work_credentials WHERE id=? ON CONFLICT(credential_id) DO UPDATE SET revision=excluded.revision,verified_at=NULL,blocked_until=excluded.blocked_until,error=excluded.error').bind(Date.now()+delay,error.code||'ARCHIVE_RETRY',credentialId).run();
  await db.prepare('UPDATE officer_ranked_global_state SET next_run=?,lease=NULL,lease_until=0,error=? WHERE faction_id=? AND lease=?').bind(keyFailure?now:now+delay,code,factionId,lease).run();
  console.warn('Ranked War archive paused',{factionId,code,retryAt:new Date(Date.now()+delay).toISOString()});
  if(!keyFailure)return 'stop';
 }
}
