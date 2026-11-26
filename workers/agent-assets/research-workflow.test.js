import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { runResearchJob } from './research-workflow.js';
import worker from './worker.js';

const env={TORN_API_KEY:'torn-fixture',KAL_API_KEY:'kal-fixture',FFSCOUTER_API_KEY:'ff-fixture'};
const fail=()=>{throw Error('Unexpected network call');};
test('workflow health needs no research bearer; HTTP route still fails closed',async()=>{
  const r=await runResearchJob({operation:'health'},env,fail);
  assert.deepEqual(r,{ok:true,format:'json',data:{ok:true,configured:{torn:true,kal:true,ffscouter:true}}});
  assert.equal((await worker.fetch(new Request('https://example.com/v1/research/health'),env)).status,503);
});
test('workflow rejects unsupported operations, external URLs, injected paths and credentials',async()=>{
  for(const p of [{operation:'shell'},{operation:'torn',path:'https://evil.example'},{operation:'torn',path:'/v2/user/../key'},{operation:'torn',path:'/v2/user/basic',query:{key:'bad'}},{operation:'kal',path:'/check-key',token:'bad'},{operation:'faction',faction_id:'0'},{operation:'ffscouter',ids:[1,0]}]){
    const r=await runResearchJob(p,env,fail);
    assert.equal(r.ok,false);assert.equal(r.error.code,'INVALID_JOB');
  }
});
test('workflow uses existing Torn validation, credentials and error handling',async()=>{
  const result=await runResearchJob({operation:'torn',path:'/v2/faction/123/members',query:{striptags:true}},env,async(url,init)=>{
    assert.equal(new URL(url).origin,'https://api.torn.com');assert.equal(init.headers.Authorization,'ApiKey torn-fixture');
    return Response.json({error:{code:5,error:'Slow down torn-fixture'}});
  });
  assert.equal(result.ok,false);assert.equal(result.status,429);assert.ok(!JSON.stringify(result).includes('torn-fixture'));
});
test('workflow generates the existing XLSX without a public storage link',async()=>{
  const result=await runResearchJob({operation:'faction_export',faction_id:123,images:true},env,async(url)=>{
    const u=new URL(url);
    if(u.hostname==='api.torn.com')return Response.json({members:[{id:1,name:'Example'}]});
    if(u.hostname==='ffscouter.com')return Response.json([{player_id:1,bs_estimate:12345}]);
    return Response.json({name:'Faction',members:[{user_id:1,loadout:{equipment:[{id:398,name:'SIG',rarity:'orange',slot_name:'primary'}]}}]});
  });
  assert.equal(result.ok,true);assert.equal(result.format,'xlsx');assert.equal(result.encoding,'gzip+base64');
  const bytes=gunzipSync(Buffer.from(result.data,'base64'));
  assert.equal(bytes.length,result.bytes);assert.equal(bytes.readUInt32LE(0),0x04034b50);
  assert.ok(bytes.includes(Buffer.from('_xlfn.IMAGE')));
});
test('large JSON result is compressed; missing provider is actionable',async()=>{
  const result=await runResearchJob({operation:'torn',path:'/v2/user/basic'},env,async()=>Response.json({data:'a'.repeat(800000)}));
  assert.equal(result.encoding,'gzip+base64');
  assert.equal(JSON.parse(gunzipSync(Buffer.from(result.data,'base64')).toString()).data.length,800000);
  const missing=await runResearchJob({operation:'torn',path:'/v2/user/basic'},{},fail);
  assert.equal(missing.error.secret,'TORN_API_KEY');
});
