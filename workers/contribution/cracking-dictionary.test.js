import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCrackingDictionary} from './cracking-dictionary.js';

const dictionaryPath='/api/cracking-dictionary/v1/4/A/0';
const objectKey='crime-dictionaries/cracking/v1/4/A/0.json';
const request=()=>new Request('https://worker.example'+dictionaryPath);
const seed={schema:1,words:['ABLE'],next:null};

test('loads a missing page with Workers-compatible fetch, caches it, and reuses the object',async t=>{
  let cached=null;
  const fetchSeed=t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,'https://raw.githubusercontent.com/Considious/SLINK-Cloudflare-Services/cracking-dictionary-v1/'+objectKey);
    // Cloudflare Workers throws before fetching for redirect: 'error'.
    if(options.redirect==='error')throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect,'manual');
    return Response.json(seed);
  });
  const env={CRACKING_DICTIONARY:{
    async get(key){return key===objectKey?cached:null;},
    async put(key,body,options){
      assert.equal(key,objectKey);
      assert.equal(options.onlyIf.get('If-None-Match'),'*');
      cached={size:body.length,body,httpEtag:'"page"'};
    }
  }};
  let response=await handleCrackingDictionary(request(),env);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),seed);
  response=await handleCrackingDictionary(request(),env);
  assert.equal(response.status,200);
  assert.equal(response.headers.get('etag'),'"page"');
  assert.deepEqual(await response.json(),seed);
  assert.equal(fetchSeed.mock.callCount(),1);
});

test('rejects redirects without following them or caching the response',async t=>{
  const fetchSeed=t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{location:'https://elsewhere.example/0.json'}});
  });
  const env={CRACKING_DICTIONARY:{
    async get(){return null;},
    async put(){assert.fail('A redirect must not be cached');}
  }};
  const response=await handleCrackingDictionary(request(),env);
  assert.equal(response.status,503);
  assert.equal(fetchSeed.mock.callCount(),1);
});
