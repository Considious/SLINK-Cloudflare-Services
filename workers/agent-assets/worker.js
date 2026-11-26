import { artworkWorkflowError } from './github-identity.js';

const maxBytes = 4 * 1024 * 1024;
const slug = '[a-z0-9]+(?:-[a-z0-9]+)*';
const objectKey = new RegExp(
  `^(?:assets/(?:themes|companions)/${slug}/(?:animations/|effects/|artwork/)?)?${slug}\\.([a-f0-9]{64})\\.(webp|png|jpe?g)$`
);
const mime = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const hexPattern = /^[a-f0-9]{64}$/;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

class UploadError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
  });
}

async function sha256(source) {
  const hash = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function uploadCredentialError(request, expectedHash) {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') || '');
  if (!match) return 'invalid-credential';
  const value = match[1];
  if (!hexPattern.test(value)) return artworkWorkflowError(value);
  if (!hexPattern.test(expectedHash || '')) return 'invalid-credential';
  const hash = await sha256(new TextEncoder().encode(value));
  let mismatch = 0;
  for (let i = 0; i < hash.length; i++) mismatch |= hash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return mismatch === 0 ? '' : 'invalid-credential';
}

function validateImage(bytes, extension) {
  const textAt = (start, text) => Array.from(text).every((character, index) => bytes[start + index] === character.charCodeAt(0));
  switch (extension) {
    case 'webp':
      return bytes.length >= 20 && textAt(0, 'RIFF') && textAt(8, 'WEBP') &&
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 === bytes.length &&
        ['VP8 ', 'VP8L', 'VP8X'].some(tag => textAt(12, tag));
    case 'png':
      return bytes.length >= 33 && pngSignature.every((byte, index) => bytes[index] === byte) && textAt(12, 'IHDR');
    default:
      return bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 &&
        bytes.at(-2) === 255 && bytes.at(-1) === 217;
  }
}

async function readUpload(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > maxBytes) throw new UploadError(413, 'Use an image no larger than 4 MiB.');
  if (!request.body) throw new UploadError(400, 'Send the image as the request body.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UploadError(413, 'Use an image no larger than 4 MiB.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function putAsset(request, bucket, key, expectedHash, extension) {
  const contentType = mime[extension];
  if (request.headers.get('Content-Type') !== contentType || request.headers.has('Content-Encoding')) {
    throw new UploadError(415, `Send an unencoded ${contentType} file.`);
  }
  const bytes = await readUpload(request);
  if (!validateImage(bytes, extension)) throw new UploadError(415, 'The image signature does not match its filename.');
  if (await sha256(bytes) !== expectedHash) throw new UploadError(422, 'The image SHA-256 does not match its filename.');

  const created = await bucket.put(key, bytes, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    httpMetadata: { contentType },
    customMetadata: { sha256: expectedHash }
  });
  if (!created) {
    const existing = await bucket.head(key);
    if (existing?.customMetadata?.sha256 !== expectedHash || existing.size !== bytes.length ||
      existing.httpMetadata?.contentType !== contentType) {
      throw new UploadError(409, 'An existing object uses this key. Check its metadata in R2.');
    }
  }
  return json({ ok: true, created: Boolean(created), key, size: bytes.length, sha256: expectedHash, contentType }, created ? 201 : 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isAsset = url.pathname.startsWith('/v1/assets/');
    const isHealth = url.pathname === '/v1/health';
    if (url.search || (!isAsset && !isHealth)) return json({ ok: false, error: 'Unknown upload API route.' }, 404);
    if (!env.GRAPHICS_ASSETS) {
      return json({ ok: false, error: 'Configure the graphics bucket binding.' }, 503);
    }
    const authError = await uploadCredentialError(request, env.ASSET_UPLOAD_TOKEN_SHA256);
    if (authError) {
      return json({ ok: false, error: 'Supply an artwork upload password or valid GitHub workflow identity.' },
        authError.startsWith('github-keys-') ? 503 : 401,
        { 'WWW-Authenticate': 'Bearer', 'X-SLINK-Upload-Auth': authError });
    }
    if (isHealth && request.method === 'GET') return json({ ok: true, service: 'slink-agent-assets', maxBytes });
    if (!isAsset || request.method !== 'PUT') {
      return json({ ok: false, error: 'Use PUT for uploads or GET for health.' }, 405, { Allow: isAsset ? 'PUT' : 'GET' });
    }
    const key = url.pathname.slice('/v1/assets/'.length);
    const match = key.length <= 200 && objectKey.exec(key);
    if (!match) return json({ ok: false, error: 'Use a supported graphics key ending in its SHA-256 and image extension.' }, 400);
    try {
      return await putAsset(request, env.GRAPHICS_ASSETS, key, match[1], match[2]);
    } catch (error) {
      if (error instanceof UploadError) return json({ ok: false, error: error.message }, error.status);
      console.error('Agent artwork upload failed', error?.name || 'Error');
      return json({ ok: false, error: 'R2 could not complete the upload. Try again.' }, 503);
    }
  }
};
