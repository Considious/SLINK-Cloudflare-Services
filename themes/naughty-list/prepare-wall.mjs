// Format-only optimisation. Composition and painted lettering are generated artwork.
import {pathToFileURL,fileURLToPath} from 'node:url';
import path from 'node:path';
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE))).default;
const target=path.join(path.dirname(fileURLToPath(import.meta.url)),'assets/backgrounds/naughty_wall_portrait_v3.webp');
await sharp(process.argv[2]).resize({width:1000,withoutEnlargement:true}).webp({quality:87,effort:5}).toFile(target);
console.log(target);
