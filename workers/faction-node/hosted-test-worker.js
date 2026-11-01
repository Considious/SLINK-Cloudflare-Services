import node from './worker.js';
import {HostedTestIdentity,TEST_NODE,TEST_CENTRAL,TEST_NODE_ID} from './hosted-test-identity.js';
import {body,json,ensure,errorResponse} from './protocol.js';
import {setupResponse} from './setup-response.js';
export {HostedTestIdentity};
export {FactionDirectory,ChatRoom} from './worker.js';
export default {async fetch(request,env){try{
 const url=new URL(request.url);ensure(url.origin===TEST_NODE&&env.SLINK_CENTRAL_URL===TEST_CENTRAL&&env.SLINK_FACTION_ID==='46978'&&env.SLINK_NODE_ID===TEST_NODE_ID,'WRONG_TEST_TARGET','This deployment does not match the approved test node.',503);
 const identity=env.IDENTITY.get(env.IDENTITY.idFromName('test-node-46978'));
 if(url.pathname==='/setup'&&request.method==='GET')return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>SLINK faction chat setup</title><style>body{font:18px system-ui;max-width:620px;margin:60px auto;padding:20px;background:#15151b;color:#eee}button{padding:16px;border-radius:10px;font:inherit;cursor:pointer}</style><h1>Finish faction chat setup</h1><p>Test faction: 46978<br>Explicit Chat Leader: 3853023</p><p>This creates the node identity in Cloudflare and registers it with test Central. No local tools or secret copying.</p><form method="post" action="/api/setup/complete"><button>Finish setup</button></form>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
 if(url.pathname==='/api/setup/identity-proof'&&request.method==='POST')return json(await identity.registrationProof(await body(request,2048)));
 if(url.pathname==='/api/setup/complete'&&request.method==='POST'){
  ensure(request.headers.get('Origin')===TEST_NODE,'ORIGIN_DENIED','Open the setup page on this node to finish installation.',403);
  const response=await fetch(TEST_CENTRAL+'/api/chat/test-node/bootstrap',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json'},body:'{}'}),result=await setupResponse(response,'Test Central registration',16384);
  ensure(response.ok,'SETUP_FAILED',String(result.error||'Test Central could not complete setup.').slice(0,250),response.status);
  return json({...await identity.accept(result.certificate,result.public_key),message:'Backend setup complete. Private identity is stored in Cloudflare. SLINK test-client integration remains separate.'});
 }
 const material=await identity.material();
 return node.fetch(request,{...env,SLINK_NODE_ID:material.node_id,NODE_PRIVATE_KEY:JSON.stringify(material.private_key),NODE_CERTIFICATE:material.certificate,SLINK_PUBLIC_VERIFY_KEY:material.central_public_key?JSON.stringify(material.central_public_key):undefined});
 }catch(error){return errorResponse(error);}}};
