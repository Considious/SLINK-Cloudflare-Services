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
  INSERT INTO faction_scope_grants VALUES(10,'slink.chat','active',0,NULL);`);
  function statement(query,values=[]){return {bind:(...args)=>statement(query,args),first:async()=>sql.prepare(query).get(...values)||null,all:async()=>({results:sql.prepare(query).all(...values)}),run:async()=>({meta:{changes:sql.prepare(query).run(...values).changes}}),execute:()=>({meta:{changes:sql.prepare(query).run(...values).changes}})};}
  return {sql,prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=statements.map(s=>s.execute());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
}
async function keys(){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {private:await crypto.subtle.exportKey('jwk',pair.privateKey),public:await crypto.subtle.exportKey('jwk',pair.publicKey)};}
async function fixture(t){const db=database();db.sql.exec(await readFile(new URL('../../../permissions/migrations/0023-faction-node.sql',import.meta.url),'utf8'));t.after(()=>db.sql.close());const central=await keys(),node=await keys(),issuer='https://central.example.test';const env={PERMISSIONS_DB:db,CHAT_CENTRAL_ISSUER:issuer,CHAT_SIGNING_PRIVATE_JWK:JSON.stringify(central.private)};let session={user_id:1,user_name:'Leader',faction_id:10,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+7200};const services={session:async()=>session,hasScope:()=>true};
  async function call(path,payload,headers={}){const response=await handleFactionNode(new Request(issuer+'/api/chat/'+path,{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',...headers},...(payload?{body:JSON.stringify(payload)}:{})}),env,services);return {status:response.status,data:await response.json()};}
  async function setup(endpoint='https://node.example.test'){const result=await call('setup-token',{faction_id:10,leader_id:1,endpoint});assert.equal(result.status,200);return result.data.registration_token;}
  async function registration(token,nodeId='node-test',key=node,endpoint='https://node.example.test'){const now=Math.floor(Date.now()/1000);return {registration_token:token,node_id:nodeId,faction_id:10,endpoint,protocol:1,public_key:key.public,proof:await sign({iss:nodeId,aud:'slink-node-registration',kind:'node_registration',protocol:1,iat:now,exp:now+120,token_hash:await hash(token),endpoint,faction_id:10},key.private)};}
  return {db,central,node,env,issuer,call,setup,registration,setSession:value=>{session={...session,...value};}};
}
test('registration binds identity, retries safely and cannot be replaced with a new key',async t=>{
  const f=await fixture(t),token=await f.setup(),input=await f.registration(token);
  const first=await f.call('register',input);assert.equal(first.status,200,JSON.stringify(first.data));
  const cert=await verify(first.data.certificate,f.central.public,{aud:'slink-node-network',issuer:f.issuer,kind:'node_certificate',maxTtl:366*86400});assert.equal(cert.leader_id,1);
  const retry=await f.call('register',await f.registration(token));assert.equal(retry.status,200);assert.equal(retry.data.resumed,true);
  assert.equal((await f.call('register',await f.registration(token,'node-test',await keys()))).status,409);
  assert.equal(f.db.sql.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,1);
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
  assert.equal(claims.exp,now+50);
  f.setSession({iat:now-301});assert.equal((await f.call('token',{})).status,428);
});
test('revocation and expired faction license stop token issue and renewal',async t=>{
  const f=await fixture(t);await f.call('register',await f.registration(await f.setup()));
  await f.call('revoke',{faction_id:10});assert.equal((await f.call('token',{})).status,404);
  f.db.sql.exec("UPDATE faction_scope_grants SET status='revoked'");assert.equal((await f.call('token',{})).status,403);
});
test('foreign browser origins are rejected rather than given wildcard CORS',async t=>{
  const f=await fixture(t);assert.equal((await f.call('verification-key',null,{Origin:'https://untrusted.example'})).status,403);
});
