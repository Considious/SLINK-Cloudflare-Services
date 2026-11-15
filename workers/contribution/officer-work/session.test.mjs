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
 const env={PERMISSIONS_DB:{prepare,batch:async steps=>Promise.all(steps.map(s=>s.run()))},USER_BACKUPS:{get:async key=>key.endsWith('/78.json')?{json:async()=>({warId:78,report:{"rankedwarreport":{"id":78,"start":100,"end":200,"winner":5,"forfeit":false,"factions":[{"id":5,"name":"Faction A","rewards":{"respect":450,"points":10,"items":[{"id":1,"name":"Medium Arms Cache","quantity":2}]},"members":[{"id":511,"name":"Officer One","level":20,"attacks":8,"score":29}]},{"id":7,"name":"Faction B","rewards":{"respect":120,"points":4,"items":[{"id":2,"name":"Armor Cache","quantity":1}]},"members":[{"id":712,"name":"Opponent One","level":25,"attacks":4,"score":19}]}],"bonus_condition":"Fixture extra"}}})}:null},RANKED_ARCHIVE_FACTION_ID:'10'};
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
  const [row]= (await response.json()).rows;
  assert.equal(row.warId,78);
  assert.equal(row.report.rankedwarreport.factions[0].rewards.respect,450);
  assert.equal(row.report.rankedwarreport.factions[1].rewards.items[0].quantity,1);
  assert.equal(row.report.rankedwarreport.factions[0].members[0].name,'Officer One');
  assert.equal((await (await call('/ranked-archive/78',{headers})).json()).warId,78);
  assert.equal((await call('/jobs',{headers})).status,200);
 }
 assert.equal((await call('/jobs',{method:'POST',body:'{}'})).status,401);
 for(let warId=100;warId<121;warId++)sqlite.prepare('INSERT INTO officer_ranked_global_wars VALUES(?,?,?,?,?)').run(10,warId,100,200,JSON.stringify({warId}));
 const first=await (await call('/ranked-archive')).json();
 assert.equal(first.rows.length,20);assert.equal(first.rows[0].warId,120);assert.equal(first.rows[0].report,null);
 const older=await (await call('/ranked-archive?before='+first.next)).json();
 assert.deepEqual(older.rows.map(r=>r.warId),[100,78]);assert.equal(older.next,null);
 current=[];
 assert.equal((await call('/session')).status,403);
 assert.equal((await call('/ranked-archive')).status,403);
 active=false;
 assert.equal((await call('/session')).status,401);
});
