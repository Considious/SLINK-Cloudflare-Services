import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectRankedArchive,readRankedArchive,rankedHelp} from './ranked-archive.js';

test('archive checkpoints, retains report fields, isolates factions and refreshes on schedule',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const prepare=sql=>{
  const bind=(...values)=>({run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})});
  return {...bind(),bind};
 };
 const storage=new Map(),calls=[];
 const env={RANKED_ARCHIVE_ENABLED:'true',RANKED_ARCHIVE_FACTION_ID:'10',RANKED_ARCHIVE_CREDENTIAL_ID:'fixture',PERMISSIONS_DB:{prepare,batch:async steps=>Promise.all(steps.map(x=>x.run()))},USER_BACKUPS:{
  put:async(key,value)=>storage.set(key,value),
  get:async key=>storage.has(key)?{json:async()=>JSON.parse(storage.get(key))}:null
 }};
 const now=1_800_000_000_000,end=now/1000-10, start=end-30;
 let rejectOnce=true;
 const deps={verify:async()=>({key:'test',actor:{factionId:10,userId:5}}),clean:v=>v,request:async(_key,_user,path)=>{
  calls.push(path);
  if(path.endsWith('/warfareranked'))return {data:{warfareranked:[7,6,5].map(id=>({id,start,end,target:400}))}};
  const warId=Number(path.split('/')[3]);
  if(warId===6&&rejectOnce){rejectOnce=false;throw Error('temporary');}
  return {data:{rankedwarreport:{id:warId,start,end,winner:warId===5?20:30,forfeit:warId===5,factions:[{id:30,name:'Faction A',score:4,members:[],rewards:{points:5}},{id:20,name:'Faction B',score:2,members:[]}]}}};
 }};
 const list=()=>readRankedArchive(env,{factionId:10},'/ranked-archive',new URLSearchParams(),now);
 await collectRankedArchive(env,deps,now);
 assert.equal((await list()).paused,true);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7]);
 await collectRankedArchive(env,deps,now+300000);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7,6,5]);
 assert.equal((await list()).backfilled,true);
 assert.equal((await list()).analysis.forfeits,1);
 assert.equal((await list()).rows[0].factionA,'Faction A');
 assert.equal((await list()).rows[0].factionB,'Faction B');
 const stored=await readRankedArchive(env,{factionId:10},'/ranked-archive/7',new URLSearchParams());
 assert.equal(stored.listing.target,400);
 assert.equal(stored.report.rankedwarreport.factions[0].rewards.points,5);
 await assert.rejects(readRankedArchive(env,{factionId:11},'/ranked-archive/7',new URLSearchParams()),{code:'ARCHIVE_FACTION_REQUIRED'});
 const count=calls.length;await collectRankedArchive(env,deps,now+600000);
 assert.equal(calls.length,count);
 const helper={userId:8,factionId:10};
 assert.deepEqual(await rankedHelp(env,helper,'helper-key'),{enabled:false});
 await assert.rejects(rankedHelp(env,helper,'session-8',true),{code:'SAVED_KEY_REQUIRED'});
 assert.deepEqual(await rankedHelp(env,helper,'helper-key',true),{enabled:true});
 sqlite.exec('UPDATE officer_ranked_global_state SET next_run=0,backfilled=0');
 const users=[];
 const pooled={...deps,pool:async()=>[{id:'fixture',user_id:5},{id:'helper-key',user_id:8}],verify:async credential=>({key:'test',actor:{factionId:10,userId:credential==='fixture'?5:8}}),request:async(key,user,path)=>{
  users.push(user);
  if(path.endsWith('/warfareranked'))return {data:{warfareranked:[12,11,10].map(id=>({id,start,end}))}};
  return deps.request(key,user,path);
 }};
 await collectRankedArchive(env,pooled,now+700000);
 assert.deepEqual(users,[5,5,5,8,8]);
 assert.equal((await list()).rows.length,6);
 assert.deepEqual(await rankedHelp(env,helper,'helper-key',false),{enabled:false});
});
