import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import worker from './worker.js';

const token = 'ab'.repeat(32);
const hash = value => createHash('sha256').update(value).digest('hex');
const image = Buffer.from('UklGRtIAAABXRUJQVlA4TMUAAAAvP8APEBcgEEji2Z9hRoFAikMZaYFAktxK889/QPUHCLFtx21e0haC+BhCF33NRBDERxCy6NJ0/H43ABH9nwD9xRqH5cl7mG+76pRd2JI27yS9e29S9YoUyV+wZU7/2iU1MpPMlZZY9AQ0b0J4V0Zi0RPQvAlxNJ8M49oirnRj9YhFMxgREEcTYloB7cpwFn3RnSsDmjMBwglgeAu6d4XmTQgvGJl1yZj/kDL6BdUr0rv3Jm3eSZInSdUpu3fnbad6VPQXAQA=', 'base64');
const name = `jack-idle.${hash(image)}.webp`;
const key = 'assets/companions/jack-o-slink/animations/' + name;
const endpoint = '/v1/assets/' + key;

function fixture() {
  const objects = new Map();
  let writes = 0;
  const env = {
    ASSET_UPLOAD_TOKEN_SHA256: hash(token),
    GRAPHICS_ASSETS: {
      async put(key, bytes, { onlyIf, httpMetadata, customMetadata }) {
        writes++;
        assert.equal(onlyIf.get('If-None-Match'), '*');
        if (objects.has(key)) return null;
        const object = { size: bytes.length, httpMetadata, customMetadata };
        objects.set(key, object);
        return object;
      },
      async head(key) { return objects.get(key); }
    }
  };
  return { env, objects, writes: () => writes };
}

function request(path = endpoint, options = {}) {
  return new Request('https://uploader.example' + path, {
    method: 'PUT', body: image,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'image/webp' },
    ...options
  });
}

test('requires a configured bucket and valid scoped token before touching R2', async () => {
  const { env, writes } = fixture();
  assert.equal((await worker.fetch(request(), {})).status, 503);
  assert.equal((await worker.fetch(request(endpoint, { headers: {} }), env)).status, 401);
  assert.equal((await worker.fetch(request(endpoint, { headers: { Authorization: 'Bearer ' + 'cd'.repeat(32) } }), env)).status, 401);
  assert.equal(writes(), 0);
});

test('writes a verified image and safely accepts simultaneous retries', async () => {
  const { env, objects } = fixture();
  const replies = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env)]);
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 201]);
  const response = await replies.find(reply => reply.status === 201).json();
  assert.deepEqual(response, { ok: true, created: true, key, size: image.length, sha256: hash(image), contentType: 'image/webp' });
  assert.equal(objects.get(key).customMetadata.sha256, hash(image));
  assert.equal(objects.size, 1);
});

test('accepts hash-named legacy root objects and validates protected health', async () => {
  const { env } = fixture();
  assert.equal((await worker.fetch(request('/v1/assets/' + name), env)).status, 201);
  const health = await worker.fetch(new Request('https://uploader.example/v1/health', {
    headers: { Authorization: 'Bearer ' + token }
  }), env);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).maxBytes, 4 * 1024 * 1024);
});

test('refuses conflicting objects without overwriting', async () => {
  const { env, objects } = fixture();
  const preexisting = { size: image.length };
  objects.set(key, preexisting);
  assert.equal((await worker.fetch(request(), env)).status, 409);
  assert.equal(objects.get(key), preexisting);
});

test('rejects invalid types, bytes, keys, and content hashes', async () => {
  const { env, writes } = fixture();
  const badType = request();
  badType.headers.set('Content-Type', 'text/html');
  assert.equal((await worker.fetch(badType, env)).status, 415);
  assert.equal((await worker.fetch(request(endpoint, { body: 'fake' }), env)).status, 415);
  assert.equal((await worker.fetch(request(endpoint.replace(hash(image), '0'.repeat(64))), env)).status, 422);
  assert.equal((await worker.fetch(request('/v1/assets/private/' + name), env)).status, 400);
  assert.equal((await worker.fetch(request(endpoint + '?target=other'), env)).status, 404);
  assert.equal((await worker.fetch(request(endpoint, { method: 'DELETE' }), env)).status, 405);
  assert.equal((await worker.fetch(request(endpoint, { method: 'GET', body: undefined }), env)).status, 405);
  assert.equal(writes(), 0);
});

test('bounds streamed bytes independently of Content-Length', async () => {
  const { env, writes } = fixture();
  const large = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    }
  });
  const oversized = request(endpoint, { body: large, duplex: 'half' });
  assert.equal((await worker.fetch(oversized, env)).status, 413);
  assert.equal(writes(), 0);
});
