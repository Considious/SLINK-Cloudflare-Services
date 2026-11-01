import {readFile,writeFile,mkdir} from 'node:fs/promises';
// Mechanical mirrors of the existing lockfile-pinned build tools, not runtime code.
for(const folder of ['test-central','test-node']){await mkdir(new URL(folder+'/',import.meta.url),{recursive:true});for(const file of ['package.json','package-lock.json'])await writeFile(new URL(folder+'/'+file,import.meta.url),await readFile(new URL(file,import.meta.url)));}
console.log('Both Cloudflare build roots have their own matching pinned package files.');
