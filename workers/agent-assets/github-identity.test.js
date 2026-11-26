import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { artworkWorkflowError } from './github-identity.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', alg: 'RS256', use: 'sig' };
const now = 1800000000;
const claims = {
  iss: 'https://token.actions.githubusercontent.com', aud: 'slink-agent-assets',
  repository: 'Considious/SLINK-Browser-Extension', repository_id: '1345632275',
  ref: 'refs/heads/main', event_name: 'push',
  workflow_ref: 'Considious/SLINK-Browser-Extension/.github/workflows/sync-r2-artwork.yml@refs/heads/main',
  iat: now - 10, nbf: now - 10, exp: now + 300
};
const b64 = object => Buffer.from(JSON.stringify(object)).toString('base64url');

function jwt(overrides = {}, alg = 'RS256') {
  const input = b64({ alg, kid: 'test' }) + '.' + b64({ ...claims, ...overrides });
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url');
}

test('accepts only a signed, current identity for the designated upload workflow', async () => {
  const keys = async () => [jwk];
  assert.equal(await artworkWorkflowError(jwt(), keys, now), '');
  assert.equal(await artworkWorkflowError(jwt({ event_name: 'workflow_dispatch' }), keys, now), '');
  for (const override of [
    { aud: 'wrong' }, { iss: 'https://example.org' }, { repository_id: '100' },
    { repository: 'another/SLINK-Browser-Extension' }, { ref: 'refs/heads/other' },
    { workflow_ref: claims.workflow_ref.replace('sync-r2-artwork', 'another') },
    { event_name: 'pull_request_target' }, { exp: now }, { nbf: now + 120 },
    { iat: now - 601 }, { iat: now + 45 }
  ]) assert.equal(await artworkWorkflowError(jwt(override), keys, now), 'identity-claims');
  assert.equal(await artworkWorkflowError(jwt({}, 'none'), keys, now), 'identity-claims');
  assert.equal(await artworkWorkflowError(jwt(), async () => [], now), 'github-key-not-found');
  const [header, payload] = jwt().split('.');
  assert.equal(await artworkWorkflowError(header + '.' + payload + '.AAAA', keys, now), 'github-signature');
});

test('reports the upstream status when the GitHub signing key fetch fails', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  assert.equal(await artworkWorkflowError(jwt(), undefined, now), 'github-keys-http-403');
});
