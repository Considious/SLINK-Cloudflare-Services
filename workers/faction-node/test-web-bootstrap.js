import {body,ensure,verify,hash,hmac,json,errorResponse} from './protocol.js';
import {handleFactionNode} from './central.js';
import {setupResponse} from './setup-response.js';
const CENTRAL='https://slink-chat-central-test.richard-johnson554.workers.dev',NODE='https://slink-faction-node-46978-test.richard-johnson554.workers.dev';
// Owner preapproval is deliberately fixed to ONE test endpoint/faction/Leader.
// This is NOT a general public customer installer or an admin wildcard bypass.
export async function bootstrapApprovedTestNode(request,env,send=fetch){try{
 ensure(request.method==='POST'&&new URL(request.url).origin===CENTRAL&&env.CHAT_CENTRAL_ISSUER===CENTRAL&&env.CHAT_TEST_FACTION_ID==='46978','WRONG_TEST_TARGET','This route is only available on the approved test Central.',403);
 ensure(!request.headers.get('Origin'),'ORIGIN_DENIED','Run setup through the approved faction node.',403);
 ensure(env.PERMISSIONS_DB&&env.API_KEY_ENCRYPTION_KEY&&env.CHAT_SIGNING_PRIVATE_JWK,'CHAT_NOT_CONFIGURED','Test Central secrets or database are missing.',503);
 const db=env.PERMISSIONS_DB,now=Date.now();
 ensure(await db.prepare("SELECT faction_id FROM faction_scope_grants WHERE faction_id=46978 AND scope='slink.chat' AND status='active' AND starts_at<=? AND (expires_at IS NULL OR expires_at>?)").bind(now,now).first(),'CHAT_LICENSE_REQUIRED','The test faction Chat license is missing or expired.',403);
 await db.prepare('CREATE TABLE IF NOT EXISTS faction_chat_web_setup_gate (id INTEGER PRIMARY KEY CHECK(id=1),last_at INTEGER NOT NULL)').run();
 const gate=await db.prepare('INSERT INTO faction_chat_web_setup_gate(id,last_at) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET last_at=excluded.last_at WHERE last_at<=?').bind(now,now-10000).run();
 ensure(gate.meta?.changes===1,'SETUP_BUSY','Wait ten seconds before retrying setup.',429);
 const token=await hmac(await hash(env.API_KEY_ENCRYPTION_KEY),'approved-test-node-46978:'+Math.floor(now/300000)),digest=await hash(token),nonce=await hash(crypto.randomUUID());
 const challenge=await send(NODE+'/api/setup/identity-proof',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({token_hash:digest,nonce})});
 const identity=await setupResponse(challenge,'Test node ownership proof',8192);ensure(challenge.ok,'NODE_SETUP_UNAVAILABLE','Test node ownership proof returned HTTP '+challenge.status+'. '+String(identity.error||'The node code/bindings are not ready.').slice(0,180),502);
 const proof=await verify(identity.proof,identity.public_key,{issuer:identity.node_id,aud:'slink-node-registration',kind:'node_registration',maxTtl:120});
 ensure(proof.nonce===nonce&&proof.token_hash===digest&&proof.endpoint===NODE&&proof.faction_id===46978,'NODE_SETUP_MISMATCH','The node did not prove ownership of the approved test endpoint.',403);
 const existing=await db.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=46978').first();
 const services={session:async()=>null,hasScope:()=>false};
 if(existing){
  ensure(existing.status==='active'&&existing.node_id===identity.node_id&&existing.endpoint===NODE&&JSON.parse(existing.public_key).x===identity.public_key.x&&JSON.parse(existing.public_key).y===identity.public_key.y,'NODE_EXISTS','A different identity is already registered. Do not replace it; preserve its storage.',409);
  const renewal=await verify(identity.renewal_proof,identity.public_key,{issuer:identity.node_id,aud:'slink-node-renewal',kind:'node_renewal',maxTtl:120});ensure(renewal.nonce===nonce&&renewal.endpoint===NODE&&renewal.faction_id===46978,'NODE_SETUP_MISMATCH','Invalid renewal proof.',403);
  return handleFactionNode(new Request(CENTRAL+'/api/chat/renew',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({node_id:identity.node_id,proof:identity.renewal_proof})}),env,services);
 }
 await db.prepare('INSERT INTO faction_chat_setup_tokens(token_hash,faction_id,leader_id,endpoint,expires_at,granted_by) VALUES(?,46978,3853023,?,?,3853023) ON CONFLICT(token_hash) DO NOTHING').bind(digest,NODE,now+600000).run();
 return handleFactionNode(new Request(CENTRAL+'/api/chat/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({registration_token:token,node_id:identity.node_id,faction_id:46978,endpoint:NODE,protocol:1,public_key:identity.public_key,proof:identity.proof})}),env,services);
 }catch(error){return errorResponse(error);}}
