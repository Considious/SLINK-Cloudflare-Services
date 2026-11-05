import {DurableObject} from 'cloudflare:workers';
import {PROTOCOL,ACCESS_TTL,ChatError,body,readText,json,ensure,id,messageContent,encoder,errorResponse,hmac,verifyHmac,verify} from './protocol.js';
import {roomAccess,canEditMessage} from './access.js';

export class ChatRoom extends DurableObject{
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.sql=ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS room_config (id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS messages (seq INTEGER PRIMARY KEY AUTOINCREMENT,message_id TEXT UNIQUE NOT NULL,user_id INTEGER NOT NULL,display_name TEXT NOT NULL,origin_node TEXT NOT NULL,origin_faction_id INTEGER NOT NULL,type TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL,edited_at INTEGER,deleted_at INTEGER,reply_to TEXT,revision INTEGER NOT NULL DEFAULT 1,client_id TEXT,UNIQUE(origin_node,user_id,client_id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS reads (user_id INTEGER PRIMARY KEY,seq INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS inbox (link_id TEXT NOT NULL,event_id TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(link_id,event_id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS outbox (event_id TEXT NOT NULL,link_id TEXT NOT NULL,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(event_id,link_id))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action TEXT NOT NULL,target TEXT,created_at INTEGER NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS budgets (user_id INTEGER NOT NULL,bucket TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(user_id,bucket))`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS messages_retention ON messages(created_at)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS messages_edited ON messages(edited_at) WHERE edited_at IS NOT NULL`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS messages_deleted ON messages(deleted_at) WHERE deleted_at IS NOT NULL`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS inbox_retention ON inbox(created_at)`);
    this.config=null;
  }
  all(query,...params){return [...this.sql.exec(query,...params)];}
  room(){if(!this.config){const row=this.all('SELECT json FROM room_config WHERE id=1')[0];ensure(row,'ROOM_NOT_FOUND','This room has not been created.',404);this.config=JSON.parse(row.json);}return this.config;}
  actor(ws){return ws.deserializeAttachment();}
  valid(actor){ensure(actor&&actor.exp*1000>Date.now(),'ACCESS_EXPIRED','Your chat access expired. Reconnect through SLINK.',401);return roomAccess(this.room(),actor);}
  async configure(config){
    const previous=this.config||this.all('SELECT json FROM room_config WHERE id=1').map(row=>JSON.parse(row.json))[0];
    if(previous&&Number(config.revision)<Number(previous.revision))return;
    this.sql.exec('INSERT INTO room_config(id,json) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json',JSON.stringify(config));this.config=config;
    for(const ws of this.ctx.getWebSockets()){const actor=this.actor(ws),access=roomAccess(config,actor);if(!access.read){this.send(ws,{type:'access_revoked',reason:access.reason});ws.close(4003,'Room access removed');}else this.send(ws,{type:'access',access});}
    if(config.archived)for(const ws of this.ctx.getWebSockets())ws.close(4003,'Room archived');
    // Revoke queued deliveries when a link is severed.
    const active=new Set((config.links||[]).filter(link=>link.active).map(link=>link.link_id));
    for(const row of this.all('SELECT DISTINCT link_id FROM outbox'))if(!active.has(row.link_id))this.sql.exec('DELETE FROM outbox WHERE link_id=?',row.link_id);
    await this.schedule();
  }
  send(ws,event){try{ws.send(JSON.stringify({protocol:PROTOCOL,...event}));}catch{/* Closed socket; never retry a user broadcast. */}}
  broadcast(event){for(const ws of this.ctx.getWebSockets()){try{if(this.valid(this.actor(ws)).read)this.send(ws,event);else ws.close(4003,'Room access removed');}catch{ws.close(4001,'Access expired');}}}
  presence(){const users=new Map();for(const ws of this.ctx.getWebSockets()){const a=this.actor(ws);if(a.exp*1000>Date.now()&&roomAccess(this.room(),a).read)users.set(a.user_id,{user_id:a.user_id,display_name:a.user_name});}return [...users.values()];}
  history(actor,before=Number.MAX_SAFE_INTEGER){ensure(this.valid(actor).read,'ROOM_FORBIDDEN','You cannot read this room.',403);const rows=this.all('SELECT * FROM messages WHERE seq<? ORDER BY seq DESC LIMIT 50',before);const last=this.all('SELECT seq FROM reads WHERE user_id=?',actor.user_id)[0]?.seq||0;const unread=this.all('SELECT COUNT(*) AS count FROM messages WHERE seq>? AND user_id<>? AND deleted_at IS NULL',last,actor.user_id)[0].count;return {messages:rows.reverse().map(row=>this.present(row)),unread,next_before:rows[0]?.seq||null};}
  present(row){return {...row,content:row.deleted_at?null:JSON.parse(row.content),client_id:undefined};}
  moderationTarget(actor,messageId){try{ensure(this.valid(actor).moderate,'MODERATOR_REQUIRED','Room moderation permission is required.',403);const row=this.all('SELECT user_id,origin_faction_id FROM messages WHERE message_id=?',id(messageId))[0];ensure(row,'MESSAGE_NOT_FOUND','This message is no longer available.',404);return {ok:true,user_id:row.user_id,faction_id:row.origin_faction_id};}catch(error){return {ok:false,error:error.message};}}
  async fetch(request){try{
    // Only the router Worker calls this binding. It overwrites identity headers after verification.
    const actor=JSON.parse(request.headers.get('x-slink-actor')||'null'),u=new URL(request.url);ensure(actor,'AUTH_REQUIRED','Sign in through SLINK first.',401);
    if(u.pathname.endsWith('/sync')&&request.method==='GET'){
      const access=this.valid(actor);ensure(access.read,'ROOM_FORBIDDEN',access.reason,403);this.budget(actor.user_id,'https_reads',60000,30);
      const after=Number(u.searchParams.get('after')||0),changed=Number(u.searchParams.get('changed')||0),stamp=Date.now();ensure(Number.isSafeInteger(after)&&after>=0&&Number.isSafeInteger(changed)&&changed>=0,'INVALID_CURSOR','Reconnect to reset this room cursor.');
      if(u.searchParams.get('delta')==='1'){
        if(!changed){
          const history=this.history(actor);
          return json({protocol:PROTOCOL,type:'welcome',access,...history,presence:this.presence(),after:history.messages.at(-1)?.seq||0,changed:stamp,more:false});
        }
        const delta=this.all('SELECT * FROM messages WHERE seq>? ORDER BY seq LIMIT 201',after);
        const updates=this.all('SELECT * FROM messages WHERE (edited_at>=? OR deleted_at>=?) AND seq<=? ORDER BY seq LIMIT 301',changed,changed,after);
        ensure(updates.length<=300,'CHAT_RESYNC_REQUIRED','Too many messages changed at once. Press Reconnect to refresh this room.',409);
        const batch=delta.slice(0,200),more=delta.length>200;
        const last=this.all('SELECT seq FROM reads WHERE user_id=?',actor.user_id)[0]?.seq||0;
        const unread=this.all('SELECT COUNT(*) AS count FROM messages WHERE seq>? AND user_id<>? AND deleted_at IS NULL',last,actor.user_id)[0].count;
        return json({protocol:PROTOCOL,type:'welcome',access,unread,messages:[...batch,...updates].map(row=>this.present(row)),presence:this.presence(),after:batch.at(-1)?.seq||after,changed:more?changed:stamp,more});
      }
      const history=this.history(actor),delta=this.all('SELECT * FROM messages WHERE seq>? ORDER BY seq LIMIT 201',after),updates=changed?this.all('SELECT * FROM messages WHERE edited_at>=? OR deleted_at>=? ORDER BY seq LIMIT 301',changed,changed):[];
      ensure(updates.length<=300,'CHAT_RESYNC_REQUIRED','Too many messages changed at once. Press Reconnect to refresh this room.',409);
      const more=delta.length>200,batch=delta.slice(0,200),messages=[...new Map([...history.messages,...batch.map(row=>this.present(row)),...updates.map(row=>this.present(row))].map(message=>[message.message_id,message])).values()];
      return json({protocol:PROTOCOL,type:'welcome',access,...history,messages,presence:this.presence(),after:batch.at(-1)?.seq||after,changed:more?changed:stamp,more});
    }
    if(u.pathname.endsWith('/events')&&request.method==='POST'){
      const raw=await readText(request,8192),input=JSON.parse(raw);ensure(['send','read','typing','edit','delete'].includes(input?.type),'INVALID_EVENT','Unsupported chat action.');this.valid(actor);this.budget(actor.user_id,'https_events',60000,120);
      const events=[],socket={deserializeAttachment:()=>actor,send:raw=>events.push(JSON.parse(raw)),close(){}};await this.webSocketMessage(socket,raw);if(['edit','delete'].includes(input.type)&&events.some(event=>event.type==='action_ack')){const row=this.all('SELECT * FROM messages WHERE message_id=?',input.message_id)[0];events.unshift({protocol:PROTOCOL,type:'message_update',message:this.present(row)});}return json({events});
    }
    if(u.pathname.endsWith('/history'))return json(this.history(actor,Number(u.searchParams.get('before'))||Number.MAX_SAFE_INTEGER));
    ensure(request.headers.get('Upgrade')?.toLowerCase()==='websocket','WEBSOCKET_REQUIRED','Open this room through SLINK chat.',426);
    ensure(this.valid(actor).read,'ROOM_FORBIDDEN','You cannot read this room.',403);
    ensure(this.ctx.getWebSockets().length<500,'ROOM_FULL','This room has reached its connection limit. Try again later.',503);
    ensure(this.ctx.getWebSockets().filter(ws=>this.actor(ws).user_id===actor.user_id).length<3,'TOO_MANY_CONNECTIONS','This account already has three connections to this room. Close an extra tab.',429);
    this.budget(actor.user_id,'connections',600000,30);
    const [client,server]=Object.values(new WebSocketPair());this.ctx.acceptWebSocket(server);server.serializeAttachment({...actor,typing_at:0});
    this.send(server,{type:'welcome',room:{room_id:this.room().room_id,name:this.room().name},access:this.valid(actor),...this.history(actor),presence:this.presence()});this.broadcast({type:'presence',users:this.presence()});await this.schedule();
    return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':'slink.chat.v1'}});
  }catch(e){return errorResponse(e);}}
  budget(uid,bucket,period,limit){const window=Math.floor(Date.now()/period),row=this.all('SELECT window,count FROM budgets WHERE user_id=? AND bucket=?',uid,bucket)[0],count=row?.window===window?row.count:0;ensure(count<limit,'CHAT_RATE_LIMIT','Too many chat requests. Wait a moment before trying again.',429);this.sql.exec('INSERT INTO budgets(user_id,bucket,window,count) VALUES(?,?,?,?) ON CONFLICT(user_id,bucket) DO UPDATE SET window=excluded.window,count=excluded.count',uid,bucket,window,count+1);}
  rate(actor){this.ctx.storage.transactionSync(()=>{this.budget(actor.user_id,'actions',60000,30);this.budget(actor.user_id,'burst',1000,5);});}
  controlRate(actor){this.budget(actor.user_id,'events',60000,120);}
  frameRate(actor){const window=Math.floor(Date.now()/60000),peers=this.ctx.getWebSockets().filter(ws=>this.actor(ws).user_id===actor.user_id),count=Math.max(0,...peers.map(ws=>this.actor(ws).frames).filter(value=>value?.window===window).map(value=>value.count));ensure(count<120,'CHAT_RATE_LIMIT','Too many chat updates. Wait a minute before reconnecting.',429);for(const ws of peers){const attachment=this.actor(ws);attachment.frames={window,count:count+1};ws.serializeAttachment(attachment);}}
  async webSocketMessage(ws,raw){
    let commandId=null;
    try{const actor=this.actor(ws);this.frameRate(actor);ensure(typeof raw==='string'&&encoder.encode(raw).length<=8192,'MESSAGE_TOO_LARGE','This message exceeds the 8 KB transport limit.',413);const m=JSON.parse(raw);ensure(m&&typeof m==='object'&&!Array.isArray(m),'INVALID_EVENT','This chat action could not be read.');commandId=typeof m.command_id==='string'?id(m.command_id):null;const access=this.valid(actor);ensure(access.read,'ROOM_FORBIDDEN','Your access to this room has ended.',403);
      if(m.type==='typing'){ensure(access.speak,'ROOM_MUTED',access.reason,403);const peers=this.ctx.getWebSockets().filter(peer=>this.actor(peer).user_id===actor.user_id),last=Math.max(0,...peers.map(peer=>this.actor(peer).typing_at||0));if(Date.now()-last>2500){for(const peer of peers){const attachment=this.actor(peer);attachment.typing_at=Date.now();peer.serializeAttachment(attachment);}this.broadcast({type:'typing',user_id:actor.user_id,expires_at:Date.now()+5000});}return;}
      this.controlRate(actor);
      if(m.type==='auth'){const claims=await verify(m.token,typeof this.env.SLINK_PUBLIC_VERIFY_KEY==='string'?JSON.parse(this.env.SLINK_PUBLIC_VERIFY_KEY):this.env.SLINK_PUBLIC_VERIFY_KEY,{issuer:this.env.SLINK_CENTRAL_URL,aud:this.env.SLINK_NODE_ID,kind:'chat_access',maxTtl:ACCESS_TTL});ensure(claims.user_id===actor.user_id&&claims.faction_id===actor.faction_id&&claims.scopes?.includes('slink.chat'),'IDENTITY_CHANGED','Reconnect to change chat accounts.',403);const current=this.actor(ws);ws.serializeAttachment({...current,exp:claims.exp,user_name:claims.user_name,faction_position:claims.faction_position});this.send(ws,{type:'auth_ack',expires_at:claims.exp*1000});await this.schedule();return;}
      if(m.type==='read'){const seq=Number(m.seq);ensure(Number.isSafeInteger(seq)&&seq>=0,'INVALID_CURSOR','The read position is invalid.');const last=this.all('SELECT COALESCE(MAX(seq),0) AS seq FROM messages')[0].seq;ensure(seq<=last,'INVALID_CURSOR','The read position is ahead of this room.');this.sql.exec('INSERT INTO reads(user_id,seq) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET seq=excluded.seq WHERE reads.seq<excluded.seq',actor.user_id,seq);this.send(ws,{type:'read_ack',seq});return;}
      this.rate(actor);
      if(m.type==='send'){
        ensure(access.speak,'ROOM_MUTED',access.reason,403);const content=messageContent(m.content),clientId=id(m.client_id);const existing=this.all('SELECT * FROM messages WHERE origin_node=? AND user_id=? AND client_id=?',this.env.SLINK_NODE_ID,actor.user_id,clientId)[0];if(existing){this.send(ws,{type:'ack',client_id:clientId,message:this.present(existing)});return;}
        if(content.reply_to)ensure(this.all('SELECT message_id FROM messages WHERE message_id=?',content.reply_to).length,'REPLY_NOT_FOUND','The message you are replying to is no longer available.',404);
        const message={message_id:crypto.randomUUID(),user_id:actor.user_id,display_name:actor.user_name,origin_node:this.env.SLINK_NODE_ID,origin_faction_id:Number(this.env.SLINK_FACTION_ID),type:content.type,content,created_at:Date.now(),revision:1,reply_to:content.reply_to||null};
        this.insert(message,clientId);const row=this.all('SELECT * FROM messages WHERE message_id=?',message.message_id)[0];this.broadcast({type:'message',message:this.present(row)});this.send(ws,{type:'ack',client_id:clientId,message:this.present(row)});this.ctx.waitUntil(this.queueEvent({type:'message',message}));this.prune();await this.schedule();return;
      }
      ensure(['edit','delete'].includes(m.type),'UNKNOWN_EVENT','This chat action is not supported.');const row=this.all('SELECT * FROM messages WHERE message_id=?',id(m.message_id))[0];ensure(row,'MESSAGE_NOT_FOUND','This message is no longer available.',404);
      const own=canEditMessage(row,{...actor,node_id:this.env.SLINK_NODE_ID});ensure(own||(m.type==='delete'&&access.moderate),'MESSAGE_FORBIDDEN','You can only change your own messages unless you moderate this room.',403);if(m.type==='edit')ensure(access.speak,'ROOM_MUTED',access.reason,403);
      const now=Date.now();if(m.type==='edit'){const content=messageContent(m.content);if(content.reply_to)ensure(this.all('SELECT message_id FROM messages WHERE message_id=?',content.reply_to).length,'REPLY_NOT_FOUND','The replied-to message is no longer available.',404);this.sql.exec('UPDATE messages SET content=?,type=?,reply_to=?,edited_at=?,revision=revision+1 WHERE message_id=?',JSON.stringify(content),content.type,content.reply_to||null,now,row.message_id);}else{this.sql.exec('UPDATE messages SET content=?,deleted_at=?,revision=revision+1 WHERE message_id=?','{}',now,row.message_id);if(!own)this.sql.exec('INSERT INTO audit(user_id,action,target,created_at) VALUES(?,?,?,?)',actor.user_id,'moderator_delete',row.message_id,now);}
      const updated=this.all('SELECT * FROM messages WHERE message_id=?',row.message_id)[0];this.broadcast({type:'message_update',message:this.present(updated)});if(row.origin_node===this.env.SLINK_NODE_ID)this.ctx.waitUntil(this.queueEvent({type:'message_update',message:{...updated,content:JSON.parse(updated.content)}}));this.send(ws,{type:'action_ack',command_id:commandId});
    }catch(e){this.send(ws,{type:'error',command_id:commandId,code:e instanceof ChatError?e.code:'INVALID_EVENT',error:e instanceof ChatError?e.message:'This chat action could not be completed. Reconnect and retry once.'});if(e.status===401)ws.close(4001,'Access expired');else if(e.status===429)ws.close(4008,'Chat rate limit');else if(e.status===413||e instanceof SyntaxError)ws.close(4002,'Invalid chat frame');}
  }
  insert(m,clientId=null){this.sql.exec('INSERT INTO messages(message_id,user_id,display_name,origin_node,origin_faction_id,type,content,created_at,edited_at,deleted_at,reply_to,revision,client_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',m.message_id,m.user_id,m.display_name,m.origin_node,m.origin_faction_id,m.type,JSON.stringify(m.content),m.created_at,m.edited_at||null,m.deleted_at||null,m.reply_to||null,m.revision||1,clientId);}
  async webSocketClose(ws){ws.close();this.broadcast({type:'presence',users:this.presence()});}
  async webSocketError(ws){ws.close(1011,'Connection interrupted');}
  async queueEvent(event){
    const links=(this.room().links||[]).filter(link=>link.active);if(!links.length)return;
    if(this.all('SELECT COUNT(*) AS count FROM outbox')[0].count+links.length>1000){this.broadcast({type:'delivery_failed',message_id:event.message.message_id,reason:'Local message saved, but the linked faction delivery queue is full.'});return;}
    const eventId=crypto.randomUUID(),now=Date.now();for(const link of links)this.sql.exec('INSERT INTO outbox(event_id,link_id,payload,next_at,expires_at) VALUES(?,?,?,?,?)',eventId,link.link_id,JSON.stringify(event),now,now+180000);
    await this.flush();await this.schedule();
  }
  async flush(){if(this.flushing)return this.flushing;const current=this.flushOnce();this.flushing=current;try{return await current;}finally{if(this.flushing===current)this.flushing=null;}}
  async flushOnce(){
    const now=Date.now();for(const row of this.all('SELECT * FROM outbox WHERE expires_at<=? OR attempts>=3',now)){this.broadcast({type:'delivery_failed',event_id:row.event_id,message_id:JSON.parse(row.payload).message.message_id,link_id:row.link_id,reason:'Local message saved. Delivery to a linked faction could not be confirmed.'});this.sql.exec('DELETE FROM outbox WHERE event_id=? AND link_id=?',row.event_id,row.link_id);}
    for(const row of this.all('SELECT * FROM outbox WHERE next_at<=? ORDER BY next_at LIMIT 12',now)){
      const link=this.room().links?.find(link=>link.link_id===row.link_id&&link.active);if(!link){this.sql.exec('DELETE FROM outbox WHERE event_id=? AND link_id=?',row.event_id,row.link_id);continue;}
      const payload=JSON.stringify({protocol:PROTOCOL,link_id:link.link_id,event_id:row.event_id,sent_at:now,origin_node:this.env.SLINK_NODE_ID,origin_room:this.room().room_id,target_room:link.remote_room,event:JSON.parse(row.payload)});
      try{const response=await fetch(link.remote_endpoint+'/api/federation/events',{method:'POST',headers:{'Content-Type':'application/json','x-slink-signature':await hmac(link.secret,payload)},body:payload,redirect:'manual',signal:AbortSignal.timeout(5000)});ensure(response.ok,'LINK_DELIVERY','Remote delivery failed.',502);const ack=await body(response);ensure(ack.ok===true&&ack.protocol===PROTOCOL&&ack.event_id===row.event_id,'LINK_DELIVERY','Remote delivery was not acknowledged.',502);this.sql.exec('DELETE FROM outbox WHERE event_id=? AND link_id=?',row.event_id,row.link_id);this.broadcast({type:'delivery_confirmed',event_id:row.event_id,message_id:JSON.parse(row.payload).message.message_id,link_id:row.link_id});}catch{this.sql.exec('UPDATE outbox SET attempts=attempts+1,next_at=? WHERE event_id=? AND link_id=?',now+[5000,30000,120000][Math.min(row.attempts,2)],row.event_id,row.link_id);this.broadcast({type:'delivery_pending',event_id:row.event_id,message_id:JSON.parse(row.payload).message.message_id,link_id:row.link_id});}
    }
  }
  async receiveRequest(raw,signature){try{return {ok:true,value:await this.receive(raw,signature)};}catch(e){return {ok:false,error:{code:e instanceof ChatError?e.code:'INVALID_LINK_EVENT',message:e instanceof ChatError?e.message:'This linked event could not be read.',status:e instanceof ChatError?e.status:400}};}}
  async receive(raw,signature){const envelope=JSON.parse(raw),link=this.room().links?.find(link=>link.link_id===envelope?.link_id&&link.active);ensure(link&&envelope.origin_node===link.remote_node&&envelope.origin_room===link.remote_room&&envelope.target_room===this.room().room_id,'LINK_REVOKED','This room link is not active.',403);ensure(envelope.protocol===PROTOCOL&&['message','message_update'].includes(envelope.event?.type)&&Number.isSafeInteger(envelope.sent_at)&&Math.abs(Date.now()-envelope.sent_at)<60000&&await verifyHmac(link.secret,raw,signature),'INVALID_LINK_EVENT','The room link event could not be authenticated.',401);id(envelope.event_id);if(this.all('SELECT event_id FROM inbox WHERE link_id=? AND event_id=?',link.link_id,envelope.event_id).length)return {ok:true,protocol:PROTOCOL,event_id:envelope.event_id,duplicate:true};
    const m=envelope.event?.message;ensure(m&&m.origin_node===link.remote_node&&m.origin_faction_id===link.remote_faction&&Number.isSafeInteger(m.user_id)&&m.user_id>0&&typeof m.display_name==='string'&&m.display_name.trim()&&m.display_name.length<=100&&Number.isSafeInteger(m.created_at)&&m.created_at>0&&m.created_at<=Date.now()+15000&&Number.isSafeInteger(m.revision)&&m.revision>0&&m.revision<=1000000000,'INVALID_LINK_MESSAGE','The linked message identity is invalid.');id(m.message_id);for(const field of ['edited_at','deleted_at'])ensure(m[field]==null||(Number.isSafeInteger(m[field])&&m[field]>=m.created_at&&m[field]<=Date.now()+15000),'INVALID_LINK_MESSAGE','The linked message timestamp is invalid.');ensure(['text','reply','media'].includes(m.type),'INVALID_LINK_MESSAGE','The linked message type is invalid.');if(!m.deleted_at){m.content=messageContent(m.content);ensure(m.type===m.content.type,'INVALID_LINK_MESSAGE','The linked message content does not match its type.');}else m.content={};m.reply_to=m.content.reply_to||null;
    this.ctx.storage.transactionSync(()=>{const existing=this.all('SELECT * FROM messages WHERE message_id=?',m.message_id)[0];if(existing){ensure(existing.origin_node===link.remote_node&&existing.user_id===m.user_id,'INVALID_LINK_MESSAGE','The linked message identity does not match.');if(Number(m.revision)>existing.revision&&(!existing.deleted_at||m.deleted_at))this.sql.exec('UPDATE messages SET content=?,type=?,reply_to=?,edited_at=?,deleted_at=?,revision=? WHERE message_id=?',JSON.stringify(m.content),m.type,m.reply_to,m.edited_at||null,m.deleted_at||null,m.revision,m.message_id);}else this.insert(m);this.sql.exec('INSERT INTO inbox(link_id,event_id,created_at) VALUES(?,?,?)',link.link_id,envelope.event_id,Date.now());});
    const row=this.all('SELECT * FROM messages WHERE message_id=?',m.message_id)[0];this.broadcast({type:envelope.event.type==='message'?'message':'message_update',message:this.present(row)});this.prune();await this.schedule();return {ok:true,protocol:PROTOCOL,event_id:envelope.event_id};
  }
  retentionMs(){return Math.max(1,Math.min(365,Number(this.env.RETENTION_DAYS)||30))*86400000;}
  prune(){const cutoff=Date.now()-this.retentionMs(),max=Math.max(100,Math.min(50000,Number(this.env.MAX_ROOM_MESSAGES)||10000));this.sql.exec('DELETE FROM messages WHERE created_at<?',cutoff);this.sql.exec('DELETE FROM messages WHERE seq<=(SELECT COALESCE(MAX(seq),0)-? FROM messages)',max);this.sql.exec('DELETE FROM inbox WHERE created_at<?',Date.now()-86400000);this.sql.exec('DELETE FROM audit WHERE seq<=(SELECT COALESCE(MAX(seq),0)-1000 FROM audit)');}
  async schedule(){const now=Date.now(),times=this.ctx.getWebSockets().map(ws=>this.actor(ws).exp*1000);for(const ws of this.ctx.getWebSockets()){const entry=this.room().members?.find(m=>m.user_id===this.actor(ws).user_id);if(entry)for(const key of ['access_until','muted_until','blocked_until'])if(entry[key]>now)times.push(entry[key]);}const next=this.all('SELECT MIN(next_at) AS at FROM outbox')[0]?.at;if(next)times.push(next);const oldest=this.all('SELECT MIN(created_at) AS at FROM messages')[0]?.at;if(oldest)times.push(Math.ceil((oldest+this.retentionMs()+1)/3600000)*3600000);const target=times.length?Math.max(now+100,Math.min(...times)):null;if(await this.ctx.storage.getAlarm()!==target){if(target)await this.ctx.storage.setAlarm(target);else await this.ctx.storage.deleteAlarm();}}
  async alarm(){for(const ws of this.ctx.getWebSockets()){const actor=this.actor(ws);if(actor.exp*1000<=Date.now())ws.close(4001,'Access expired');else{const access=roomAccess(this.room(),actor);if(!access.read){this.send(ws,{type:'access_revoked',reason:access.reason});ws.close(4003,'Room access ended');}else this.send(ws,{type:'access',access});}}await this.flush();this.prune();await this.schedule();}
  diagnostics(){return {connected:this.presence().length,pending_deliveries:this.all('SELECT COUNT(*) AS count FROM outbox')[0].count};}
}
