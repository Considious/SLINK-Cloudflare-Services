import assert from 'node:assert/strict';
import test from 'node:test';
import { JACK_ARTWORK_PATH, serveJackArtwork } from './jack-artwork.js';

const key = 'jack-o-slink-idle.4ee8f4e8cfc57dc25a9f3dd84c8e530c932f5e8b05d4cb6befd77c781f49b7ec.webp';
const hash = '4ee8f4e8cfc57dc25a9f3dd84c8e530c932f5e8b05d4cb6befd77c781f49b7ec';
const size = 174180;
const url = new URL('https://artwork.example' + JACK_ARTWORK_PATH + key);

function route({ session = { user_id:7 }, scopes = ['slink.theme.halloween'], object, incoming = url } = {}) {
  let reads = 0;
  const env = { GRAPHICS_ASSETS:{ async get(requested) {
    reads++;
    assert.equal(requested,key);
    return object;
  } } };
  const pending = serveJackArtwork(new Request(incoming), incoming, env, {
    permissionSession:async()=>session,
    loadPermissions:async(_env,id)=>{assert.equal(id,7);return {scopes};},
    hasScope:(permissions,scope)=>permissions.scopes.includes(scope),
    json:(data,status)=>Response.json(data,{status})
  });
  return {pending, reads:()=>reads};
}

test('Jack requires a session and a current entitlement before R2 is read', async ()=>{
  for (const [options,status] of [[{session:null},401],[{scopes:[]},403],[{incoming:new URL(url+'?bypass=1')},404]]) {
    const request = route(options);
    assert.equal((await request.pending).status,status);
    assert.equal(request.reads(),0);
  }
});

test('Jack serves verified R2 objects with private caching headers', async ()=>{
  const request = route({object:{size,customMetadata:{sha256:hash},body:new Response(new Uint8Array(size)).body}});
  const response = await request.pending;
  assert.equal(response.status,200);
  assert.match(response.headers.get('Cache-Control'),/private, no-store/);
  assert.equal(response.headers.get('Content-Type'),'image/webp');
  assert.equal((await response.arrayBuffer()).byteLength,size);
});

test('Jack distinguishes absent and incorrectly versioned objects', async ()=>{
  const missing = await route().pending;
  assert.equal(missing.status,503);
  assert.match((await missing.json()).error,/missing/);
  const bad = await route({object:{size,customMetadata:{sha256:'old'},body:new Response('bad').body}}).pending;
  assert.equal(bad.status,503);
  assert.match((await bad.json()).error,/checksum/);
});
