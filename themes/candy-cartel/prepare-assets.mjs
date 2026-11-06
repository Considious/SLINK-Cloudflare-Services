// Mechanical sizing/format conversion only; source artwork is generated, never recoloured here.
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE).href)).default;
const manifest=JSON.parse(await readFile(new URL('./source-manifest.json',import.meta.url),'utf8'));
if(!process.env.SLINK_CANDY_SOURCE_DIR)throw new Error('Set SLINK_CANDY_SOURCE_DIR to the directory containing the eight generated source PNGs.');
const out=new URL('./assets/',import.meta.url);await mkdir(out,{recursive:true});
const report=[];
for(const item of manifest){const width=({background:1000,frame:700,button:500,rail:160,brand:240,medical:420,casino:320,market:320})[item.id];
 const destination=new URL(item.id+'.webp',out);await sharp(path.join(process.env.SLINK_CANDY_SOURCE_DIR,item.source)).resize({width,withoutEnlargement:true}).webp({quality:item.id==='background'?85:90,alphaQuality:100}).toFile(fileURLToPath(destination));
 const meta=await sharp(fileURLToPath(destination)).metadata();report.push({id:item.id,width:meta.width,height:meta.height,alpha:meta.hasAlpha});
}
await writeFile(new URL('./asset-report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(report);
