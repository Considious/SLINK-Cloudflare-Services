// Mechanical nine-patch slicing and format optimisation only; source artwork is generated with the built-in image tool.
import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),[framePath,backgroundPath]=process.argv.slice(2);
if(!framePath||!backgroundPath||!process.env.SLINK_SHARP_MODULE)throw Error('Supply the generated frame/background paths and SLINK_SHARP_MODULE.');
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE))).default;
const frame=sharp(framePath),metadata=await frame.metadata();if(!metadata.hasAlpha)throw Error('Frame must retain genuine transparency.');
const cap=Math.round(Math.min(metadata.width,metadata.height)*.16),width=metadata.width,height=metadata.height;
const center=await sharp(framePath).extract({left:cap,top:cap,width:width-2*cap,height:height-2*cap}).raw().toBuffer({resolveWithObject:true});let maximumAlpha=0;for(let i=3;i<center.data.length;i+=center.info.channels)maximumAlpha=Math.max(maximumAlpha,center.data[i]);if(maximumAlpha>1)throw Error('Frame centre must be transparent, not a baked UI panel.');
await sharp(framePath).webp({quality:86,alphaQuality:100,effort:6}).toFile(path.join(root,'assets/frames/naughty_frame_atlas.webp'));
const x=[0,cap,width-cap],y=[0,cap,height-cap],w=[cap,width-2*cap,cap],h=[cap,height-2*cap,cap],names=[['tl','top','tr'],['left','center','right'],['bl','bottom','br']];
for(let row=0;row<3;row++)for(let col=0;col<3;col++)await sharp(framePath).extract({left:x[col],top:y[row],width:w[col],height:h[row]}).webp({quality:86,alphaQuality:100,effort:6}).toFile(path.join(root,'assets/frames/naughty_frame_'+names[row][col]+'.webp'));
await sharp(backgroundPath).resize({width:1200,withoutEnlargement:true}).webp({quality:82,effort:6}).toFile(path.join(root,'assets/backgrounds/naughty_bg_main.webp'));
const files=(await fs.readdir(path.join(root,'assets/frames'))).map(p=>'assets/frames/'+p).concat('assets/backgrounds/naughty_bg_main.webp');let total=0;for(const f of files){const size=(await fs.stat(path.join(root,f))).size;total+=size;console.log(f+' '+size+' bytes');}if(total>1500000)throw Error('Theme raster assets exceed the 1.5MB testing budget.');
console.log('Nine independent pieces, transparent centre, '+cap+'px source caps; raster total '+total+' bytes.');
