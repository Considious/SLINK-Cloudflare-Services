import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {Miniflare,Response as MFResponse} from 'miniflare';
import {testDatabaseSql} from '../prepare-test-database.mjs';
import {bootstrapApprovedTestNode} from '../test-web-bootstrap.js';
import {sign} from '../protocol.js';
test('real hosted Worker completes setup in Cloudflare runtime and keeps Chat Leader separate from admin wildcard',async t=>{
 const central='https://slink-chat-central-test.richard-johnson554.workers.dev',node='https://slink-faction-node-46978-test.richard-johnson554.workers.dev',db=new DatabaseSync(':memory:');db.exec(await testDatabaseSql());t.after(()=>db.close());
 function statement(sql,args=[]){return {bind:(...a)=>statement(sql,a),first:async()=>db.prepare(sql).get(...args)||null,run:async()=>({meta:{changes:db.prepare(sql).run(...args).changes}}),execute:()=>({meta:{changes:db.prepare(sql).run(...args).changes}})};}
 const database={prepare:statement,async batch(statements){db.exec('BEGIN');try{const result=statements.map(s=>s.execute());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
 const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey);
 const env={CHAT_CENTRAL_ISSUER:central,CHAT_TEST_FACTION_ID:'46978',CHAT_SIGNING_PRIVATE_JWK:JSON.stringify(privateKey),API_KEY_ENCRYPTION_KEY:'local-test-only',PERMISSIONS_DB:database};
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../hosted-test-worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
 const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-06',durableObjects:{IDENTITY:{className:'HostedTestIdentity',useSQLite:true},DIRECTORY:{className:'FactionDirectory',useSQLite:true},ROOMS:{className:'ChatRoom',useSQLite:true}},bindings:{SLINK_NODE_ID:'slink-node-46978-hosted-test',SLINK_FACTION_ID:'46978',SLINK_CENTRAL_URL:central},outboundService:async request=>{
  assert.equal(request.url,central+'/api/chat/test-node/bootstrap');const response=await bootstrapApprovedTestNode(new Request(request.url,{method:'POST'}),env,(url,options)=>mf.dispatchFetch(url,options));return new MFResponse(await response.arrayBuffer(),{status:response.status,headers:response.headers});
 }});t.after(()=>mf.dispose());
 const page=await mf.dispatchFetch(node+'/setup');assert.equal(page.status,200);const html=await page.text();assert.ok(html.includes('Finish setup'));assert.equal(html.includes('private_key'),false);
 assert.equal((await mf.dispatchFetch(node+'/api/setup/complete',{method:'POST',headers:{Origin:'https://foreign.example'}})).status,403);
 const done=await mf.dispatchFetch(node+'/api/setup/complete',{method:'POST',headers:{Origin:node}}),result=await done.json();assert.equal(done.status,200,JSON.stringify(result));assert.equal(result.leader_id,3853023);
 const health=await (await mf.dispatchFetch(node+'/health')).json();assert.equal(health.status,'registered');assert.equal(health.node_id,result.node_id);
 const now=Math.floor(Date.now()/1000),token=uid=>sign({iss:central,aud:result.node_id,kind:'chat_access',protocol:1,iat:now,exp:now+300,user_id:uid,user_name:'Test user',faction_id:46978,scopes:['slink.chat','admin.*']},privateKey);
 const admin=await mf.dispatchFetch(node+'/api/admin',{headers:{Authorization:'Bearer '+await token(2)}});assert.equal(admin.status,403,await admin.text());
 const leader=await mf.dispatchFetch(node+'/api/admin',{headers:{Authorization:'Bearer '+await token(3853023)}});assert.equal(leader.status,200);assert.deepEqual((await leader.json()).leaders,[3853023]);
 const connection=await mf.dispatchFetch(node+'/api/rooms/general/socket',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'slink.chat.v1, slink.token.'+await token(2)}});assert.equal(connection.status,101);const socket=connection.webSocket;socket.accept();t.after(()=>socket.close());const events=[];socket.addEventListener('message',event=>events.push(JSON.parse(event.data)));socket.send(JSON.stringify({type:'send',client_id:'hosted-test-message',content:{type:'text',text:'Hosted setup works'}}));
 const started=Date.now();while(!events.some(e=>e.type==='ack')&&Date.now()-started<5000)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(events.some(e=>e.type==='ack'&&e.client_id==='hosted-test-message'),JSON.stringify(events));
 const history=await (await mf.dispatchFetch(node+'/api/rooms/general/history',{headers:{Authorization:'Bearer '+await token(2)}})).json();assert.equal(history.messages[0].content.text,'Hosted setup works');assert.equal(history.messages[0].origin_node,result.node_id);
 const cert=await (await mf.dispatchFetch(node+'/api/node/certificate')).json();assert.equal(Object.keys(cert).join(','),'certificate');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM faction_chat_nodes').get().n,1);
});
