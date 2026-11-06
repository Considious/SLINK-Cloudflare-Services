import {NaughtyFrame} from './frame.js';
const pages={War:'war',Targets:'targets',Mugging:'mugging',Leveling:'combat',Market:'market',Racing:'racing',Chat:'chat'};
let cleanup=[];
export function decorateNaughtyPreview(root,theme,screen){
 cleanup.forEach(fn=>fn());cleanup=[];
 root.classList.remove('theme-naughty-list');delete root.dataset.naughtyPage;
 for(const old of root.querySelectorAll('[data-naughty-flavor],[data-naughty-samples]'))old.remove();
 if(!theme?.testingOnly||theme.id!=='slink-naughty-list')return;
 root.classList.add('theme-naughty-list');root.dataset.naughtyPage=pages[screen]||'dashboard';
 const samples=document.createElement('details');samples.dataset.naughtySamples='';samples.className='naughty-components';
 samples.innerHTML='<summary>Theme component samples</summary><div class="naughty-component-grid">'+
 ['standard','dark','alert','premium','compact'].map(v=>'<div class="slink-frame--naughty slink-frame--naughty-'+v+'"><strong>'+v+' frame</strong><p class="muted">Resizable content, fixed-aspect corners.</p></div>').join('')+
 '<div class="slink-frame--naughty slink-frame--naughty-standard"><h3>Buttons</h3><div class="action-row">'+['primary','secondary','danger','success','warning','neutral','icon','pill'].map(v=>'<button type="button" data-sample class="slink-btn--naughty-'+v+'">'+(v==='icon'?'✦':v)+'</button>').join('')+'<button type="button" disabled>Disabled</button></div></div>'+
 '<div class="slink-frame--naughty slink-frame--naughty-dark"><h3>Badges</h3><div class="action-row">'+['active','inactive','warning','danger','success','event','premium'].map(v=>'<span class="slink-badge--naughty slink-badge--naughty-'+v+'">'+v+'</span>').join('')+'</div></div>'+
 '<div class="mock-table-wrap"><table><thead><tr><th>State</th><th>Sample value</th></tr></thead><tbody><tr><td>Normal</td><td>125</td></tr><tr><td>Alternate</td><td>200</td></tr><tr aria-selected="true"><td>Selected</td><td>345</td></tr><tr data-tone="warning"><td>Warning</td><td>Check source</td></tr><tr data-tone="danger"><td>Danger</td><td>Unavailable</td></tr><tr data-tone="success"><td>Success</td><td>Ready</td></tr></tbody></table></div><div class="slink-tooltip--naughty" role="tooltip">A compact tooltip: sample formula, source and estimated value. Keyboard focus stays visible.</div></div>';
 root.querySelector('#panel')?.append(samples);
 const frame=(selector,variant)=>{for(const el of root.querySelectorAll(selector)){const wrapped=NaughtyFrame(el,{variant});cleanup.push(wrapped.dispose);}};
 frame('.mock-alert','standard');frame('.mock-metrics>div','compact');frame('.chat-example','dark');frame('.mock-control-grid','premium');
 const assignments=[['.mock-alert.error','slink-alert--naughty-danger'],['.mock-alert.warning','slink-alert--naughty-warning'],['.mock-alert.info','slink-alert--naughty-info'],['.mock-alert:not(.error):not(.warning):not(.info)','slink-alert--naughty-success'],['table','slink-table--naughty'],['.ff-bubble,.count','slink-badge--naughty'],['.panel-heading button','slink-btn--naughty-secondary'],['.mock-alert.error button','slink-btn--naughty-danger'],['.mock-alert:not(.error):not(.warning) button:first-child','slink-btn--naughty-success']];
 for(const [selector,name]of assignments)for(const el of root.querySelectorAll(selector)){el.classList.add(name);cleanup.push(()=>el.classList.remove(name));}
 const copy=theme.copy[pages[screen]];if(copy){const flavor=document.createElement('p');flavor.dataset.naughtyFlavor='';flavor.className='naughty-flavor';flavor.textContent=copy.title+(copy.subtitle?' · '+copy.subtitle:'');root.querySelector('.panel-heading')?.after(flavor);}
}
