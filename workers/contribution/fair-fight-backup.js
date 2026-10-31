const PREFIX='/api/fair-fight/backup/';
const UPSERT=`INSERT INTO fair_fight_backup(player_id,bs_estimate,bss_public,source,ff_last_updated,slink_observed_at,updated_at)
 SELECT json_extract(value,'$.player_id'),json_extract(value,'$.bs_estimate'),json_extract(value,'$.bss_public'),'ffscouter-bss',json_extract(value,'$.ff_last_updated'),json_extract(value,'$.slink_observed_at'),?2
 FROM json_each(?1) WHERE true
 ON CONFLICT(player_id) DO UPDATE SET bs_estimate=excluded.bs_estimate,bss_public=excluded.bss_public,ff_last_updated=excluded.ff_last_updated,slink_observed_at=excluded.slink_observed_at,updated_at=excluded.updated_at
 WHERE excluded.ff_last_updated > fair_fight_backup.ff_last_updated`;
const SELECT=`SELECT player_id,bs_estimate,bss_public,source,ff_last_updated,slink_observed_at FROM fair_fight_backup WHERE player_id IN (SELECT value FROM json_each(?1))`;
function numeric(value,max){return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;}
function validate(row,now){
 if(!row||Object.keys(row).some(k=>!['player_id','bs_estimate','bss_public','source','ff_last_updated','slink_observed_at'].includes(k)))return null;
 if(row.source!=='ffscouter-bss'||!numeric(row.player_id,999999999)||!Number.isSafeInteger(row.player_id)||!numeric(row.bs_estimate,Number.MAX_SAFE_INTEGER)||!numeric(row.bss_public,1e12)||!Number.isSafeInteger(row.ff_last_updated)||row.ff_last_updated<946684800||row.ff_last_updated>Math.floor(now/1000)+300)return null;
 if(!Number.isSafeInteger(row.slink_observed_at)||row.slink_observed_at<row.ff_last_updated*1000-300000||row.slink_observed_at>now+300000)return null;
 return {...row,slink_observed_at:Math.min(now,row.slink_observed_at)};
}
async function body(request){
 const invalid=status=>Object.assign(Error('Invalid backup request body'),{status});
 if(Number(request.headers.get('Content-Length'))>65536)throw invalid(413);
 const reader=request.body?.getReader();let size=0,text='';const decoder=new TextDecoder();
 if(!reader)return {};
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536){await reader.cancel();throw invalid(413);}text+=decoder.decode(value,{stream:true});}
 try{return JSON.parse(text+decoder.decode());}catch{throw invalid(400);}
}
async function reserve(db,day,actor,count,cap){
 await db.prepare('INSERT INTO fair_fight_backup_budget(day,actor,reserved) VALUES(?1,?2,0) ON CONFLICT(day,actor) DO NOTHING').bind(day,actor).run();
 const row=await db.prepare('UPDATE fair_fight_backup_budget SET reserved=reserved+?3 WHERE day=?1 AND actor=?2 AND reserved+?3<=?4 RETURNING reserved').bind(day,actor,count,cap).first();return !!row;
}
export async function handleFairFightBackup(request,env,helpers){
 const path=new URL(request.url).pathname;if(!path.startsWith(PREFIX))return null;
 const json=helpers.json;
 if(env.FF_BACKUP_ENABLED!=='true')return json({ok:false,error:'Backup not enabled'},503);
 const session=await helpers.session(request,env);
 const scopes=session?.scopes||[],admin=scopes.includes('admin.*')||scopes.includes('*');
 if(!session||!admin&&!['slink.leveling','slink.war','slink.bounties','slink.mugging','slink.qol.chat'].some(scope=>helpers.hasScope?helpers.hasScope(session,scope):scopes.includes(scope)))return json({ok:false,error:'A valid SLINK session with Fair Fight feature access is required.'},401);
 const action=path.slice(PREFIX.length),db=env.PERMISSIONS_DB,now=Date.now(),day=Math.floor(now/86400000);
 try{
  if(action==='status'&&request.method==='GET'){
   if(!admin)return json({ok:false,error:'Admin access required'},403);
   const stats=await db.prepare('SELECT COUNT(*) AS records, MAX(updated_at) AS last_updated FROM fair_fight_backup').first();
   const snap=await db.prepare("SELECT value FROM fair_fight_backup_meta WHERE key='snapshot'").first();
   return json({ok:true,...stats,snapshot:snap?JSON.parse(snap.value):null});
  }
  if(request.method!=='POST'||!['lookup','contribute'].includes(action))return json({ok:false,error:'Not found'},404);
  const input=await body(request);
  if(action==='lookup'){
   if(!Array.isArray(input.player_ids)||input.player_ids.length>200||!input.player_ids.length||input.player_ids.some(id=>!numeric(id,999999999)||!Number.isSafeInteger(id)))return json({ok:false,error:'Use 1–200 player IDs'},400);
   const ids=[...new Set(input.player_ids)],result=await db.prepare(SELECT).bind(JSON.stringify(ids)).all();return json({ok:true,records:result.results||[]});
  }
  if(!Array.isArray(input.records)||!input.records.length||input.records.length>200)return json({ok:false,error:'Use 1–200 records'},400);
  const unique=new Map();for(const value of input.records){const row=validate(value,now);if(!row)return json({ok:false,error:'Invalid public estimate record'},400);if(!unique.has(row.player_id)||unique.get(row.player_id).ff_last_updated<row.ff_last_updated)unique.set(row.player_id,row);}
  const records=[...unique.values()];if(!records.length)return json({ok:true,acknowledged:[]});
  // Signed sessions prevent anonymous writes, not forgery by an authorized malicious client.
  // Atomic daily reservations bound exposure. No extra FFScouter validation crawl.
  if(!await reserve(db,day,'user:'+session.user_id,records.length,1000))return json({ok:false,error:'Contribution allowance reached'},429);
  const old=await db.prepare(SELECT).bind(JSON.stringify(records.map(r=>r.player_id))).all(),byId=new Map((old.results||[]).map(r=>[r.player_id,r]));
  const newer=records.filter(r=>!byId.has(r.player_id)||byId.get(r.player_id).ff_last_updated<r.ff_last_updated);
  const configured=Number(env.FF_BACKUP_DAILY_ROWS),limit=Number.isFinite(configured)?Math.max(0,Math.min(50000,configured)):20000;
  if(newer.length&&!await reserve(db,day,'global',newer.length,limit))return json({ok:false,error:'Shared backup daily allowance reached'},429);
  if(newer.length)await db.batch([db.prepare(UPSERT).bind(JSON.stringify(newer),now)]);
  return json({ok:true,acknowledged:records.map(r=>({player_id:r.player_id,ff_last_updated:Math.max(r.ff_last_updated,byId.get(r.player_id)?.ff_last_updated||0)})),changed_candidates:newer.length});
 }catch(error){return json({ok:false,error:[400,413].includes(error.status)?'Invalid backup request body':'Backup temporarily unavailable'},[400,413].includes(error.status)?error.status:503);}
}
export async function snapshotFairFightBackup(env,time=Date.now()){
 if(env.FF_BACKUP_ENABLED!=='true'||env.FF_BACKUP_SNAPSHOTS!=='true'||!env.USER_BACKUPS)return;
 const hours=Math.max(12,Math.min(168,Number(env.FF_BACKUP_SNAPSHOT_HOURS)||24));
 const db=env.PERMISSIONS_DB,bucket=env.USER_BACKUPS,slot=Math.floor(time/(hours*3600000)),key='fair-fight-backups/'+new Date(time).toISOString().slice(0,13).replace('T','-')+'.json.gz';
 const acquired=await db.prepare("INSERT INTO fair_fight_backup_meta(key,value) VALUES('snapshot-lease',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(value AS INTEGER) < ?1 RETURNING value").bind(slot).first();if(!acquired)return;
 try{
  // Keyset-paged streaming avoids a huge JS array/string and any R2 read on lookup paths.
  const enc=new TextEncoder();let cursorId=0,first=true,started=false,rawBytes=0;
  const stream=new ReadableStream({async pull(controller){try{
   if(!started){started=true;controller.enqueue(enc.encode('{"schema":1,"generated_at":'+time+',"records":['));return;}
   const result=await db.prepare('SELECT player_id,bs_estimate,bss_public,ff_last_updated FROM fair_fight_backup WHERE player_id>?1 ORDER BY player_id LIMIT 1000').bind(cursorId).all();
   const rows=result.results||[];if(!rows.length){controller.enqueue(enc.encode(']}'));controller.close();return;}
   const chunk=enc.encode((first?'':',')+rows.map(r=>JSON.stringify([r.player_id,r.bs_estimate,r.bss_public,r.ff_last_updated])).join(','));
   rawBytes+=chunk.byteLength;if(rawBytes>64*1024*1024)throw Error('Snapshot exceeds bounded export capacity');
   first=false;cursorId=rows.at(-1).player_id;controller.enqueue(chunk);
  }catch(error){controller.error(error);}}});
  const reader=stream.pipeThrough(new CompressionStream('gzip')).getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32*1024*1024){await reader.cancel();throw Error('Snapshot exceeds bounded compressed capacity');}chunks.push(value);}
  const compressed=new Uint8Array(size);let offset=0;for(const chunk of chunks){compressed.set(chunk,offset);offset+=chunk.byteLength;}
  await bucket.put(key,compressed,{httpMetadata:{contentType:'application/json',contentEncoding:'gzip'}});
  await db.prepare("INSERT INTO fair_fight_backup_meta(key,value) VALUES('snapshot',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({key,generated_at:time})).run();
  let cursor;const before=time-14*86400000;do{const page=await bucket.list({prefix:'fair-fight-backups/',limit:1000,...(cursor?{cursor}:{})});const expired=page.objects.filter(o=>o.uploaded.getTime()<before).map(o=>o.key);if(expired.length)await bucket.delete(expired);cursor=page.truncated?page.cursor:null;}while(cursor);
  await db.prepare('DELETE FROM fair_fight_backup_budget WHERE day<?1').bind(Math.floor(time/86400000)-2).run();
 }catch{console.warn('SLINK public FF snapshot failed; live lookups are unaffected.');}
}
export const testOnly={UPSERT,SELECT,validate};
