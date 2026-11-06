// Package the approved Theme Lab CSS/artwork verbatim for the existing app entry points.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import candy from './theme.js';
const release=new URL('../../release/',import.meta.url),read=p=>readFile(new URL(p,import.meta.url),'utf8');
const extension=new URL('extension/',release),pda=new URL('SLINK-PDA/',release),services=new URL('services/',release);
const keys={background:'background',brand:'brand',frame:'frame-chocolate-v2',button:'button-chocolate-v2',rail:'rail',...Object.fromEntries(Object.keys(candy.assets.alertProps).map(id=>['prop_'+id,id]))};
const files=Object.fromEntries(Object.entries(keys).map(([key,id])=>[key,'candy-cartel-'+id+'.webp']));
const tokens=Object.fromEntries(Object.entries(candy.tokens).filter(([key])=>!/(?:primary|secondary|muted$|radius)/.test(key)||['--slink-muted','--slink-bg-raised','--slink-bg-control'].includes(key)).filter(([key])=>!key.startsWith('--slink-text-')&&!key.startsWith('--slink-bg-panel')));
const origin='https://raw.githubusercontent.com/Considious/SLINK-Cloudflare-Services/main/themes/assets/';
const definition={id:candy.id,label:'Candy Cartel',description:'Sugar Logistics & Illicit Network of Kriminals. Chocolate, purple candy, gold foil and pistachio/cherry glow.',scope:'slink.theme.candy-cartel',ornament:'none',swatch:['#221128','#842fe2','#9bd52b'],tokens,assets:{background:origin+files.background,brandIcon:origin+files.brand,chatIcon:origin+files.brand,frame:origin+files.frame,packaged:true}};
const css=await read('theme.css');
const iconSource=(await read('preview.js')).match(/const shapes=(\{[^\n]+\});/)[1],icons=Function('return '+iconSource)();
const source=(await read('runtime.template.js')).replace('/*DEFINITION*/null',JSON.stringify(definition)).replace('/*FILES*/null',JSON.stringify(files)).replace("/*CSS*/''",JSON.stringify(css)).replace('/*ICONS*/null',JSON.stringify(icons));
await writeFile(new URL('src/core/candy-theme.js',extension),source);await writeFile(new URL('src/00-candy-theme.part',pda),source+'\n');
await writeFile(new URL('assets/themes/candy-cartel-theme.css',extension),css);await writeFile(new URL('src/candy-cartel-theme.css',pda),css);
for(const [key,id]of Object.entries(keys))for(const base of [new URL('assets/themes/',extension),new URL('themes/assets/',services)]){await mkdir(base,{recursive:true});await copyFile(new URL('assets/'+id+'.webp',import.meta.url),new URL(files[key],base));}
const catalogPath=new URL('themes/catalog.json',services),catalog=JSON.parse(await readFile(catalogPath,'utf8'));catalog.themes=catalog.themes.filter(t=>t.id!==candy.id);catalog.themes.push(definition);catalog.revision='candy-cartel-2026-11-06';catalog.updatedAt='2026-11-06T00:00:00Z';await writeFile(catalogPath,JSON.stringify(catalog,null,2)+'\n');
await writeFile(new URL('candy-release.json',release),JSON.stringify({definition,files},null,2)+'\n');
console.log('Packaged shared Candy Cartel CSS and '+Object.keys(files).length+' approved assets; no storage changes.');
