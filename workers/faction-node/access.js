import {ensure,userId} from './protocol.js';

// A room's access state is evaluated on the server for every operation, not only at connect.
export function roomAccess(room,actor,now=Date.now()){
  const uid=Number(actor.user_id),sameFaction=Number(actor.faction_id)===Number(room.faction_id);
  if(!sameFaction||room.archived)return {read:false,speak:false,moderate:false,reason:'This room is not available to your faction.'};
  const leader=(room.leaders||[]).includes(uid);
  if(leader)return {read:true,speak:true,moderate:true,leader:true};
  const entry=(room.members||[]).find(member=>Number(member.user_id)===uid);
  const restricted=room.visibility!=='faction';
  const granted=Boolean(entry&&entry.restriction_only!==true&&entry.can_read!==false&&(!entry.access_until||entry.access_until>now));
  const blocked=Boolean(entry?.blocked&&(!entry.blocked_until||entry.blocked_until>now));
  const read=room.visibility!=='leaders'&&!blocked&&(restricted?(granted||entry?.can_read!==false&&(room.allowed_positions||[]).includes(actor.faction_position)):entry?.can_read!==false);
  const muted=Boolean(entry?.muted&&(!entry.muted_until||entry.muted_until>now));
  const speak=read&&!muted&&entry?.can_speak!==false;
  return {read,speak,moderate:read&&entry?.role==='moderator',leader:false,muted:read&&muted,muted_until:muted?entry?.muted_until||null:null,reason:!read?'You do not currently have access to this room.':!speak?'You can read this room, but do not currently have permission to send messages.':null};
}
export function membership(input,now=Date.now(),previous={}){
  for(const key of ['can_read','can_speak','muted','blocked'])if(Object.hasOwn(input,key))ensure(typeof input[key]==='boolean','INVALID_PERMISSION','Choose on or off for this member permission.');
  for(const key of ['access_until','muted_until','blocked_until'])if(Object.hasOwn(input,key)){const value=input[key];ensure(value==null||(Number.isSafeInteger(value)&&value>now&&value<=now+366*86400000),'INVALID_EXPIRY','Choose an expiry within the next year, or leave it empty for no expiry.');}
  const merged={...previous,...input};
  const result={user_id:userId(input.user_id),role:merged.role==='moderator'?'moderator':'member',can_read:merged.can_read!==false,can_speak:merged.can_speak!==false,muted:merged.muted===true,blocked:merged.blocked===true};
  if(previous.restriction_only===true&&!Object.hasOwn(input,'can_read')){result.restriction_only=true;delete result.can_read;}
  for(const key of ['access_until','muted_until','blocked_until'])result[key]=merged[key]||null;
  return result;
}
export function canEditMessage(message,actor){return message.origin_node===actor.node_id&&Number(message.user_id)===Number(actor.user_id)&&!message.deleted_at;}
