import { createHash } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const types = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const [file, namespace] = process.argv.slice(2);
const token = process.env.SLINK_ASSET_UPLOAD_TOKEN;
const origin = process.env.SLINK_ASSET_UPLOAD_URL;

async function upload() {
  if (!file || !token || !origin) throw new Error('Set SLINK_ASSET_UPLOAD_URL and SLINK_ASSET_UPLOAD_TOKEN, then pass the image path and optional namespace.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Set SLINK_ASSET_UPLOAD_URL to the HTTPS origin of the upload Worker.');
  }

  const suffix = extname(file);
  const extension = suffix.slice(1).toLowerCase();
  if (!types[extension]) throw new Error('Choose a WebP, PNG or JPEG image.');
  if (namespace && !/^assets\/(?:themes|companions)\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/(?:animations|effects|artwork))?$/.test(namespace)) {
    throw new Error('Use a graphics namespace such as assets/companions/jack-o-slink/animations.');
  }
  const stem = basename(file, suffix).replace(/\.[a-f0-9]{64}$/, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(stem)) throw new Error('Use a lowercase, dash-separated image filename.');

  const info = await stat(file);
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw new Error('Choose a regular image file up to 4 MiB.');
  const bytes = await readFile(file);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const name = `${stem}.${hash}.${extension}`;
  const key = namespace ? `${namespace}/${name}` : name;
  const reply = await fetch(new URL(`/v1/assets/${key}`, url), {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': types[extension] },
    body: bytes, redirect: 'error', signal: AbortSignal.timeout(30000)
  });
  const result = await reply.json().catch(() => null);
  if (!reply.ok || !result?.ok) throw new Error(result?.error || `The artwork upload returned HTTP ${reply.status}.`);
  console.log(JSON.stringify(result));
}

try {
  await upload();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
