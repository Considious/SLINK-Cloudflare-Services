import {PROTOCOL,ACCESS_TTL,ChatError,body,json,ensure,id,userId,endpoint,hash,b64,sign,publicKey,verify,errorResponse} from './protocol.js';
const centralUrl=env=>String(env.CHAT_CENTRAL_ISSUER||'https://slinkcontributionworker.richard-johnson554.workers.dev').replace(/\/$/,'');
const signingKey=env=>{ensure(env.CHAT_SIGNING_PRIVATE_JWK,'CHAT_NOT_CONFIGURED','Faction chat has not been enabled by SLINK Central.',503);return JSON.parse(env.CHAT_SIGNING_PRIVATE_JWK);};
function verificationKey(env){const {d,key_ops,...jwk}=signingKey(env);return {...jwk,key_ops:['verify']};}
const sameKey=(a,b)=>a?.kty===b?.kty&&a?.crv===b?.crv&&a?.x===b?.x&&a?.y===b?.y;
async function nodeCertificate(node,env){const iat=Math.floor(Date.now()/1000),key=JSON.parse(node.public_key);return sign({iss:centralUrl(env),aud:'slink-node-network',kind:'node_certificate',protocol:PROTOCOL,iat,exp:iat+365*86400,node_id:node.node_id,faction_id:node.faction_id,endpoint:node.endpoint,leader_id:node.leader_id,public_key:key,status:'active'},signingKey(env));}
async function licensed(db,factionId){const now=Date.now();return Boolean(await db.prepare(`SELECT faction_id FROM faction_scope_grants WHERE faction_id=? AND scope='slink.chat' AND status='active' AND starts_at<=? AND (expires_at IS NULL OR expires_at>?) LIMIT 1`).bind(factionId,now,now).first());}
export async function handleFactionNode(request,env,services){const path=new URL(request.url).pathname;if(!path.startsWith('/api/chat/'))return null;
  const origin=request.headers.get('Origin'),allowed=String(env.CHAT_ALLOWED_ORIGINS||'https://www.torn.com').split(',').map(s=>s.trim());const cors=origin&&allowed.includes(origin)?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
  try{
    ensure(!origin||allowed.includes(origin),'ORIGIN_DENIED','This origin is not enabled for SLINK faction chat.',403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'}});
    ensure(env.PERMISSIONS_DB,'CHAT_DATABASE_MISSING','SLINK’s faction chat registry database is not configured.',503);const db=env.PERMISSIONS_DB;
    if(path==='/api/chat/verification-key'&&request.method==='GET')return json({protocol:PROTOCOL,issuer:centralUrl(env),public_key:verificationKey(env)},200,cors);
    if(path==='/api/chat/register'&&request.method==='POST'){
      const input=await body(request),token=String(input.registration_token||''),digest=await hash(token),setup=await db.prepare('SELECT * FROM faction_chat_setup_tokens WHERE token_hash=?').bind(digest).first();
      ensure(setup&&setup.expires_at>Date.now(),'SETUP_TOKEN_EXPIRED','The setup token expired. Request another from SLINK Central.',403);
      const nodeEndpoint=endpoint(input.endpoint),nodeId=id(input.node_id);ensure(nodeEndpoint===setup.endpoint&&Number(input.faction_id)===setup.faction_id,'SETUP_TOKEN_MISMATCH','The setup token does not match this faction and endpoint.',403);ensure(input.protocol===PROTOCOL,'PROTOCOL_MISMATCH','This node version is not supported.',426);ensure(await licensed(db,setup.faction_id),'CHAT_LICENSE_REQUIRED','This faction needs an active SLINK Chat license.',403);
      await publicKey(input.public_key);const proof=await verify(input.proof,input.public_key,{aud:'slink-node-registration',issuer:nodeId,kind:'node_registration',maxTtl:120});ensure(proof.token_hash===digest&&proof.endpoint===nodeEndpoint&&proof.faction_id===setup.faction_id,'REGISTRATION_PROOF_INVALID','This node did not prove ownership of its registration key.',403);
      const candidate={faction_id:setup.faction_id,node_id:nodeId,endpoint:nodeEndpoint,public_key:JSON.stringify(input.public_key),leader_id:setup.leader_id};
      // Validate signing configuration before consuming a one-use token.
      const certificate=await nodeCertificate(candidate,env),verifyKey=verificationKey(env);
      const existing=await db.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=?').bind(setup.faction_id).first();
      const matches=node=>node&&node.status==='active'&&node.node_id===nodeId&&node.endpoint===nodeEndpoint&&sameKey(JSON.parse(node.public_key),input.public_key);
      if(setup.used_at){ensure(setup.consumed_by===nodeId&&matches(existing),'SETUP_TOKEN_USED','This setup token was already used by a different registration.',409);return json({ok:true,node_id:nodeId,certificate,public_key:verifyKey,issuer:centralUrl(env),resumed:true},200,cors);}
      ensure(!existing||existing.status!=='active','NODE_EXISTS','This faction already has a node. Ask SLINK Central to revoke it before replacing it.',409);
      const now=Date.now(),claim=crypto.randomUUID();
      // A random claim, not a timestamp, binds this transaction to exactly one attempt.
      // Different setup tokens for the same faction must not overwrite an active node either.
      await db.batch([
        db.prepare(`UPDATE faction_chat_setup_tokens SET used_at=?,consumed_by=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND NOT EXISTS(SELECT 1 FROM faction_chat_nodes WHERE faction_id=? AND status='active')`).bind(now,claim,digest,now,setup.faction_id),
        db.prepare(`INSERT INTO faction_chat_nodes(faction_id,node_id,endpoint,public_key,protocol,leader_id,status,created_at,updated_at) SELECT ?,?,?,?,?,?,'active',?,? WHERE EXISTS(SELECT 1 FROM faction_chat_setup_tokens WHERE token_hash=? AND consumed_by=?) ON CONFLICT(faction_id) DO UPDATE SET node_id=excluded.node_id,endpoint=excluded.endpoint,public_key=excluded.public_key,protocol=excluded.protocol,leader_id=excluded.leader_id,status='active',updated_at=excluded.updated_at WHERE faction_chat_nodes.status='revoked'`).bind(setup.faction_id,nodeId,nodeEndpoint,JSON.stringify(input.public_key),PROTOCOL,setup.leader_id,now,now,digest,claim),
        db.prepare('UPDATE faction_chat_setup_tokens SET consumed_by=? WHERE token_hash=? AND consumed_by=?').bind(nodeId,digest,claim)
      ]);
      const consumed=await db.prepare('SELECT * FROM faction_chat_setup_tokens WHERE token_hash=?').bind(digest).first(),registered=await db.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=?').bind(setup.faction_id).first();
      ensure(consumed.consumed_by===nodeId&&matches(registered),'SETUP_TOKEN_USED','Another registration completed first. Request another setup token.',409);
      return json({ok:true,node_id:nodeId,certificate,public_key:verifyKey,issuer:centralUrl(env)},200,cors);
    }
    if(path==='/api/chat/renew'&&request.method==='POST'){
      const input=await body(request),node=await db.prepare("SELECT * FROM faction_chat_nodes WHERE node_id=? AND status='active'").bind(id(input.node_id)).first();ensure(node,'NODE_NOT_REGISTERED','This node is not registered or has been revoked.',403);ensure(await licensed(db,node.faction_id),'CHAT_LICENSE_REQUIRED','This faction needs an active SLINK Chat license.',403);
      const proof=await verify(input.proof,JSON.parse(node.public_key),{aud:'slink-node-renewal',issuer:node.node_id,kind:'node_renewal',maxTtl:120});ensure(proof.endpoint===node.endpoint&&proof.faction_id===node.faction_id,'REGISTRATION_PROOF_INVALID','The renewal proof does not match this node.',403);
      return json({ok:true,node_id:node.node_id,certificate:await nodeCertificate(node,env),public_key:verificationKey(env),issuer:centralUrl(env)},200,cors);
    }
    const session=await services.session(request,env);ensure(session,'AUTH_REQUIRED','Sign in through SLINK Access first.',401);
    ensure(Number.isInteger(session.iat)&&Math.floor(Date.now()/1000)-session.iat<ACCESS_TTL,'MEMBERSHIP_REFRESH_REQUIRED','Refresh SLINK Access to verify your current identity before using faction chat.',428);
    if(path==='/api/chat/setup-token'&&request.method==='POST'){
      ensure(services.hasScope(session,'admin.*'),'CENTRAL_ADMIN_REQUIRED','SLINK Central must authorize the initial faction node registration.',403);const input=await body(request),factionId=userId(input.faction_id),leaderId=userId(input.leader_id),nodeEndpoint=endpoint(input.endpoint);ensure(await licensed(db,factionId),'CHAT_LICENSE_REQUIRED','Assign this faction its SLINK Chat license first.',403);
      const token=b64(crypto.getRandomValues(new Uint8Array(32))),expires=Date.now()+30*60000;await db.prepare('DELETE FROM faction_chat_setup_tokens WHERE expires_at<?').bind(Date.now()).run();await db.prepare('INSERT INTO faction_chat_setup_tokens(token_hash,faction_id,leader_id,endpoint,expires_at,granted_by) VALUES(?,?,?,?,?,?)').bind(await hash(token),factionId,leaderId,nodeEndpoint,expires,session.user_id).run();return json({registration_token:token,expires_at:expires,faction_id:factionId,leader_id:leaderId,endpoint:nodeEndpoint},200,cors);
    }
    if(path==='/api/chat/revoke'&&request.method==='POST'){ensure(services.hasScope(session,'admin.*'),'CENTRAL_ADMIN_REQUIRED','Only SLINK Central can revoke a registered node.',403);const input=await body(request);await db.prepare("UPDATE faction_chat_nodes SET status='revoked',updated_at=? WHERE faction_id=?").bind(Date.now(),userId(input.faction_id)).run();return json({ok:true},200,cors);}
    const factionId=userId(session.faction_id);ensure(await licensed(db,factionId),'CHAT_LICENSE_REQUIRED','Your faction does not have an active SLINK Chat license.',403);
    if(path==='/api/chat/discover'&&request.method==='GET'){const node=await db.prepare("SELECT node_id,faction_id,endpoint,protocol,status FROM faction_chat_nodes WHERE faction_id=? AND status='active'").bind(factionId).first();return json({ok:true,chat:node?{provider:'customer-cloudflare',...node}:null},200,cors);}
    if(path==='/api/chat/token'&&request.method==='POST'){
      // The existing verified permission session is reused; it must be refreshed at most every five minutes.
      const now=Math.floor(Date.now()/1000);ensure(now-session.iat<ACCESS_TTL,'MEMBERSHIP_REFRESH_REQUIRED','Refresh SLINK Access to verify your current faction before reconnecting to chat.',428);
      const node=await db.prepare("SELECT * FROM faction_chat_nodes WHERE faction_id=? AND status='active'").bind(factionId).first();ensure(node,'NODE_NOT_REGISTERED','Your faction has not connected its chat node yet.',404);
      const exp=Math.min(session.iat+ACCESS_TTL,session.exp);const claims={iss:centralUrl(env),aud:node.node_id,kind:'chat_access',protocol:PROTOCOL,iat:now,exp,user_id:session.user_id,user_name:session.user_name||'Player '+session.user_id,faction_id:factionId,scopes:['slink.chat'],roles:[],jti:crypto.randomUUID()};return json({ok:true,token:await sign(claims,signingKey(env)),expires_at:exp*1000,endpoint:node.endpoint,node_id:node.node_id,user_id:session.user_id,faction_id:factionId},200,cors);
    }
    if(path==='/api/chat/members'&&request.method==='GET'){const result=await db.prepare('SELECT user_id,user_name,position,updated_at FROM faction_member_roster WHERE faction_id=? AND active=1 ORDER BY user_name LIMIT 200').bind(factionId).all();return json({members:result.results||[],source:'last_verified_faction_roster'},200,cors);}
    throw new ChatError('NOT_FOUND','This faction chat endpoint does not exist.',404);
  }catch(e){const response=errorResponse(e),headers=new Headers(response.headers);for(const [key,value]of Object.entries(cors))headers.set(key,value);return new Response(response.body,{status:response.status,headers});}
}
