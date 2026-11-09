import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectRankedArchive,readRankedArchive} from './ranked-archive.js';

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
  if(path.endsWith('/rankedwars'))return {data:{rankedwars:[7,6,5].map(id=>({id,start,end,target:400}))}};
  const warId=Number(path.split('/')[3]);
  if(warId===6&&rejectOnce){rejectOnce=false;throw Error('temporary');}
  return {data:{rankedwarreport:{id:warId,start,end,winner:warId===5?20:10,forfeit:false,factions:[{id:10,score:4,members:[],rewards:{points:5}},{id:20,name:'Opponent',score:2,members:[]}]}}};
 }};
 const list=()=>readRankedArchive(env,{factionId:10},'/ranked-archive',new URLSearchParams(),now);
 await collectRankedArchive(env,deps,now);
 assert.equal((await list()).paused,true);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7]);
 await collectRankedArchive(env,deps,now+300000);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7,6,5]);
 assert.equal((await list()).backfilled,true);
 assert.equal((await list()).analysis.wins,2);
 const stored=await readRankedArchive(env,{factionId:10},'/ranked-archive/7',new URLSearchParams());
 assert.equal(stored.listing.target,400);
 assert.equal(stored.report.rankedwarreport.factions[0].rewards.points,5);
 await assert.rejects(readRankedArchive(env,{factionId:11},'/ranked-archive/7',new URLSearchParams()),{code:'WAR_NOT_ARCHIVED'});
 const count=calls.length;await collectRankedArchive(env,deps,now+600000);
 assert.equal(calls.length,count);
});
