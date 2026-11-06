// Theme Lab sample content only. No account reads, timers, notifications or live actions.
export const ALERT_PROP_SAMPLES=Object.freeze([
 ['drug','Drug cooldown is clear','Ready for your next dose.','drug'],
 ['booster','Booster cooldown is nearly clear','12 minutes remaining.','booster'],
 ['energy','Energy refill is available','Your daily energy refill is ready.','drug','lightning'],
 ['nerve','Nerve refill is available','Your daily nerve refill is ready.','booster','flame'],
 ['casino','Casino tokens are waiting','Your daily tokens are ready to use.','casino'],
 ['addiction','Your addiction needs attention','Check your addiction before your next dose.','addiction'],
 ['shopping','Buy your 100 city items','35 / 100 items bought today.','shopping'],
 ['flight','Time to catch your flight','Leave for the United Kingdom in 8 minutes.','flight'],
 ['racing','Your race is ready','Your next race starts in 5 minutes.','racing'],
 ['education','Your course is complete','Choose what to study next.','education'],
 ['stocks','A stock benefit is ready','Your next payout is ready to collect.','stocks'],
 ['oc','Your organized crime is ready','Your team is ready. Review your role.','oc'],
 ['market','A watched item is below your price','Example deal: $812,000 each · 4 available.','market']
]);
function attach(alert,theme,id,assetId,emblem){
 alert.classList.add('has-naughty-prop');alert.dataset.naughtyProp=id;
 const art=document.createElement('span');art.className='naughty-prop-art';art.dataset.naughtyArt='';art.setAttribute('aria-hidden','true');
 const image=document.createElement('img');image.src=theme.assets.alertProps[assetId];image.alt='';image.width=360;image.height=360;image.decoding='async';art.append(image);
 if(emblem){const badge=document.createElement('span');badge.className='naughty-prop-emblem';badge.dataset.emblem=emblem;badge.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+(emblem==='lightning'?'M14 2L4 14h7l-1 8 10-13h-7l1-7Z':'M13 2c2 6 7 7 7 13a8 8 0 0 1-16 0c0-4 3-7 6-9-1 4 0 6 2 7 2-3 1-7 1-11Z')+'"/></svg>';art.append(badge);}
 alert.append(art);
 return ()=>{alert.classList.remove('has-naughty-prop');delete alert.dataset.naughtyProp;art.remove();};
}
export function decorateAlertProps(root,theme,screen){
 const disposers=[];if(screen!=='Alerts')return ()=>{};
 const panel=root.querySelector('#panel'),medical=panel?.querySelector('.mock-alert');if(!panel||!medical)return ()=>{};
 disposers.push(attach(medical,theme,'medical','medical'));
 for(const [id,title,description,assetId,emblem]of ALERT_PROP_SAMPLES){
 const alert=document.createElement('article');alert.className='mock-alert';alert.dataset.naughtyExample='';
 const tag=document.createElement('div');tag.className='tag';tag.textContent='Sample · '+({energy:'Energy refill',nerve:'Nerve refill',oc:'Organized crime'}[id]||id);
 const heading=document.createElement('h3');heading.textContent=title;const detail=document.createElement('p');detail.textContent=description;
 const actions=document.createElement('div');actions.className='action-row';actions.innerHTML='<button type="button" data-sample>Open</button><select aria-label="Sample snooze duration" data-sample><option>Snooze 1 hour</option><option>Snooze 12 hours</option><option>Snooze 24 hours</option></select><button type="button" data-sample>Dismiss</button>';
 alert.append(tag,heading,detail,actions);panel.append(alert);disposers.push(attach(alert,theme,id,assetId,emblem),()=>alert.remove());
 }
 return ()=>disposers.forEach(fn=>fn());
}
