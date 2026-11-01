import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import worker,{TEST_ORIGIN} from '../central-test-worker.js';
import {testing} from '../../contribution/worker.js';
import {testDatabaseSql} from '../prepare-test-database.mjs';

test('isolated test schema reuses auth tables, grants only faction chat, and never grants admin wildcard',async()=>{
 const db=new DatabaseSync(':memory:');try{
  const sql=await testDatabaseSql();assert.equal(await readFile(new URL('../test-database.sql',import.meta.url),'utf8'),sql);db.exec(sql);db.exec(sql);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_scope_grants').get().n,0);
  assert.deepEqual(db.prepare('SELECT faction_id,scope FROM faction_scope_grants').all().map(row=>({...row})),[{faction_id:46978,scope:'slink.chat'}]);
  const adapter={prepare(query){return {bind(...values){return {async all(){return {results:db.prepare(query).all(...values)};}};}};}};
  const permissions=await testing.loadPermissions({PERMISSIONS_DB:adapter},3853023,46978,Date.now(),'Leader');assert.deepEqual(permissions.scopes,['slink.chat']);assert.deepEqual(permissions.roles,['member']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,0);
 }finally{db.close();}
});
test('test wrapper blocks unrelated APIs and wrong deployment targets without executing them',async()=>{
 const env={CHAT_CENTRAL_ISSUER:TEST_ORIGIN,CHAT_TEST_FACTION_ID:'46978'};
 for(const path of ['/api/user-backup','/api/admin/scopes','/api/chat/setup-token','/api/chat/revoke'])assert.equal((await worker.fetch(new Request(TEST_ORIGIN+path),env)).status,404);
 assert.equal((await worker.fetch(new Request('https://other.example.test/'),env)).status,503);
 const health=await (await worker.fetch(new Request(TEST_ORIGIN+'/api/health'),env)).json();assert.equal(health.configured,false);assert.equal(health.test_only,true);
 const terms=await (await worker.fetch(new Request(TEST_ORIGIN+'/api/permissions/terms'),env)).json();assert.ok(terms.terms.sha256);
});
test('test deployment has only its new D1 database and no production buckets, schedules or secrets',async()=>{
 const config=JSON.parse(await readFile(new URL('../test-central/wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.main,'../central-test-worker.js');await readFile(new URL('../test-central/'+config.main,import.meta.url),'utf8');
 assert.equal(config.name,'slink-chat-central-test');assert.equal(config.vars.CHAT_CENTRAL_ISSUER,TEST_ORIGIN);assert.equal(config.d1_databases[0].database_id,'9a10280e-47d7-4a43-aff9-7eca42f12b6c');assert.equal(config.r2_buckets,undefined);assert.equal(config.triggers,undefined);assert.equal(JSON.stringify(config).includes('2debd2fe-69b6-42e3-acc9-2a567d170928'),false);
});
