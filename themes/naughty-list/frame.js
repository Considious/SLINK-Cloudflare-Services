// Shared, additive decoration. Never rebuilds component contents or attaches a live-game action.
const variants=new Set(['standard','dark','alert','premium','compact']);
export function NaughtyFrame(element,{variant='standard',padding,compact=false,interactive=false,className=''}={}){
 if(!(element instanceof Element))throw new TypeError('NaughtyFrame requires an existing element.');
 if(!variants.has(variant))throw new TypeError('Unsupported frame variant.');
 if(padding!==undefined&&(!Number.isFinite(padding)||padding<0||padding>80))throw new TypeError('Frame padding must be between 0 and 80 pixels.');
 const classes=['slink-frame--naughty','slink-frame--naughty-'+variant,...(compact?['slink-frame--naughty-compact']:[]),...(interactive?['slink-frame--naughty-interactive']:[]),...className.split(/\s+/).filter(Boolean)];
 element.classList.add(...classes);const previous=element.style.getPropertyValue('--naughty-content-padding');
 if(padding!==undefined){if(!Number.isFinite(padding)||padding<0||padding>80)throw new TypeError('Frame padding must be between 0 and 80 pixels.');element.style.setProperty('--naughty-content-padding',padding+'px');}
 return {element,dispose(){element.classList.remove(...classes);if(previous)element.style.setProperty('--naughty-content-padding',previous);else element.style.removeProperty('--naughty-content-padding');}};
}
