import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,loadClass} from './fault-harness.mjs';
import {testDatabaseSql} from '../prepare-test-database.mjs';
import {bootstrapApprovedTestNode} from '../test-web-bootstrap.js';
import {verify} from '../protocol.js';
const Identity=await loadClass('hosted-test-identity.js','HostedTestIdentity');
const CENTRAL='https://slink-chat-central-test.richard-johnson554.workers.dev',NODE='https://slink-faction-node-46978-test.richard-johnson554.workers.dev';
async function fixture(t){
 const h=harness(t);h.now=Date.now();const original=Date.now;Date.now=()=>h.now;t.after(()=>{Date.now=original;});h.db.exec(await testDatabaseSql());
 const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 const privateKey=await crypto.subtle.exportKey('jwk',key.privateKey),publicKey=await crypto.subtle.exportKey('jwk',key.publicKey);
 function statement(sql,args=[]){return {bind:(...a)=>statement(sql,a),first:async()=>h.db.prepare(sql).get(...args)||null,run:async()=>({meta:{changes:h.db.prepare(sql).run(...args).changes}}),execute:()=>({meta:{changes:h.db.prepare(sql).run(...args).changes}})};}
 const db={prepare:statement,async batch(statements){h.db.exec('BEGIN');try{const result=statements.map(s=>s.execute());h.db.exec('COMMIT');return result;}catch(error){h.db.exec('ROLLBACK');throw error;}}};
 const env={CHAT_TEST_FACTION_ID:'46978',CHAT_CENTRAL_ISSUER:CENTRAL,CHAT_SIGNING_PRIVATE_JWK:JSON.stringify(privateKey),API_KEY_ENCRYPTION_KEY:'test-secret-only',PERMISSIONS_DB:db};
 const identity=new Identity(h.ctx,h.env);await h.ctx.blockConcurrencyWhile(async()=>{});
 let sends=0;const send=async(url,options)=>{sends++;assert.equal(url,NODE+'/api/setup/identity-proof');assert.equal(options.redirect,'manual');return Response.json(await identity.registrationProof(JSON.parse(options.body)));};
 const call=(request=new Request(CENTRAL+'/api/chat/test-node/bootstrap',{method:'POST'}),transport=send)=>bootstrapApprovedTestNode(request,env,transport);
 return {h,env,publicKey,identity,call,get sends(){return sends;}};
}
test('web-only setup registers the exact test node and Leader without admin or exported private keys',async t=>{
 const f=await fixture(t),response=await f.call(),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
 const cert=await verify(result.certificate,f.publicKey,{issuer:CENTRAL,aud:'slink-node-network',kind:'node_certificate',maxTtl:366*86400});assert.equal(cert.leader_id,3853023);assert.equal(cert.faction_id,46978);assert.equal(cert.endpoint,NODE);
 assert.equal(JSON.stringify(result).includes('"d"'),false);assert.equal(f.h.db.prepare('SELECT COUNT(*) AS n FROM user_scope_grants').get().n,0);
 await f.identity.accept(result.certificate,result.public_key);const material=await f.identity.material();assert.ok(material.private_key.d);assert.equal(material.certificate,result.certificate);
 const restarted=new Identity(f.h.ctx,f.h.env);await f.h.ctx.blockConcurrencyWhile(async()=>{});assert.equal((await restarted.material()).private_key.d,material.private_key.d);
 f.h.now+=11000;const again=await f.call();assert.equal(again.status,200);assert.equal(f.h.db.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,1);
});
test('web setup cannot bypass the license, change faction/target, or replace an existing identity',async t=>{
 const f=await fixture(t);assert.equal((await f.call(new Request('https://other.example.test/api/chat/test-node/bootstrap',{method:'POST'}))).status,403);assert.equal(f.sends,0);
 const untrusted=new Request(CENTRAL+'/api/chat/test-node/bootstrap',{method:'POST',headers:{Origin:'https://untrusted.example'}});assert.equal((await f.call(untrusted)).status,403);
 f.h.db.exec("UPDATE faction_scope_grants SET status='revoked'");assert.equal((await f.call()).status,403);assert.equal(f.sends,0);
 f.h.db.exec("UPDATE faction_scope_grants SET status='active'");assert.equal((await f.call()).status,200);f.h.now+=11000;f.h.db.exec("UPDATE faction_chat_nodes SET node_id='another-identity'");assert.equal((await f.call()).status,409);assert.equal(f.h.db.prepare('SELECT node_id FROM faction_chat_nodes').get().node_id,'another-identity');
});
test('mismatched ownership challenges and request floods are refused before registration',async t=>{
 const f=await fixture(t);const wrong=async(url,options)=>{const input=JSON.parse(options.body);input.nonce='a'.repeat(43);return Response.json(await f.identity.registrationProof(input));};
 assert.equal((await f.call(undefined,wrong)).status,403);assert.equal(f.h.db.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,0);assert.equal((await f.call()).status,429);assert.equal(f.sends,0);
});
