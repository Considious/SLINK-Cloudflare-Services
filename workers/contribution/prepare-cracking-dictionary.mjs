// Usage: node prepare-cracking-dictionary.mjs INPUT_FILE OUTPUT_DIRECTORY
// Run on the reviewed Torn game corpus only. Never use a real credential dump.
import {createReadStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Provide the reviewed Torn dictionary and an output directory.');
const root=resolve(output,'crime-dictionaries','cracking','v1');
const buckets=new Map(),all=new Map();
for await(const row of createInterface({input:createReadStream(input,{encoding:'utf8'}),crlfDelay:Infinity})){
  const word=row.trim().toUpperCase();
  if(!/^[A-Z0-9_.]{4,10}$/.test(word))continue;
  const k=word.length+'/'+(word[0]==='.'?'dot':word[0]);if(!buckets.has(k))buckets.set(k,new Set());buckets.get(k).add(word);
  if(/^[A-Z]+$/.test(word)){if(!all.has(word.length))all.set(word.length,new Set());all.get(word.length).add(word);}
}
// A broad fallback when the first slot is still hidden. Sample each leading-letter
// bucket deterministically so the fallback isn't dominated by the first few letters.
for(let length=4;length<=10;length++){
  const plain=all.get(length)||new Set(),pool=[];
  for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){
    const sorted=[...(buckets.get(length+'/'+letter)||[])].filter(word=>plain.has(word)).sort();
    const step=Math.max(1,Math.ceil(sorted.length/128));for(let i=0;i<sorted.length;i+=step)pool.push(sorted[i]);
  }
  buckets.set(length+'/common',new Set(pool));
}
let count=0;
for(const [key,words] of buckets){
  const values=[...words].sort(),directory=join(root,key),size=4096,pages=Math.ceil(values.length/size);
  if(pages>16)throw Error('Shard exceeds 16 pages; define a new dictionary schema.');
  if(!pages)continue;
  await mkdir(directory,{recursive:true});
  for(let page=0;page<pages;page++){
    const body=JSON.stringify({schema:1,words:values.slice(page*size,(page+1)*size),next:page+1<pages?page+1:null});
    if(Buffer.byteLength(body)>65536)throw Error('Shard exceeds bridge-safe page limit.');
    await writeFile(join(directory,page+'.json'),body);count++;
  }
}
console.log('Generated '+count+' read-only R2 objects under '+root);
