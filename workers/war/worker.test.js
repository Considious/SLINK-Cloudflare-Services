import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { registerHooks } from 'node:module';
import { themeCatalogText, themeCatalogObjectKey } from './theme-catalog-source.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateKey,
  attackFlags,
  chooseCollectors,
  classifyAttack,
  filterMembers,
  hasScope,
  LOG_SCOPE,
  OFFICER_SCOPE,
  sanitizeMembers
} from './worker-core.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('publishes the exact current shared terms fingerprint', () => {
  const terms = fs.readFileSync(
    path.resolve(directory, '../../terms/2026-08-23/SLINK_API_Data_Terms_of_Service.md'),
    'utf8'
  ).replace(/\r\n?/g, '\n');
  const fingerprint = crypto.createHash('sha256').update(terms, 'utf8').digest('hex');
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /const TERMS_VERSION = '2026-11-23'/);
  assert.match(worker, new RegExp(fingerprint));
});

test('faction capability never makes a non-admin an admin', () => {
  assert.equal(hasScope({ user_id: 12, scopes:['slink.war.faction', 'admin.*'] }, 'admin.*'), false);
  assert.equal(hasScope({ user_id:3853023, scopes:['admin.*'] }, 'admin.*'), true);
});

test('War officer access is distinct from ordinary product and legacy log scopes', () => {
  assert.equal(hasScope({ user_id:12, scopes:['slink.war'] }, OFFICER_SCOPE), false);
  assert.equal(hasScope({ user_id:12, scopes:[LOG_SCOPE] }, OFFICER_SCOPE), false);
  assert.equal(hasScope({ user_id:12, scopes:[OFFICER_SCOPE] }, OFFICER_SCOPE), true);
  assert.equal(hasScope({ user_id:3853023, scopes:['admin.*'] }, 'admin.permissions'), true);
  assert.equal(hasScope({ user_id:12, scopes:['admin.*'] }, 'admin.permissions'), false);
});

test('classifies incoming retals and outgoing review events', () => {
  const context = { ownFactionId:46978, opponentFactionId:99 };
  const incoming = classifyAttack({
    id:1, ended:1000, result:'Hospitalized',
    modifiers:{ war:2, retaliation:2 },
    attacker:{ id:10, name:'Enemy', faction:{ id:99, name:'Enemy Faction', tag:'ENMY' } }, defender:{ id:20, name:'Member', faction:{ id:46978, name:'Slinkys' } }
  }, context);
  assert.equal(incoming.kind, 'retal');
  assert.equal(incoming.againstWarOpponent, true);
  assert.equal(incoming.attackerFactionName, 'Enemy Faction');
  assert.equal(incoming.attackerFactionTag, 'ENMY');
  assert.equal(incoming.defenderName, 'Member');
  assert.deepEqual(attackFlags({ modifiers:{ war:2, retaliation:2 } }), { isRetal:true, isWar:true });
  assert.equal(incoming.isWar, true);
  assert.equal(incoming.isRetal, true);

  const loss = classifyAttack({
    id:2, ended:1001, result:'Lost',
    attacker:{ id:20, faction:{ id:46978 } }, defender:{ id:10, faction:{ id:99 } }
  }, context);
  assert.equal(loss.outcome, 'loss');

  const onlineHit = classifyAttack({
    id:3, ended:1002, result:'Attacked',
    attacker:{ id:20, faction:{ id:46978 } }, defender:{ id:10, faction:{ id:99 } }
  }, context, new Map([[10, { activity:'Online' }]]));
  assert.equal(onlineHit.outcome, 'online_hit');
});

test('sanitizes and filters status snapshots by mode', () => {
  const members = sanitizeMembers([
    { id:1, name:'Online', last_action:{ status:'Online', timestamp:1000 }, status:{ state:'Okay' } },
    { id:2, name:'Old idle', last_action:{ status:'Idle', timestamp:1 }, status:{ state:'Okay' } },
    { id:3, name:'Travel', last_action:{ status:'Offline', timestamp:1 }, status:{ state:'Traveling', description:'Traveling to Mexico' } }
  ]);
  assert.deepEqual(filterMembers(members, { mode:'termed', idleMinutes:5 }, 2000).map(member => member.id), [2]);
  assert.deepEqual(filterMembers(members, { mode:'war' }, 2000).map(member => member.id), [1, 2]);
});

test('prioritizes non-faction status contributors and faction attack collectors', () => {
  const now = Date.now();
  const selected = chooseCollectors([
    { sessionId:'faction', factionCapable:true, joinedAt:1, lastSeenAt:now },
    { sessionId:'public', factionCapable:false, joinedAt:2, lastSeenAt:now }
  ], now);
  assert.equal(selected.publicSessionId, 'public');
  assert.equal(selected.factionSessionId, 'faction');
});

