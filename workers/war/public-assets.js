// This generated 64×64 WebP is a public delivery fixture with no product artwork.
const proofImage = 'UklGRtIAAABXRUJQVlA4TMUAAAAvP8APEBcgEEji2Z9hRoFAikMZaYFAktxK889/QPUHCLFtx21e0haC+BhCF33NRBDERxCy6NJ0/H43ABH9nwD9xRqH5cl7mG+76pRd2JI27yS9e29S9YoUyV+wZU7/2iU1MpPMlZZY9AQ0b0J4V0Zi0RPQvAlxNJ8M49oirnRj9YhFMxgREEcTYloB7cpwFn3RnSsDmjMBwglgeAu6d4XmTQgvGJl1yZj/kDL6BdUr0rv3Jm3eSZInSdUpu3fnbad6VPQXAQA=';
const proofHash = '1faba9b401a6320c7a8dd1664ad3395ae46b0459ff5c5c01149e22200c6ebbe0';
const proofKey = `assets/diagnostics/delivery-proof.${proofHash}.webp`;

const assets = new Map([
  [`/api/${proofKey}`, {
    key: proofKey,
    type: 'image/webp',
    size: 218,
    sha256: proofHash,
    bundled: proofImage
  }]
]);

function failure(message, status, headers) {
  headers.set('Cache-Control', 'no-store');
  return new Response(message, { status, headers });
}

function matchesETag(value, tag) {
  return value?.split(',').some(part => {
    const candidate = part.trim();
    return candidate === '*' || candidate === tag || candidate === `W/${tag}`;
  });
}

async function readAsset(asset, bucket) {
  if (!bucket) return Uint8Array.from(atob(asset.bundled), character => character.charCodeAt(0));
  const object = await bucket.get(asset.key);
  if (!object) throw new Error('Asset is missing from the configured bucket.');
  if (object.size !== asset.size) {
    await object.body?.cancel();
    throw new Error('Asset size does not match its registry entry.');
  }
  const bytes = await object.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength !== asset.size || hex !== asset.sha256) throw new Error('Asset checksum does not match its registry entry.');
  return bytes;
}

export async function servePublicAsset(request, url, bucket) {
  const headers = new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'ETag',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  const isHead = request.method === 'HEAD';
  const asset = assets.get(url.pathname);
  if (!asset || url.search) return failure(isHead ? null : 'Unknown SLINK asset.', 404, headers);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'If-None-Match');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET' && !isHead) {
    headers.set('Allow', 'GET, HEAD, OPTIONS');
    return failure('Use GET or HEAD to retrieve an asset.', 405, headers);
  }

  let bytes;
  try {
    bytes = await readAsset(asset, bucket);
  } catch (error) {
    console.error('SLINK public asset unavailable:', asset.key, error.message);
    return failure(isHead ? null : 'SLINK artwork is temporarily unavailable. Try again later.', 503, headers);
  }

  const tag = `"${asset.sha256}"`;
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', tag);
  if (matchesETag(request.headers.get('If-None-Match'), tag)) {
    return new Response(null, { status: 304, headers });
  }
  headers.set('Content-Type', asset.type);
  headers.set('Content-Length', String(asset.size));
  return new Response(isHead ? null : bytes, { headers });
}
