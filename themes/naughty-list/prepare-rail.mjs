// Format-only resize of the generated transparent foreground trim.
import {pathToFileURL,fileURLToPath} from 'node:url';import path from 'node:path';
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE))).default;
const input=sharp(process.argv[2]);if(!(await input.metadata()).hasAlpha)throw Error('Transparent trim required');
await input.resize({width:180}).webp({quality:88,alphaQuality:100,effort:5}).toFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'assets/overlays/naughty_side_rail_v4.webp'));
