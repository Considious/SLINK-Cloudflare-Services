import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('all authentication services publish one current policy version and exact document fingerprint',async()=>{
 const document=await readFile(new URL('../../../terms/2026-08-23/SLINK_API_Data_Terms_of_Service.md',import.meta.url));
 const hash=createHash('sha256').update(document).digest('hex');
 assert.match(document.toString(),/Policy version:\*\* 2026-11-01/);
 for(const name of ['contribution','leveling','war']){
  const source=await readFile(new URL('../../'+name+'/worker.js',import.meta.url),'utf8');
  assert(source.includes(hash),name+' must publish the current policy fingerprint');
  assert.match(source,/(?:DATA_TERMS_VERSION|TERMS_VERSION) = '2026-11-01'/);
 }
 assert.match(document.toString(),/not end-to-end encrypted/);
 assert.match(document.toString(),/not the Torn API key/);
});
