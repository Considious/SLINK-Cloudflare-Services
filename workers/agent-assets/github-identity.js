const issuer = 'https://token.actions.githubusercontent.com';
const audience = 'slink-agent-assets';
const repository = 'Considious/SLINK-Browser-Extension';
const repositoryId = '1345632275';
const branch = 'refs/heads/main';
const workflow = `${repository}/.github/workflows/sync-r2-artwork.yml@${branch}`;
const signatureAlgorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodePart(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid JWT encoding');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0));
}

async function fetchKeys() {
  const reply = await fetch(issuer + '/.well-known/jwks', {
    headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000)
  });
  if (!reply.ok) throw new Error('GitHub signing keys unavailable');
  const body = await reply.json();
  if (!Array.isArray(body.keys)) throw new Error('Invalid GitHub signing keys');
  return body.keys;
}

let cachedKeys;
let expiresAt = 0;

function githubKeys() {
  if (Date.now() >= expiresAt) {
    expiresAt = Date.now() + 60_000;
    cachedKeys = fetchKeys().catch(error => {
      expiresAt = Date.now() + 5_000;
      throw error;
    });
  }
  return cachedKeys;
}

function allowedClaims(claims, now) {
  return claims.iss === issuer && claims.aud === audience &&
    claims.repository === repository && claims.repository_id === repositoryId &&
    claims.ref === branch && claims.workflow_ref === workflow &&
    ['push', 'workflow_dispatch'].includes(claims.event_name) &&
    [claims.iat, claims.nbf, claims.exp].every(Number.isInteger) &&
    claims.iat <= now + 30 && claims.nbf <= now + 30 && claims.exp > now &&
    claims.exp > claims.iat && claims.exp - claims.iat <= 600;
}

export async function isArtworkWorkflow(token, loadKeys = githubKeys, now = Math.floor(Date.now() / 1000)) {
  if (token.length > 8192) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = JSON.parse(decoder.decode(decodePart(encodedHeader)));
    const claims = JSON.parse(decoder.decode(decodePart(encodedClaims)));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !allowedClaims(claims, now)) return false;
    const jwk = (await loadKeys()).find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
    if (!jwk) return false;
    const key = await crypto.subtle.importKey('jwk', jwk, signatureAlgorithm, false, ['verify']);
    return await crypto.subtle.verify(signatureAlgorithm, key, decodePart(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
  } catch {
    return false;
  }
}
