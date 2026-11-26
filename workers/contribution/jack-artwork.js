export const JACK_ARTWORK_PATH = '/api/graphics/companions/jack-o-slink/';
const halloweenScope = 'slink.theme.halloween';
const artwork = new Map(Object.entries({
  "jack-o-slink-idle.4ee8f4e8cfc57dc25a9f3dd84c8e530c932f5e8b05d4cb6befd77c781f49b7ec.webp": {
    "size": 174180,
    "sha256": "4ee8f4e8cfc57dc25a9f3dd84c8e530c932f5e8b05d4cb6befd77c781f49b7ec"
  },
  "jack-o-slink-slinky-move.0ea51ab3ce5e5a5d7f5115b2a238e5b3d33b4a14a182b8ab824666032eacb82e.webp": {
    "size": 178676,
    "sha256": "0ea51ab3ce5e5a5d7f5115b2a238e5b3d33b4a14a182b8ab824666032eacb82e"
  }
}));

export async function serveJackArtwork(request, url, env, { permissionSession, loadPermissions, hasScope, json }) {
  const key = url.pathname.slice(JACK_ARTWORK_PATH.length);
  const asset = artwork.get(key);
  if (!asset || url.search) return json({ ok:false, error:'This Jack O’ Slink artwork version is unavailable. Update SLINK and try again.' }, 404);
  if (request.method !== 'GET') return json({ ok:false, error:'Use GET to download Jack O’ Slink artwork.' }, 405);

  try {
    const session = await permissionSession(request, env);
    if (!session) return json({ ok:false, error:'Open SLINK Access and refresh permissions to load Jack’s HD artwork.' }, 401);
    const permissions = await loadPermissions(env, Number(session.user_id), Number(session.faction_id) || 0,
      Date.now(), String(session.faction_position || ''));
    if (!hasScope(permissions, halloweenScope) && !hasScope(permissions, 'admin.*')) {
      return json({ ok:false, error:'Jack’s HD artwork requires the Halloween theme entitlement.' }, 403);
    }
    if (!env.GRAPHICS_ASSETS) return json({ ok:false, error:'The private graphics bucket is not configured on the artwork service.' }, 503);
    const object = await env.GRAPHICS_ASSETS.get(key);
    if (!object) return json({ ok:false, error:'Jack’s HD image is missing from the graphics bucket.' }, 503);
    if (object.size !== asset.size || object.customMetadata?.sha256 !== asset.sha256) {
      await object.body.cancel();
      return json({ ok:false, error:'Jack’s stored HD image failed its size or checksum check.' }, 503);
    }
    return new Response(object.body, {
      headers:{
        'Content-Type':'image/webp', 'Content-Length':String(asset.size),
        'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff',
        'ETag':`"${asset.sha256}"`
      }
    });
  } catch (error) {
    console.error('Jack artwork delivery failed', error?.name || 'Error');
    return json({ ok:false, error:'Could not check Jack’s entitlement or read the HD image. Try again later.' }, 503);
  }
}
