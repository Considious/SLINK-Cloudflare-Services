import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {handleOfficerWork} from './service.js';

test('Officer Work restores signed access without requiring or returning a Torn key',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 const prepare=sql=>{
  const bind=(...values)=>({run:async()=>sqlite.prepare(sql).run(...values),first:async()=>sqlite.prepare(sql).get(...values),all:async()=>({results:sqlite.prepare(sql).all(...values)})});
  return {...bind(),bind};
 };
 const env={PERMISSIONS_DB:{prepare,batch:async steps=>Promise.all(steps.map(s=>s.run()))},USER_BACKUPS:{get:async key=>key.endsWith('/78.json')?{json:async()=>({warId:78})}:null},RANKED_ARCHIVE_FACTION_ID:'10'};
 const actor={user_id:1,user_name:'Officer',faction_id:10,faction_position:'Leader',scopes:['slink.war.officer'],exp:Math.floor(Date.now()/1000)+600};
 let current=actor.scopes,active=true;
 const deps={session:async()=>active?actor:null,loadPermissions:async()=>({scopes:current}),hasScope:(value,scope)=>value.scopes.includes(scope),decryptApiKey:()=>{throw Error('Archive session must not decrypt a key');}};
 const call=(path,extra={})=>handleOfficerWork(new Request('https://unit.test/api/officer-work'+path,{...extra,headers:{Origin:'https://sharedliveintelligencenetwork.app',...extra.headers}}),env,{},deps);
 const resume=await call('/session');
 assert.equal(resume.status,200);
 assert.deepEqual((await resume.json()).identity,{userId:1,name:'Officer',factionId:10});
 sqlite.exec("INSERT INTO officer_work_credentials VALUES ('theirs',2,10,'secret','iv','{}',0,0,0),('mine',1,10,'secret','iv','{}',0,0,0)");
 for(const [credential,expected] of [['theirs',null],['mine','mine']]){
  const value=await (await call('/session',{headers:{'X-Officer-Credential':credential}})).json();
  assert.equal(value.credentialId,expected);assert.ok(!JSON.stringify(value).includes('secret'));
 }

 // The shared collection bucket is full. Existing rows must still render,
 // even when the browser sends a current saved credential or page-only key.
 sqlite.prepare('INSERT INTO officer_work_rate VALUES(?,?,20)').run(1,Math.floor(Date.now()/60000));
 assert.equal((await call('/ranked-archive')).status,200);
 sqlite.prepare('INSERT INTO officer_ranked_global_wars VALUES(?,?,?,?,?)').run(10,78,100,200,JSON.stringify({warId:78}));
 for(const headers of [{},{'X-Officer-Credential':'mine'},{'X-Officer-Key':'abcdefghijklmnop'}]){
  const response=await call('/ranked-archive',{headers});
  assert.equal(response.status,200);
  assert.deepEqual((await response.json()).rows,[{warId:78}]);
  assert.deepEqual(await (await call('/ranked-archive/78',{headers})).json(),{warId:78});
  assert.equal((await call('/jobs',{headers})).status,200);
 }
 assert.equal((await call('/jobs',{method:'POST',body:'{}'})).status,401);
 current=[];
 assert.equal((await call('/session')).status,403);
 assert.equal((await call('/ranked-archive')).status,403);
 active=false;
 assert.equal((await call('/session')).status,401);
});
