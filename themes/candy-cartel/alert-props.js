// Sample text is lab-only. The artwork map in theme.js is reusable without these examples.
export const CANDY_ALERT_SAMPLES=Object.freeze([
 ['drug','Drug cooldown','Drug cooldown is clear','Ready for your next dose.','drug'],
 ['booster','Booster cooldown','Booster cooldown is nearly clear','12 minutes remaining.','booster'],
 ['energy','Energy refill','Energy refill is available','Your daily energy refill is ready.','drug','lightning'],
 ['nerve','Nerve refill','Nerve refill is available','Your daily nerve refill is ready.','booster','flame'],
 ['casino','Casino','Casino tokens are ready','A little risk. A little reward.','casino'],
 ['addiction','Player addiction','Your addiction needs attention','Check your addiction before your next dose.','addiction'],
 ['shopping','City shopping','Buy your 100 city items','35 / 100 items bought today.','shopping'],
 ['flight','Flight reminder','Time to catch your flight','Leave for the United Kingdom in 8 minutes.','flight'],
 ['racing','Racing','Your race is ready','Your next race starts in 5 minutes.','racing'],
 ['education','Education','Your course is complete','Choose what to study next.','education'],
 ['stocks','Stock benefits','A stock benefit is ready','Your next payout is ready to collect.','stocks'],
 ['oc','Organized crime','Your organized crime is ready','Your team is ready. Review your role.','oc'],
 ['market','Market Watch','A sweet deal just landed','Xanax · $812,000 each · 4 available.','market']
]);
export function attachCandyProp(card,theme,id,assetId=id,emblem){
 card.dataset.candyProp=id;
 const art=document.createElement('span');art.className='candy-prop';art.dataset.candyArt='';art.setAttribute('aria-hidden','true');
 const img=document.createElement('img');img.alt='';img.src=theme.assets.alertProps[assetId];img.width=360;img.height=assetId==='medical'?180:360;img.decoding='async';art.append(img);
 if(emblem){const badge=document.createElement('span');badge.className='candy-prop-emblem';badge.dataset.emblem=emblem;badge.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(emblem==='lightning'?'M14 2L4 14h7l-1 8 10-13h-7l1-7Z':'M13 2c2 6 7 7 7 13a8 8 0 0 1-16 0c0-4 3-7 6-9-1 4 0 6 2 7 2-3 1-7 1-11Z')+'"/></svg>';art.append(badge);}
 card.append(art);return ()=>{delete card.dataset.candyProp;art.remove();};
}
export function decorateCandyAlerts(root,theme,screen){
 const panel=root.querySelector('#panel'),cleanup=[];if(!panel)return ()=>{};
 if(screen==='Alerts'){
  const medical=panel.querySelector('.mock-alert');if(medical)cleanup.push(attachCandyProp(medical,theme,'medical'));
  for(const [id,label,title,description,assetId,emblem]of CANDY_ALERT_SAMPLES){
   const card=document.createElement('article');card.className='mock-alert candy-sample';card.dataset.candySample=id;
   const tag=document.createElement('div');tag.className='tag';tag.textContent=label;
   const heading=document.createElement('h3');heading.textContent=title;
   const detail=document.createElement('p');detail.textContent=description;
   const actions=document.createElement('div');actions.className='action-row';actions.innerHTML='<button type="button" data-sample>Open</button><select data-sample aria-label="Sample snooze duration"><option>Snooze 1 hour</option><option>Snooze 12 hours</option><option>Snooze 24 hours</option></select><button type="button" data-sample>Dismiss</button>';
   card.append(tag,heading,detail,actions);panel.append(card);cleanup.push(attachCandyProp(card,theme,id,assetId,emblem),()=>card.remove());
  }
 }else if(screen==='Market'){
  const card=panel.querySelector('.mock-alert');if(card)cleanup.push(attachCandyProp(card,theme,'market'));
 }
 return ()=>cleanup.forEach(fn=>fn());
}
