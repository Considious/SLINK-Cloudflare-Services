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
  db.prepare('CREATE INDEX IF NOT EXISTS officer_ranked_global_wars_by_end ON officer_ranked_global_wars(faction_id,ended DESC,war_id DESC)')
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
 need(Object.keys(out).length&&JSON.stringify(out)!==JSON.stringify(current),'UNSAFE_PAGINATION','Torn did not advance global history.',503);
 return out;
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
 const state=await db.prepare('SELECT backfilled,updated_at,error FROM officer_ranked_global_state WHERE faction_id=?').bind(factionId).first();
 const cutoff=Math.floor(now/1000)-30*86400;
 const to=Math.floor(now/1000);
 const recent=await db.prepare("SELECT count(*) AS wars, sum(CASE WHEN json_extract(summary,'$.forfeit')='Yes' THEN 1 ELSE 0 END) AS forfeits, avg(abs(json_extract(summary,'$.scoreA')-json_extract(summary,'$.scoreB'))) AS averageScoreMargin FROM officer_ranked_global_wars WHERE faction_id=? AND ended>=? AND ended<=?").bind(factionId,cutoff,to).first();
 const last=rows[99];
 return {rows:rows.slice(0,100).map(r=>JSON.parse(r.summary)),next:rows.length>100?`${last.ended}:${last.war_id}`:null,updatedAt:state?.updated_at??null,backfilled:Boolean(state?.backfilled),paused:Boolean(state?.error),analysis:{from:cutoff,to,wars:recent.wars,forfeits:recent.forfeits??0,averageScoreMargin:recent.averageScoreMargin,coverageComplete:Boolean(state?.backfilled&&!state?.error&&now-state.updated_at<INTERVAL+60*60000)}};
}
export async function collectRankedArchive(env,{verify,request,clean},now=Date.now()){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID),credentialId=env.RANKED_ARCHIVE_CREDENTIAL_ID;
 if(env.RANKED_ARCHIVE_ENABLED!=='true'||!factionId||!credentialId)return;
 const db=env.PERMISSIONS_DB;await setup(db);
 await db.prepare('INSERT OR IGNORE INTO officer_ranked_global_state(faction_id) VALUES(?)').bind(factionId).run();
 const lease=crypto.randomUUID();
 const state=await db.prepare('UPDATE officer_ranked_global_state SET lease=?,lease_until=? WHERE faction_id=? AND next_run<=? AND lease_until<=? RETURNING *').bind(lease,now+300000,factionId,now,now).first();
 if(!state)return;
 try{
  const verified=await verify(credentialId,factionId);
  const {actor,key}=verified;
  need(actor.factionId===factionId,'FACTION_CHANGED','The archive credential does not match the archive faction.',403);
  const cursor=state.cursor?JSON.parse(state.cursor):{to:Math.floor(now/1000),...(state.backfilled?{from:Math.floor(now/1000)-30*86400}:{})};
  const history=await request(key,actor.userId,'/v2/faction/warfareranked',{...cursor,sort:'DESC',limit:PAGE});
  const list=history.data?.warfareranked;
  need(Array.isArray(list)&&list.length<=PAGE,'TORN_SCHEMA','Torn returned an invalid ranked war history page.',503);
  need(list.length||!history.data?._metadata?.links?.next,'TORN_SCHEMA','Torn returned an empty page with a continuation.',503);
  let position=state.position,nextPage=cursor,backfilled=state.backfilled,next=now+60000,checked=0;
  // At most five Torn calls per scheduled slice: two credential checks,
  // one history page and two reports. A single leased slice runs at a time.
  while(position<list.length&&checked<2){
   const listing=list[position],warId=id(listing?.id??listing?.war_id);
   need(warId,'TORN_SCHEMA','Torn returned a war without an ID.',503);
   if(!epoch(listing.end)){position++;continue;}
   const existing=await db.prepare('SELECT war_id FROM officer_ranked_global_wars WHERE faction_id=? AND war_id=?').bind(factionId,warId).first();
   if(!existing){
    checked++;
    const report=await request(key,actor.userId,`/v2/faction/${warId}/rankedwarreport`,{});
    const summary=rankedSummary(report.data?.rankedwarreport);
    need(summary?.warId===warId,'TORN_SCHEMA','Torn returned a mismatched or incomplete ranked war report.',503);
    await env.USER_BACKUPS.put(root(factionId)+warId+'.json',JSON.stringify(clean({schema:1,warId,factionId,observedAt:report.observedAt,listing,report:report.data},key)),{httpMetadata:{contentType:'application/json'}});
    await db.prepare('INSERT INTO officer_ranked_global_wars(faction_id,war_id,started,ended,summary) VALUES(?,?,?,?,?) ON CONFLICT(faction_id,war_id) DO UPDATE SET started=excluded.started,ended=excluded.ended,summary=excluded.summary').bind(factionId,warId,summary.start,summary.end,JSON.stringify(summary)).run();
   }
   position++;
  }
  if(position>=list.length){
   nextPage=nextCursor(history.data?._metadata?.links?.next,cursor);
   position=0;
   if(!nextPage){backfilled=1;next=now+INTERVAL;}
   else if(backfilled&&cursor.from!=null)nextPage={...nextPage,from:cursor.from};
  }
  await db.prepare('UPDATE officer_ranked_global_state SET cursor=?,position=?,backfilled=?,updated_at=?,next_run=?,lease=NULL,lease_until=0,error=NULL WHERE faction_id=? AND lease=?').bind(nextPage?JSON.stringify(nextPage):null,position,backfilled,now,next,factionId,lease).run();
 }catch(error){
  const delay=Math.max(300000,Number(error?.retryAfter||0)*1000,error?.status===403?3600000:0);
  await db.prepare('UPDATE officer_ranked_global_state SET next_run=?,lease=NULL,lease_until=0,error=? WHERE faction_id=? AND lease=?').bind(now+delay,error instanceof WorkError?error.code:'ARCHIVE_RETRY',factionId,lease).run();
 }
}
