import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import worker from './worker.js';
import { researchFetch } from './research.js';
import { factionWorkbook } from './faction-workbook.js';

if (!globalThis.crypto) Object.defineProperty(globalThis,'crypto',{value:webcrypto});
const token='a'.repeat(64);
const env={RESEARCH_TOKEN_SHA256:createHash('sha256').update(token).digest('hex'),TORN_API_KEY:'torn-secret-fixture',KAL_API_KEY:'kal-secret-fixture',FFSCOUTER_API_KEY:'ff-secret-fixture'};
const request=(path,auth=token,method='GET')=>new Request('https://worker.example/v1/research'+path,{method,headers:auth?{Authorization:'Bearer '+auth}:{}});
const json=(body,status=200)=>Response.json(body,{status});
const fail=()=>{throw Error('Unexpected upstream call');};
const equipment={id:398,name:'SIG & 552',slot_name:'primary',rarity:'orange',stats:{damage:77,accuracy:56},bonuses:[{title:'Warlord',value:24}]};
function mocked(calls, options={}) {
  return async (url,init)=>{
    const u=new URL(url);
    calls.push({u,init});
    if(u.hostname==='api.torn.com'&&u.pathname.endsWith('/rankedwars'))return json({rankedwars:[]});
    if(u.hostname==='api.torn.com')return json({members:[{id:1,name:'=not a formula',level:10},{id:2,name:'Second',level:20},{id:3,name:'Third'}]});
    if(u.hostname==='ffscouter.com')return options.ffError?json({error:'bad key '+env.FFSCOUTER_API_KEY,code:2},401):json([{player_id:2,bs_estimate:1000,fair_fight:1.5,last_updated:1786331700},{player_id:1,bs_estimate:2000}]);
    if(u.pathname==='/faction/123/loadouts')return json({name:'Test faction',members_observed_at:1786331700,members:[{user_id:1,loadout:{observed_at:1786331700,equipment:[equipment]}},{user_id:2,loadout:null},{user_id:999,loadout:{equipment:[]}}]});
    if(u.pathname==='/user/3/loadout')return json({user_id:3,observed_at:1786331800,equipment:[{...equipment,rarity:'red'}]});
    return fail();
  };
}
test('research auth is separate and route dispatch does not require the graphics bucket',async()=>{
  assert.equal((await worker.fetch(request('/health'),env)).status,200);
  assert.equal((await researchFetch(request('/health',null),env,fail)).status,401);
  const other='b'.repeat(64);
  assert.equal((await researchFetch(request('/health',other),{...env,ASSET_UPLOAD_TOKEN_SHA256:createHash('sha256').update(other).digest('hex')},fail)).status,401);
  assert.equal((await researchFetch(request('/health'),{},fail)).status,503);
  assert.equal((await researchFetch(request('/health',token,'POST'),env,fail)).status,405);
});
test('Torn proxy forwards documented read paths, query parameters and provider-specific credentials',async()=>{
  for(const [path,expected,header] of [['/torn/v2/user/123/basic?striptags=true','/v2/user/123/basic',true],['/torn/user/123?selections=basic','/user/123',false]]) {
    const response=await researchFetch(request(path),env,async(url,init)=>{
      const u=new URL(url);
      assert.equal(u.origin,'https://api.torn.com');
      assert.equal(u.pathname,expected);
      assert.equal(init.redirect,'manual');
      assert.equal(init.headers.Authorization,header?'ApiKey '+env.TORN_API_KEY:undefined);
      assert.equal(u.searchParams.get('key'),header?null:env.TORN_API_KEY);
      return json({name:'Example'});
    });
    assert.equal(response.status,200);
  }
  for(const path of ['/torn/https://evil.example','/torn/v2/user?key=bad','/torn/v2/user/%2fexample','/kal/unknown','/ffscouter/stats?ids=0'])assert.equal((await researchFetch(request(path),env,fail)).status,400);
});
test('missing provider secret and upstream error return actionable redacted details',async()=>{
  const missing=await researchFetch(request('/torn/v2/user/basic'),{...env,TORN_API_KEY:undefined},fail);
  assert.equal(missing.status,503);
  assert.equal((await missing.json()).error.secret,'TORN_API_KEY');
  const bad=await researchFetch(request('/torn/v2/user/basic'),env,async()=>json({error:{code:5,error:'Too many requests '+env.TORN_API_KEY}}));
  assert.equal(bad.status,429);
  const body=await bad.json();
  assert.equal(body.error.upstream_code,'5');
  assert.equal(body.error.provider,'torn');
  assert.ok(!JSON.stringify(body).includes(env.TORN_API_KEY));
  const invalid=await researchFetch(request('/kal/check-key'),env,async()=>new Response('invalid html',{status:502}));
  assert.match((await invalid.json()).error.message,/non-JSON/);
});
test('faction report joins by ID, excludes former members and recovers missing KAL roster entries',async()=>{
  const calls=[];
  const res=await researchFetch(request('/faction/123'),env,mocked(calls));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.deepEqual(body.player_ids,[1,2,3]);
  assert.equal(body.members[0].stats.bs_estimate,2000);
  assert.equal(body.members[1].loadout_status,'no_visible_loadout');
  assert.equal(body.members[2].loadout.equipment[0].rarity,'red');
  assert.equal(body.members[2].stats_status,'no_estimate');
  assert.equal(calls.length,4);
  const kal=calls.find(x=>x.u.hostname==='api.kalends.dev');
  assert.equal(kal.init.headers.Authorization,'ApiKey '+env.KAL_API_KEY);
  const ff=calls.find(x=>x.u.hostname==='ffscouter.com');
  assert.equal(ff.u.searchParams.get('targets'),'1,2,3');
  assert.equal(ff.u.searchParams.get('key'),env.FFSCOUTER_API_KEY);
});
test('FFScouter failure retains roster and KAL data, with explicit coverage warning',async()=>{
  const res=await researchFetch(request('/faction/123'),env,mocked([],{ffError:true}));
  const body=await res.json();
  assert.equal(body.members.length,3);
  assert.equal(body.members[0].stats_status,'provider_error');
  assert.equal(body.members[0].loadout_status,'available');
  assert.equal(body.warnings[0].provider,'ffscouter');
  assert.ok(!JSON.stringify(body).includes(env.FFSCOUTER_API_KEY));
});
function unzipStored(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const files={};let offset=0;
  while(view.getUint32(offset,true)===0x04034b50){
    const size=view.getUint32(offset+18,true),len=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    const name=new TextDecoder().decode(bytes.slice(offset+30,offset+30+len));
    const start=offset+30+len+extra;
    files[name]=new TextDecoder().decode(bytes.slice(start,start+size));
    offset=start+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  return files;
}
test('XLSX endpoint provides valid package entries, rarity styles, source dates and safe text',async()=>{
  const res=await researchFetch(request('/faction/123/export.xlsx'),env,mocked([]));
  assert.equal(res.status,200);
  assert.match(res.headers.get('Content-Type'),/spreadsheetml/);
  const files=unzipStored(new Uint8Array(await res.arrayBuffer()));
  assert.ok(files['[Content_Types].xml']);
  assert.match(files['xl/workbook.xml'],/Faction roster.*Equipment details.*Read me/);
  assert.match(files['xl/worksheets/sheet1.xml'],/s="4" t="inlineStr".*SIG &amp; 552/);
  assert.match(files['xl/worksheets/sheet1.xml'],/s="5" t="inlineStr".*SIG &amp; 552/);
  assert.match(files['xl/worksheets/sheet1.xml'],/=not a formula/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f>/);
  assert.doesNotMatch(files['xl/workbook.xml'],/Item artwork/);
  assert.match(files['xl/styles.xml'],/FFFFF2B2.*FFFFD0A1.*FFFFB5B5/);
});
test('empty faction and warnings produce a workbook without placeholder stats',()=>{
  const files=unzipStored(factionWorkbook({faction_id:1,members:[],warnings:[{provider:'kal',message:'Unavailable'}]}));
  assert.match(files['xl/worksheets/sheet1.xml'],/A1:R1/);
  assert.match(files['xl/worksheets/sheet3.xml'],/Unavailable/);
});

test('legacy images parameter remains accepted without creating an artwork sheet',async()=>{
  const res=await researchFetch(request('/faction/123/export.xlsx?images=true'),env,mocked([]));
  assert.equal(res.status,200);
  const files=unzipStored(new Uint8Array(await res.arrayBuffer()));
  assert.doesNotMatch(files['xl/workbook.xml'],/Item artwork/);
  assert.doesNotMatch(files['xl/worksheets/sheet1.xml'],/<f>/);
  assert.equal((await researchFetch(request('/faction/123?images=true'),env,fail)).status,400);
});

test('faction roster uses full official Torn URL and rejects redirects without forwarding credentials',async()=>{
  let calls=0;
  const response=await researchFetch(request('/faction/16247'),env,async(url,init)=>{
    calls++;
    assert.equal(url,'https://api.torn.com/v2/faction/16247/members?striptags=true');
    assert.equal(init.redirect,'manual');
    assert.equal(init.headers.Authorization,'ApiKey '+env.TORN_API_KEY);
    return new Response(null,{status:302,headers:{Location:'https://unexpected.example/?key='+env.TORN_API_KEY}});
  });
  assert.equal(calls,1);
  assert.equal(response.status,502);
  const body=await response.json();
  assert.equal(body.error.upstream_status,302);
  assert.equal(body.error.upstream_origin,'https://api.torn.com');
  assert.match(body.error.message,/redirect/);
  assert.ok(!JSON.stringify(body).includes(env.TORN_API_KEY));
});

test('roster has only requested columns and real date cells; missing estimates stay blank',()=>{
  const report={faction_id:123,members:[
    {name:'Example',player_id:1,level:100,position:'Leader',status:'Okay',stats:{bs_estimate:123456,bs_estimate_human:'123k',fair_fight:3,last_updated:Date.UTC(2026,10,26,23,59)/1000},stats_status:'available',loadout:{observed_at:'2026-11-25T01:10:00Z',equipment:[equipment]},loadout_status:'available'},
    {name:'Missing',player_id:2,stats:null,loadout:null,stats_status:'no_estimate',loadout_status:'no_visible_loadout'}
  ]};
  const files=unzipStored(factionWorkbook(report));
  const roster=files['xl/worksheets/sheet1.xml'];
  const header=roster.match(/<row r="1"[^>]*>(.*?)<\/row>/)[1];
  const labels=[...header.matchAll(/<t xml:space="preserve">(.*?)<\/t>/g)].map(m=>m[1]);
  assert.deepEqual(labels,['Player','Player ID','FFScouter estimate','Stats updated','Torn Stats total','Spy date','Last 6 wars (points)','Loadout observed','Loadout note','Primary','Secondary','Melee','Temporary','Helmet','Body','Pants','Boots','Gloves']);
  const serial=Math.floor(Date.UTC(2026,10,26)/86400000)+25569;
  assert.match(roster,/<c r="C2" s="2"><v>123456<\/v><\/c>/);
  assert.ok(roster.includes('<c r="D2" s="6"><v>'+serial+'</v></c>'));
  assert.ok(roster.includes('<c r="H2" s="6"><v>'+(serial-1)+'</v></c>'));
  assert.match(roster,/<c r="C3" s="2" t="inlineStr"><is><t xml:space="preserve"><\/t><\/is><\/c>/);
  assert.match(files['xl/styles.xml'],/numFmtId="164" formatCode="mmmm d, yyyy"/);
  assert.ok(files['xl/worksheets/sheet2.xml'].includes('<c r="P2" s="6"><v>'+(serial-1)+'</v></c>'));
  assert.match(roster,/<c r="J2" s="4" t="inlineStr"/);
});

test('export enriches documented spy roster, six ordered war scores and next older pillow loadout',async()=>{
  const calls=[];const now=Math.floor(Date.now()/1000);
  const pillow={id:99,name:'Pillow',slot_name:'melee'};
  const mock=async(url,init)=>{
    const u=new URL(url);calls.push(u.pathname);
    if(u.hostname==='api.torn.com'){
      if(u.pathname.endsWith('/members'))return json({members:[{id:1,name:'Example'},{id:2,name:'Missing'}]});
      if(u.pathname.endsWith('/rankedwars'))return json({rankedwars:[...Array.from({length:7},(_,i)=>({id:100+i,end:now-100-i*100})),{id:999,end:0}]});
      const id=Number(u.pathname.split('/')[3]);
      return json({rankedwarreport:{id,factions:[{id:123,members:[{id:1,score:id===101?0:id}]},{id:456,name:'Opponent',members:[]}]}});
    }
    if(u.hostname==='www.tornstats.com'){
      assert.equal(u.pathname,'/api/v2/spy-fixture/spy/faction/123');
      return json({status:true,faction:{ID:123},members:{1:{id:1,spy:{total:'123456',timestamp:now-300}},2:{id:2,spy:{status:false}}}});
    }
    if(u.hostname==='ffscouter.com')return json([{player_id:1,bs_estimate:111111}]);
    if(u.pathname==='/faction/123/loadouts')return json({members:[{user_id:1,loadout:{observed_at:now,equipment:[pillow]}},{user_id:2,loadout:null}]});
    if(u.pathname==='/user/1/loadout')return u.searchParams.get('cursor')==='older'?json({user_id:1,observed_at:now-86400,equipment:[equipment]}):json({user_id:1,observed_at:now,equipment:[pillow],pagination:{next_cursor:'older'}});
    throw Error('Unexpected request');
  };
  const result=await researchFetch(request('/faction/123/export.xlsx'),{...env,TORNSTATS_API_KEY:'spy-fixture'},mock);
  assert.equal(result.status,200);
  const files=unzipStored(new Uint8Array(await result.arrayBuffer()));
  const roster=files['xl/worksheets/sheet1.xml'];
  assert.match(roster,/<c r="E2" s="2"><v>123456<\/v>/);
  assert.match(roster,/100 \| 0 \| 102 \| 103 \| 104 \| 105/);
  assert.match(roster,/Historical \(pillow fallback\)/);
  assert.match(roster,/SIG &amp; 552/);
  assert.doesNotMatch(roster,/>Pillow</);
  assert.match(roster,/— \| — \| — \| — \| — \| —/);
  assert.equal(calls.filter(p=>p.endsWith('/rankedwarreport')).length,6);
  assert.ok(!calls.some(p=>p.includes('/106/rankedwarreport')));
  assert.ok(!Object.values(files).join('').includes('spy-fixture'));
});
