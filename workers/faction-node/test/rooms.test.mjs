import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {sign} from '../protocol.js';

test('real Worker and SQLite rooms enforce Leader changes on existing WebSockets',async t=>{
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',key.privateKey),publicKey=await crypto.subtle.exportKey('jwk',key.publicKey);
  const now=Math.floor(Date.now()/1000),issuer='https://central.example.test',origin='https://node.example.test';
  const cert=await sign({iss:issuer,aud:'slink-node-network',kind:'node_certificate',protocol:1,iat:now,exp:now+86400,node_id:'node-test',faction_id:10,endpoint:origin,leader_id:1,public_key:publicKey},privateKey);
  const bundle=await build({entryPoints:[new URL('../worker.js',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1')],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers']});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-06',durableObjects:{DIRECTORY:{className:'FactionDirectory',useSQLite:true},ROOMS:{className:'ChatRoom',useSQLite:true}},bindings:{SLINK_NODE_ID:'node-test',SLINK_FACTION_ID:'10',SLINK_CENTRAL_URL:issuer,SLINK_PUBLIC_VERIFY_KEY:JSON.stringify(publicKey),NODE_PRIVATE_KEY:JSON.stringify(privateKey),NODE_CERTIFICATE:cert}});
  t.after(()=>mf.dispose());
  const token=async uid=>sign({iss:issuer,aud:'node-test',kind:'chat_access',protocol:1,iat:now,exp:now+300,user_id:uid,user_name:'Test '+uid,faction_id:10,scopes:['slink.chat']},privateKey);
  const leader=await token(1),member=await token(2);
  async function request(path,auth,payload){const response=await mf.dispatchFetch(origin+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});return {status:response.status,data:await response.json()};}
  const admin=async payload=>{const result=await request('/api/admin',leader,payload);assert.equal(result.status,200,JSON.stringify(result.data));return result.data;};
  assert.equal((await request('/api/admin',member)).status,403);
  // Real Worker/SQLite HTTP path for WebViews that refuse WebSocket creation.
  const sync=await request('/api/rooms/general/sync',member);assert.equal(sync.status,200);assert.equal(sync.data.access.speak,true);
  const event={type:'send',client_id:'https-once',command_id:'https-once',content:{type:'text',text:'HTTPS member message'}};
  const sent=await request('/api/rooms/general/events',member,event);assert.equal(sent.status,200);assert.equal(sent.data.events[0].type,'ack');
  const repeat=await request('/api/rooms/general/events',member,event);assert.equal(repeat.data.events[0].message.message_id,sent.data.events[0].message.message_id);
  const latest=await request('/api/rooms/general/sync',member);assert.equal(latest.data.messages.length,1);assert.equal(latest.data.messages[0].display_name,'Test 2');
  await admin({action:'member.set',room_id:'general',user_id:2,muted:true});
  const muted=await request('/api/rooms/general/events',member,{...event,client_id:'muted-https'});assert.equal(muted.data.events[0].code,'ROOM_MUTED');
  await admin({action:'member.remove',room_id:'general',user_id:2});
  assert.equal((await request('/api/rooms/general/sync','bad-token')).status,401);
  const {room_id}=await admin({action:'room.create',name:'Officers',visibility:'selected'});
  await admin({action:'members.set',room_id,user_ids:[4,5],can_read:true,access_until:Date.now()+60000});
  assert.equal((await request('/api/rooms/'+room_id+'/history',await token(4))).status,200);
  const current=(await request('/api/admin',leader)).data.rooms.find(room=>room.room_id===room_id);assert.equal(current.members.filter(entry=>[4,5].includes(entry.user_id)&&entry.can_read).length,2);
  await admin({action:'member.set',room_id,user_id:3,muted:true});
  assert.equal((await request('/api/rooms/'+room_id+'/history',await token(3))).status,403);
  const invalidUpdate=await request('/api/admin',leader,{action:'room.update',room_id,name:'Should not stick',visibility:'invalid'});
  assert.equal(invalidUpdate.status,400);
  assert.equal((await request('/api/admin',leader)).data.rooms.find(room=>room.room_id===room_id).name,'Officers');
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).status,403);
  await admin({action:'member.set',room_id,user_id:2,can_read:true});
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).status,200);
  const response=await mf.dispatchFetch(origin+'/api/rooms/'+room_id+'/socket',{headers:{Upgrade:'websocket','Sec-WebSocket-Protocol':'slink.chat.v1, slink.token.'+member}});
  assert.equal(response.status,101);const socket=response.webSocket;socket.accept();
  const messages=[];let closed=false;socket.addEventListener('message',event=>messages.push(JSON.parse(event.data)));socket.addEventListener('close',()=>{closed=true;});
  async function waitFor(predicate){const start=Date.now();while(Date.now()-start<5000){const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Expected Worker event was not received: '+JSON.stringify(messages));}
  socket.send(JSON.stringify({type:'auth',token:await token(2)}));
  await waitFor(()=>messages.some(m=>m.type==='auth_ack'));
  socket.send(JSON.stringify({type:'auth',token:await token(3)}));
  await waitFor(()=>messages.some(m=>m.type==='error'&&m.code==='IDENTITY_CHANGED'));
  await admin({action:'member.set',room_id,user_id:2,muted:true,muted_until:Date.now()+1000});
  await waitFor(()=>messages.some(m=>m.type==='access'&&m.access.muted));
  socket.send(JSON.stringify({type:'send',client_id:'muted-attempt',content:{type:'text',text:'Must not save'}}));
  await waitFor(()=>messages.some(m=>m.type==='error'&&m.code==='ROOM_MUTED'));
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).data.messages.length,0);
  await waitFor(()=>messages.some(m=>m.type==='access'&&m.access.speak));
  socket.send(JSON.stringify({type:'send',client_id:'unmuted-attempt',content:{type:'text',text:'Allowed after expiry'}}));
  await waitFor(()=>messages.some(m=>m.type==='ack'&&m.client_id==='unmuted-attempt'));
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).data.messages.length,1);
  await admin({action:'member.set',room_id,user_id:2,blocked:true,blocked_until:Date.now()+1000});
  await waitFor(()=>closed);
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).status,403);
  // Expired blocking must restore the pre-existing selected-room grant, not require a fresh grant.
  await waitFor(async()=>(await request('/api/rooms/'+room_id+'/history',member)).status===200);
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).status,200);
  await admin({action:'member.remove',room_id,user_id:2});
  assert.equal((await request('/api/rooms/'+room_id+'/history',member)).status,403);
});
