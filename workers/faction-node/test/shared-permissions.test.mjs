import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {testDatabaseSql} from '../prepare-test-database.mjs';
import {ensureSharedChatPermissions} from '../shared-permissions.js';
import central,{TEST_ORIGIN} from '../central-test-worker.js';
import {handleFactionNode} from '../central.js';

function adapter(sql,readOnly=false){
 function statement(query,values=[]){return {bind:(...args)=>statement(query,args),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>{assert(!readOnly,'Legacy database must remain read-only');return {meta:{changes:sql.prepare(query).run(...values).changes}};},execute:()=>({meta:{changes:sql.prepare(query).run(...values).changes}})};}
 return {prepare:statement,async batch(statements){assert(!readOnly);sql.exec('BEGIN');try{const result=statements.map(s=>s.execute());sql.exec('COMMIT');return result;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
async function fixture(t){const primary=new DatabaseSync(':memory:'),legacy=new DatabaseSync(':memory:');t.after(()=>{primary.close();legacy.close();});const schema=await testDatabaseSql();primary.exec(schema);legacy.exec(schema);primary.exec('DELETE FROM faction_scope_grants');
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),key=await crypto.subtle.exportKey('jwk',pair.publicKey);
 legacy.prepare("INSERT INTO faction_chat_nodes VALUES(46978,'slink-node-46978-hosted-test','https://slink-faction-node-46978-test.richard-johnson554.workers.dev',?,1,3853023,'active',100,200)").run(JSON.stringify(key));
 return {primary,legacy,env:{CHAT_PERMISSION_STORE:'shared',PERMISSIONS_DB:adapter(primary),LEGACY_CHAT_DB:adapter(legacy,true)}};
}
test('one-time transfer preserves identity and grant expiry, never writes legacy, then uses only production',async t=>{
 const f=await fixture(t),node=f.legacy.prepare('SELECT * FROM faction_chat_nodes').get(),grant=f.legacy.prepare('SELECT * FROM faction_scope_grants').get();
 await ensureSharedChatPermissions(f.env);
 assert.deepEqual(f.primary.prepare('SELECT * FROM faction_chat_nodes').get(),node);assert.deepEqual(f.primary.prepare('SELECT * FROM faction_scope_grants').get(),grant);
 assert.equal(f.primary.prepare('SELECT COUNT(*) n FROM user_scope_grants').get().n,0);
 f.legacy.exec('DELETE FROM faction_chat_nodes; DELETE FROM faction_scope_grants');
 await ensureSharedChatPermissions({...f.env,PERMISSIONS_DB:adapter(f.primary)});
 assert.deepEqual(f.primary.prepare('SELECT * FROM faction_chat_nodes').get(),node,'Durable marker prevents dependency on the retired registry');
});
test('a production license revocation is not overridden by the old active test grant',async t=>{
 const f=await fixture(t);f.primary.exec("INSERT INTO faction_scope_grants SELECT 46978,'slink.chat','revoked',0,NULL,3853023,'Revoked',0,0");await ensureSharedChatPermissions(f.env);
 assert.equal(f.primary.prepare('SELECT status FROM faction_scope_grants').get().status,'revoked');
});
test('expired test license is not renewed during transfer',async t=>{
 const f=await fixture(t);f.legacy.exec("UPDATE faction_scope_grants SET starts_at=1,expires_at=2");await ensureSharedChatPermissions(f.env);assert.equal(f.primary.prepare('SELECT COUNT(*) n FROM faction_scope_grants').get().n,0);
});
test('different or revoked production registrations cannot be replaced',async t=>{
 const f=await fixture(t),row=f.legacy.prepare('SELECT * FROM faction_chat_nodes').get();f.primary.prepare('INSERT INTO faction_chat_nodes VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(row));f.primary.exec("UPDATE faction_chat_nodes SET status='revoked'");
 await assert.rejects(ensureSharedChatPermissions(f.env),{code:'CHAT_MIGRATION_REGISTRY_CONFLICT'});assert.equal(f.primary.prepare('SELECT status FROM faction_chat_nodes').get().status,'revoked');assert.equal(f.primary.prepare('SELECT COUNT(*) n FROM faction_scope_grants').get().n,0);
});
test('unexpected legacy Leader identity or absent bindings fail closed',async t=>{
 const f=await fixture(t);f.legacy.exec('UPDATE faction_chat_nodes SET leader_id=2');await assert.rejects(ensureSharedChatPermissions(f.env),{code:'CHAT_MIGRATION_IDENTITY_MISMATCH'});assert.equal(f.primary.prepare('SELECT COUNT(*) n FROM faction_chat_nodes').get().n,0);
 await assert.rejects(ensureSharedChatPermissions({...f.env,LEGACY_CHAT_DB:null}),{code:'CHAT_MIGRATION_BINDING_MISSING'});
});

test('Chat Central authentication records current acceptance only in shared production permissions',async t=>{
 const f=await fixture(t),originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});
 globalThis.fetch=async url=>{assert.equal(String(url),'https://api.torn.com/v2/key/info');return Response.json({info:{user:{id:3853023,name:'Considious',faction_id:46978,faction_position:'Leader'}}});};
 const env={...f.env,CHAT_CENTRAL_ISSUER:TEST_ORIGIN,CHAT_TEST_FACTION_ID:'46978',API_KEY_ENCRYPTION_KEY:'synthetic-signing-secret'};
 const metadata=await (await central.fetch(new Request(TEST_ORIGIN+'/api/permissions/terms'),env)).json();
 const response=await central.fetch(new Request(TEST_ORIGIN+'/api/permissions/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:'synthetic-key',terms_accepted:true,terms_version:metadata.terms.version,terms_sha256:metadata.terms.sha256})}),env);
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert(result.scopes.includes('slink.chat'));
 const accepted=f.primary.prepare('SELECT user_id,terms_version,terms_sha256 FROM war_terms_acceptances').get();assert.equal(accepted.user_id,3853023);assert.equal(accepted.terms_version,metadata.terms.version);assert.equal(accepted.terms_sha256,metadata.terms.sha256);
 assert.equal(f.legacy.prepare('SELECT COUNT(*) n FROM war_terms_acceptances').get().n,0,'Legacy acceptance store is never updated');
});

test('an already-completed cutover repairs a missing roster without seeding members or changing permissions',async t=>{
 const f=await fixture(t);await ensureSharedChatPermissions(f.env);
 const registration=f.primary.prepare('SELECT * FROM faction_chat_nodes').get(),grant=f.primary.prepare('SELECT * FROM faction_scope_grants').get();
 f.primary.exec('DROP TABLE faction_member_roster');
 const session={user_id:3853023,faction_id:46978,iat:Math.floor(Date.now()/1000)},services={session:async()=>session,hasScope:()=>false};
 const request=()=>new Request(TEST_ORIGIN+'/api/chat/members');
 const missing=await handleFactionNode(request(),f.env,services);assert.equal(missing.status,503);assert.equal((await missing.json()).code,'CHAT_ROSTER_SCHEMA_MISSING');
 // Fresh isolate, existing durable transfer marker, retired legacy contents.
 f.legacy.exec('DELETE FROM faction_chat_nodes;DELETE FROM faction_scope_grants');
 const repaired={...f.env,PERMISSIONS_DB:adapter(f.primary)};await ensureSharedChatPermissions(repaired);await ensureSharedChatPermissions(repaired);
 const response=await handleFactionNode(request(),repaired,services);assert.equal(response.status,200);assert.deepEqual((await response.json()).members,[],'No invented roster or presence data');
 assert.deepEqual(f.primary.prepare('SELECT * FROM faction_chat_nodes').get(),registration);assert.deepEqual(f.primary.prepare('SELECT * FROM faction_scope_grants').get(),grant);
 f.primary.exec("INSERT INTO faction_member_roster VALUES(46978,12,'Verified member','Member',1,1,1,1,1),(46978,13,'Inactive','Member',1,1,1,0,1),(99,14,'Other faction','Member',1,1,1,1,1)");
 const listed=await (await handleFactionNode(request(),repaired,services)).json();assert.deepEqual(listed.members.map(member=>member.user_id),[12]);
});
