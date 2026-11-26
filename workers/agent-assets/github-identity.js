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
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
}

class SigningKeyError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.code = 'github-keys-' + code;
  }
}

async function fetchKeys() {
  let reply;
  try {
    reply = await fetch(issuer + '/.well-known/jwks', {
      headers: { Accept: 'application/json', 'User-Agent': 'SLINK-Agent-Assets/1.0' },
      redirect: 'manual', signal: AbortSignal.timeout(5000)
    });
  } catch (error) {
    throw new SigningKeyError('request-failed', error);
  }
  if (!reply.ok) {
    await reply.body?.cancel();
    throw new SigningKeyError('http-' + reply.status);
  }
  let body;
  try {
    body = await reply.json();
  } catch (error) {
    throw new SigningKeyError('invalid-json', error);
  }
  if (!Array.isArray(body?.keys)) throw new SigningKeyError('invalid-key-set');
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

export async function artworkWorkflowError(token, loadKeys = githubKeys, now = Math.floor(Date.now() / 1000)) {
  if (token.length > 8192) return 'invalid-credential';
  const parts = token.split('.');
  if (parts.length !== 3) return 'invalid-credential';
  try {
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = JSON.parse(decoder.decode(decodePart(encodedHeader)));
    const claims = JSON.parse(decoder.decode(decodePart(encodedClaims)));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !allowedClaims(claims, now)) return 'identity-claims';
    let keys;
    try {
      keys = await loadKeys();
    } catch (error) {
      const code = error instanceof SigningKeyError ? error.code : 'github-keys-unavailable';
      // Only report details from the fixed public signing-key request.
      const detail = typeof error?.cause?.message === 'string' ? error.cause.message.slice(0, 250) : '';
      console.error('Artwork GitHub signing-key fetch failed', code, detail);
      const label = detail.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96);
      return label && code === 'github-keys-request-failed' ? code + '-' + label : code;
    }
    const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.use === 'sig');
    if (!jwk) return 'github-key-not-found';
    const key = await crypto.subtle.importKey('jwk', jwk, signatureAlgorithm, false, ['verify']);
    const valid = await crypto.subtle.verify(signatureAlgorithm.name, key, decodePart(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`));
    return valid ? '' : 'github-signature';
  } catch {
    return 'invalid-credential';
  }
}
