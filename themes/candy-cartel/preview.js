// Original SLINK Theme Lab adapter. Decorations never attach observers or fetch game data.
let cleanup=[];
const shapes={combat:'M5 3l16 16-3 3L2 6V2h4M16 3l5-1v5L5 22l-3-3L16 3',efficiency:'M4 8h16v13H4V8M2 4h20v4H2V4M12 4v17M12 4C8-3 1 5 12 4M12 4c4-7 11 1 0 0',qol:'M3 7l4-4h10l4 4-9 14L3 7h18M7 3l5 18 5-18',access:'M12 3l3 4 5 1-1 5 1 5-5 1-3 4-3-4-5-1 1-5-1-5 5-1 3-4M16 13a4 4 0 1 0-8 0 4 4 0 0 0 8 0',refresh:'M20 9a8 8 0 1 0 0 7M20 3v6h-6',open:'M13 3h8v8M21 3L10 14M10 5H4v16h16v-6',dismiss:'M5 5l14 14M19 5L5 19',bell:'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4M10 21h4',market:'M3 21V11h4v10M10 21V6h4v15M17 21V2h4v19',crimes:'M8 14c-5-3-1-9 4-12-1 5 8 6 7 12a7 7 0 0 1-14 0M10 20c-3-3 0-5 2-7 0 3 5 4 2 7',merits:'M12 2l3 7h7l-6 5 2 8-6-5-6 5 2-8-6-5h7l3-7',chat:'M3 3h18v13H9l-6 5V3'};
const icon=name=>'<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+shapes[name]+'"/></svg>';
export function clearCandyPreview(){cleanup.forEach(fn=>fn());cleanup=[];}
export function decorateCandyPreview(root,theme,screen){
 if(theme?.id!=='slink-candy-cartel'||!theme.testingOnly)return;
 root.classList.add('theme-candy-cartel');cleanup.push(()=>root.classList.remove('theme-candy-cartel'));
 for(const [selector,text]of [['.mock-header strong',theme.branding.title],['.mock-header small',theme.branding.subtitle]]){
  const el=root.querySelector(selector);if(!el)continue;const previous=el.textContent;el.textContent=text;cleanup.push(()=>el.textContent=previous);
 }
 const add=(parent,node)=>{parent.append(node);cleanup.push(()=>node.remove());return node;};
 for(const side of ['left','right']){const rail=document.createElement('div');rail.className='candy-rail candy-rail--'+side;rail.dataset.candyArt='';rail.setAttribute('aria-hidden','true');rail.style.backgroundImage='url("'+theme.assets.sideRail+'")';add(root,rail);}
 const panel=root.querySelector('#panel');
 if(screen==='Alerts'){
  const samples=[['casino','Casino tokens are ready','A little risk. A little reward.','Casino'],['market','A sweet deal just landed','Xanax · $812,000 each · 4 available.','View Bazaar']];
  for(const [id,title,description,button]of samples){const card=document.createElement('article');card.className='mock-alert candy-sample';card.dataset.candySample=id;card.innerHTML='<div class="tag">'+(id==='casino'?'Casino':'Market Watch')+'</div><h3>'+title+'</h3><p>'+description+'</p><div class="action-row"><button type="button" data-sample>'+button+'</button><button type="button" data-sample>Dismiss</button></div>';add(panel,card);}
 }
 const props=screen==='Alerts'?[['.mock-alert:first-of-type','medical'],['[data-candy-sample=casino]','casino'],['[data-candy-sample=market]','market']]:screen==='Market'?[['.mock-alert','market']]:[];
 for(const [selector,id]of props){const card=panel.querySelector(selector);if(!card)continue;card.dataset.candyProp=id;cleanup.push(()=>delete card.dataset.candyProp);const img=document.createElement('img');img.className='candy-prop';img.dataset.candyArt='';img.alt='';img.setAttribute('aria-hidden','true');img.src=theme.assets.alertProps[id];img.width=360;img.height=id==='medical'?180:360;img.decoding='async';add(card,img);}
 for(const b of root.querySelectorAll('button')){
  const nav=b.querySelector('.nav-icon'),key=nav?b.dataset.section:({Refresh:'refresh',Open:'open',Dismiss:'dismiss',Alerts:'bell',Market:'market',Crimes:'crimes',Merits:'merits',Rooms:'chat'}[b.textContent.trim()]);if(!shapes[key])continue;
  if(nav){const old=nav.innerHTML;nav.innerHTML=icon(key);cleanup.push(()=>nav.innerHTML=old);}else{const span=document.createElement('span');span.className='candy-button-icon';span.dataset.candyArt='';span.innerHTML=icon(key);add(b,span);b.prepend(span);}
 }
}
