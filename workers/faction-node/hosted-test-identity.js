import {DurableObject} from 'cloudflare:workers';
import {body,ensure,sign,verify,hash} from './protocol.js';
export const TEST_CENTRAL='https://slink-chat-central-test.richard-johnson554.workers.dev';
export const TEST_NODE='https://slink-faction-node-46978-test.richard-johnson554.workers.dev';
export const TEST_NODE_ID='slink-node-46978-hosted-test';
// Private identity lives in the customer's Durable Object, never in GitHub or HTML.
export class HostedTestIdentity extends DurableObject {
 constructor(ctx,env){super(ctx,env);this.ctx=ctx;this.env=env;this.proofs=0;this.window=0;ctx.blockConcurrencyWhile(async()=>{
  this.saved=await ctx.storage.get('identity');if(!this.saved){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);this.saved={node_id:TEST_NODE_ID,private_key:await crypto.subtle.exportKey('jwk',pair.privateKey),public_key:await crypto.subtle.exportKey('jwk',pair.publicKey)};await ctx.storage.put('identity',this.saved);}
 });}
 material(){return this.saved;}
 async registrationProof(input){
  ensure(/^[A-Za-z0-9_-]{43}$/.test(input?.token_hash||'')&&/^[A-Za-z0-9_-]{43}$/.test(input?.nonce||''),'INVALID_SETUP','Invalid setup challenge.');
  const now=Date.now();if(now-this.window>60000){this.window=now;this.proofs=0;}ensure(this.proofs++<20,'SETUP_RATE_LIMIT','Wait a minute before retrying setup.',429);
  const iat=Math.floor(now/1000),base={iss:this.saved.node_id,protocol:1,iat,exp:iat+120,faction_id:46978,endpoint:TEST_NODE,nonce:input.nonce};
  return {node_id:this.saved.node_id,public_key:this.saved.public_key,proof:await sign({...base,aud:'slink-node-registration',kind:'node_registration',token_hash:input.token_hash},this.saved.private_key),renewal_proof:await sign({...base,aud:'slink-node-renewal',kind:'node_renewal'},this.saved.private_key)};
 }
 async accept(certificate,key){
  const claims=await verify(certificate,key,{issuer:TEST_CENTRAL,aud:'slink-node-network',kind:'node_certificate',maxTtl:366*86400});
  ensure(claims.node_id===this.saved.node_id&&claims.faction_id===46978&&claims.leader_id===3853023&&claims.endpoint===TEST_NODE&&claims.public_key.x===this.saved.public_key.x&&claims.public_key.y===this.saved.public_key.y,'SETUP_IDENTITY_MISMATCH','Central returned a different node identity.',503);
  this.saved={...this.saved,certificate,central_public_key:key};await this.ctx.storage.put('identity',this.saved);return {ok:true,node_id:this.saved.node_id,faction_id:46978,leader_id:3853023};
 }
}