test('aggregate keys share a ten-minute bucket but preserve outcome', () => {
  const first = aggregateKey({ ended:100, attackerId:1, defenderId:2, outcome:'loss' });
  const second = aggregateKey({ ended:101, attackerId:1, defenderId:2, outcome:'loss' });
  const third = aggregateKey({ ended:101, attackerId:1, defenderId:2, outcome:'escape' });
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test('keeps live War responses available when historical D1 log storage is unavailable', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /storedAvailable:!storedResult\.error/);
  assert.match(worker, /Historical War log storage is unavailable\. Live targets and retals remain available\./);
});

test('keeps faction-wide config and med-out claims in the per-war coordinator', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /CREATE TABLE IF NOT EXISTS med_out_claims/);
  assert.match(worker, /async updateConfig\(session, input = \{\}\)/);
  assert.match(worker, /async updateClaim\(session, input = \{\}\)/);
  assert.match(worker, /canViewLogs:officer/);
  assert.match(worker, /insideHitCap/);
  assert.match(worker, /insideBlockMode/);
  assert.match(worker, /requestedAssigneeId/);
});

test('keeps armory requests transient in the per-war coordinator', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /CREATE TABLE IF NOT EXISTS armory_item_requests/);
  assert.match(worker, /async updateItemRequest\(session, input = \{\}\)/);
  assert.match(worker, /Only Warlord and Revitalize items can be requested/);
  assert.match(worker, /itemRequests:this\.activeItemRequests\(session\)/);
  assert.doesNotMatch(worker, /PERMISSIONS_DB\.prepare\([^)]*armory_item_requests/s);
});

test('returns the full opponent membership IDs for inside-hit safety', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /opponentMemberIds:status\.members\.map/);
  assert.match(worker, /inside_block_mode/);
});

test('publishes only declarative visual data in the central theme catalog', () => {
  const catalog = JSON.parse(fs.readFileSync(path.resolve(directory, '../../themes/catalog.json'), 'utf8'));
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.themes.length > 0 && catalog.themes.length <= 32);
  assert.equal(new Set(catalog.themes.map(theme => theme.id)).size, catalog.themes.length);
  assert.ok(catalog.themes.every(theme => theme.id && theme.tokens && !JSON.stringify(theme).match(/<script|javascript:|url\s*\(/i)));
  const dragonsBreath = catalog.themes.find(theme => theme.id === 'slinky-dragons-breath');
  assert.equal(dragonsBreath?.label, "Dragon's Breath");
  assert.equal(dragonsBreath?.scope, 'slink.theme.dragons-breath');
  assert.equal(dragonsBreath?.ornament, 'coil');
  const halloween = catalog.themes.find(theme => theme.id === 'halloween-2026');
  assert.equal(halloween?.scope, 'slink.theme.halloween');
  assert.equal(halloween?.ornament, 'halloween');
  assert.match(halloween?.assets?.background || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.(?:png|webp)$/);
  assert.match(halloween?.assets?.iconSheet || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.png$/);
  assert.match(halloween?.assets?.brandIcon || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.png$/);
  assert.match(halloween?.assets?.chatIcon || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.png$/);
  assert.equal(halloween?.assets?.packaged, true);
  const gothic = catalog.themes.find(theme => theme.id === 'gothic-valentines');
  assert.equal(gothic?.scope, 'slink.theme.gothic-valentines');
  assert.equal(gothic?.ornament, 'gothic');
  assert.match(gothic?.assets?.frame || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.png$/);
  assert.match(gothic?.assets?.roseCorner || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.png$/);
  assert.match(gothic?.assets?.badgeIvory || '', /^https:\/\/raw\.githubusercontent\.com\/Considious\/SLINK-Cloudflare-Services\/main\/themes\/assets\/[^?]+\.svg$/);
  assert.deepEqual(Object.keys(gothic?.assets?.healthRoses || {}), ['100', '075', '050', '025', '004']);
  assert.deepEqual(Object.keys(gothic?.assets?.healthBlood || {}), ['100', '075', '050', '025', '004']);
  assert.deepEqual(dragonsBreath?.swatch, ['#060302', '#e34710', '#ffd49a']);
  const permissionMigration = fs.readFileSync(path.resolve(directory, '../../permissions/migrations/0010-dragons-breath-theme.sql'), 'utf8');
  assert.match(permissionMigration, /'slink\.theme\.dragons-breath'/);
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /\/api\/themes/);
  assert.match(worker, /validateThemeCatalog/);
  assert.match(worker, /THEME_DIRECT_ASSETS/);
  assert.match(worker, /healthRoses:healthAssets/);
  assert.match(worker, /healthBlood:healthAssets/);
});

