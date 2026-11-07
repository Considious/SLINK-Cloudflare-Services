import assert from 'node:assert/strict';import {releaseResponse}from'./releases.js';
let calls=0;const map=new Map(),pending=[];const cache={match:async key=>map.get(key.url)?.clone(),put:async(key,response)=>map.set(key.url,response.clone())};
const options={cache,fetcher:async url=>{calls++;return Response.json({version:url.includes('manifest.json')?'0.19.64':'0.4.190'});}};
const ctx={waitUntil:p=>pending.push(p)};
const response=await releaseResponse(new Request('https://worker.example/api/releases?a=1'),{},ctx,options);assert.equal(response.status,200);const body=await response.json();assert.equal(body.extension.version,'0.19.64');assert.equal(body.pda.version,'0.4.190');assert.equal(calls,2);await Promise.all(pending);
await releaseResponse(new Request('https://worker.example/api/releases?a=999'),{},ctx,options);assert.equal(calls,2,'Query strings cannot bypass shared caching');
const bad=await releaseResponse(new Request('https://worker.example/api/releases'),{},ctx,{fetcher:async()=>new Response('bad',{status:500})});assert.equal(bad.status,503);
assert.equal((await releaseResponse(new Request('https://worker.example/api/releases',{method:'POST'}),{},ctx,options)).status,405);
console.log('Release metadata cache, failure and method checks passed');
