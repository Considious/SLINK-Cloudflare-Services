import {PROTOCOL,VERSION,ACCESS_TTL,ChatError,ensure,id,userId,text,endpoint,body,readText,json,errorResponse,verify,sign,b64,hmac,verifyHmac} from './protocol.js';
export {FactionDirectory} from './directory.js';
export {ChatRoom} from './room.js';

const parsed=new Map();
function config(env,name){const value=env[name];if(typeof value==='object')return value;if(!parsed.has(value))parsed.set(value,JSON.parse(value||'null'));return parsed.get(value);}
function directory(env){const stub=env.DIRECTORY.get(env.DIRECTORY.idFromName('faction:'+env.SLINK_FACTION_ID));return Object.fromEntries(['bootstrap','authorize','list','admin','mutate','addInvitation','link','consumeInvitation','revoke','revokeInternal','findLink','moderate','personal'].map(method=>[method,async(...args)=>{const result=await stub.invoke(method,args);if(!result.ok)throw new ChatError(result.error.code,result.error.message,result.error.status);return result.value;}]));}
function room(env,roomId){return env.ROOMS.get(env.ROOMS.idFromName('room:'+id(roomId)));}
function originAllowed(request,env){const origin=request.headers.get('Origin');if(!origin)return true;/* Extension dashboards have their own origin; protected routes still require signed tickets. */if(/^chrome-extension:\/\/[a-p]{32}$/.test(origin))return true;return String(env.ALLOWED_ORIGINS||'https://www.torn.com').split(',').map(x=>x.trim()).includes(origin);}
async function certificate(env){return verify(env.NODE_CERTIFICATE,config(env,'SLINK_PUBLIC_VERIFY_KEY'),{issuer:env.SLINK_CENTRAL_URL,aud:'slink-node-network',kind:'node_certificate',maxTtl:366*86400});}
async function actor(request,env){let token=request.headers.get('Authorization')?.replace(/^Bearer /,'');if(request.headers.get('Upgrade')?.toLowerCase()==='websocket'){const protocols=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(x=>x.trim());ensure(protocols.includes('slink.chat.v1'),'PROTOCOL_MISMATCH','Update SLINK to connect to this chat node.',426);token=protocols.find(x=>x.startsWith('slink.token.'))?.slice(12);}
  const claims=await verify(token,config(env,'SLINK_PUBLIC_VERIFY_KEY'),{aud:env.SLINK_NODE_ID,issuer:env.SLINK_CENTRAL_URL,kind:'chat_access',maxTtl:ACCESS_TTL});ensure(Number(claims.faction_id)===Number(env.SLINK_FACTION_ID)&&claims.scopes?.includes('slink.chat'),'FACTION_ACCESS_REQUIRED','Your current faction does not have access to this node.',403);userId(claims.user_id);ensure(typeof claims.user_name==='string'&&claims.user_name.length<=100,'INVALID_IDENTITY','Chat identity is incomplete.',401);return claims;
}
async function foreignCertificate(token,env){const c=await verify(token,config(env,'SLINK_PUBLIC_VERIFY_KEY'),{issuer:env.SLINK_CENTRAL_URL,aud:'slink-node-network',kind:'node_certificate',maxTtl:366*86400});ensure(c.status==='active'&&c.node_id!==env.SLINK_NODE_ID,'INVALID_PEER','This is not a valid linked faction node.',403);endpoint(c.endpoint);return c;}
async function handle(request,env){
  const u=new URL(request.url);
  if(request.method==='GET'&&u.pathname==='/health')return json({product:'SLINK Faction Node',version:VERSION,protocol:PROTOCOL,status:env.NODE_CERTIFICATE?'registered':'setup_required',node_id:env.SLINK_NODE_ID});
  ensure(originAllowed(request,env),'ORIGIN_DENIED','This browser origin is not allowed by the faction’s node settings.',403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':request.headers.get('Origin')||'',Vary:'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'}});
  ensure(env.NODE_CERTIFICATE&&env.SLINK_PUBLIC_VERIFY_KEY,'NODE_NOT_REGISTERED','The faction node has not completed registration.',503);
  const ownCert=await certificate(env);ensure(ownCert.node_id===env.SLINK_NODE_ID&&ownCert.faction_id===Number(env.SLINK_FACTION_ID)&&ownCert.endpoint===u.origin,'NODE_IDENTITY_MISMATCH','This node’s registered endpoint or faction does not match its configuration.',503);await directory(env).bootstrap(ownCert);
  if(u.pathname==='/api/node/certificate'&&request.method==='GET')return json({certificate:env.NODE_CERTIFICATE});
  if(u.pathname==='/api/federation/events'&&request.method==='POST'){
    const raw=await readText(request,16384);let e;try{e=JSON.parse(raw);}catch{throw new ChatError('INVALID_JSON','This linked event could not be read.');}const result=await room(env,id(e?.target_room)).receiveRequest(raw,request.headers.get('x-slink-signature'));if(!result.ok)throw new ChatError(result.error.code,result.error.message,result.error.status);return json(result.value);
  }
  if(u.pathname==='/api/federation/accept'&&request.method==='POST'){
    const input=await body(request),peer=await foreignCertificate(input.certificate,env),approval=await verify(input.approval,peer.public_key,{aud:env.SLINK_NODE_ID,issuer:peer.node_id,kind:'link_accept',maxTtl:120});
    ensure(approval.faction_id===peer.faction_id&&approval.endpoint===peer.endpoint,'INVALID_PEER','The link approval does not match the registered node.',403);
    const link=await directory(env).consumeInvitation(id(approval.link_id),{node_id:peer.node_id,faction_id:peer.faction_id,endpoint:peer.endpoint,room_id:id(approval.room_id),user_id:userId(approval.user_id)});return json({ok:true,link_id:link.link_id,secret:link.secret,origin_room:link.room_id});
  }
  if(u.pathname==='/api/federation/revoke'&&request.method==='POST'){
    const raw=await readText(request,4096);const input=JSON.parse(raw),link=await directory(env).findLink(id(input.room_id),id(input.link_id));ensure(Math.abs(Date.now()-input.at)<60000&&input.origin_node===link.remote_node&&await verifyHmac(link.secret,raw,request.headers.get('x-slink-signature')),'INVALID_LINK_EVENT','The revocation could not be authenticated.',401);await directory(env).revokeInternal(input.room_id,input.link_id);return json({ok:true});
  }
  const who=await actor(request,env),registry=directory(env);
  if(u.pathname==='/api/rooms'&&request.method==='GET')return json(await registry.list(who));
  if(u.pathname==='/api/personal-rooms'&&request.method==='POST')return json(await registry.personal(who,await body(request)));
  if(u.pathname==='/api/admin'&&request.method==='GET')return json(await registry.admin(who));
  if(u.pathname==='/api/admin/diagnostics'&&request.method==='GET'){const state=await registry.admin(who),rooms=await Promise.all(state.rooms.map(async item=>({room_id:item.room_id,name:item.name,archived:item.archived,...await room(env,item.room_id).diagnostics()})));return json({version:VERSION,protocol:PROTOCOL,node_id:env.SLINK_NODE_ID,rooms});}
  if(u.pathname==='/api/admin'&&request.method==='POST'){const input=await body(request);ensure(['room.create','room.update','room.archive','member.set','members.set','member.remove','leader.set'].includes(input.action),'INVALID_ACTION','This administration action is not supported.');return json(await registry.mutate(who,input.action,input));}
  const moderation=u.pathname.match(/^\/api\/rooms\/([A-Za-z0-9_-]+)\/moderate$/);if(moderation&&request.method==='POST')return json(await registry.moderate(who,moderation[1],await body(request)));
  const match=u.pathname.match(/^\/api\/rooms\/([a-zA-Z0-9_-]+)\/(socket|history|sync|events)$/);
  if(match){await registry.authorize(who,match[1]);const headers=new Headers(request.headers);headers.set('x-slink-actor',JSON.stringify(who));headers.delete('Authorization');headers.delete('Cookie');return room(env,match[1]).fetch(new Request(request,{headers}));}
  if(u.pathname==='/api/links/invite'&&request.method==='POST'){
    const input=await body(request);await registry.admin(who);const now=Math.floor(Date.now()/1000),linkId=crypto.randomUUID(),target=userId(input.target_faction);ensure(target!==Number(env.SLINK_FACTION_ID),'INVALID_TARGET','Choose another faction.');const invite={link_id:linkId,room_id:id(input.room_id),target_faction:target,exp:(now+1800)*1000,secret:b64(crypto.getRandomValues(new Uint8Array(32)))};await registry.addInvitation(who,invite);
    const invitation=await sign({iss:env.SLINK_NODE_ID,aud:'slink-faction-'+target,kind:'link_invite',protocol:PROTOCOL,iat:now,exp:now+1800,link_id:linkId,room_id:invite.room_id,target_faction:target,origin_endpoint:ownCert.endpoint},config(env,'NODE_PRIVATE_KEY'));
    return json({invitation,certificate:env.NODE_CERTIFICATE,expires_at:invite.exp});
  }
  if(u.pathname==='/api/links/approve'&&request.method==='POST'){
    const input=await body(request);await registry.admin(who);const peer=await foreignCertificate(input.certificate,env),invite=await verify(input.invitation,peer.public_key,{aud:'slink-faction-'+env.SLINK_FACTION_ID,issuer:peer.node_id,kind:'link_invite',maxTtl:1800});ensure(invite.origin_endpoint===peer.endpoint&&invite.target_faction===Number(env.SLINK_FACTION_ID),'WRONG_TARGET','This invitation belongs to another faction.',403);const localRoom=id(input.room_id);await registry.authorize(who,localRoom);const now=Math.floor(Date.now()/1000);
    const approval=await sign({iss:env.SLINK_NODE_ID,aud:peer.node_id,kind:'link_accept',protocol:PROTOCOL,iat:now,exp:now+120,link_id:invite.link_id,room_id:localRoom,faction_id:Number(env.SLINK_FACTION_ID),endpoint:ownCert.endpoint,user_id:who.user_id},config(env,'NODE_PRIVATE_KEY'));
    const response=await fetch(peer.endpoint+'/api/federation/accept',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({certificate:env.NODE_CERTIFICATE,approval})});ensure(response.ok,'LINK_APPROVAL_FAILED','The other faction could not confirm this link. Nothing has been enabled locally.',502);const result=await body(response);ensure(typeof result.secret==='string'&&/^[A-Za-z0-9_-]{43}$/.test(result.secret)&&result.origin_room===invite.room_id,'LINK_APPROVAL_FAILED','The other faction returned an incomplete link confirmation.',502);
    return json(await registry.link(who,{link_id:invite.link_id,room_id:localRoom,remote_node:peer.node_id,remote_faction:peer.faction_id,remote_endpoint:peer.endpoint,remote_room:invite.room_id,secret:result.secret}));
  }
  if(u.pathname==='/api/links/review'&&request.method==='POST'){
    await registry.admin(who);const input=await body(request),peer=await foreignCertificate(input.certificate,env),invite=await verify(input.invitation,peer.public_key,{aud:'slink-faction-'+env.SLINK_FACTION_ID,issuer:peer.node_id,kind:'link_invite',maxTtl:1800});ensure(invite.origin_endpoint===peer.endpoint&&invite.target_faction===Number(env.SLINK_FACTION_ID),'WRONG_TARGET','This invitation belongs to another faction.',403);return json({faction_id:peer.faction_id,node_id:peer.node_id,room_id:invite.room_id,expires_at:invite.exp*1000});
  }
  if(u.pathname==='/api/links/revoke'&&request.method==='POST'){
    const input=await body(request),link=await registry.revoke(who,id(input.room_id),id(input.link_id));const raw=JSON.stringify({link_id:link.link_id,room_id:link.remote_room,origin_node:env.SLINK_NODE_ID,at:Date.now()});let remoteConfirmed=false;try{const response=await fetch(link.remote_endpoint+'/api/federation/revoke',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json','x-slink-signature':await hmac(link.secret,raw)},body:raw});remoteConfirmed=response.ok;}catch{}return json({ok:true,local_revoked:true,remote_confirmed:remoteConfirmed});
  }
  throw new ChatError('NOT_FOUND','This faction node endpoint does not exist.',404);
}
export default {async fetch(request,env){let response;try{response=await handle(request,env);}catch(e){response=errorResponse(e);}if(response.status!==101&&request.headers.get('Origin')&&originAllowed(request,env)){const headers=new Headers(response.headers);headers.set('Access-Control-Allow-Origin',request.headers.get('Origin'));headers.set('Vary','Origin');return new Response(response.body,{status:response.status,headers});}return response;}};