test('leaves generic permission sessions and grants outside the War Worker', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(directory, 'package.json'), 'utf8'));
  const migration = [
    fs.readFileSync(path.resolve(directory, '../../permissions/migrations/0008-adhd-dashboard.sql'), 'utf8'),
    fs.readFileSync(path.resolve(directory, '../../permissions/migrations/0009-market-watch-tiers.sql'), 'utf8')
  ].join('\n');
  assert.equal(packageJson.version, '0.8.0');
  assert.doesNotMatch(worker, /\/api\/permissions\/auth/);
  assert.doesNotMatch(worker, /\/api\/admin\/scopes/);
  assert.doesNotMatch(worker, /\/api\/admin\/users/);
  for (const scope of ['slink.adhd.alerts', 'slink.adhd.marketwatch.5', 'slink.adhd.marketwatch.10', 'slink.adhd.marketwatch.15', 'slink.adhd.marketwatch.20', 'slink.adhd.marketwatch.25', 'slink.adhd.marketwatch.30', 'slink.adhd.marketwatch.35', 'slink.adhd.marketwatch.40']) {
    assert.match(migration, new RegExp(scope.replaceAll('.', '\\.')));
  }
  assert.match(migration, /INSERT INTO faction_scope_grants[\s\S]*46978,[\s\S]*'slink\.adhd\.alerts',[\s\S]*'active'/);
});

const proofHash = '1faba9b401a6320c7a8dd1664ad3395ae46b0459ff5c5c01149e22200c6ebbe0';
const proofKey = `assets/diagnostics/delivery-proof.${proofHash}.webp`;
const proofUrl = `https://worker.example/api/${proofKey}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    }
    return nextResolve(specifier, context);
  }
});
let worker;
try {
  ({ default: worker } = await import('./worker.js'));
} finally {
  hooks.deregister();
}

function requestProof(options, env = {}, url = proofUrl) {
  return worker.fetch(new Request(url, options), env);
}

test('serves the immutable public WebP through the Worker without a session or R2 binding', async () => {
  const response = await requestProof();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/webp');
  assert.equal(response.headers.get('Content-Length'), '218');
  assert.equal(response.headers.get('ETag'), `"${proofHash}"`);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Access-Control-Expose-Headers'), 'ETag');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'cross-origin');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), proofHash);
});

test('supports conditional GET, HEAD and CORS preflight', async () => {
  const tag = `"${proofHash}"`;
  const conditional = await requestProof({ headers: { 'If-None-Match': `"older", W/${tag}` } });
  assert.equal(conditional.status, 304);
  assert.equal(conditional.headers.get('ETag'), tag);
  assert.equal(conditional.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await conditional.text(), '');

  const head = await requestProof({ method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Length'), '218');
  assert.equal(await head.text(), '');

  const preflight = await requestProof({ method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Headers'), 'If-None-Match');
});

test('rejects unknown asset IDs, queries and writes before accessing R2', async () => {
  const env = { GRAPHICS_ASSETS: { get: () => assert.fail('Unexpected R2 lookup') } };
  const unknown = await requestProof({}, env, 'https://worker.example/api/assets/companions/jack.webp');
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('Cache-Control'), 'no-store');
  assert.equal((await requestProof({}, env, proofUrl + '?url=other')).status, 404);
  const write = await requestProof({ method: 'POST' }, env);
  assert.equal(write.status, 405);
  assert.equal(write.headers.get('Allow'), 'GET, HEAD, OPTIONS');
});

test('reads and verifies the exact registered R2 object when a bucket is bound', async () => {
  const bytes = await (await requestProof()).arrayBuffer();
  const fromR2 = await requestProof({}, { GRAPHICS_ASSETS: {
    async get(key) {
      assert.equal(key, proofKey);
      return { size: bytes.byteLength, arrayBuffer: async () => bytes };
    }
  } });
  assert.equal(fromR2.status, 200);
  assert.deepEqual(await fromR2.arrayBuffer(), bytes);
});

test('returns an uncacheable error for missing or corrupt R2 objects', async () => {
  for (const object of [null, {
    size: 218,
    arrayBuffer: async () => new ArrayBuffer(218)
  }]) {
    const response = await requestProof({}, { GRAPHICS_ASSETS: { get: async () => object } });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('ETag'), null);
  }
});

test('serves the exact catalog uploaded for this deployment from private R2', async () => {
  const expectedKey = await themeCatalogObjectKey();
  const env = { THEME_CATALOG_ASSETS:{ async get(key) {
    assert.equal(key, expectedKey);
    return { body:new Response(themeCatalogText).body, size:Buffer.byteLength(themeCatalogText) };
  } } };
  const response = await worker.fetch(new Request('https://worker.example/api/themes?refresh=1'), env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.source, 'r2');
  assert.equal(data.catalog.revision, JSON.parse(themeCatalogText).revision);
  assert.ok(data.catalog.themes.some(theme => theme.id === 'gothic-valentines'));
});

test('serves the full bundled catalog when the R2 copy is unavailable or mismatched', async () => {
  const corrupt = { body:new Response('{}').body, size:2 };
  for (const object of [null, corrupt]) {
    const env = { THEME_CATALOG_ASSETS:{ get:async () => object } };
    const response = await worker.fetch(new Request('https://worker.example/api/themes'), env);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.source, 'bundled-fallback');
    assert.equal(data.catalog.revision, JSON.parse(themeCatalogText).revision);
    assert.ok(data.catalog.themes.some(theme => theme.id === 'gothic-valentines'));
  }
});
