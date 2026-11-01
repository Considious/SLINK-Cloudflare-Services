// Separate development entry point. Never use this configuration for live SLINK.
// Reuse existing permission authentication; do not expose donation/backup/admin APIs.
import contribution from '../contribution/worker.js';
import {bootstrapApprovedTestNode} from './test-web-bootstrap.js';
export const TEST_ORIGIN='https://slink-chat-central-test.richard-johnson554.workers.dev';
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.origin!==TEST_ORIGIN||env.CHAT_CENTRAL_ISSUER!==TEST_ORIGIN||env.CHAT_TEST_FACTION_ID!=='46978')return Response.json({ok:false,error:'Test Central configuration does not match the isolated test deployment.'},{status:503});
  if(request.method==='GET'&&['/','/api/health'].includes(url.pathname))return Response.json({product:'SLINK Faction Chat Test Central',test_only:true,faction_id:46978,configured:Boolean(env.PERMISSIONS_DB&&env.API_KEY_ENCRYPTION_KEY&&env.CHAT_SIGNING_PRIVATE_JWK)});
  if(url.pathname==='/api/chat/test-node/bootstrap')return bootstrapApprovedTestNode(request,env);
  const auth=['/api/permissions/auth','/api/permissions/terms'].includes(url.pathname);
  const chat=url.pathname.startsWith('/api/chat/');
  // Setup tokens are provisioned separately by the database owner for this test.
  // No admin.* grant is added merely to bootstrap the initial Chat Leader.
  if(!auth&&!chat||['/api/chat/setup-token','/api/chat/revoke'].includes(url.pathname))return Response.json({ok:false,error:'This route is not exposed by the isolated chat test service.'},{status:404});
  // Unpacked extension IDs vary by installation. Echo only a syntactically valid
  // extension origin on this test service; every protected route still verifies its token.
  const origin=request.headers.get('Origin'),extensionOrigin=/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'');
  const scoped=extensionOrigin?{...env,CHAT_ALLOWED_ORIGINS:(env.CHAT_ALLOWED_ORIGINS||'https://www.torn.com')+','+origin}:env;
  return contribution.fetch(request,scoped,ctx);
 }
};
