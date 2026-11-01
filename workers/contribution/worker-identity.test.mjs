import assert from 'node:assert/strict';
import {test,afterEach} from 'node:test';
import {testing} from './worker.js';
const original=globalThis.fetch;afterEach(()=>{globalThis.fetch=original;});
test('key info without a name uses the verified user basic name in the signed identity',async()=>{
 const calls=[];globalThis.fetch=async url=>{calls.push(String(url));return Response.json(String(url).endsWith('/key/info')?{info:{user:{id:3853023,faction_id:46978}}}:{profile:{id:3853023,name:'Considious',faction:{position:'Leader'}}});};
 const result=await testing.validateTornIdentity('synthetic-key');assert.equal(result.userName,'Considious');assert.equal(result.userId,3853023);assert.equal(result.factionPosition,'Leader');assert.equal(calls.length,2,'Reuse the profile request rather than checking every message');
});
test('a different profile cannot rename a validated chat identity',async()=>{
 globalThis.fetch=async url=>Response.json(String(url).endsWith('/key/info')?{info:{user:{id:1,faction_id:10}}}:{profile:{id:2,name:'Other player',faction:{position:'Leader'}}});
 const result=await testing.validateTornIdentity('synthetic-key');assert.equal(result.userId,1);assert.equal(result.userName,'Player 1');assert.equal(result.factionPosition,'');
});
test('a temporary profile failure does not break valid permission authentication',async()=>{
 globalThis.fetch=async url=>String(url).endsWith('/key/info')?Response.json({info:{user:{id:1,faction_id:10}}}):Response.json({error:{code:5}},{status:429});
 const result=await testing.validateTornIdentity('synthetic-key');assert.equal(result.userId,1);assert.equal(result.userName,'Player 1');
});
