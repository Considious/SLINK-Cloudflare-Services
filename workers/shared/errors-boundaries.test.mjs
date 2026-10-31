import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const policy=fs.readFileSync(new URL('./errors.js',import.meta.url),'utf8');
for(const worker of ['contribution','leveling','war','mugging']){
 const source=fs.readFileSync(new URL('../'+worker+'/worker.js',import.meta.url),'utf8');
 assert.match(source,/import '..\/shared\/errors.js'/);
 const name=worker==='war'?'json':'jsonResponse';
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}',start)+2;
 const ctx=vm.createContext({Response,corsHeaders:()=>({'X-test':'kept'})});vm.runInContext(policy,ctx);vm.runInContext(source.slice(start,end),ctx);
 const result=ctx[name]({ok:false,error:'no such table: scopes',code:'KEEP_THIS'},500);
 assert.equal(result.status,500);assert.equal(result.headers.get('X-test'),'kept');
 const data=await result.json();assert.equal(data.error,'no such table: scopes');assert.equal(data.code,'KEEP_THIS');assert.equal(data.error_code,'SLINK_SERVER_SETUP');assert.match(data.user_message,/administrator/i);
 const success=await ctx[name]({ok:true,token:'session-kept'},200).json();assert.deepEqual(success,{ok:true,token:'session-kept'});
 const auth=await ctx[name]({ok:false,error:'Unauthorized'},401).json();assert.equal(auth.error_code,'SLINK_ACCESS_DENIED');
}
console.log('All four worker JSON boundaries preserve HTTP status, headers, successful sessions and legacy error fields while adding user explanations.');
