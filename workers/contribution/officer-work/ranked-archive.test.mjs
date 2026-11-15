import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {collectRankedArchive,readRankedArchive,rankedHelp} from './ranked-archive.js';
import {WorkError} from './model.js';

test('archive checkpoints, retains report fields, isolates factions and refreshes on schedule',async t=>{
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
 const deps={verify:async()=>({key:'test',actor:{factionId:10,userId:5}}),clean:v=>v,request:async(_key,_user,path,params)=>{
  calls.push(path);
  if(path.endsWith('/warfareranked'))return {data:{warfareranked:(params.to>=start?[7,6,5]:params.to>=start-100?[4]:[]).map(id=>({id,start:id===4?start-100:start,end,target:400}))}};
  const warId=Number(path.split('/')[3]);
  if(warId===6&&rejectOnce){rejectOnce=false;throw Error('temporary');}
  return {data:{rankedwarreport:{id:warId,start,end,winner:warId===5?20:30,forfeit:warId===5,factions:[{id:30,name:'Faction A',score:4,members:[],rewards:{points:5}},{id:20,name:'Faction B',score:2,members:[]}]}}};
 }};
 const list=()=>readRankedArchive(env,{factionId:10},'/ranked-archive',new URLSearchParams(),now);
 await collectRankedArchive(env,deps,now);
 assert.equal((await list()).paused,true);
 assert.equal((await list()).errorCode,'ARCHIVE_RETRY');
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7]);
 const failedCalls=calls.length;
 await collectRankedArchive(env,deps,now+60000);
 assert.equal(calls.length,failedCalls);
 await collectRankedArchive(env,deps,now+300000);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7,6,5]);
 assert.equal((await list()).backfilled,false);
 for(let i=6;i<=9;i++)await collectRankedArchive(env,deps,now+i*60000);
 assert.deepEqual((await list()).rows.map(w=>w.warId),[7,6,5,4]);
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
 let wall=now+700000;
 t.mock.method(Date,'now',()=>wall);
 const pooled={...deps,pool:async()=>[{id:'fixture',user_id:5},{id:'helper-key',user_id:8}],verify:async credential=>({key:'test',actor:{factionId:10,userId:credential==='fixture'?5:8},verificationCalls:credential==='fixture'?2:0}),request:async(key,user,path,params)=>{
  users.push(user);
  if(path.endsWith('/warfareranked'))return {data:{warfareranked:(params.to>=start?[12,11,10]:[9,8,3,2,1]).map(id=>({id,start:id>=10?start:start-100,end}))}};
  return deps.request(key,user,path);
 }};
 await collectRankedArchive(env,pooled,now+700000);
 assert.deepEqual(users,[5,5,5,8]);
 assert.equal((await list()).rows.length,7);
 for(let i=0;i<5;i++)await collectRankedArchive(env,pooled,wall);
 for(const user of [5,8])assert.equal(users.filter(id=>id===user).length,5);
 wall+=60000;
 await collectRankedArchive(env,pooled,wall);
 assert.ok(users.filter(id=>id===5).length>5);
 assert.deepEqual(await rankedHelp(env,helper,'helper-key',false),{enabled:false});
});

