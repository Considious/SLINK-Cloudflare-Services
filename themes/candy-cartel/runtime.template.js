(function installCandyTheme(global){
 'use strict';
 const definition=/*DEFINITION*/null;
 const files=/*FILES*/null;
 const sharedCss=/*CSS*/'';
 const icons=/*ICONS*/null;
 const states=new WeakMap();
 const remote='https://raw.githubusercontent.com/Considious/SLINK-Cloudflare-Services/main/themes/assets/';
 const url=key=>global.chrome?.runtime?.getURL?global.chrome.runtime.getURL('assets/themes/'+files[key]):remote+files[key];
 const kinds={medicalCooldown:'medical',drugCooldown:'drug',boosterCooldown:'booster',energyRefill:'drug',nerveRefill:'booster',casinoTokens:'casino',playerAddiction:'addiction',cityItem:'shopping',cityItems:'shopping',landing:'flight',travel:'flight',racing:'racing',education:'education',stockBenefits:'stocks',organizedCrime:'oc'};
 function alertKind(id){const s=String(id||'');return kinds[s]||(/^market|^watch/i.test(s)?'market':/^abroad|^travel|^flight/i.test(s)?'flight':/^rac/i.test(s)?'racing':/^oc[:_-]|^organized/i.test(s)?'oc':'');}
 function markAlert(card,id){card.dataset.candyKind=alertKind(id);if(id==='energyRefill'||id==='nerveRefill')card.dataset.candyRefill=id==='energyRefill'?'lightning':'flame';}
 function refresh(host,subtree){
  const state=states.get(host);if(!state?.active)return;
  const root=host.shadowRoot||host.ownerDocument,scope=subtree||root;
  for(const [node,undo]of state.undo)if(!root.contains(node)){undo();state.undo.delete(node);}
  const remember=(node,fn)=>{const previous=state.undo.get(node);state.undo.set(node,()=>{fn();previous?.();});};
  const cls=(node,name)=>{if(!node||node.classList.contains(name))return;node.classList.add(name);remember(node,()=>node.classList.remove(name));};
  const surfaces=host.shadowRoot?[root.querySelector('.window.main,.overlay')].filter(Boolean):[root.body];
  const computed=global.getComputedStyle(host),opacity=parseFloat(computed.getPropertyValue('--slink-theme-panel-opacity')||computed.getPropertyValue('--s-theme-panel-opacity'));
  for(const surface of surfaces)surface.style.setProperty('--panel-alpha',String(Number.isFinite(opacity)?Math.max(0,Math.min(100,opacity))/100:.9));
  for(const surface of surfaces){
   cls(surface,'theme-candy-cartel');
   if(!surface.querySelector(':scope>.candy-live-wall')){
    const wall=surface.ownerDocument.createElement('div');wall.className='theme-art candy-live-wall';wall.setAttribute('aria-hidden','true');surface.prepend(wall);remember(surface,()=>wall.remove());
    for(const side of ['left','right']){const rail=surface.ownerDocument.createElement('div');rail.className='candy-rail candy-rail--'+side;rail.setAttribute('aria-hidden','true');rail.style.backgroundImage='url("'+url('rail')+'")';surface.append(rail);remember(surface,()=>rail.remove());}
   }
  }
  const aliases={'.head,.topbar':'mock-header','.mark,.brand-mark,.topbar .brand>span:first-child':'brand-mark','.groups,.primary-nav,.dashboard-tabs':'section-tabs','.tabs,.subnav,.efficiency-tabs,.quality-tabs':'module-tabs','.slink-adhd-summary,.compact-stats,.stats':'mock-metrics','.slink-adhd-links,.adhd-alert-actions,.target-actions':'action-row'};
  for(const [selector,name]of Object.entries(aliases))for(const node of scope.querySelectorAll(selector))cls(node,name);
  for(const card of scope.querySelectorAll('.slink-adhd-alert,.adhd-alert-card,.alert-list>.alert')){
   cls(card,'mock-alert');const kind=card.dataset.candyKind||card.dataset.naughtyAlert;
   if(!kind||!files['prop_'+kind]||card.querySelector(':scope>.candy-prop'))continue;
   const old=card.getAttribute('data-candy-prop');card.dataset.candyProp=kind;remember(card,()=>old===null?card.removeAttribute('data-candy-prop'):card.setAttribute('data-candy-prop',old));
   const art=card.ownerDocument.createElement('span');art.className='candy-prop';art.setAttribute('aria-hidden','true');
   const img=card.ownerDocument.createElement('img');img.src=url('prop_'+kind);img.alt='';img.width=320;img.height=320;img.decoding='async';art.append(img);
   const refill=card.dataset.candyRefill||({energy:'lightning',nerve:'flame'}[card.dataset.naughtyRefill]);
   if(refill){const badge=card.ownerDocument.createElement('span');badge.className='candy-prop-emblem';badge.dataset.emblem=refill;badge.textContent=refill==='lightning'?'ϟ':'♨';art.append(badge);}
   card.append(art);remember(card,()=>art.remove());
  }
  for(const select of scope.querySelectorAll('select'))if(!select.parentElement.classList.contains('candy-select-shell')){
   const shell=select.ownerDocument.createElement('span');shell.className='candy-select-shell';select.before(shell);shell.append(select);remember(select,()=>shell.replaceWith(select));
  }
  for(const button of scope.querySelectorAll('button')){
   if(button.querySelector('[data-candy-live-icon]'))continue;
   const label=button.textContent.trim(),key=Object.entries({Combat:'combat',Efficiency:'efficiency','Quality of Life':'qol',Access:'access',Alerts:'bell',Market:'market',Crimes:'crimes',Merits:'merits',Refresh:'refresh',Open:'open',Dismiss:'dismiss'}).find(([text])=>label.startsWith(text))?.[1];if(!icons[key])continue;
   const span=button.ownerDocument.createElement('span');span.className='candy-button-icon';span.dataset.candyLiveIcon='';span.setAttribute('aria-hidden','true');span.innerHTML='<svg viewBox="0 0 24 24"><path d="'+icons[key]+'"/></svg>';button.prepend(span);remember(button,()=>span.remove());
  }
  for(const [selector,text]of [['.head .title,.topbar h1,.topbar .brand strong','SLINK'],['.head .subtitle,.topbar .brand p,.topbar .brand>span','Sugar Logistics & Illicit Network of Kriminals']]){
   const node=selector.split(',').map(s=>root.querySelector(s)).find(Boolean);if(node&&!node.dataset.candyHeader){const old=node.textContent;node.textContent=text;node.dataset.candyHeader='';remember(node,()=>{if(node.textContent===text)node.textContent=old;delete node.dataset.candyHeader;});}
  }
 }
 function apply(host,id){
  if(!host?.ownerDocument)return;let state=states.get(host);
  const root=host.shadowRoot||host.ownerDocument;
  if(!state){const style=host.ownerDocument.createElement('style');style.dataset.candyRuntime='';style.textContent=sharedCss+`
   .theme-candy-cartel{isolation:isolate;--panel-alpha:.9;--slink-theme-background-image:url("${url('background')}");--slink-theme-brand-icon:url("${url('brand')}");--candy-frame:url("${url('frame')}");--candy-button-frame:url("${url('button')}")}
   .window.main.theme-candy-cartel,.overlay.theme-candy-cartel{background:#140e16!important}
   .theme-candy-cartel .candy-live-wall{position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit}
   body.theme-candy-cartel{position:relative;min-height:100vh}
   .theme-candy-cartel :is(.groups,.tabs,.primary-nav,.subnav){overflow:visible}
   .theme-candy-cartel :is(.head,.topbar){box-sizing:border-box;min-height:110px!important;align-items:flex-start!important;background:#150b1b66!important;padding-block:12px!important}
   .theme-candy-cartel :is(.head,.topbar) .brand-mark{width:70px!important;min-width:70px;height:78px!important}
   .theme-candy-cartel .head .heading,.theme-candy-cartel .topbar .brand{padding-top:14px;min-width:0;flex:1}
   .theme-candy-cartel :is(.title,.brand strong,.topbar h1){font-size:23px;line-height:1.2;color:#fff3cb}
   .theme-candy-cartel :is(.subtitle,.brand>span,.brand p){display:block;font-size:10px;line-height:1.4;color:#ffe7ad;overflow-wrap:anywhere;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}
   .theme-candy-cartel .mock-alert{box-sizing:border-box;overflow:visible!important;font:12px/1.5 Arial,sans-serif}
   .theme-candy-cartel .mock-alert>strong{grid-column:1;font-size:15px;line-height:1.4}
   .theme-candy-cartel .mock-alert>span:not(.candy-prop){grid-column:1;color:#ddcbe1}
   .theme-candy-cartel .mock-alert>div:not(.action-row){grid-column:1;min-width:0}
   .theme-candy-cartel .mock-alert[data-candy-prop]{grid-template-columns:minmax(0,1fr) clamp(70px,25%,120px)}
   .theme-candy-cartel .mock-alert .candy-prop{width:100%;height:105px}
   .theme-candy-cartel .mock-alert .action-row{display:flex;flex-wrap:wrap;gap:8px;grid-column:1/-1;width:100%;min-width:0}
   .theme-candy-cartel .mock-alert .action-row>a{position:relative;padding:6px 12px;background:var(--slink-button-bg);border:8px solid transparent;border-image:var(--candy-button-frame) 16% / 8px / 0 round;color:#fff0d1;text-decoration:none}
   .theme-candy-cartel .mock-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr))}
   .theme-candy-cartel .mock-metrics>div{min-width:0;box-sizing:border-box}
   .theme-candy-cartel .theme-content-shell{position:relative;background:transparent!important}
   .theme-candy-cartel .scroll{background:transparent!important;padding-inline:26px!important}
   .theme-candy-cartel .slink-adhd-list{gap:8px}
   .theme-candy-cartel .slink-adhd-summary{padding:0 6px}
   .theme-candy-cartel .mock-alert .candy-prop{margin:0!important}
   .theme-candy-cartel .section-tabs{box-sizing:border-box;flex-wrap:wrap}
   .theme-candy-cartel .section-tabs button{min-width:0;flex:1;box-sizing:border-box}
   .theme-candy-cartel .module-view>.content{padding-inline:26px}
   .theme-candy-cartel .module-head,.theme-candy-cartel .status{background:#160d1d9c;padding-inline:26px!important}
   .theme-candy-cartel .actions,.theme-candy-cartel .page-head{padding-inline:26px!important}
   .theme-candy-cartel .groups .group-tab{min-height:36px}
   .theme-candy-cartel .primary-nav{grid-template-columns:repeat(4,minmax(0,1fr))!important}
   .theme-candy-cartel .primary-nav button{min-height:50px;font-size:11px;padding:6px}
   .theme-candy-cartel .module-tabs button{padding:7px 9px}
   .theme-candy-cartel .mock-alert>div>strong{font-size:15px}
   `;(host.shadowRoot||root.head).append(style);state={active:false,undo:new Map(),style};states.set(host,state);}
  if(id!==definition.id){for(const undo of state.undo.values())undo();state.undo.clear();state.active=false;return;}
  state.active=true;
  for(const surface of host.shadowRoot?[root.querySelector('.window.main,.overlay')].filter(Boolean):[root.body])if(!surface.dataset.candyTokens){
   const previous=[...Object.keys(definition.tokens),'--panel-alpha'].map(name=>[name,surface.style.getPropertyValue(name)]),undo=state.undo.get(surface);surface.dataset.candyTokens='';
   for(const [name,value]of Object.entries(definition.tokens))surface.style.setProperty(name,value);
   state.undo.set(surface,()=>{for(const [name,value]of previous)value?surface.style.setProperty(name,value):surface.style.removeProperty(name);delete surface.dataset.candyTokens;undo?.();});
  }
  refresh(host);
 }
 global.SLINK_CANDY_THEME=Object.freeze({definition,files,apply,refresh,markAlert,alertKind,css:sharedCss});
})(globalThis);
