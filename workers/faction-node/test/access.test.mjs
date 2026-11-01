import test from 'node:test';
import assert from 'node:assert/strict';
import {roomAccess,membership} from '../access.js';
const now=1800000000000;
const actor={user_id:2,faction_id:10};
const base={faction_id:10,visibility:'faction',leaders:[1],members:[]};
const room=(entry,visibility='faction')=>({...base,visibility,members:[entry]});
test('selected officers-only room is not visible to unassigned members',()=>{
  assert.equal(roomAccess({...base,visibility:'selected'},actor,now).read,false);
  assert.equal(roomAccess(room({user_id:2,can_read:true},'selected'),actor,now).speak,true);
});
test('timed mute preserves reading and ends at the exact expiry',()=>{
  const r=room({user_id:2,muted:true,muted_until:now+1000});
  assert.equal(roomAccess(r,actor,now).read,true);
  assert.equal(roomAccess(r,actor,now).speak,false);
  assert.equal(roomAccess(r,actor,now+1000).speak,true);
});
test('temporary access block ends without needing a cleanup write',()=>{
  const r=room({user_id:2,blocked:true,blocked_until:now+1000});
  assert.equal(roomAccess(r,actor,now).read,false);
  assert.equal(roomAccess(r,actor,now+1000).read,true);
});
test('temporary selected-room grant expires rather than becoming public',()=>{
  const r=room({user_id:2,access_until:now+1000},'selected');
  assert.equal(roomAccess(r,actor,now).read,true);
  assert.equal(roomAccess(r,actor,now+1000).read,false);
});
test('permanent restrictions remain after unrelated timed mute expires',()=>{
  const r=room({user_id:2,can_speak:false,muted:true,muted_until:now-1});
  assert.equal(roomAccess(r,actor,now).speak,false);
  assert.equal(roomAccess(room({user_id:2,blocked:true}),actor,now).read,false);
});
test('Leader-only room excludes selected members; explicit Leaders retain control',()=>{
  const r=room({user_id:2,role:'moderator',can_read:true},'leaders');
  assert.equal(roomAccess(r,actor,now).read,false);
  assert.equal(roomAccess(r,{user_id:1,faction_id:10},now).moderate,true);
  assert.equal(roomAccess(r,{user_id:1,faction_id:11},now).read,false);
});
test('archived room is inaccessible even to Leaders',()=>{
  assert.equal(roomAccess({...base,archived:true},{user_id:1,faction_id:10},now).read,false);
});
test('expiry input rejects invalid, past and overlong timestamps',()=>{
  for(const expiry of [NaN,'tomorrow',now,now-1,now+367*86400000])
    assert.throws(()=>membership({user_id:2,muted_until:expiry},now),{code:'INVALID_EXPIRY'});
  assert.equal(membership({user_id:2,muted:true,muted_until:null},now).muted_until,null);
});
test('mute-only changes preserve room access, speaking rules and expired stored restrictions',()=>{
  const previous={user_id:2,can_read:false,can_speak:false,blocked:true,blocked_until:now-1};
  const updated=membership({user_id:2,muted:true,muted_until:now+60000},now,previous);
  assert.equal(updated.can_read,false);
  assert.equal(updated.can_speak,false);
  assert.equal(updated.blocked_until,now-1);
  assert.equal(updated.muted,true);
  assert.throws(()=>membership({user_id:2,can_read:'false'},now),{code:'INVALID_PERMISSION'});
});
