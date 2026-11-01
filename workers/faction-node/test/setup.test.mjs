import test from 'node:test';
import assert from 'node:assert/strict';
import {install,configuration,target,CENTRAL} from '../setup-lib.mjs';
import {sign,verify,hash} from '../protocol.js';

async function harness(){
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const privateKey=await crypto.subtle.exportKey('jwk',pair.privateKey),publicKey=await crypto.subtle.exportKey('jwk',pair.publicKey);
  let saved=null,config={},deployedSecrets=null;const commands=[],output=[],requests=[];
  const answers=['10','1','slink-node-10','a'.repeat(32),'https://node.example.test','yes','yes','one-use-setup-token'];
  const deps={ask:async()=>answers.shift(),read:async()=>structuredClone(saved),save:async value=>{saved=structuredClone(value);},readConfig:async()=>config,writeConfig:async value=>{config=value;},output:message=>output.push(message),
    wrangler:async(args,input)=>{commands.push({args,input});if(input)deployedSecrets=JSON.parse(input);},
    request:async(url,payload)=>{
      requests.push({url,payload});
      if(url.endsWith('/health'))return {product:'SLINK Faction Node',node_id:saved.node_id,protocol:1};
      if(url.endsWith('/api/node/certificate'))return {certificate:deployedSecrets?.NODE_CERTIFICATE};
      const renew=url.endsWith('/renew');
      const proof=await verify(payload.proof,saved.public_key,{issuer:saved.node_id,aud:renew?'slink-node-renewal':'slink-node-registration',kind:renew?'node_renewal':'node_registration',maxTtl:120});
      assert.equal(proof.faction_id,10);if(!renew)assert.equal(proof.token_hash,await hash(payload.registration_token));
      const now=Math.floor(Date.now()/1000),certificate=await sign({iss:CENTRAL,aud:'slink-node-network',kind:'node_certificate',protocol:1,iat:now,exp:now+86400,node_id:saved.node_id,faction_id:10,leader_id:1,endpoint:saved.endpoint,public_key:saved.public_key},privateKey);
      return {ok:true,node_id:saved.node_id,issuer:CENTRAL,certificate,public_key:publicKey};
    }};
  return {deps,answers,commands,output,requests,get saved(){return saved;},get config(){return config;},set config(value){config=value;}};
}
test('installer deploys, registers and sends secrets through stdin, not arguments or logs',async()=>{
  const f=await harness();await install(f.deps);
  assert.deepEqual(f.commands.map(c=>c.args[0]),['login','deploy','secret']);
  assert.equal(f.config.vars.SLINK_NODE_ID,f.saved.node_id);
  assert.equal('NODE_PRIVATE_KEY' in f.config.vars,false);
  assert.equal(JSON.stringify(f.commands.map(c=>c.args)).includes(f.saved.private_key.d),false);
  assert.equal(f.output.join('\n').includes(f.saved.private_key.d),false);
  assert.equal(f.output.join('\n').includes('one-use-setup-token'),false);
  assert.equal('registration_token' in f.saved,false);
});
test('upgrade keeps identity, target, retention, routes and Durable Object migrations',async()=>{
  const f=await harness();await install(f.deps);const original=f.saved.node_id,privatePart=f.saved.private_key.d;
  f.config={...f.config,vars:{...f.config.vars,RETENTION_DAYS:'7',MAX_ROOM_MESSAGES:'15000'},routes:[{pattern:'node.example.test',custom_domain:true}]};
  f.answers.push('yes');await install({...f.deps,upgrade:true});
  assert.equal(f.saved.node_id,original);assert.equal(f.saved.private_key.d,privatePart);
  assert.equal(f.config.vars.RETENTION_DAYS,'7');assert.equal(f.config.vars.MAX_ROOM_MESSAGES,'15000');assert.equal(f.config.routes[0].custom_domain,true);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/register')).length,1);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/renew')).length,1);
  assert.equal(f.config.migrations.length,1);
});
test('failed secret upload resumes the same identity using renewal',async()=>{
  const f=await harness(),real=f.deps.wrangler;
  await assert.rejects(install({...f.deps,wrangler:async(args,input)=>{if(input)throw new Error('Test upload failure');return real(args,input);}}),/Test upload failure/);
  assert.ok(f.saved.certificate);const original=f.saved.node_id;
  f.answers.push('yes');await install(f.deps);assert.equal(f.saved.node_id,original);
  assert.equal(f.requests.filter(r=>r.url.endsWith('/renew')).length,1);
});
test('upgrade without a private configuration never deploys a replacement',async()=>{
  const f=await harness();await assert.rejects(install({...f.deps,upgrade:true}),/original node-config/);assert.equal(f.commands.length,0);
});
test('cancelled setup never deploys; invalid inputs never become shell arguments',async()=>{
  const f=await harness();f.answers.splice(5,1,'no');await assert.rejects(install(f.deps),/cancelled/);assert.equal(f.commands.length,0);
  assert.throws(()=>target({faction_id:10,leader_id:1,worker_name:'node; rm',account_id:'a'.repeat(32),endpoint:'https://node.example.test'}));
  assert.throws(()=>configuration({...target({faction_id:10,leader_id:1,worker_name:'node-test',account_id:'a'.repeat(32),endpoint:'https://node.example.test'}),node_id:'node-test'},CENTRAL,{name:'unrelated-worker'}),/different target/);
});
