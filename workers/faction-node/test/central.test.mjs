import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {handleFactionNode} from '../central.js';
import {hash,sign,verify} from '../protocol.js';

// D1-shaped adapter backed by real SQLite. batch is transactional, as in D1.
function database(){
  const sql=new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE permission_scope_catalog(scope TEXT PRIMARY KEY,category TEXT,title TEXT,description TEXT,assignable INTEGER,default_hours INTEGER,created_at INTEGER,updated_at INTEGER);
  CREATE TABLE faction_scope_grants(faction_id INTEGER,scope TEXT,status TEXT,starts_at INTEGER,expires_at INTEGER);
  CREATE TABLE user_scope_grants(user_id INTEGER,scope TEXT,status TEXT,starts_at INTEGER,expires_at INTEGER);
  INSERT INTO faction_scope_grants VALUES(10,'slink.chat','active',0,NULL);`);
  function statement(query,values=[]){return {bind:(...args)=>statement(query,args),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:{changes:sql.prepare(query).run(...values).changes}}),execute:()=>({meta:{changes:sql.prepare(query).run(...values).changes}})};}
  return {sql,prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
async function keys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {private:await crypto.subtle.exportKey('jwk',pair.privateKey),public:await crypto.subtle.exportKey('jwk',pair.publicKey)};}
async function fixture(t){const db=database();db.sql.exec(await readFile(new URL('../../../permissions/migrations/0023-faction-node.sql',import.meta.url),'utf8'));t.after(()=>db.sql.close());const central=await keys(),node=await keys(),issuer='https://central.example.test';const env={PERMISSIONS_DB:db,CHAT_CENTRAL_ISSUER:issuer,CHAT_SIGNING_PRIVATE_JWK:JSON.stringify(central.private)};let session={user_id:1,user_name:'Leader',faction_id:10,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200};const services={session:async()=>session,hasScope:()=>true};
  async function call(path,payload,headers={}){const response=await handleFactionNode(new Request(issuer+'/api/chat/'+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(payload?{body:JSON.stringify(payload)}:{})}),env,services);return {status:response.status,data:await response.json()};}
  async function setup(endpoint='https://node.example.test'){const result=await call('setup-token',{faction_id:10,leader_id:1,endpoint});assert.equal(result.status,200);return result.data.registration_token;}
  async function registration(token,nodeId='node-test',key=node,endpoint='https://node.example.test'){const now=Math.floor(Date.now()/1000);return {registration_token:token,node_id:nodeId,faction_id:10,endpoint,protocol:1,public_key:key.public,proof:await sign({iss:nodeId,aud:'slink-node-registration',kind:'node_registration',protocol:1,iat:now,exp:now+120,token_hash:await hash(token),endpoint,faction_id:10},key.private)};}
  return {db,central,node,env,issuer,call,setup,registration,services,setSession:value=>{session={...session,...value};}};
}
test('registration binds identity, retries safely and cannot be replaced with a new key',async t=>{
  const f=await fixture(t),token=await f.setup(),input=await f.registration(token);
  const first=await f.call('register',input);assert.equal(first.status,200,JSON.stringify(first.data));
  const cert=await verify(first.data.certificate,f.central.public,{aud:'slink-node-network',issuer:f.issuer,kind:'node_certificate',maxTtl:366*86400});assert.equal(cert.leader_id,1);
  const retry=await f.call('register',await f.registration(token));assert.equal(retry.status,200);assert.equal(retry.data.resumed,true);
  assert.equal((await f.call('register',await f.registration(token,'node-test',await keys()))).status,409);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,1);
});
test('personal room claims include only the signed-in user’s active explicit tiers',async t=>{
  const f=await fixture(t),setup=await f.setup();assert.equal((await f.call('register',await f.registration(setup))).status,200);
  f.db.sql.exec("INSERT INTO user_scope_grants VALUES (1,'slink.chat.personal.2','active',0,NULL),(1,'slink.chat.personal.5','active',0,1),(1,'slink.chat.personal.4','revoked',0,NULL),(1,'slink.chat.personal.*','active',0,NULL),(2,'slink.chat.personal.3','active',0,NULL)");
  const response=await f.call('token',{});assert.equal(response.status,200);
  const claims=await verify(response.data.token,f.central.public,{issuer:f.issuer,aud:'node-test',kind:'chat_access',maxTtl:300});
  assert.deepEqual(claims.scopes,['slink.chat','slink.chat.personal.2']);
  f.setSession({scopes:['admin.*']});
  const admin=await f.call('token',{});assert.equal(admin.status,200);
  const adminClaims=await verify(admin.data.token,f.central.public,{issuer:f.issuer,aud:'node-test',kind:'chat_access',maxTtl:300});
  assert(adminClaims.scopes.includes('slink.chat.personal.5'));assert(!adminClaims.scopes.includes('admin.*'));
});
test('two simultaneous registrations can consume only one token and one node',async t=>{
  const f=await fixture(t),token=await f.setup(),other=await keys();
  const inputs=await Promise.all([f.registration(token,'node-a'),f.registration(token,'node-b',other)]);
  const results=await Promise.all(inputs.map(input=>f.call('register',input)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,1);
});
test('different concurrent tokens cannot overwrite the same faction registration',async t=>{
  const f=await fixture(t),a=await f.setup(),b=await f.setup('https://other.example.test');
  const inputs=await Promise.all([f.registration(a,'node-a'),f.registration(b,'node-b',await keys(),'https://other.example.test')]);
  const results=await Promise.all(inputs.map(input=>f.call('register',input)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
});
test('missing signing configuration never consumes a setup token',async t=>{
  const f=await fixture(t),token=await f.setup(),input=await f.registration(token);delete f.env.CHAT_SIGNING_PRIVATE_JWK;
  assert.equal((await f.call('register',input)).status,503);
  assert.equal(f.db.sql.prepare('SELECT used_at FROM faction_chat_setup_tokens').get().used_at,null);
});
test('membership freshness bounds token expiry and old sessions require refresh',async t=>{
  const f=await fixture(t);assert.equal((await f.call('register',await f.registration(await f.setup()))).status,200);
  const now=Math.floor(Date.now()/1000);f.setSession({iat:now-250});
  const result=await f.call('token',{});assert.equal(result.status,200);
  const claims=await verify(result.data.token,f.central.public,{aud:'node-test',issuer:f.issuer,kind:'chat_access'});
  assert.equal(result.data.user_name,'Leader');assert.equal(claims.user_name,'Leader','Chat sender name must remain part of the verified identity');
  assert.equal(claims.exp,now+50);
  f.setSession({iat:now-301});assert.equal((await f.call('token',{})).status,428);
  assert.equal((await f.call('members')).status,428);
  assert.equal((await f.call('discover')).status,428);
});
test('revocation and expired faction license stop token issue and renewal',async t=>{
  const f=await fixture(t);await f.call('register',await f.registration(await f.setup()));
  await f.call('revoke',{faction_id:10});assert.equal((await f.call('token',{})).status,404);
  f.db.sql.exec("UPDATE faction_scope_grants SET status='revoked'");assert.equal((await f.call('token',{})).status,403);
});
test('foreign browser origins are rejected rather than given wildcard CORS',async t=>{
  const f=await fixture(t);assert.equal((await f.call('verification-key',null,{Origin:'https://untrusted.example'})).status,403);
});

test('admin wildcard cannot bypass the faction license or inject Chat Leader authority',async t=>{
  // This fixture deliberately grants every scope check, including admin.*.
  const f=await fixture(t);await f.call('register',await f.registration(await f.setup()));
  f.setSession({user_id:2,scopes:['admin.*','slink.chat.leader'],roles:['admin','leader']});
  const result=await f.call('token',{});assert.equal(result.status,200);
  const claims=await verify(result.data.token,f.central.public,{aud:'node-test',issuer:f.issuer,kind:'chat_access'});
  assert.deepEqual(claims.roles,[]);assert.deepEqual(claims.scopes,['slink.chat','slink.chat.personal.5']);
  f.db.sql.exec('DELETE FROM faction_scope_grants');
  assert.equal((await f.call('token',{})).status,403);
  assert.equal((await f.call('setup-token',{faction_id:10,leader_id:1,endpoint:'https://other.example.test'})).status,403);
});

test('empty shared member directory refreshes from Torn, caches results, and preserves roster on API failure',async t=>{
 const f=await fixture(t);f.db.sql.exec('CREATE TABLE faction_member_roster(faction_id INTEGER,user_id INTEGER,user_name TEXT,position TEXT,level INTEGER,first_seen_at INTEGER,last_seen_at INTEGER,active INTEGER,updated_at INTEGER,PRIMARY KEY(faction_id,user_id))');
 const originalFetch=globalThis.fetch;t.after(()=>{globalThis.fetch=originalFetch;});let calls=0;
 f.services.identity=async key=>{assert.equal(key,'synthetic-member-key');return {userId:1,factionId:10};};
 globalThis.fetch=async(url,options)=>{calls++;assert.equal(url,'https://api.torn.com/v2/faction/10/members');assert.equal(options.headers.Authorization,'ApiKey synthetic-member-key');return Response.json({members:[{id:1,name:'Leader',position:'Leader',level:90},{id:2,name:'Actual Member',position:'Officer',level:50}]});};
 assert.deepEqual((await f.call('members')).data.members,[]);
 const result=await f.call('members',{api_key:'synthetic-member-key'});assert.equal(result.status,200);assert.equal(result.data.members.length,2);assert.equal(result.data.members.find(m=>m.user_id===2).position,'Officer');
 await f.call('members',{api_key:'synthetic-member-key'});assert.equal(calls,1,'Cached roster avoids repeated Torn requests');
 f.db.sql.exec('UPDATE faction_member_roster SET updated_at=1');globalThis.fetch=async()=>Response.json({error:{code:5}},{status:429});
 assert.equal((await f.call('members',{api_key:'synthetic-member-key'})).status,502);assert.equal((await f.call('members')).data.members.length,2,'Failed refresh must not wipe directory');
 f.services.identity=async()=>({userId:999,factionId:10});assert.equal((await f.call('members',{api_key:'wrong-account-key'})).status,403);
});

test('room role claims come from verified permission identity, not request input',async t=>{
 const f=await fixture(t);await f.call('register',await f.registration(await f.setup()));f.setSession({faction_position:'Officer'});
 const result=await f.call('token',{faction_position:'Leader',roles:['leader']});const claims=await verify(result.data.token,f.central.public,{aud:'node-test',issuer:f.issuer,kind:'chat_access'});assert.equal(claims.faction_position,'Officer');assert.deepEqual(claims.roles,[]);
});
