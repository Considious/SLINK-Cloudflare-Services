const SLOT_MS=12*60*60*1000;
const MAX_BYTES=128*1024;
const encoder=new TextEncoder();
const allowedActions=new Set(['place','ignite','stoke','dampen']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function label(value,max){return typeof value==='string'&&value.length>0&&value.length<=max&&/^[\p{L}\p{N} .,'’%&()\-:–/]+$/u.test(value);}
const validators={
 arson(record){
  let key;
  try{key=JSON.parse(record.key);}catch{return null;}
  if(!Array.isArray(key)||key.length!==3||!label(key[0],90)||!label(key[1],90)||!Array.isArray(key[2])||key[2].length>12||!key[2].every(v=>label(v,100)))return null;
  if(!Array.isArray(record.steps)||!record.steps.length||record.steps.length>24)return null;
  if(record.steps.filter(step=>step?.action==='ignite').length!==1)return null;
  if(!record.steps.every(step=>step&&allowedActions.has(step.action)&&label(step.item,90)&&Number.isFinite(step.damageBefore)&&step.damageBefore>=0&&step.damageBefore<=100))return null;
  return {key:JSON.stringify([key[0],key[1],[...new Set(key[2])].sort()]),steps:record.steps.map(({action,item,damageBefore})=>({action,item,damageBefore}))};
 }
};
async function readBounded(request){
 const reader=request.body?.getReader();
 if(!reader)return null;
 const decoder=new TextDecoder();let size=0,text='';
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();return null;}text+=decoder.decode(value,{stream:true});}
  return JSON.parse(text+decoder.decode());
 }catch{return null;}finally{reader.releaseLock();}
}
export async function handleCrimeRecipes(request,env,{session,hasScope,json,now=Date.now}){
 const reject=(status,error)=>json({ok:false,error},status);
 try{
  const auth=await session(request,env);
  if(!auth)return reject(401,'Verify SLINK access before sharing crime recipes.');
  if(!hasScope(auth,'slink.adhd.alerts'))return reject(403,'Crimes access is required.');
  if(!env.USER_BACKUPS)return reject(503,'Shared recipe storage is unavailable.');
  const body=await readBounded(request),current=Math.floor(now()/SLOT_MS);
  if(body?.schema!==1||!['extension','pda'].includes(body.client)||!Number.isSafeInteger(body.slot)||body.slot>current||body.slot<current-6||!Array.isArray(body.records)||!body.records.length||body.records.length>20)return reject(400,'Invalid recipe batch.');
  const ids=new Set(),records=[];
  for(const row of body.records){
   if(!row||typeof row.id!=='string'||!uuid.test(row.id)||ids.has(row.id)||!Object.hasOwn(validators,row.crime))return reject(400,'Invalid recipe observation.');
   const recipe=validators[row.crime](row);if(!recipe)return reject(400,'Invalid recipe details.');
   ids.add(row.id);records.push({id:row.id,crime:row.crime,...recipe});
  }
  const payload=JSON.stringify({schema:1,slot:body.slot,records});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(payload))),byte=>byte.toString(16).padStart(2,'0')).join('');
  // Account identifies the upload slot, not the published observation payload.
  const key=`crime-recipes/v1/${body.slot}/${auth.user_id}/${body.client}.json`;
  const options={onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'},customMetadata:{hash}};
  const saved=await env.USER_BACKUPS.put(key,payload,options);
  if(!saved&&(await env.USER_BACKUPS.head(key))?.customMetadata?.hash!==hash)return reject(409,'A different batch already used this upload window.');
  return json({ok:true,slot:body.slot,accepted:[...ids]});
 }catch{return reject(503,'Shared recipe storage is temporarily unavailable.');}
}
