// Mechanical resize/format conversion of generated nine-slice border artwork.
import {pathToFileURL,fileURLToPath} from 'node:url';import path from 'node:path';
const sharp=(await import(pathToFileURL(process.env.SLINK_SHARP_MODULE))).default;
const image=sharp(process.argv[2]);if(!(await image.metadata()).hasAlpha)throw Error('Chain border requires transparency');
await image.resize({width:600}).webp({quality:88,alphaQuality:100,effort:5}).toFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'assets/frames/naughty_button_chain_v5.webp'));
