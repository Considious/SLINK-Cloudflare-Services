import assert from 'node:assert/strict';
import {handleCrimeRecipes} from './crime-recipes.js';
const slot=40000,now=()=>slot*12*60*60*1000,objects=new Map();
const bucket={
 async put(key,payload,options){assert.equal(options.onlyIf.get('if-none-match'),'*');if(objects.has(key))return null;objects.set(key,{payload,customMetadata:options.customMetadata});return objects.get(key);},
 async head(key){return objects.get(key);}
};
const id=crypto.randomUUID(),records=[{id,crime:'arson',key:JSON.stringify(['Detective Agency','Insurance',['Accidental cause requested']]),steps:[{action:'ignite',item:'Windproof Lighter',damageBefore:0,private:'strip'}],secret:'strip'}];
const payload={schema:1,client:'pda',slot,records};
const call=(data=payload,extra={})=>handleCrimeRecipes(new Request('https://test.invalid/api/crime-recipes',{method:'POST',body:JSON.stringify(data)}),{USER_BACKUPS:bucket},{session:async()=>({user_id:42}),hasScope:()=>true,json:(body,status=200)=>({body,status}),now,...extra});
assert.equal((await call(payload,{session:async()=>null})).status,401);
assert.equal((await call(payload,{hasScope:()=>false})).status,403);
assert.equal((await call({...payload,slot:slot+1})).status,400);
assert.equal((await call({...payload,records:[...records,...records]})).status,400);
assert.equal((await call({...payload,records:[{...records[0],crime:'cracking'}]})).status,400);
assert.deepEqual(await call(),{status:200,body:{ok:true,slot,accepted:[id]}});
assert.deepEqual(await call(),{status:200,body:{ok:true,slot,accepted:[id]}});
assert.equal(objects.size,1);
assert.doesNotMatch(objects.get(`crime-recipes/v1/${slot}/42/pda.json`).payload,/strip|user_id/);
assert.equal((await call({...payload,records:[{...records[0],id:crypto.randomUUID()}]})).status,409);
const put=bucket.put;bucket.put=async()=>{throw Error('unavailable');};assert.equal((await call()).status,503);bucket.put=put;
console.log('Recipe Worker auth, validation, idempotent R2 writes, slot limits and R2 failure passed.');
