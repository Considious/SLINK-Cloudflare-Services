import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,loadClass,config,certificate,leader} from './fault-harness.mjs';
import {b64,hmac} from '../protocol.js';
const Directory=await loadClass('directory.js','FactionDirectory'),Room=await loadClass('room.js','ChatRoom');

test('test faction grants management only to its explicitly bootstrapped Leader, never admin wildcard',async t=>{
 const h=harness(t);h.env.SLINK_FACTION_ID='46978';const directory=new Directory(h.ctx,h.env);
 assert.equal((await directory.invoke('bootstrap',[{node_id:'node-a',faction_id:46978,leader_id:3853023}])).ok,true);
 const admin={user_id:2,faction_id:46978,scopes:['admin.*','slink.chat.leader'],roles:['leader']};
 assert.equal((await directory.invoke('list',[admin])).value.leader,false);
 assert.equal((await directory.invoke('admin',[admin])).error.code,'LEADER_REQUIRED');
 assert.equal((await directory.invoke('mutate',[admin,'leader.set',{user_id:2,enabled:true}])).error.code,'LEADER_REQUIRED');
 assert.equal((await directory.invoke('admin',[{user_id:3853023,faction_id:46978,scopes:[]}])).ok,true);
});

test('failed directory writes preserve previous settings and unrelated member rules',async t=>{
 const h=harness(t),directory=new Directory(h.ctx,h.env);assert.equal((await directory.invoke('bootstrap',[certificate])).ok,true);
 await directory.invoke('mutate',[leader,'member.set',{room_id:'general',user_id:2,can_speak:false}]);h.putFault='before';
 const failed=await directory.invoke('mutate',[leader,'room.update',{room_id:'general',name:'Must not stick'}]);assert.equal(failed.ok,false);assert.equal(failed.error.code,'DIRECTORY_SAVE_FAILED');
 const state=(await directory.invoke('admin',[leader])).value;assert.equal(state.rooms[0].name,'general');assert.equal(state.rooms[0].members[0].can_speak,false);
});
test('saved changes awaiting room propagation recover on the next request',async t=>{
 const h=harness(t),directory=new Directory(h.ctx,h.env);await directory.invoke('bootstrap',[certificate]);h.syncFailures=1;
 const failed=await directory.invoke('mutate',[leader,'room.update',{room_id:'general',name:'Persisted name'}]);assert.equal(failed.ok,false);
 assert.deepEqual((await h.ctx.storage.get('directory')).pending_sync,['general']);
 assert.equal((await directory.invoke('bootstrap',[certificate])).ok,true);assert.equal(h.configured.get('room:general').name,'Persisted name');assert.deepEqual((await h.ctx.storage.get('directory')).pending_sync,[]);
});
test('a lost save acknowledgement cannot duplicate a retried room creation',async t=>{
 const h=harness(t),directory=new Directory(h.ctx,h.env);await directory.invoke('bootstrap',[certificate]);h.putFault='after';
 const input={name:'Officers',visibility:'selected',request_id:'create-officers-once'};
 assert.equal((await directory.invoke('mutate',[leader,'room.create',input])).ok,false);
 await directory.invoke('bootstrap',[certificate]);const retried=await directory.invoke('mutate',[leader,'room.create',input]);assert.equal(retried.ok,true);
 const state=(await directory.invoke('admin',[leader])).value;assert.equal(state.rooms.filter(room=>room.name==='Officers').length,1);
 const changed=await directory.invoke('mutate',[leader,'room.create',{...input,name:'Different request'}]);assert.equal(changed.ok,false);
});
test('typing remains ephemeral and performs no SQLite data writes',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env);await room.configure(config);const ws=h.socket();
 const before=h.sql.exec('SELECT total_changes() AS n')[0].n;await room.webSocketMessage(ws,JSON.stringify({type:'typing'}));
 assert.equal(h.sql.exec('SELECT total_changes() AS n')[0].n,before);assert.equal(ws.sent.some(event=>event.type==='typing'),true);
});

test('typing is coalesced across sockets and flood rejection performs no SQLite writes',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env);await room.configure(config);const first=h.socket(),second=h.socket();const before=h.sql.exec('SELECT total_changes() AS n')[0].n;
 await room.webSocketMessage(first,JSON.stringify({type:'typing'}));await room.webSocketMessage(second,JSON.stringify({type:'typing'}));assert.equal(first.sent.filter(event=>event.type==='typing').length,1);
 for(let i=0;i<119;i++)await room.webSocketMessage(second,JSON.stringify({type:'typing'}));assert.equal(second.code,4008);assert.equal(h.sql.exec('SELECT total_changes() AS n')[0].n,before);
});

