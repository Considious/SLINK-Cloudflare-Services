import {PROTOCOL,endpoint,id,userId,sign,hash,verify} from './protocol.js';

export const CENTRAL='https://slinkcontributionworker.richard-johnson554.workers.dev';
export function target(input){
  const result={faction_id:userId(input.faction_id),leader_id:userId(input.leader_id),endpoint:endpoint(input.endpoint),worker_name:String(input.worker_name||''),account_id:String(input.account_id||'')};
  if(!/^[a-z][a-z0-9-]{2,62}$/.test(result.worker_name))throw new Error('Choose a Worker name using 3–63 lowercase letters, numbers and hyphens, starting with a letter.');
  if(!/^[a-f0-9]{32}$/.test(result.account_id))throw new Error('Enter the 32-character Cloudflare account ID from your account dashboard.');
  return result;
}
export function configuration(saved,central=CENTRAL,previous={}){
  const t=target(saved);id(saved.node_id);
  if(previous.name&&previous.name!==t.worker_name||previous.account_id&&previous.account_id!==t.account_id)throw new Error('The existing deployment configuration belongs to a different target. Restore the matching node configuration before upgrading.');
  const migrations=previous.migrations||[];
  return {...previous,name:t.worker_name,account_id:t.account_id,main:'worker.js',compatibility_date:'2026-08-06',workers_dev:previous.workers_dev??true,
    durable_objects:{bindings:[{name:'DIRECTORY',class_name:'FactionDirectory'},{name:'ROOMS',class_name:'ChatRoom'}]},
    migrations:migrations.length?migrations:[{tag:'faction-node-v1',new_sqlite_classes:['FactionDirectory','ChatRoom']}],
    vars:{ALLOWED_ORIGINS:'https://www.torn.com',RETENTION_DAYS:'30',MAX_ROOM_MESSAGES:'10000',...previous.vars,SLINK_NODE_ID:saved.node_id,SLINK_FACTION_ID:String(t.faction_id),SLINK_CENTRAL_URL:endpoint(central)},observability:previous.observability||{enabled:false}};
}
async function identity(t){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);return {...t,node_id:'slink-node-'+t.faction_id+'-'+crypto.randomUUID(),private_key:await crypto.subtle.exportKey('jwk',pair.privateKey),public_key:await crypto.subtle.exportKey('jwk',pair.publicKey)};}
export async function proof(saved,token,renew=false){const now=Math.floor(Date.now()/1000);return sign({iss:saved.node_id,aud:renew?'slink-node-renewal':'slink-node-registration',kind:renew?'node_renewal':'node_registration',protocol:PROTOCOL,iat:now,exp:now+120,faction_id:saved.faction_id,endpoint:saved.endpoint,...(!renew?{token_hash:await hash(token)}:{})},saved.private_key);}

// Injectable boundaries let tests cover the complete flow without deploying or handling real credentials.
export async function install({ask,read,save,readConfig=async()=>({}),writeConfig,wrangler,request,output,central=CENTRAL,upgrade=false}){
  central=endpoint(central);let saved=await read();
  if(upgrade&&!saved)throw new Error('Upgrade needs the original node-config.json. Restore your private node configuration before continuing; do not create a replacement identity.');
  if(saved){target(saved);id(saved.node_id);if(!saved.private_key?.d||!saved.public_key)throw new Error('The saved node identity is incomplete. Restore its private configuration backup.');if(saved.central!==central)throw new Error('The selected SLINK Central service differs from this node’s original registration.');output('Keeping the existing faction, node identity, rooms and history.');}
  else{
    const t=target({faction_id:await ask('Torn faction ID: '),leader_id:await ask('Initial SLINK Chat Leader user ID: '),worker_name:await ask('New Cloudflare Worker name: '),account_id:await ask('Cloudflare account ID: '),endpoint:await ask('Exact public node HTTPS origin (workers.dev or configured custom domain): ')});
    if(!/^yes$/i.test(await ask(`Deploy a NEW Worker named ${t.worker_name} in this account? It must not be an unrelated existing Worker. Type yes: `)))throw new Error('Setup cancelled. No deployment was started.');
    saved={...await identity(t),central};await save(saved);
  }
  await writeConfig(configuration(saved,central,await readConfig()));
  if(!/^yes$/i.test(await ask('Open Cloudflare sign-in and deploy this node now? Type yes: ')))throw new Error('Setup paused. The saved node identity can be reused by running setup again.');
  await wrangler(['login']);
  // The initial deployment has no registration secrets and rejects chat connections.
  await wrangler(['deploy','--config','wrangler.local.json']);
  const health=await request(saved.endpoint+'/health');
  if(health.product!=='SLINK Faction Node'||health.node_id!==saved.node_id||health.protocol!==PROTOCOL)throw new Error('The public endpoint does not match the deployed node. Check its domain routing before registering.');
  let registration;
  if(upgrade||saved.certificate){registration=await request(central+'/api/chat/renew',{node_id:saved.node_id,proof:await proof(saved,null,true)});}
  else{
    output(`Ask SLINK Central for a setup token bound to faction ${saved.faction_id}, initial Leader ${saved.leader_id}, and ${saved.endpoint}.`);
    const token=String(await ask('SLINK setup token (hidden): ',true)).trim();if(!token)throw new Error('A setup token is required. No registration was sent.');
    registration=await request(central+'/api/chat/register',{registration_token:token,node_id:saved.node_id,faction_id:saved.faction_id,endpoint:saved.endpoint,protocol:PROTOCOL,public_key:saved.public_key,proof:await proof(saved,token)});
  }
  if(registration.issuer!==central||registration.node_id!==saved.node_id)throw new Error('SLINK Central returned a different node identity. Setup stopped.');
  const cert=await verify(registration.certificate,registration.public_key,{issuer:central,aud:'slink-node-network',kind:'node_certificate',maxTtl:366*86400});
  if(cert.node_id!==saved.node_id||cert.endpoint!==saved.endpoint||cert.faction_id!==saved.faction_id||cert.leader_id!==saved.leader_id||cert.public_key.x!==saved.public_key.x||cert.public_key.y!==saved.public_key.y)throw new Error('The registration certificate does not match this node. Setup stopped.');
  saved={...saved,certificate:registration.certificate,central_public_key:registration.public_key};await save(saved);
  // Secrets go over stdin, never as command arguments, console output or public vars.
  await wrangler(['secret','bulk','--config','wrangler.local.json'],JSON.stringify({NODE_PRIVATE_KEY:JSON.stringify(saved.private_key),NODE_CERTIFICATE:saved.certificate,SLINK_PUBLIC_VERIFY_KEY:JSON.stringify(saved.central_public_key)}));
  const ready=await request(saved.endpoint+'/api/node/certificate');if(ready.certificate!==saved.certificate)throw new Error('The deployed node has not confirmed the new certificate. Run setup again; keep node-config.json.');
  output(`SLINK Faction Node installed successfully.\nFaction: ${saved.faction_id}\nBackend: ${saved.endpoint}\nNode ID: ${saved.node_id}\nProtocol: ${PROTOCOL}\nInitial Leader: ${saved.leader_id}\nNext: open SLINK and verify the faction chat connection.`);
  return {node_id:saved.node_id,endpoint:saved.endpoint};
}