test('persistent cron backfill skips only the incomplete report, reuses pages, and reconciles twice daily',async t=>{
 const sqlite=new DatabaseSync(':memory:');
 const prepare=sql=>{
  const bind=(...values)=>({run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})});
  return {...bind(),bind};
 };
 const storage=new Map();
 const env={RANKED_ARCHIVE_ENABLED:'true',RANKED_ARCHIVE_FACTION_ID:'10',RANKED_ARCHIVE_CREDENTIAL_ID:'saved',PERMISSIONS_DB:{prepare,batch:async steps=>Promise.all(steps.map(x=>x.run()))},USER_BACKUPS:{put:async(key,value)=>storage.set(key,value)}};
 let wall=Date.UTC(2028,0,1,11,41),ready=false,extra=false;
 t.mock.method(Date,'now',()=>wall);
 const start=wall/1000-1000, calls=[];
 const listing=warId=>({id:warId,start:start+warId,end:start+warId+10});
 const deps={pool:async()=>[{id:'saved'}],verify:async()=>({key:'test',actor:{userId:5,factionId:10},verificationCalls:0}),clean:v=>v,request:async(_key,_user,path,params)=>{
  calls.push({at:wall,path});
  if(path.endsWith('/warfareranked')){
   const wars=Array.from({length:extra?12:11},(_,i)=>listing(i+1)).filter(x=>x.start<=params.to&&x.start>=(params.from??0));
   // Torn's generated URL may use a legacy route and give a cursor that
   // doesn't move backwards. The collector must still advance from the data.
   return {data:{warfareranked:wars,_metadata:{links:{next:wars.length?`/v2/faction/?selections=warfareranked&to=${params.to}&key=discard-me`:null}}}};
  }
  const warId=Number(path.split('/')[3]);
  if(warId===10&&!ready)throw new WorkError('TORN_6','Report missing',403);
  return {data:{rankedwarreport:{...listing(warId),factions:[{id:5},{id:7}]}}};
 }};
 const run=async()=>collectRankedArchive(env,deps,wall);
 const state=()=>sqlite.prepare('SELECT * FROM officer_ranked_global_state').get();
 const count=()=>sqlite.prepare('SELECT count(*) AS n FROM officer_ranked_global_wars').get().n;
 await run();
 assert.deepEqual(calls.map(c=>c.path.split('/').at(-2)),['faction','11','10','9','8']);
 assert.equal(count(),3);
 assert.equal(sqlite.prepare('SELECT war_id FROM officer_ranked_archive_retry').get().war_id,10);
 assert.equal(state().error,null);
 wall+=60000;await run();
 assert.equal(calls.filter(c=>c.path.endsWith('/warfareranked')).length,1);
 assert.equal(calls.filter(c=>c.at===wall).length,5);
 for(let i=0;i<10&&state().next_run<=wall;i++){wall+=60000;await run();}
 assert.equal(count(),10);
 assert.equal(state().backfilled,1);
 assert.equal(state().next_run,Date.UTC(2028,0,1,12));
 ready=true;
 // A deferred report is still retried while the twice-daily scan is asleep.
 wall+=600000;await run();
 assert.equal(count(),11);
 assert.equal(state().next_run,Date.UTC(2028,0,1,12));
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM officer_ranked_archive_retry').get().n,0);
 extra=true;wall=Date.UTC(2028,0,1,12);await run();
 assert.equal(count(),12);
 for(let i=0;i<3;i++){wall+=60000;await run();}
 assert.equal(state().next_run,Date.UTC(2028,0,2,0));
});

test('archive rebuilds safe legacy offsets, ignores other hosts, and retains all boundary ties',async t=>{
 const sqlite=new DatabaseSync(':memory:');
 const prepare=sql=>{
  const bind=(...values)=>({run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})});
  return {...bind(),bind};
 };
 const env={RANKED_ARCHIVE_ENABLED:'true',RANKED_ARCHIVE_FACTION_ID:'10',RANKED_ARCHIVE_CREDENTIAL_ID:'saved',PERMISSIONS_DB:{prepare,batch:async steps=>Promise.all(steps.map(x=>x.run()))},USER_BACKUPS:{put:async()=>{}}};
 let wall=Date.UTC(2028,1,1,11,0);
 t.mock.method(Date,'now',()=>wall);
 const second=wall/1000-600;
 const listing=warId=>({id:warId,start:warId===1?second-1:second,end:second+20});
 const requests=[];
 const deps={pool:async()=>[{id:'saved'}],verify:async()=>({key:'local-only',actor:{userId:5,factionId:10},verificationCalls:0}),clean:v=>v,request:async(_key,_user,path,params)=>{
  if(path==='/v2/faction/warfareranked'){
   requests.push(params);
   const offset=params.offset??0;
   const rows=Array.from({length:104},(_,i)=>listing(104-i)).filter(w=>w.start<=params.to&&w.start>=(params.from??0)).slice(offset,offset+100);
   const link=params.to>second?'https://untrusted.invalid/v2/faction/warfareranked?offset=100':
    rows.length===100?`/v2/faction/?selections=warfareranked&to=${params.to}&offset=100&key=discard-me&comment=ignore`:null;
   return {data:{warfareranked:rows,_metadata:{links:{next:link}}}};
  }
  const warId=Number(path.split('/')[3]);
  return {data:{rankedwarreport:{...listing(warId),factions:[{id:5},{id:7}]}}};
 }};
 const count=()=>sqlite.prepare('SELECT count(*) AS n FROM officer_ranked_global_wars').get().n;
 for(let i=0;i<35;i++){await collectRankedArchive(env,deps,wall);wall+=60000;if(count()===104)break;}
 assert.equal(count(),104);
 assert.equal(requests[1].to,second);
 assert.equal(requests[1].offset,undefined);
 assert.equal(requests[2].to,second);
 assert.equal(requests[2].offset,100);
 assert.ok(requests.every(p=>!Object.hasOwn(p,'key')&&!Object.hasOwn(p,'comment')));
});


