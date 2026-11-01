import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {Miniflare,Response as MFResponse} from 'miniflare';
import {sign} from '../protocol.js';

test('two real Workers mutually link rooms, deliver once and revoke independently',async t=>{
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey),issuer='https://central.example.test',now=Math.floor(Date.now()/1000);
  const bundle=await build({entryPoints:[fileURLToPath(new URL('../worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
  const nodes=new Map(),deliveries=[];let offline=false;
  for(const faction of [10,20]){
    const endpoint='https://node-'+faction+'.example.test',nodeId='node-'+faction;
    const keyPair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const secret=await crypto.subtle.exportKey('jwk',keyPair.privateKey),pub=await crypto.subtle.exportKey('jwk',keyPair.publicKey);
    const certificate=await sign({iss:issuer,aud:'slink-node-network',kind:'node_certificate',protocol:1,iat:now,exp:now+86400,node_id:nodeId,faction_id:faction,endpoint,leader_id:1,public_key:pub,status:'active'},privateKey);
    const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-06',durableObjects:{DIRECTORY:{className:'FactionDirectory',useSQLite:true},ROOMS:{className:'ChatRoom',useSQLite:true}},bindings:{SLINK_NODE_ID:nodeId,SLINK_FACTION_ID:String(faction),SLINK_CENTRAL_URL:issuer,SLINK_PUBLIC_VERIFY_KEY:JSON.stringify(publicKey),NODE_PRIVATE_KEY:JSON.stringify(secret),NODE_CERTIFICATE:certificate},outboundService:async request=>{
      const url=new URL(request.url),peer=nodes.get(url.origin);if(!peer||offline)return new MFResponse('Unavailable',{status:503});
      const raw=await request.text();if(url.pathname.endsWith('/events'))deliveries.push({url:request.url,raw,headers:Object.fromEntries(request.headers)});
      return peer.mf.dispatchFetch(request.url,{method:request.method,headers:request.headers,body:raw});
    }});
    const auth=await sign({iss:issuer,aud:nodeId,kind:'chat_access',protocol:1,iat:now,exp:now+300,user_id:1,user_name:'Leader '+faction,faction_id:faction,scopes:['slink.chat']},privateKey);
    nodes.set(endpoint,{mf,auth,endpoint});t.after(()=>mf.dispose());
  }
  const [a,b]=[...nodes.values()];
  async function api(node,path,payload){const response=await node.mf.dispatchFetch(node.endpoint+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+node.auth,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});return {status:response.status,data:await response.json()};}
  async function waitFor(predicate){const start=Date.now();while(Date.now()-start<5000){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('Expected linked-room result was not received.');}
  const invite=await api(a,'/api/links/invite',{room_id:'general',target_faction:20});assert.equal(invite.status,200,JSON.stringify(invite.data));
  const approve=await api(b,'/api/links/approve',{room_id:'general',...invite.data});assert.equal(approve.status,200,JSON.stringify(approve.data));
  assert.equal((await api(b,'/api/links/approve',{room_id:'general',...invite.data})).status,200);
  const connection=await a.mf.dispatchFetch(a.endpoint+'/api/rooms/general/socket',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'slink.chat.v1, slink.token.'+a.auth}});assert.equal(connection.status,101);
  const socket=connection.webSocket;socket.accept();t.after(()=>socket.close());const events=[];socket.addEventListener('message',event=>events.push(JSON.parse(event.data)));
  socket.send(JSON.stringify({type:'send',client_id:'first-message',content:{type:'text',text:'Hello linked faction'}}));
  await waitFor(()=>events.some(event=>event.type==='ack'&&event.client_id==='first-message'));
  const history=await waitFor(async()=>{const h=await api(b,'/api/rooms/general/history');return h.data.messages.length===1&&h.data.messages;});
  assert.equal(history[0].origin_faction_id,10);assert.equal(history[0].content.text,'Hello linked faction');
  await waitFor(()=>events.some(event=>event.type==='delivery_confirmed'));
  const first=deliveries[0],duplicate=await b.mf.dispatchFetch(first.url,{method:'POST',headers:first.headers,body:first.raw});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.equal((await api(b,'/api/rooms/general/history')).data.messages.length,1);
  const forged=await b.mf.dispatchFetch(first.url,{method:'POST',headers:{...first.headers,'x-slink-signature':'forged'},body:first.raw});assert.equal(forged.status,401);
  offline=true;socket.send(JSON.stringify({type:'send',client_id:'offline-message',content:{type:'text',text:'Still local'}}));
  await waitFor(()=>events.some(event=>event.type==='ack'&&event.client_id==='offline-message'));
  assert.equal((await api(a,'/api/rooms/general/history')).data.messages.length,2);
  await waitFor(()=>events.some(event=>event.type==='delivery_pending'));
  offline=false;const link=(await api(b,'/api/admin')).data.rooms.find(room=>room.room_id==='general').links[0];
  const revoked=await api(b,'/api/links/revoke',{room_id:'general',link_id:link.link_id});assert.equal(revoked.status,200);assert.equal(revoked.data.remote_confirmed,true);
  const replay=await b.mf.dispatchFetch(first.url,{method:'POST',headers:first.headers,body:first.raw});assert.equal(replay.status,403);
  socket.send(JSON.stringify({type:'send',client_id:'after-revoke',content:{type:'text',text:'No longer shared'}}));
  await waitFor(()=>events.some(event=>event.type==='ack'&&event.client_id==='after-revoke'));
  assert.equal((await api(b,'/api/rooms/general/history')).data.messages.length,1);
});