test('unavailable replies and nonmoderator changes are refused; moderator deletion is audited',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env);await room.configure(config);const ws=h.socket();
 room.insert({message_id:'original',user_id:3,display_name:'Another user',origin_node:'node-a',origin_faction_id:10,type:'text',content:{type:'text',text:'Original'},created_at:h.now});
 await room.webSocketMessage(ws,JSON.stringify({type:'edit',command_id:'edit-denied',message_id:'original',content:{type:'text',text:'Changed'}}));assert.equal(ws.sent.at(-1).code,'MESSAGE_FORBIDDEN');
 await room.webSocketMessage(ws,JSON.stringify({type:'send',client_id:'reply-denied',content:{type:'reply',text:'Reply',reply_to:'missing'}}));assert.equal(ws.sent.at(-1).code,'REPLY_NOT_FOUND');
 await room.configure({...config,revision:2,members:[{user_id:2,role:'moderator',can_read:true,can_speak:true}]});
 await room.webSocketMessage(ws,JSON.stringify({type:'delete',command_id:'delete-approved',message_id:'original'}));assert.ok(h.sql.exec('SELECT deleted_at FROM messages')[0].deleted_at);assert.equal(h.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE action='moderator_delete'")[0].n,1);
});
test('overlapping delivery flushes share one attempt rather than multiplying retries',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env),secret=b64(crypto.getRandomValues(new Uint8Array(32)));await room.configure({...config,links:[{link_id:'link-a',active:true,remote_node:'node-b',remote_room:'general',remote_faction:20,remote_endpoint:'https://remote.example.test',secret}]});
 h.sql.exec('INSERT INTO outbox(event_id,link_id,payload,next_at,expires_at) VALUES(?,?,?,?,?)','event-a','link-a',JSON.stringify({type:'message',message:{message_id:'message-a'}}),h.now,h.now+180000);
 let calls=0,entered;const ready=new Promise(resolve=>{entered=resolve;}),releases=[];h.fetch=()=>{calls++;entered();return new Promise(resolve=>{releases.push(()=>resolve(Response.json({error:'offline'},{status:503})));});};
 const first=room.flush(),second=room.flush();await ready;await new Promise(resolve=>setTimeout(resolve,50));try{assert.equal(calls,1);}finally{for(const release of releases)release();await Promise.allSettled([first,second]);}assert.equal(h.sql.exec('SELECT attempts FROM outbox')[0].attempts,1);
});
test('missing or mismatched delivery acknowledgements stop after the bounded retry budget',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env),ws=h.socket(),secret=b64(crypto.getRandomValues(new Uint8Array(32)));await room.configure({...config,links:[{link_id:'link-a',active:true,remote_node:'node-b',remote_room:'general',remote_faction:20,remote_endpoint:'https://remote.example.test',secret}]});
 h.sql.exec('INSERT INTO outbox(event_id,link_id,payload,next_at,expires_at) VALUES(?,?,?,?,?)','event-a','link-a',JSON.stringify({type:'message',message:{message_id:'message-a'}}),h.now,h.now+180000);
 let calls=0;h.fetch=async()=>{calls++;return Response.json({ok:true,protocol:1,event_id:'wrong-event'});};
 for(let i=0;i<4;i++){await room.flush();const next=h.sql.exec('SELECT next_at FROM outbox')[0];if(next)h.now=next.next_at;}
 assert.equal(calls,3);assert.equal(h.sql.exec('SELECT COUNT(*) AS n FROM outbox')[0].n,0);assert.equal(ws.sent.some(event=>event.type==='delivery_failed'),true);
});
test('rate budgets survive room reinitialization and reset only when their window passes',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env);await room.configure(config);for(let i=0;i<30;i++)room.budget(2,'connections',600000,30);
 const resumed=new Room(h.ctx,h.env);assert.throws(()=>resumed.budget(2,'connections',600000,30),{code:'CHAT_RATE_LIMIT'});h.now+=600000;assert.doesNotThrow(()=>resumed.budget(2,'connections',600000,30));
});
test('retention alarms remove expired history without any connected users',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env);await room.configure(config);
 const message=(id,at)=>({message_id:id,user_id:2,display_name:'User',origin_node:'node-a',origin_faction_id:10,type:'text',content:{type:'text',text:id},created_at:at});room.insert(message('old',h.now-86400000-1));room.insert(message('fresh',h.now));await room.schedule();assert.ok(h.alarm<=h.now+3600000);
 h.now=h.alarm;await room.alarm();assert.deepEqual(h.sql.exec('SELECT message_id FROM messages').map(row=>row.message_id),['fresh']);assert.ok(h.alarm>h.now);
});
test('concurrent linked duplicates and stale edits cannot resurrect a deleted message',async t=>{
 const h=harness(t),room=new Room(h.ctx,h.env),secret=b64(crypto.getRandomValues(new Uint8Array(32)));await room.configure({...config,links:[{link_id:'link-a',active:true,remote_node:'node-b',remote_room:'remote',remote_faction:20,secret}]});
 const message={message_id:'remote-message',user_id:3,display_name:'Remote user',origin_node:'node-b',origin_faction_id:20,type:'text',content:{type:'text',text:'Remote'},created_at:h.now,revision:1};
 async function deliver(eventId,m){const raw=JSON.stringify({protocol:1,link_id:'link-a',event_id:eventId,sent_at:h.now,origin_node:'node-b',origin_room:'remote',target_room:'general',event:{type:'message_update',message:m}});return room.receiveRequest(raw,await hmac(secret,raw));}
 const duplicates=await Promise.all([deliver('same-event',message),deliver('same-event',message)]);assert.ok(duplicates.every(result=>result.ok));assert.equal(h.sql.exec('SELECT COUNT(*) AS n FROM messages')[0].n,1);
 await deliver('delete-event',{...message,content:{},revision:2,deleted_at:h.now});await deliver('later-edit',{...message,revision:3,text:'Must not return'});assert.ok(h.sql.exec('SELECT deleted_at FROM messages')[0].deleted_at);
});
