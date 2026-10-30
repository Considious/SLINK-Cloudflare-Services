import assert from 'node:assert/strict';import {test} from 'node:test';import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';
import {handleFairFightBackup,snapshotFairFightBackup,testOnly} from './fair-fight-backup.js';
function fixture(){const raw=new DatabaseSync(':memory:');raw.exec(readFileSync(new URL('../../permissions/migrations/0022-fair-fight-public-backup.sql',import.meta.url),'utf8'));const db={prepare(sql){return {bind(...values){const q=raw.prepare(sql);return {async all(){return {results:q.all(...values)};},async first(){return q.get(...values)||null;},async run(){return q.run(...values);}};}};},async batch(statements){raw.exec('BEGIN');try{const rows=await Promise.all(statements.map(s=>s.run()));raw.exec('COMMIT');return rows;}catch(e){raw.exec('ROLLBACK');throw e;}}};return {db,raw};}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const row=(id=1,at=Math.floor(Date.now()/1000))=>({player_id:id,bs_estimate:10000,bss_public:200,source:'ffscouter-bss',ff_last_updated:at,slink_observed_at:Date.now()});
function request(action,body){return new Request('https://test/api/fair-fight/backup/'+action,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{})});}
const allowed={json,session:async()=>({user_id:5,scopes:['admin.*']})};
test('Auth, validation, JSON upsert, duplicate/older/newer rules and targeted lookup',async()=>{const {db,raw}=fixture(),env={PERMISSIONS_DB:db,FF_BACKUP_ENABLED:'true'};
 assert.equal((await handleFairFightBackup(request('lookup',{player_ids:[1]}),env,{json,session:async()=>null})).status,401);
 assert.equal((await handleFairFightBackup(request('contribute',{records:[{...row(),api_key:'secret'}]}),env,allowed)).status,400);
 assert.equal((await handleFairFightBackup(request('contribute',{records:[{...row(),source:'premium'}]}),env,allowed)).status,400);
 for(const at of [Math.floor(Date.now()/1000)-500,Math.floor(Date.now()/1000)-500,Math.floor(Date.now()/1000)-600,Math.floor(Date.now()/1000)-400]){
  const r=await handleFairFightBackup(request('contribute',{records:[row(1,at)]}),env,allowed);assert.equal(r.status,200,await r.text());
 }
 assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM fair_fight_backup').get().n,1);assert.equal(raw.prepare('SELECT ff_last_updated AS at FROM fair_fight_backup').get().at,Math.floor(Date.now()/1000)-400);
 const found=await (await handleFairFightBackup(request('lookup',{player_ids:[1,99]}),env,allowed)).json();assert.equal(found.records.length,1);assert.equal(found.records[0].player_id,1);assert.equal(found.records[0].fair_fight,undefined);
 const old=raw.prepare('SELECT * FROM fair_fight_backup').get();const result=raw.prepare(testOnly.UPSERT).run(JSON.stringify([row(1,old.ff_last_updated)]),Date.now());assert.equal(result.changes,0,'Identical timestamp does not write estimate row');
 assert.equal((await handleFairFightBackup(request('lookup',{player_ids:Array(201).fill(1)}),env,allowed)).status,400);
 assert.equal((await handleFairFightBackup(request('status'),env,{json,session:async()=>({user_id:2,scopes:['slink.war']})})).status,403);
 assert.equal(await handleFairFightBackup(new Request('https://test/api/terms'),env,allowed),null);
});
test('Budget cap rejects growth without overwriting; failed batch remains unacknowledged',async()=>{const {db,raw}=fixture(),env={PERMISSIONS_DB:db,FF_BACKUP_ENABLED:'true',FF_BACKUP_DAILY_ROWS:'1'};
 assert.equal((await handleFairFightBackup(request('contribute',{records:[row(1)]}),env,allowed)).status,200);
 assert.equal((await handleFairFightBackup(request('contribute',{records:[row(2)]}),env,allowed)).status,429);
 assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM fair_fight_backup').get().n,1);
});
test('Daily compressed snapshot, retention isolation and graceful R2 failure',async()=>{const {db}=fixture(),objects=new Map(),time=Date.UTC(2026,9,29);await db.prepare(testOnly.UPSERT).bind(JSON.stringify([row()]),Date.now()).run();let removed=[];
 const env={PERMISSIONS_DB:db,FF_BACKUP_ENABLED:'true',FF_BACKUP_SNAPSHOTS:'true',USER_BACKUPS:{async put(key,value){objects.set(key,value);},async list(){return {objects:[{key:'fair-fight-backups/old.json.gz',uploaded:new Date(time-20*86400000)}],truncated:false};},async delete(keys){removed=keys;}}};
 await snapshotFairFightBackup(env,time);assert.equal(objects.size,1);const buffer=[...objects.values()][0];const parsed=JSON.parse(await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text());assert.equal(parsed.records.length,1);assert.deepEqual(removed,['fair-fight-backups/old.json.gz']);
 await snapshotFairFightBackup(env,time);assert.equal(objects.size,1,'Snapshot lease prevents repeated same-slot full exports');
 env.USER_BACKUPS.put=async()=>{throw Error('R2 failure');};await snapshotFairFightBackup(env,time+86400000);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM fair_fight_backup').bind().first()).n,1);
});
