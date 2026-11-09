// Torn API v2 completed sales and documented Big Al exchange values.
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const weaverNumber=v=>typeof v==='string'&&/^\d+(?:\.\d+)?$/.test(v)?number(Number(v)):number(v);
const positive=v=>number(v)>0?v:null;
const int=v=>Number.isSafeInteger(v)&&v>0?v:null;
const label=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,120):null;
const canonical=v=>label(v)?.toLowerCase()??'';
const levels=['yellow','orange','red'];
const types=['primary','secondary','melee','armor','defensive'];
const bucks={pistol:4,smg:4,clubbing:6,piercing:6,slashing:6,shotgun:10,rifle:10,'machine gun':14,'heavy artillery':14};
export const gearGroups={small:['pistol','smg'],melee:['clubbing','piercing','slashing'],long:['rifle','shotgun'],heavy:['machine gun','heavy artillery'],armor:[]};
export function gearGroup(row){
 return ['armor','defensive'].includes(row.category)?'armor':Object.keys(gearGroups).find(k=>gearGroups[k].includes(row.weaponClass));
}
export function scanPlan(rate){
 return [
  {tab:'armor',bb:108},
  {tab:'weapons',weaponType:'melee',bb:81},
  // Primary and secondary are slots, not classes. Keep a safe ceiling
  // on both rather than assuming every secondary is a pistol or SMG.
  {tab:'weapons',weaponType:'secondary',bb:189},
  {tab:'weapons',weaponType:'primary',bb:189}
 ].map(({bb,...scan})=>({...scan,maxPrice:Math.floor(bb*rate)}));
}
function bonuses(value){
 return Array.isArray(value)?value.map(b=>({name:label(b?.title??b?.name),value:number(b?.value)})).filter(b=>b.name):null;
}
export function bunkerBucks(row){
 const rarity=canonical(row?.rarity), category=canonical(row?.category), count=row?.bonuses?.length;
 if(!levels.includes(rarity)||![1,2].includes(count))return null;
 if(category==='armor'||category==='defensive')return count===1?({yellow:12,orange:36,red:108})[rarity]:null;
 if(!['primary','secondary','melee'].includes(category))return null;
 const base=bucks[canonical(row.weaponClass)];
 if(!base||(rarity==='yellow'&&count!==1))return null;
 return base*(rarity==='yellow'?1:rarity==='orange'?(count===2?4.5:3):(count===2?13.5:9));
}
export function completedSale(row){
 const item=row?.item, category=canonical(item?.type), rarity=canonical(item?.rarity);
 const auctionId=int(row?.id), itemId=int(item?.id), name=label(item?.name), endedAt=int(row?.timestamp), price=positive(row?.price);
 if(!auctionId||!itemId||!name||!endedAt||!price||!int(row?.bids)||!int(row?.buyer?.id)||!types.includes(category)||!levels.includes(rarity))return null;
 return {auctionId,itemUid:int(item.uid)??label(item.uid),itemId,itemName:name,category:category==='defensive'?'armor':category,weaponClass:canonical(item.sub_type)||null,rarity,
 quality:number(item.stats?.quality),damage:number(item.stats?.damage),accuracy:number(item.stats?.accuracy),armor:number(item.stats?.armor),
 bonuses:bonuses(item.bonuses),salePrice:price,endedAt,source:'torn-auction-api'};
}
export function normalizeListing(row,tab,weaponClasses={}){
 const itemName=label(row?.itemName),price=positive(row?.price),rarity=canonical(row?.rarity);
 if(!itemName||!price||!levels.includes(rarity))return null;
 const category=canonical(row.weaponType??row.itemType), itemId=int(row.itemId);
 const weaponClass=[row.weaponCategory,weaponClasses[itemId]].map(canonical).find(value=>Object.hasOwn(bucks,value))??null;
 const rawBonuses=row.bonuses&&typeof row.bonuses==='object'?Object.values(row.bonuses):null;
 const parsedBonuses=rawBonuses?.map(b=>({name:label(b?.bonus??b?.name??b?.title),value:weaverNumber(b?.value)}));
 const listingBonuses=parsedBonuses?.every(b=>b.name)&&new Set(parsedBonuses.map(b=>canonical(b.name))).size===parsedBonuses.length?parsedBonuses:null;
 const source=label(row.source), rawLink=label(row.url??row.listingUrl);
 let link=null;try{const u=new URL(rawLink);if(u.origin==='https://www.torn.com'&&!u.username&&!u.password&&['/bazaar.php','/page.php','/displaycase.php','/amarket.php'].includes(u.pathname))link=u.href;}catch{}
 return {uid:int(row.uid)??label(row.uid),itemId,itemName,price,rarity,category:tab==='armor'?'armor':types.includes(category)?category:null,weaponClass,quality:weaverNumber(row.quality),damage:weaverNumber(row.damage),accuracy:weaverNumber(row.accuracy),armor:weaverNumber(row.armor),
 bonuses:listingBonuses,sellerId:int(row.playerId??row.sellerId),sellerName:label(row.playerName??row.sellerName),source,updatedAt:label(row.lastUpdated??row.updatedAt)??number(row.updatedAt),link};
}
export function valuation(listing,rate){
 const bb=bunkerBucks(listing),price=positive(listing?.price);
 if(!bb||!price||!positive(rate))return null;
 const bunkerValue=bb*rate;
 return {bb,bunkerValue,percent:price/bunkerValue*100,discount:bunkerValue-price};
}
export function matchesWatch(row,rule,rate){
 const value=valuation(row,rate);if(!value||!row.uid||!positive(rule.maxPercent)||value.percent>rule.maxPercent)return null;
 if(rule.groups&&!rule.groups.includes(gearGroup(row))||rule.perkCounts&&!rule.perkCounts.includes(row.bonuses.length))return null;
 if(rule.categories?.length&&!rule.categories.includes(row.category)||rule.rarities?.length&&!rule.rarities.includes(row.rarity))return null;
 if(rule.maxPrice>0&&row.price>rule.maxPrice||rule.minBB>0&&value.bb<rule.minBB||rule.minDiscount>0&&100-value.percent<rule.minDiscount)return null;
 if((rule.bonus||rule.minBonus>0)&&!row.bonuses?.some(b=>(!rule.bonus||canonical(b.name)===canonical(rule.bonus))&&(!rule.minBonus||b.value>=rule.minBonus)))return null;
 return value;
}
export function summarize(rows,now=Date.now()/1000){
 const prices=rows.map(r=>positive(r.salePrice)).filter(Boolean).sort((a,b)=>a-b);
 if(!prices.length)return {count:0};
 const pct=(a,p)=>{const x=(a.length-1)*p,i=Math.floor(x);return a.length?a[i]+(a[Math.ceil(x)]-a[i])*(x-i):null;};
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const trim=Math.floor(prices.length*.1),recent=rows.filter(r=>r.endedAt>=now-2592000).map(r=>positive(r.salePrice)).filter(Boolean).sort((a,b)=>a-b);
 return {count:prices.length,median:pct(prices,.5),average:mean(prices),trimmedAverage:mean(prices.slice(trim,prices.length-trim)),min:prices[0],max:prices.at(-1),p25:pct(prices,.25),p75:pct(prices,.75),recentMedian:pct(recent,.5)};
}
export async function weaverBulk(tab,request,maxPages=20,weaponClasses={},filters={}){
 if(!['weapons','armor'].includes(tab))throw Error('Invalid ranked gear tab');
 const rows=[], seen=new Set();
 let offset=0;
 for(let page=0;page<maxPages;page++){
  const url=new URL('https://weav3r.dev/api/ranked-weapons');
  url.search=new URLSearchParams({tab,limit:'100',offset:String(offset),sortField:'price',sortDirection:'asc',...filters}).toString();
  const data=await request(url);
  if(data?.total_count===0&&(data.weapons===null||Array.isArray(data.weapons)&&!data.weapons.length))return {rows,complete:true};
  if(!Array.isArray(data?.weapons)||!Number.isSafeInteger(data.total_count)||data.total_count<0)throw Error('Weaver ranked response is unavailable');
  const batch=data.weapons;if(!batch.length&&offset<data.total_count)throw Error('Weaver returned an incomplete page');
  const signature=JSON.stringify(batch);if(seen.has(signature))throw Error('Weaver repeated a page');seen.add(signature);
  rows.push(...batch.map(r=>normalizeListing(r,tab,weaponClasses)).filter(r=>r&&(!filters.weaponType||r.category===filters.weaponType)&&(!filters.maxPrice||r.price<=filters.maxPrice)));offset+=batch.length;
  if(offset>=data.total_count)return {rows,complete:true};
 }
 return {rows,complete:false};
}
