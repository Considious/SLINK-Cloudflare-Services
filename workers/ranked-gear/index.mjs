import {completedSale,weaverBulk,summarize,matchesWatch,bunkerBucks,scanPlan,gearGroups} from './model.mjs';
const AUCTION='https://api.torn.com/v2/market/auctionhouse', SNAPSHOT='ranked-gear/live-v1.json';
const INSERT='INSERT OR IGNORE INTO ranked_sales VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
const checkpoint='UPDATE ranked_ingest SET completed_through=?,window_end=?,next_url=? WHERE id=1';
async function get(url,key,fetcher=fetch){
 const r=await fetcher(url,{headers:{Accept:'application/json',...(key?{Authorization:'ApiKey '+key}:{})},signal:AbortSignal.timeout(12000),redirect:'error'});
 if(!r.ok)throw Object.assign(Error('Upstream HTTP '+r.status),{status:r.status,retryAfter:r.headers.get('Retry-After')});
 const data=await r.json();if(data?.error)throw Error('Torn API rejected the request');return data;
}
export function cleanNext(raw,from,to){
 if(raw==null)return null;
 const u=new URL(raw,AUCTION);
 if(u.origin!=='https://api.torn.com'||u.pathname!=='/v2/market/auctionhouse'||u.username||u.password)throw Error('Unexpected auction pagination link');
 u.searchParams.delete('key');u.searchParams.set('from',String(from));u.searchParams.set('to',String(to));u.searchParams.set('sort','ASC');
 return u.href;
}
export async function ingest(env,fetcher=fetch,now=Math.floor(Date.now()/1000)){
 if(!env.TORN_AUCTION_KEY)throw Error('Missing ingestion credential');
 const start=Number(env.AUCTION_START_UNIX);
 if(!Number.isSafeInteger(start)||start<1450000000||start>=now)throw Error('Invalid configured archive start');
 const db=env.RANKED_DB;
 await db.prepare('INSERT OR IGNORE INTO ranked_ingest(id,completed_through) VALUES (1,?)').bind(start-1).run();
 const progress=await db.prepare('SELECT * FROM ranked_ingest WHERE id=1').first();
 const from=progress.completed_through+1,to=progress.window_end??Math.min(now-600,from+86400-1);
 if(from>to)return;
 let url=progress.next_url?cleanNext(progress.next_url,from,to):AUCTION+'?'+new URLSearchParams({from,to,limit:100,sort:'ASC'});
 const seen=new Set();
 for(let page=0;page<8&&url;page++){
  if(seen.has(url))throw Error('Repeated Torn auction page');seen.add(url);
  const payload=await get(url,env.TORN_AUCTION_KEY,fetcher);
  if(!Array.isArray(payload?.auctionhouse)||!payload?._metadata?.links||!Object.hasOwn(payload._metadata.links,'next'))throw Error('Unexpected Torn auction response');
  const next=cleanNext(payload._metadata.links.next,from,to);if(next===url||seen.has(next))throw Error('Repeated Torn auction pagination');
  const rows=payload.auctionhouse.map(completedSale).filter(row=>row&&row.endedAt>=from&&row.endedAt<=to);
  await db.batch([...rows.map(x=>db.prepare(INSERT).bind(x.auctionId,x.itemUid==null?null:String(x.itemUid),x.itemId,x.itemName,x.category,x.weaponClass,x.rarity,x.quality,x.damage,x.accuracy,x.armor,x.bonuses?.[0]?.name??null,x.bonuses?.[0]?.value??null,x.bonuses?.[1]?.name??null,x.bonuses?.[1]?.value??null,x.salePrice,x.endedAt)),db.prepare(checkpoint).bind(next?from-1:to,next?to:null,next)]);
  url=next;
 }
}
export function historyQuery(params){
 const conditions=[],values=[];
 function bound(column,op,value){conditions.push(column+' '+op+' ?');values.push(value);}
 for(const [field,col] of Object.entries({item:'item_name',category:'category',rarity:'rarity',weaponClass:'weapon_class'})){
  const value=params.get(field)?.trim();if(value)bound(col,'=',value.slice(0,120));
 }
 for(const [field,col] of Object.entries({quality:'quality',damage:'damage',accuracy:'accuracy',armor:'armor',date:'ended_at'}))for(const [prefix,op] of [['min','>='],['max','<=']]){
  const value=params.get(prefix+field[0].toUpperCase()+field.slice(1));if(value!==null&&value.trim()&&Number.isFinite(Number(value)))bound(col,op,Number(value));
 }
 for(let slot=1;slot<=2;slot++){
  const name=params.get('bonus'+slot)?.trim(), min=params.get('minBonus'+slot),max=params.get('maxBonus'+slot);
  if(!name&&min===null&&max===null)continue;
  // Both perk filters can match either native slot; when both are used they must match distinct perks.
  const build=i=>{const checks=[],args=[];if(name){checks.push('bonus_'+i+' = ?');args.push(name.slice(0,120));}
   for(const [x,op] of [[min,'>='],[max,'<=']])if(x!==null&&x.trim()&&Number.isFinite(Number(x))){checks.push('bonus_'+i+'_value '+op+' ?');args.push(Number(x));}
   return checks.length?{sql:'('+checks.join(' AND ')+')',args}:null;};
  const a=build(1),b=build(2);if(a)conditions.push({slot,a,b});
 }
 const perks=conditions.filter(x=>typeof x==='object'), clauses=conditions.filter(x=>typeof x==='string');
 if(perks.length===1){const [{a,b}]=perks;clauses.push('('+a.sql+' OR '+b.sql+')');values.push(...a.args,...b.args);}
 if(perks.length===2){const [a,b]=perks;clauses.push('(('+a.a.sql+' AND '+b.b.sql+') OR ('+a.b.sql+' AND '+b.a.sql+'))');values.push(...a.a.args,...b.b.args,...a.b.args,...b.a.args);}
 return {where:clauses.length?' WHERE '+clauses.join(' AND '):'',values};
}
export async function refreshSnapshot(env,fetcher=fetch,now=Date.now()){
 if(!env.RANKED_SNAPSHOT||env.LIVE_SCAN_ENABLED!=='true')return;
 const quote=async()=>{
  const data=await get('https://api.torn.com/v2/market/1120/itemmarket',env.TORN_AUCTION_KEY,fetcher);
  const asks=data?.itemmarket?.listings;
  if(!Array.isArray(asks)||data?.itemmarket?.item?.id!==1120)throw Error('Invalid cache quote');
  const lowest=asks.map(a=>a.price).filter(p=>Number.isSafeInteger(p)&&p>0).reduce((a,b)=>Math.min(a,b),Infinity);
  return Number.isFinite(lowest)?{rate:lowest/20,ask:lowest,observedAt:now}:null;
 };
 const catalog=async()=>{
  const path='ranked-gear/weapon-classes-v1.json';
  let previous;
  try{const cached=await env.RANKED_SNAPSHOT.get(path);previous=cached?await cached.json():null;}catch{}
  if(previous?.classes&&now-previous.observedAt<86400000)return previous.classes;
  if(!env.TORN_AUCTION_KEY)return previous?.classes||{};
  try{
   const data=await get('https://api.torn.com/v2/torn/items',env.TORN_AUCTION_KEY,fetcher);
   if(!Array.isArray(data?.items))throw Error('Invalid Torn item catalog');
   const classes=Object.fromEntries(data.items.filter(x=>Number.isSafeInteger(x?.id)&&typeof x.sub_type==='string').map(x=>[x.id,x.sub_type]));
   if(!Object.keys(classes).length)throw Error('No weapon classes in Torn item catalog');
   try{await env.RANKED_SNAPSHOT.put(path,JSON.stringify({observedAt:now,classes}));}catch{}
   return classes;
  }catch{return previous?.classes||{};}
 };
 const old=await env.RANKED_SNAPSHOT.get(SNAPSHOT);
 const previous=old?await old.json():null;
 if(previous?.retryAt>now)return;
 const [classes,currentQuote]=await Promise.all([catalog(),env.TORN_AUCTION_KEY?quote().catch(()=>null):null]);
 const activeQuote=currentQuote??(now-previous?.quote?.observedAt<15*60000?previous.quote:null);
 if(!activeQuote)return;
 const scanRate=Math.max(activeQuote.rate,Number(env.LIVE_SCAN_MAX_BB_RATE)||0);
 const scanPercent=Math.min(100,Math.max(1,Number(env.LIVE_SCAN_MAX_PERCENT)||90));
 const workerBudget=Number(env.LIVE_SCAN_MAX_PRICE);
 const rows=[];
 let complete=true,successful=0,retryAt=0;
 for(const {tab,...filters} of scanPlan(scanRate*scanPercent/100)){
  if(workerBudget>0)filters.maxPrice=Math.floor(Math.min(filters.maxPrice,workerBudget));
  try{
   const page=await weaverBulk(tab,u=>get(u,null,fetcher),5,classes,filters);
   rows.push(...page.rows);successful++;complete&&=page.complete;
  }catch(e){
   complete=false;
   if(e.status===429){
    const delay=Number(e.retryAfter)>0?Number(e.retryAfter)*1000:Date.parse(e.retryAfter)-now;
    retryAt=now+Math.max(5*60000,Number.isFinite(delay)?delay:0);
    break;
   }
  }
 }
 const value={observedAt:now,available:successful>0,complete,quote:activeQuote,scanRate,scanPercent,scanBudget:workerBudget>0?workerBudget:null,rows,retryAt};
 await env.RANKED_SNAPSHOT.put(SNAPSHOT,JSON.stringify(value));
}
export default {
 async scheduled(_event,env,ctx){ctx.waitUntil(Promise.allSettled([ingest(env),refreshSnapshot(env)]).then(results=>{if(results.some(r=>r.status==='rejected'))throw Error('Ranked Gear scheduled job failed');}));},
 async fetch(request,env){
  const url=new URL(request.url);
  const origin=request.headers.get('Origin');
  const cors=origin==='https://www.torn.com'||/^chrome-extension:\/\/[a-p]{32}$/.test(origin||'')?{'Access-Control-Allow-Origin':origin,Vary:'Origin'}:{};
  const send=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store',...cors}});
  if(env.PREVIEW_HTTP_ENABLED!=='true')return send({error:'Ranked Gear preview access is not enabled.'},503);
  if(request.method==='OPTIONS'&&Object.keys(cors).length)return new Response(null,{status:204,headers:{...cors,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
  try{
   if(request.method==='GET'&&url.pathname==='/api/ranked/history'){
    const q=historyQuery(url.searchParams);
    if(!q.where)return send({error:'Choose at least one gear filter.'},400);
    const rows=(await env.RANKED_DB.prepare('SELECT * FROM ranked_sales'+q.where+' ORDER BY ended_at DESC,auction_id DESC LIMIT 5001').bind(...q.values).all()).results;
    if(rows.length>5000)return send({error:'More than 5,000 sales match. Narrow the filters for an exact summary.'},422);
    const state=await env.RANKED_DB.prepare('SELECT completed_through FROM ranked_ingest WHERE id=1').first();
    let quote=null;
    try{const snapshot=await env.RANKED_SNAPSHOT?.get(SNAPSHOT),live=snapshot?await snapshot.json():null;if(live?.quote&&Date.now()-live.quote.observedAt<15*60000)quote=live.quote;}catch{}
    const sales=rows.slice(0,100).map(x=>({...x,bb:bunkerBucks({rarity:x.rarity,category:x.category,weaponClass:x.weapon_class,bonuses:[x.bonus_1,x.bonus_2].filter(Boolean)})}));
    return send({source:'Torn completed Auction API / SLINK archive',indexedThrough:state?.completed_through??null,summary:summarize(rows.map(x=>({salePrice:x.sale_price,endedAt:x.ended_at}))),rows:sales,quote});
   }
   if(request.method==='POST'&&url.pathname==='/api/ranked/watch'){
    if(!env.RANKED_SNAPSHOT)return send({error:'Live ranked listings are not configured.'},503);
    const raw=await request.text();if(raw.length>32768)return send({error:'Bunker Watch request is too large.'},413);
    let body;try{body=JSON.parse(raw);}catch{return send({error:'Invalid Bunker Watch request.'},400);}
    const rules=body?.rules;
    if(!Array.isArray(rules)||!rules.length||rules.length>40||rules.some(r=>!r||typeof r.id!=='string'||r.id.length>80||!(r.maxPercent>0&&r.maxPercent<=100)|| (r.groups!==undefined&&(!Array.isArray(r.groups)||!r.groups.length||r.groups.some(g=>!Object.hasOwn(gearGroups,g))))||(r.perkCounts!==undefined&&(!Array.isArray(r.perkCounts)||!r.perkCounts.length||r.perkCounts.some(n=>n!==1&&n!==2)))))return send({error:'Invalid Bunker Watch rules.'},400);
    const obj=await env.RANKED_SNAPSHOT.get(SNAPSHOT),live=obj?await obj.json():null;
    if(!live?.available||Date.now()-live.observedAt>15*60000)return send({error:'Live ranked listings are temporarily unavailable. Historical pricing still works.'},503);
    const rate=Number.isFinite(body.rate)&&body.rate>0?body.rate:live.quote?.rate;
    if(!rate)return send({error:'Small Arms Cache quote unavailable. Set a manual BB rate or try again later.'},503);
    const matches=[];
    for(const rule of rules){const seen=new Set(),eligible=[];for(const row of live.rows){
     const val=matchesWatch(row,rule,rate);if(!val||seen.has(row.uid))continue;seen.add(row.uid);
     eligible.push({watchId:rule.id,row,...val});
    }matches.push(...eligible.sort((a,b)=>a.percent-b.percent||a.row.price-b.row.price).slice(0,25));}
    const covered=rules.every(r=>rate*r.maxPercent<=live.scanRate*live.scanPercent&&(!live.scanBudget||r.maxPrice>0&&r.maxPrice<=live.scanBudget));
    return send({source:'TornW3B / Weaver observed asks',observedAt:live.observedAt,complete:live.complete&&covered,scanBudget:live.scanBudget??null,rate,rateSource:body.rate===rate?'Manual rate':'Small Arms Cache Item Market ask ÷ 20',matches});
   }
   return send({error:'Not found'},404);
  }catch{return send({error:'Ranked Gear data is temporarily unavailable.'},503);}
 }
};
