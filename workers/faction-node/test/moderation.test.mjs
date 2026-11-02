import test from 'node:test';import assert from 'node:assert/strict';import {harness,loadClass,certificate,leader} from './fault-harness.mjs';import {roomAccess} from '../access.js';
const Directory=await loadClass('directory.js','FactionDirectory'),Room=await loadClass('room.js','ChatRoom');
async function fixture(t){const h=harness(t),room=new Room(h.ctx,h.env);h.env.ROOMS.get=()=>room;const directory=new Directory(h.ctx,h.env);await directory.invoke('bootstrap',[certificate]);const actor=(uid,position='Officer')=>({user_id:uid,user_name:'User '+uid,faction_id:10,faction_position:position,exp:Math.floor(h.now/1000)+300});for(const uid of [1,2,3,4])room.insert({message_id:'message-'+uid,user_id:uid,display_name:'User '+uid,origin_node:'node-a',origin_faction_id:10,type:'text',content:{text:'test'},created_at:h.now,revision:1});return {h,room,directory,actor,run:(who,input)=>directory.invoke('moderate',[who,'general',input]),state:()=>directory.state.rooms[0]};}
test('room moderation enforces authority, protects Leaders/peers, validates durations and takes target from message',async t=>{
 const f=await fixture(t),request={message_id:'message-2',action:'mute',duration_minutes:720};assert.equal((await f.run(f.actor(2),request)).error.code,'MODERATOR_REQUIRED');
 await f.directory.invoke('mutate',[leader,'member.set',{room_id:'general',user_id:3,role:'moderator',can_read:true}]);
 assert.equal((await f.run(f.actor(3),{...request,duration_minutes:2})).error.code,'INVALID_MODERATION');assert.equal((await f.run(f.actor(3),{...request,message_id:'message-1'})).error.code,'LEADER_PROTECTED');
 await f.directory.invoke('mutate',[leader,'member.set',{room_id:'general',user_id:4,role:'moderator',can_read:true}]);assert.equal((await f.run(f.actor(3),{...request,message_id:'message-4'})).error.code,'MODERATOR_PROTECTED');
 assert.equal((await f.run(f.actor(3),{...request,user_id:1})).value.user_id,2,'Forged target ID cannot select the protected Leader');
 const config=()=>({...f.state(),leaders:[1]});assert.equal(roomAccess(config(),f.actor(2),f.h.now).read,true);assert.equal(roomAccess(config(),f.actor(2),f.h.now).speak,false);f.h.now+=720*60000;assert.equal(roomAccess(config(),f.actor(2),f.h.now).speak,true);
 const kick=await f.run(f.actor(3),{...request,action:'kick',duration_minutes:15});assert(kick.ok);assert.equal(roomAccess(config(),f.actor(2),f.h.now).read,false);f.h.now+=15*60000;assert.equal(roomAccess(config(),f.actor(2),f.h.now).read,true);
 assert.equal((await f.run(f.actor(3),{...request,action:'leader.set'})).error.code,'INVALID_MODERATION');
 f.room.insert({message_id:'foreign',user_id:88,display_name:'Other faction',origin_node:'node-b',origin_faction_id:11,type:'text',content:{text:'linked'},created_at:f.h.now,revision:1});assert.equal((await f.run(f.actor(3),{...request,message_id:'foreign'})).error.code,'WRONG_FACTION');
});
test('moderation restrictions do not turn role-derived access into a permanent individual grant',async t=>{
 const f=await fixture(t);await f.directory.invoke('mutate',[leader,'room.update',{room_id:'general',visibility:'selected',allowed_positions:['Officer']}]);
 assert((await f.run(f.actor(1),{message_id:'message-2',action:'mute',duration_minutes:15})).ok);let cfg={...f.state(),leaders:[1]};assert.equal(roomAccess(cfg,f.actor(2),f.h.now).read,true);assert.equal(roomAccess(cfg,f.actor(2),f.h.now).speak,false);assert.equal(roomAccess(cfg,f.actor(2,'Member'),f.h.now).read,false);
 f.h.now+=15*60000;assert.equal(roomAccess(cfg,f.actor(2),f.h.now).speak,true);assert.equal(roomAccess(cfg,f.actor(2,'Member'),f.h.now).read,false);
 await f.directory.invoke('mutate',[leader,'member.set',{room_id:'general',user_id:2,muted:false}]);cfg={...f.state(),leaders:[1]};assert.equal(roomAccess(cfg,f.actor(2,'Member'),f.h.now).read,false,'Restore action preserves inheritance rather than granting access');
 const permanent=await f.run(f.actor(1),{message_id:'message-2',action:'kick',duration_minutes:0});assert(permanent.ok);assert.equal(permanent.value.until,null);
});
