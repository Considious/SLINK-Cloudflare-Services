import {WorkError,need} from './model.js';

const PAGE=50, INTERVAL=12*60*60*1000;
const id=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const epoch=v=>id(v);
const root=f=>`factions/${f}/ranked-war-archive/v1/`;
const schema=new WeakMap();
async function setup(db){
 if(!schema.has(db))schema.set(db,db.batch([
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_state(faction_id INTEGER PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0, backfilled INTEGER NOT NULL DEFAULT 0, updated_at INTEGER, next_run INTEGER NOT NULL DEFAULT 0, lease TEXT, lease_until INTEGER NOT NULL DEFAULT 0, error TEXT)'),
  db.prepare('CREATE TABLE IF NOT EXISTS officer_ranked_wars(faction_id INTEGER NOT NULL, war_id INTEGER NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL, summary TEXT NOT NULL, PRIMARY KEY(faction_id,war_id))'),
  db.prepare('CREATE INDEX IF NOT EXISTS officer_ranked_wars_by_end ON officer_ranked_wars(faction_id,ended DESC,war_id DESC)')
 ]).catch(e=>{schema.delete(db);throw e;}));
 await schema.get(db);
}
export function rankedSummary(report,factionId){
 const warId=id(report?.id??report?.war_id), start=epoch(report?.start), end=epoch(report?.end);
 const factions=Array.isArray(report?.factions)?report.factions:[];
 const own=factions.find(f=>id(f.id)===factionId),opponent=factions.find(f=>id(f.id)!==factionId);
 if(!warId||!start||!end||end<start||!own||!opponent)return null;
 const stat=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
 const winner=typeof report.winner==='object'?id(report.winner?.id):id(report.winner);
 const result=winner===factionId?'Win':winner===id(opponent.id)?'Loss':null;
 return {warId,start,end,durationSeconds:end-start,opponentId:id(opponent.id),opponent:opponent.name??null,result,forfeit:typeof report.forfeit==='boolean'?(report.forfeit?'Yes':'No'):null,score:stat(own.score),opponentScore:stat(opponent.score),ownAttacks:stat(own.attacks),opponentAttacks:stat(opponent.attacks),ownMembers:Array.isArray(own.members)?own.members.length:null,opponentMembers:Array.isArray(opponent.members)?opponent.members.length:null};
}
export function recentAnalysis(rows,now,coverageComplete){
 const to=Math.floor(now/1000),from=to-30*86400;
 const recent=rows.filter(r=>r.end>=from&&r.end<=to),wins=recent.filter(r=>r.result==='Win').length,losses=recent.filter(r=>r.result==='Loss').length;
 const margins=recent.filter(r=>r.score!==null&&r.opponentScore!==null).map(r=>r.score-r.opponentScore);
 return {from,to,coverageComplete,wars:recent.length,wins,losses,unknown:recent.length-wins-losses,winRate:wins+losses?wins/(wins+losses):null,averageScoreMargin:margins.length?margins.reduce((a,b)=>a+b,0)/margins.length:null};
}
export async function readRankedArchive(env,actor,path,params,now=Date.now()){
 const factionId=actor.factionId,db=env.PERMISSIONS_DB;await setup(db);
 const detail=path.match(/^\/ranked-archive\/(\d+)$/);
 if(detail){
  const warId=id(detail[1]);
  const row=warId&&await db.prepare('SELECT war_id FROM officer_ranked_wars WHERE faction_id=? AND war_id=?').bind(factionId,warId).first();
  need(row,'WAR_NOT_ARCHIVED','That war is not archived for your faction.',404);
  const obj=await env.USER_BACKUPS.get(root(factionId)+warId+'.json');
  need(obj,'ARCHIVE_MISSING','The archived report is temporarily unavailable.',503);
  return obj.json();
 }
 const before=params.get('before'),parts=before?.match(/^(\d+):(\d+)$/);
 need(!before||parts&&id(parts[1])&&id(parts[2]),'INVALID_PAGE','Invalid archive page.');
 const filters=['faction_id=?'],values=[factionId];
 if(parts){filters.push('(ended<? OR (ended=? AND war_id<?))');values.push(Number(parts[1]),Number(parts[1]),Number(parts[2]));}
 const rows=(await db.prepare('SELECT war_id,ended,summary FROM officer_ranked_wars WHERE '+filters.join(' AND ')+' ORDER BY ended DESC,war_id DESC LIMIT 101').bind(...values).all()).results;
 const state=await db.prepare('SELECT backfilled,updated_at,error FROM officer_ranked_state WHERE faction_id=?').bind(factionId).first();
 const cutoff=Math.floor(now/1000)-30*86400;
 const recent=(await db.prepare('SELECT summary FROM officer_ranked_wars WHERE faction_id=? AND ended>=? AND ended<=?').bind(factionId,cutoff,Math.floor(now/1000)).all()).results;
 const last=rows[99];
 return {rows:rows.slice(0,100).map(r=>JSON.parse(r.summary)),next:rows.length>100?`${last.ended}:${last.war_id}`:null,updatedAt:state?.updated_at??null,backfilled:Boolean(state?.backfilled),paused:Boolean(state?.error),analysis:recentAnalysis(recent.map(r=>JSON.parse(r.summary)),now,Boolean(state?.backfilled&&!state?.error&&now-state.updated_at<INTERVAL+60*60000))};
}
export async function collectRankedArchive(env,{verify,request,clean},now=Date.now()){
 const factionId=id(env.RANKED_ARCHIVE_FACTION_ID),credentialId=env.RANKED_ARCHIVE_CREDENTIAL_ID;
 if(env.RANKED_ARCHIVE_ENABLED!=='true'||!factionId||!credentialId)return;
 const db=env.PERMISSIONS_DB;await setup(db);
 await db.prepare('INSERT OR IGNORE INTO officer_ranked_state(faction_id) VALUES(?)').bind(factionId).run();
 const lease=crypto.randomUUID();
 const state=await db.prepare('UPDATE officer_ranked_state SET lease=?,lease_until=? WHERE faction_id=? AND next_run<=? AND lease_until<=? RETURNING *').bind(lease,now+300000,factionId,now,now).first();
 if(!state)return;
 try{
  const verified=await verify(credentialId,factionId);
  const {actor,key}=verified;
  need(actor.factionId===factionId,'FACTION_CHANGED','The archive credential does not match the archive faction.',403);
  const history=await request(key,actor.userId,'/v2/faction/rankedwars',{offset:state.offset,limit:PAGE});
  const list=history.data?.rankedwars;
  need(Array.isArray(list)&&list.length<=PAGE,'TORN_SCHEMA','Torn returned an invalid ranked war history page.',503);
  need(list.length||!history.data?._metadata?.links?.next,'TORN_SCHEMA','Torn returned an empty page with a continuation.',503);
  let position=state.position,offset=state.offset,backfilled=state.backfilled,next=now+60000,checked=0;
  while(position<list.length&&checked<2){
   const listing=list[position],warId=id(listing?.id??listing?.war_id);
   need(warId,'TORN_SCHEMA','Torn returned a war without an ID.',503);
   if(!epoch(listing.end)){position++;continue;}
   const existing=await db.prepare('SELECT war_id FROM officer_ranked_wars WHERE faction_id=? AND war_id=?').bind(factionId,warId).first();
   if(existing&&backfilled&&state.offset===0&&position>=5){position=list.length;next=now+INTERVAL;break;}
   if(!existing||backfilled&&state.offset===0&&position<5){
    checked++;
    const report=await request(key,actor.userId,`/v2/faction/${warId}/rankedwarreport`,{});
    const summary=rankedSummary(report.data?.rankedwarreport,factionId);
    need(summary?.warId===warId,'TORN_SCHEMA','Torn returned a mismatched or incomplete ranked war report.',503);
    await env.USER_BACKUPS.put(root(factionId)+warId+'.json',JSON.stringify(clean({schema:1,warId,factionId,observedAt:report.observedAt,listing,report:report.data},key)),{httpMetadata:{contentType:'application/json'}});
    await db.prepare('INSERT INTO officer_ranked_wars(faction_id,war_id,started,ended,summary) VALUES(?,?,?,?,?) ON CONFLICT(faction_id,war_id) DO UPDATE SET started=excluded.started,ended=excluded.ended,summary=excluded.summary').bind(factionId,warId,summary.start,summary.end,JSON.stringify(summary)).run();
   }
   position++;
  }
  if(next===now+INTERVAL||position>=list.length&&!history.data?._metadata?.links?.next&&list.length<PAGE){
   offset=0;position=0;backfilled=1;next=now+INTERVAL;
  }else if(position>=list.length){offset+=list.length;position=0;}
  await db.prepare('UPDATE officer_ranked_state SET offset=?,position=?,backfilled=?,updated_at=?,next_run=?,lease=NULL,lease_until=0,error=NULL WHERE faction_id=? AND lease=?').bind(offset,position,backfilled,now,next,factionId,lease).run();
 }catch(error){
  const delay=Math.max(300000,Number(error?.retryAfter||0)*1000,error?.status===403?3600000:0);
  await db.prepare('UPDATE officer_ranked_state SET next_run=?,lease=NULL,lease_until=0,error=? WHERE faction_id=? AND lease=?').bind(now+delay,error instanceof WorkError?error.code:'ARCHIVE_RETRY',factionId,lease).run();
 }
}
