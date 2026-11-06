// Mechanical size/format optimisation only. Preserve generated alpha and proportions.
import {pathToFileURL,fileURLToPath} from 'node:url';import path from 'node:path';import {readFile,mkdir,stat} from 'node:fs/promises';
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE))).default,root=path.join(path.dirname(fileURLToPath(import.meta.url)),'assets/props');await mkdir(root,{recursive:true});
for(const {id,source}of JSON.parse(await readFile(process.argv[2],'utf8'))){const image=sharp(source);if(!(await image.metadata()).hasAlpha)throw Error(id+' requires alpha');const target=path.join(root,id+'.webp');await image.resize({width:360}).webp({quality:86,alphaQuality:100,effort:5}).toFile(target);console.log(id+': '+(await stat(target)).size+' bytes');}
