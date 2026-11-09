import test from 'node:test';
import assert from 'node:assert/strict';
import {completedSale,bunkerBucks,summarize,valuation,matchesWatch,weaverBulk,normalizeListing,scanPlan} from './model.mjs';

test('shared scan prioritizes armor and melee and uses price ceilings',async()=>{
 const plan=scanPlan(6030000);
 assert.deepEqual(plan.map(x=>[x.weaponType??x.tab,x.maxPrice]),[['armor',651240000],['melee',488430000],['secondary',1139670000],['primary',1139670000]]);
 const {tab,...filters}=plan[1];
 assert.deepEqual(await weaverBulk(tab,async url=>{
  assert.equal(url.searchParams.get('weaponType'),'melee');
  assert.equal(url.searchParams.get('maxPrice'),'488430000');
  return {total_count:0,weapons:null};
 },5,{},filters),{rows:[],complete:true});
});

test('watch checks class, rarity, perks and budget independently',()=>{
 const row={uid:'1',category:'secondary',weaponClass:'smg',rarity:'red',price:300000000,bonuses:[{name:'A'},{name:'B'}]};
 const rule={groups:['small'],rarities:['red'],perkCounts:[2],maxPrice:310000000,maxPercent:90};
 assert.ok(matchesWatch(row,rule,6700000));
 for(const update of [{groups:['heavy']},{rarities:['orange']},{perkCounts:[1]},{maxPrice:299000000}])assert.equal(matchesWatch(row,{...rule,...update},6700000),null);
 assert.equal(matchesWatch({...row,rarity:'yellow'},rule,6700000),null);
});
import {cleanNext,historyQuery,refreshSnapshot} from './index.mjs';
const item={id:1,uid:44,name:'Example Rifle',type:'Primary',sub_type:'Rifle',rarity:'Orange',stats:{quality:100,damage:60,accuracy:55},bonuses:[{title:'Warlord',value:12},{title:'Conserve',value:18}]};
const auction={id:10,buyer:{id:5},bids:4,price:240000000,timestamp:1770000000,item};
test('archive excludes unsold or unranked results, but distinct auctions may resell the same UID',()=>{
 const a=completedSale(auction), b=completedSale({...auction,id:11});
 assert.equal(a.itemUid,b.itemUid);assert.notEqual(a.auctionId,b.auctionId);
 assert.equal(completedSale({...auction,buyer:null}),null);assert.equal(completedSale({...auction,bids:0}),null);
 assert.equal(completedSale({...auction,item:{...item,rarity:null}}),null);
 assert.equal(a.armor,null);assert.equal(a.bonuses[0].name,'Warlord');
});
test('Big Al value and watch rules are separate from the price history',()=>{
 const row={...completedSale(auction),price:auction.price,uid:44};
 assert.equal(bunkerBucks(row),45);
 assert.equal(valuation(row,134000000/20).bunkerValue,301500000);
 assert.ok(matchesWatch(row,{maxPercent:90,bonus:'warlord',minBonus:12},6700000));
 assert.equal(matchesWatch(row,{maxPercent:79},6700000),null);
 assert.equal(matchesWatch({...row,uid:null},{maxPercent:90},6700000),null);
 assert.equal(bunkerBucks({...row,category:'armor',rarity:'red'}),null);
 assert.equal(bunkerBucks({...row,category:'armor',rarity:'red',bonuses:[{name:'Test'}]}),108);
});
test('median, quartiles, recent median and trim use completed sale prices only',()=>{
 const now=1770000000;
 const rows=[10,20,30,40,1000].map((salePrice,i)=>({salePrice,endedAt:i<3?now:0}));
 assert.deepEqual(summarize(rows,now),{count:5,median:30,average:220,trimmedAverage:220,min:10,max:1000,p25:20,p75:40,recentMedian:20});
});
test('history binds user input and can match bonuses in either order',()=>{
 const x=historyQuery(new URLSearchParams({item:"O'Brien",bonus1:'Warlord',minBonus1:'12',bonus2:'Conserve',minDamage:'60'}));
 assert.ok(!x.where.includes("O'Brien"));
 assert.deepEqual(x.values,["O'Brien",60,'Warlord',12,'Conserve','Warlord',12,'Conserve']);
 assert.match(x.where,/bonus_1 = .*bonus_2 = .* OR .*bonus_2 = .*bonus_1 = /);
});
test('Torn pagination does not leak key or follow another origin',()=>{
 assert.throws(()=>cleanNext('https://example.com/v2/market/auctionhouse',1,2));
 const u=new URL(cleanNext('?offset=100&key=secret',1,2));
 assert.equal(u.searchParams.get('key'),null);assert.equal(u.searchParams.get('offset'),'100');
});
test('Weaver paginates in bulk and rejects unexpected or truncated responses',async()=>{
 const row={itemName:'Example',price:100,rarity:'Yellow'};
 const offsets=[];
 const result=await weaverBulk('weapons',async u=>{const offset=Number(u.searchParams.get('offset'));offsets.push(offset);return {weapons:[{...row,uid:offset+1}],total_count:2};});
 assert.deepEqual(offsets,[0,1]);assert.equal(result.complete,true);assert.equal(result.rows.length,2);
 assert.equal((await weaverBulk('armor',async()=>({weapons:[row],total_count:3}),1)).complete,false);
 await assert.rejects(weaverBulk('armor',async()=>({})),/unavailable/);
});
test('live Weaver shape preserves slot, decimal stats, keyed bonuses and freshness',()=>{
 const weapon={uid:'21821713037',itemId:485,itemName:'Skorpion',weaponType:'Secondary',rarity:'yellow',damage:'46.9',accuracy:'58.8',quality:'117.03',bonuses:{0:{bonus:'Wither',value:22}},price:26500000,playerId:2491196,lastUpdated:'2026-11-09T04:22:16Z',source:'bazaar'};
 const row=normalizeListing(weapon,'weapons',{485:'SMG'});
 assert.equal(row.category,'secondary');assert.equal(row.damage,46.9);assert.equal(row.quality,117.03);
 assert.deepEqual(row.bonuses,[{name:'Wither',value:22}]);assert.equal(row.updatedAt,weapon.lastUpdated);
 assert.equal(bunkerBucks(row),4);assert.equal(bunkerBucks(normalizeListing(weapon,'weapons')),null);
 const armor=normalizeListing({...weapon,itemId:661,itemName:'Dune Vest',weaponType:'Armor',damage:null,accuracy:null,quality:'16.24',bonuses:{0:{bonus:'Insurmountable',value:31}},price:80000000},'armor');
 assert.equal(armor.damage,null);assert.equal(armor.armor,null);assert.equal(bunkerBucks(armor),12);
 assert.equal(bunkerBucks(normalizeListing({...weapon,bonuses:{0:{bonus:'Wither'},1:{value:15}}},'weapons',{485:'SMG'})),null);
});
test('Weaver outage does not prevent cache-rate collection',async()=>{
 let data;
 await refreshSnapshot({LIVE_SCAN_ENABLED:'true',TORN_AUCTION_KEY:'fake',RANKED_SNAPSHOT:{get:async()=>null,put:async(_key,v)=>{data=JSON.parse(v);}}},async url=>{
  if(String(url).includes('weav3r.dev'))return new Response(null,{status:503});
  return Response.json({itemmarket:{item:{id:1120},listings:[{price:134000000},{price:140000000}]}});
 });
 assert.equal(data.available,false);assert.equal(data.quote.rate,6700000);
});
test('Weaver rate limit stops lower-priority scans and delays the next refresh',async()=>{
 const entries=new Map(),calls=[],now=1_800_000_000_000;
 const env={LIVE_SCAN_ENABLED:'true',TORN_AUCTION_KEY:'fake',RANKED_SNAPSHOT:{
  get:async key=>entries.has(key)?{json:async()=>entries.get(key)}:null,
  put:async(key,v)=>entries.set(key,JSON.parse(v))
 }};
 const fetcher=async raw=>{
  const u=new URL(raw);
  if(u.hostname==='weav3r.dev'){
   calls.push(u.searchParams.get('weaponType')??u.searchParams.get('tab'));
   return calls.length===1?Response.json({total_count:0,weapons:null}):new Response(null,{status:429,headers:{'Retry-After':'600'}});
  }
  return Response.json(u.pathname.endsWith('/items')?{items:[{id:485,sub_type:'SMG'}]}:{itemmarket:{item:{id:1120},listings:[{price:134000000}]}});
 };
 await refreshSnapshot(env,fetcher,now);
 await refreshSnapshot(env,fetcher,now+300000);
 assert.deepEqual(calls,['armor','melee']);
 assert.equal(entries.get('ranked-gear/live-v1.json').complete,false);
});
