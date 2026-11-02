// Existing hosted Chat Central address/issuer is retained for node compatibility.
// Production grants and acceptance use the shared permissions database.
import contribution from '../contribution/worker.js';
import {bootstrapApprovedTestNode} from './test-web-bootstrap.js';
import {ensureSharedChatPermissions} from './shared-permissions.js';
import {errorResponse} from './protocol.js';
export const TEST_ORIGIN='https://slink-chat-central-test.richard-johnson554.workers.dev';
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.origin!==TEST_ORIGIN||env.CHAT_CENTRAL_ISSUER!==TEST_ORIGIN||env.CHAT_TEST_FACTION_ID!=='46978')return Response.json({ok:false,error:'Test Central configuration does not match the isolated test deployment.'},{status:503});
  if(request.method==='GET'&&['/','/api/health'].includes(url.pathname)){const metadata=await contribution.fetch(new Request(TEST_ORIGIN+'/api/permissions/terms'),env,ctx);const policy=await metadata.json();return Response.json({product:'SLINK Faction Chat Central',version:'0.1.3-shared-permissions',test_only:env.CHAT_PERMISSION_STORE!=='shared',permission_store:env.CHAT_PERMISSION_STORE==='shared'?'shared':'isolated',faction_id:46978,configured:Boolean(env.PERMISSIONS_DB&&env.API_KEY_ENCRYPTION_KEY&&env.CHAT_SIGNING_PRIVATE_JWK),terms:policy.terms});}
  const auth=['/api/permissions/auth','/api/permissions/terms'].includes(url.pathname);
  const chat=url.pathname.startsWith('/api/chat/');
  // Setup tokens are provisioned separately by the database owner for this test.
  // No admin.* grant is added merely to bootstrap the initial Chat Leader.
  if(!auth&&!chat||['/api/chat/setup-token','/api/chat/revoke'].includes(url.pathname))return Response.json({ok:false,error:'This route is not exposed by the isolated chat test service.'},{status:404});
  // Unpacked extension IDs vary by installation. Echo only a syntactically valid
  // extension origin on this test service; every protected route still verifies its token.
  const origin=request.headers.get('Origin'),extensionOrigin=/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'');
  const scoped=extensionOrigin?{...env,CHAT_ALLOWED_ORIGINS:(env.CHAT_ALLOWED_ORIGINS||'https://www.torn.com')+','+origin}:env;
  if(chat&&origin&&!extensionOrigin&&!String(env.CHAT_ALLOWED_ORIGINS||'https://www.torn.com').split(',').map(value=>value.trim()).includes(origin))return contribution.fetch(request,env,ctx);
  if(url.pathname!=='/api/permissions/terms')try{await ensureSharedChatPermissions(env);}catch(error){const response=errorResponse(error),headers=new Headers(response.headers);if(origin&&(extensionOrigin||String(env.CHAT_ALLOWED_ORIGINS||'https://www.torn.com').split(',').includes(origin))){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}return new Response(response.body,{status:response.status,headers});}
  if(url.pathname==='/api/chat/test-node/bootstrap')return bootstrapApprovedTestNode(request,env);
  return contribution.fetch(request,scoped,ctx);
 }
};
