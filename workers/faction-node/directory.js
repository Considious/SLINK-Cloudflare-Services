import {DurableObject} from 'cloudflare:workers';
import {ChatError,ensure,id,text,userId} from './protocol.js';
import {membership,roomAccess,personalRoomQuota} from './access.js';
function positionGrants(values){ensure(Array.isArray(values)&&values.length<=100&&values.every(value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=100),'INVALID_POSITIONS','Choose valid faction roles.');return [...new Set(values)];}

function roomLook(input){const look={};if(input.icon!==undefined){ensure(['◆','●','★','⚑','☰'].includes(input.icon),'INVALID_ROOM_ICON','Choose a supported room icon.');look.icon=input.icon;}if(input.color!==undefined){ensure(['#563571','#20516d','#2c6049','#784442','#75541e'].includes(input.color),'INVALID_ROOM_COLOR','Choose a supported room color.');look.color=input.color;}return look;}
export class FactionDirectory extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.state=null;this.rates=new Map();ctx.blockConcurrencyWhile(async()=>{await this.reload();});}
  async reload(){this.state=await this.ctx.storage.get('directory')||{leaders:[],rooms:[],audit:[],invites:[],revision:0,pending_sync:[]};this.persisted=structuredClone(this.state);}
  // RPC does not preserve custom Error properties. Return an explicit result envelope instead.
  async invoke(method,args){return this.ctx.blockConcurrencyWhile(async()=>{try{ensure(['bootstrap','authorize','list','admin','mutate','addInvitation','link','consumeInvitation','revoke','revokeInternal','findLink','moderate','personal'].includes(method),'INVALID_ACTION','This directory operation is not supported.');return {ok:true,value:await this[method](...args)};}catch(e){await this.reload();if(e instanceof ChatError)return {ok:false,error:{code:e.code,message:e.message,status:e.status}};console.error('Faction directory operation failed:',e?.name);return {ok:false,error:{code:'DIRECTORY_SAVE_FAILED',message:'This room change could not be fully confirmed. Reopen room management to check the saved state before retrying.',status:503}};}});}
  async personal(actor,input){
    ensure(Number(actor.faction_id)===Number(this.env.SLINK_FACTION_ID),'WRONG_FACTION','This node belongs to another faction.',403);
    const owner=userId(actor.user_id),limit=personalRoomQuota(actor.scopes);
    const owned=this.state.rooms.filter(room=>room.owner_id===owner&&!room.archived);
    const summary=()=>({used:owned.length,limit,rooms:owned.map(({room_id,name,description,icon,color,members})=>({room_id,name,description,icon,color,members}))});
    if(!input)return summary();
    const action=input.action;
    ensure(['create','update','archive','member.set','member.remove'].includes(action),'INVALID_ACTION','Unsupported personal room change.');
    ensure(limit>0||action==='archive','PERSONAL_TIER_REQUIRED','A personal room permission is required.',403);
    this.rateChange(actor);
    let room;
    if(action==='create'){
      const requestId=id(input.request_id),name=text(input.name,60),description=String(input.description||'').slice(0,300);
      const look=roomLook(input),existing=this.state.rooms.find(room=>room.owner_id===owner&&room.request_id===requestId);
      if(existing){
        ensure(!existing.archived&&existing.name===name&&existing.description===description&&Object.keys(look).every(key=>existing[key]===look[key]),'REQUEST_REUSED','Start a new room request.',409);
        if(this.state.pending_sync?.includes(existing.room_id))await this.sync(existing);
        return {room_id:existing.room_id,resumed:true};
      }
      ensure(owned.length<limit,'PERSONAL_ROOM_LIMIT','You have used all your personal room slots.',409);
      ensure(this.state.rooms.length<256,'NODE_ROOM_LIMIT','This node has reached its total room limit.',409);
      room={room_id:crypto.randomUUID(),owner_id:owner,request_id:requestId,faction_id:Number(this.env.SLINK_FACTION_ID),name,description,...look,visibility:'selected',allowed_positions:[],members:[],links:[],archived:false,revision:0};
      this.state.rooms.push(room);
    }else{
      room=owned.find(item=>item.room_id===id(input.room_id));
      ensure(room,'PERSONAL_OWNER_REQUIRED','You can manage only your own personal rooms.',403);
      if(action==='update'){Object.assign(room,roomLook(input));if(input.name!==undefined)room.name=text(input.name,60);if(input.description!==undefined)room.description=String(input.description).slice(0,300);}
      if(action==='archive')room.archived=true;
      if(action.startsWith('member.')){
        const uid=userId(input.user_id);ensure(uid!==owner,'INVALID_MEMBER','The room owner cannot be changed.');
        const index=room.members.findIndex(row=>row.user_id===uid);
        if(action==='member.remove'){if(index>=0)room.members.splice(index,1);}
        else{
          const entry=membership(input,Date.now(),room.members[index]||{can_read:false});
          if(index>=0)room.members[index]=entry;else{ensure(room.members.length<200,'MEMBER_LIMIT','This room has too many members.');room.members.push(entry);}
        }
      }
    }
    room.revision++;this.record(actor,'personal.'+action,room.room_id);await this.save();await this.sync(room);return {room_id:room.room_id};
  }
  leader(actor){return this.state.leaders.includes(Number(actor.user_id));}
  record(actor,action,target){this.state.audit.push({user_id:actor.user_id,action,target,at:Date.now()});this.state.audit=this.state.audit.slice(-500);}
  async save(){const leadersChanged=JSON.stringify(this.state.leaders)!==JSON.stringify(this.persisted.leaders),pending=new Set(this.state.pending_sync||[]);for(const room of this.state.rooms)if(leadersChanged||JSON.stringify(room)!==JSON.stringify(this.persisted.rooms.find(old=>old.room_id===room.room_id)))pending.add(room.room_id);this.state.pending_sync=[...pending];this.state.revision++;await this.ctx.storage.put('directory',this.state);this.persisted=structuredClone(this.state);}
  async bootstrap(certificate){ensure(Number(certificate.faction_id)===Number(this.env.SLINK_FACTION_ID)&&certificate.node_id===this.env.SLINK_NODE_ID,'NODE_IDENTITY_MISMATCH','This node configuration does not match its registration.',503);if(this.state.leaders.length){for(const roomId of [...this.state.pending_sync||[]])await this.sync(this.room(roomId));return;}this.state.leaders=[userId(certificate.leader_id)];const room={room_id:'general',name:'general',description:'Faction chat',visibility:'faction',faction_id:Number(this.env.SLINK_FACTION_ID),members:[],links:[],archived:false,revision:1};this.state.rooms=[room];await this.save();await this.sync(room);}
  materialize(room){return {...room,leaders:room.owner_id?[]:[...this.state.leaders]};}
  async sync(room){await this.env.ROOMS.get(this.env.ROOMS.idFromName('room:'+room.room_id)).configure(this.materialize(room));if(this.state.pending_sync?.includes(room.room_id)){this.state.pending_sync=this.state.pending_sync.filter(roomId=>roomId!==room.room_id);await this.ctx.storage.put('directory',this.state);this.persisted=structuredClone(this.state);}}
  room(roomId){const room=this.state.rooms.find(room=>room.room_id===roomId);ensure(room,'ROOM_NOT_FOUND','This room does not exist.',404);return room;}
  authorize(actor,roomId){ensure(Number(actor.faction_id)===Number(this.env.SLINK_FACTION_ID),'WRONG_FACTION','This node belongs to another faction.',403);const room=this.room(roomId),access=roomAccess(this.materialize(room),actor);ensure(access.read,'ROOM_FORBIDDEN',access.reason,403);return access;}
  async list(actor){ensure(Number(actor.faction_id)===Number(this.env.SLINK_FACTION_ID),'WRONG_FACTION','This node belongs to another faction.',403);return {personal:await this.personal(actor),leader:this.leader(actor),rooms:this.state.rooms.filter(room=>roomAccess(this.materialize(room),actor).read).map(room=>({room_id:room.room_id,name:room.name,description:room.description,icon:room.icon,color:room.color,visibility:room.visibility,personal:!!room.owner_id,access:roomAccess(this.materialize(room),actor),linked_factions:room.links.filter(link=>link.active).map(link=>link.remote_faction)}))};}
  rateChange(actor){const now=Date.now(),key=actor.user_id,entry=this.rates.get(key)||{at:now,count:0};if(now-entry.at>=60000){entry.at=now;entry.count=0;}ensure(entry.count++<30,'ADMIN_RATE_LIMIT','Too many room changes. Wait a minute and try again.',429);this.rates.set(key,entry);}
  requireLeader(actor){ensure(this.leader(actor),'LEADER_REQUIRED','Only an assigned SLINK Chat Leader can change this setting.',403);this.rateChange(actor);}
  async mutate(actor,action,input){this.requireLeader(actor);
    if(action==='room.create'){
      const details={...roomLook(input),name:text(input.name,60),description:typeof input.description==='string'?input.description.slice(0,300):'',visibility:['faction','selected','leaders'].includes(input.visibility)?input.visibility:'selected',allowed_positions:positionGrants(input.allowed_positions||[])},requestId=input.request_id===undefined?null:id(input.request_id),fingerprint=JSON.stringify(details);
      this.state.operations=(this.state.operations||[]).filter(operation=>operation.at>Date.now()-86400000);
      const previous=requestId&&this.state.operations.find(operation=>operation.user_id===actor.user_id&&operation.request_id===requestId&&operation.action===action);
      if(previous){ensure(previous.fingerprint===fingerprint,'REQUEST_REUSED','This room request was already used with different details. Start a new room request.',409);if(this.state.pending_sync?.includes(previous.room_id))await this.sync(this.room(previous.room_id));return {room_id:previous.room_id,resumed:true};}
      ensure(this.state.rooms.length<32,'ROOM_LIMIT','This node supports up to 32 rooms.');const room={room_id:crypto.randomUUID(),faction_id:Number(this.env.SLINK_FACTION_ID),...details,members:[],links:[],archived:false,revision:1};this.state.rooms.push(room);this.record(actor,action,room.room_id);
      if(requestId){this.state.operations.push({user_id:actor.user_id,request_id:requestId,action,fingerprint,room_id:room.room_id,at:Date.now()});this.state.operations=this.state.operations.slice(-200);}
      await this.save();await this.sync(room);return {room_id:room.room_id};
    }
    if(action==='leader.set'){const target=userId(input.user_id);ensure(input.enabled===true||input.enabled===false,'INVALID_ACTION','Choose whether to grant or revoke Leader access.');if(!input.enabled)ensure(this.state.leaders.length>1||!this.state.leaders.includes(target),'LAST_LEADER','Assign another Leader before removing the last Leader.');if(input.enabled&&!this.state.leaders.includes(target))this.state.leaders.push(target);if(!input.enabled)this.state.leaders=this.state.leaders.filter(uid=>uid!==target);this.record(actor,action,target);for(const room of this.state.rooms)room.revision++;await this.save();for(const room of this.state.rooms)await this.sync(room);return {ok:true};}
    const room=this.room(id(input.room_id));
    ensure(!room.owner_id,'PERSONAL_OWNER_REQUIRED','This personal room is managed by its owner.',403);
    if(action==='room.update'){Object.assign(room,roomLook(input));if(input.name!==undefined)room.name=text(input.name,60);if(input.description!==undefined)room.description=String(input.description).slice(0,300);if(input.allowed_positions!==undefined){ensure(Array.isArray(input.allowed_positions)&&input.allowed_positions.length<=100&&input.allowed_positions.every(value=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=100),'INVALID_POSITIONS','Choose valid faction roles.');room.allowed_positions=[...new Set(input.allowed_positions)];}if(input.visibility!==undefined){ensure(['faction','selected','leaders'].includes(input.visibility),'INVALID_VISIBILITY','Choose a supported room access mode.');room.visibility=input.visibility;}}
    else if(action==='room.archive'){room.archived=true;room.links=room.links.map(link=>({...link,active:false}));}
    else if(action==='members.set'){
      ensure(Array.isArray(input.user_ids)&&input.user_ids.length>0&&input.user_ids.length<=200&&typeof input.can_read==='boolean','INVALID_MEMBERS','Choose faction members and whether to grant room access.');
      const ids=[...new Set(input.user_ids.map(userId))];ensure(!ids.some(uid=>this.state.leaders.includes(uid)),'LEADER_PROTECTED','Room overrides cannot remove a Chat Leader.');
      const updates=ids.map(uid=>membership({user_id:uid,can_read:input.can_read,...(input.can_read?{access_until:input.access_until??null}:{})},Date.now(),room.members.find(m=>m.user_id===uid)||{can_read:room.visibility==='faction'}));
      const merged=new Map(room.members.map(entry=>[entry.user_id,entry]));for(const entry of updates)merged.set(entry.user_id,entry);ensure(merged.size<=200,'MEMBER_LIMIT','This room has too many explicit member rules.');room.members=[...merged.values()];
    }
    else if(action==='member.set'){
      const target=userId(input.user_id),previous=room.members.find(m=>m.user_id===target);
      // A mute-only update must not silently grant read access or erase an existing restriction.
      const entry=membership(input,Date.now(),previous||{can_read:room.visibility==='faction'});ensure(!this.state.leaders.includes(entry.user_id),'LEADER_PROTECTED','Change Leader access separately; room overrides cannot mute or remove a Leader.');
      const index=room.members.findIndex(m=>m.user_id===entry.user_id);if(index>=0)room.members[index]=entry;else{ensure(room.members.length<200,'MEMBER_LIMIT','This room has too many explicit member rules.');room.members.push(entry);}
    }else if(action==='member.remove'){const target=userId(input.user_id);room.members=room.members.filter(member=>member.user_id!==target);}
    else throw new Error('Unsupported room action');
    room.revision++;this.record(actor,action,room.room_id);await this.save();await this.sync(room);return {ok:true};
  }
  async moderate(actor,roomId,input){
    const room=this.room(id(roomId)),access=roomAccess(this.materialize(room),actor);ensure(access.moderate,'MODERATOR_REQUIRED','Only this room’s moderators or assigned Chat Leaders can restrict members.',403);
    ensure(['mute','kick'].includes(input.action)&&[0,15,60,720,1440,10080].includes(input.duration_minutes),'INVALID_MODERATION','Choose a supported moderation action and duration.');
    const result=await this.env.ROOMS.get(this.env.ROOMS.idFromName('room:'+room.room_id)).moderationTarget(actor,id(input.message_id));ensure(result.ok,'MODERATION_TARGET_INVALID',result.error||'This message cannot be used for room moderation.',403);
    const target=userId(result.user_id);ensure(Number(result.faction_id)===Number(room.faction_id),'WRONG_FACTION','Only the sender’s own faction node can restrict a linked-faction member.',403);ensure(target!==Number(actor.user_id),'SELF_MODERATION','Use room management rather than restricting yourself.');ensure(!this.state.leaders.includes(target),'LEADER_PROTECTED','Room actions cannot mute or remove an assigned Chat Leader.',403);
    const previous=room.members.find(member=>member.user_id===target);ensure(this.leader(actor)||previous?.role!=='moderator','MODERATOR_PROTECTED','Only a Chat Leader can restrict another room moderator.',403);
    const now=Date.now(),rate=this.rates.get(actor.user_id)||{at:now,count:0};if(now-rate.at>=60000){rate.at=now;rate.count=0;}ensure(rate.count++<30,'ADMIN_RATE_LIMIT','Too many room changes. Wait a minute and try again.',429);this.rates.set(actor.user_id,rate);
    const entry=previous?{...previous}:{user_id:target,restriction_only:true},until=input.duration_minutes?now+input.duration_minutes*60000:null;Object.assign(entry,input.action==='mute'?{muted:true,muted_until:until}:{blocked:true,blocked_until:until});
    if(previous)room.members[room.members.indexOf(previous)]=entry;else{ensure(room.members.length<200,'MEMBER_LIMIT','This room has too many member overrides.');room.members.push(entry);}room.revision++;this.record(actor,'member.'+input.action,{room_id:room.room_id,user_id:target,until});await this.save();await this.sync(room);return {ok:true,user_id:target,until};
  }
  admin(actor){this.requireLeader(actor);return {leaders:this.state.leaders,rooms:this.state.rooms.filter(room=>!room.owner_id).map(({links,...room})=>({...room,links:links.map(({secret,...link})=>link)})),audit:this.state.audit.slice(-100),node_id:this.env.SLINK_NODE_ID,protocol:1};}
  async addInvitation(actor,invite){this.requireLeader(actor);const room=this.room(invite.room_id);ensure(!room.owner_id&&!room.archived,'ROOM_ARCHIVED','Choose an active room.');this.state.invites=this.state.invites.filter(entry=>entry.exp>Date.now());ensure(this.state.invites.length<50,'INVITE_LIMIT','Too many pending invitations.');this.state.invites.push(invite);this.record(actor,'link.invite',invite.link_id);await this.save();}
  getInvitation(linkId){const invite=this.state.invites.find(entry=>entry.link_id===linkId);ensure(invite&&invite.exp>Date.now()&&!invite.used,'INVITE_EXPIRED','This invitation expired or has already been used.',403);return invite;}
  async link(actor,input){this.requireLeader(actor);const room=this.room(id(input.room_id));const existing=room.links.find(link=>link.link_id===input.link_id);if(existing){ensure(existing.active&&existing.remote_node===input.remote_node&&existing.remote_room===input.remote_room,'LINK_REVOKED','This invitation was already used or revoked.',403);return {ok:true,resumed:true};}ensure(!room.owner_id&&!room.archived&&room.links.filter(link=>link.active).length<8,'LINK_LIMIT','This room is archived or already links with eight other nodes.');room.links.push({...input,active:true,created_at:Date.now()});room.revision++;this.record(actor,'link.approved',input.link_id);await this.save();await this.sync(room);return {ok:true};}
  async consumeInvitation(linkId,peer){const existing=this.state.rooms.flatMap(room=>room.links).find(link=>link.link_id===linkId);if(existing){ensure(existing.active&&existing.remote_node===peer.node_id&&existing.remote_room===peer.room_id,'LINK_REVOKED','This invitation has already been used or revoked.',403);return existing;}const invite=this.getInvitation(linkId);ensure(peer.faction_id===invite.target_faction,'WRONG_TARGET','This invitation is for another faction.',403);const room=this.room(invite.room_id);ensure(!room.archived&&room.links.filter(link=>link.active).length<8,'ROOM_UNAVAILABLE','This room can no longer accept the link.');invite.used=true;const link={link_id:linkId,room_id:room.room_id,remote_node:peer.node_id,remote_faction:peer.faction_id,remote_endpoint:peer.endpoint,remote_room:peer.room_id,secret:invite.secret,active:true};room.links.push(link);room.revision++;this.record({user_id:peer.user_id},'link.remote_approval',linkId);await this.save();await this.sync(room);return link;}
  async revoke(actor,roomId,linkId){this.requireLeader(actor);return this.revokeInternal(roomId,linkId,actor.user_id);}
  async revokeInternal(roomId,linkId,actorId=null){const room=this.room(roomId),link=room.links.find(link=>link.link_id===linkId);ensure(link,'LINK_NOT_FOUND','This link does not exist.',404);link.active=false;room.revision++;this.record({user_id:actorId},'link.revoked',linkId);await this.save();await this.sync(room);return {...link};}
  findLink(roomId,linkId){const link=this.room(roomId).links.find(link=>link.link_id===linkId);ensure(link,'LINK_NOT_FOUND','This link does not exist.',404);return {...link};}
}
