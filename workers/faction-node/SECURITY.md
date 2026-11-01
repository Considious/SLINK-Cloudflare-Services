# Security model and release gates

## Trust boundaries

SLINK Central's dedicated ES256 private key stays in its secret configuration (`CHAT_SIGNING_PRIVATE_JWK`). It is **not** the existing permission-session HMAC secret and is never given to customers. Nodes receive only Central's public verification key, their signed identity certificate, and their own private node key. Do not configure a real Central signing key for development fixtures.

Registration tokens are random, hashed in D1, faction/address/initial-Leader-bound and valid for 30 minutes. A random per-attempt claim makes token consumption and registration atomic across concurrent requests. An active faction node cannot be overwritten with another token. Retrying a successful registration requires fresh proof from the same registered private key; a copied token alone cannot replace it. Signing configuration is validated before token consumption.

Central checks an exact, active, in-date faction-level `slink.chat` grant before setup, discovery, renewal and access-token issuance. Chat access expires no later than five minutes after the existing verified permission session's identity check, and cannot be extended by repeatedly reusing an aging session. The frontend must refresh the existing permission session before that deadline. A public key verifies access locally; sending a message does not call Central or Torn.

The initial Leader is bound in the Central-approved certificate. Later Leader assignments live in the customer directory and are changeable only by explicit existing Leaders. Local Leader authority represents `slink.chat.leader`; unrelated permission scopes and chat customization settings do not grant it. Tokens cannot self-assert local Leader authority. Room rules are rechecked on every message and recipient broadcast. Existing connections are notified/closed when their permissions change.

## Revocation and linked nodes

Central revocation stops discovery, renewal and new access tokens. Existing member tokens can last until their fixed expiry (at most five minutes from verification). Node certificates prove identity for one year; they are **not a live revocation list**. Already approved cross-faction link trust remains customer-controlled: a Leader must sever the link to stop that peer immediately. Central revocation is not represented as instantaneous revocation of every customer's link.

Mutual signed invitations and per-link HMACs prevent an outsider from attaching to rooms or inventing a different origin. Incoming events must match the exact active link, room, node, faction, protocol, timestamp and signature. Durable inbox IDs deduplicate retries. Deletes cannot be undone by a higher-version remote edit. Message content is structured text/media URLs, not executable HTML. Only registered public HTTPS origins are used for inter-node requests; redirects are not followed. Approved peers are still independent operators who control their own software and storage.

No end-to-end encryption is claimed. Customer Cloudflare administrators can access their stored messages. Do not treat linked factions, their customers, or external media providers as private encrypted recipients. Do not share sensitive material on the assumption that unlinking retracts copies.

## Resource limits

Limits include 32 rooms, 200 explicit rules per room, 8 links per room, 500 live sockets per room, 3 sockets per user/room, 8 KB incoming socket frames, 4 KB text, 16 KB incoming HTTP JSON, 30 message actions/minute and 120 total socket events/minute per user/room. Read cursors use one row per account, not a row per message. These are application safeguards, not billing guarantees or a replacement for Cloudflare abuse controls.

Per-user/room admission and action budgets live in SQLite and survive closing every socket or hibernating. They add bounded counter writes rather than letting reconnects reset the sending allowance. They are not an account-wide DDoS service. Installer tokens and member authentication endpoints still need deployment-level request abuse controls and realistic load testing.

Typing performs no SQLite writes. It is coalesced across the same account's room sockets to one broadcast per 2.5 seconds. The 120-frame/minute limit (including malformed/typing frames) is attachment-backed and shared across those live sockets; closing all sockets may reset that transient counter, but does not reset the persisted admission/action budgets. Excess frames close the offending socket with 4008; the shared client stops automatic reconnects and enforces a one-minute cooldown. Malformed/oversized frames close with 4002, without automatic retry. Brief welcome/disconnect loops do not reset the client retry budget; only a connection stable for 30 seconds does.

## Central operator setup (testing environment only)

1. Provision a **separate test deployment/database**, not the live contribution service. Apply migration `0023-faction-node.sql` after the existing permissions migrations.
2. Generate a dedicated P-256 keypair using a secure tool. Store the private JWK as `CHAT_SIGNING_PRIVATE_JWK`; set `CHAT_CENTRAL_ISSUER` to that test service's exact HTTPS origin. Do not commit the key.
3. Grant the test faction its `slink.chat` license using the existing permissions system. Migration 0023 only catalogs scopes; it grants nobody a license or Leader permission.
4. An existing Central administrator uses `POST /api/chat/setup-token` with a verified permission session, faction ID, initial Leader ID and exact node HTTPS origin. The initial Leader is explicitly approved, not inferred from Torn faction rank.
5. Set `SLINK_CENTRAL_URL` for the setup process to that same test issuer. Keep all customer node/client tests on that environment until rollout is approved.

The new routes are isolated under `/api/chat/`. Existing permission/session requests retain their existing implementation. Cross-origin responses use explicit allowed origins, not a wildcard; credentials go in headers or WebSocket subprotocols, never in URLs.

## Remaining production gates

The owner-only hosted test flow is documented in WEB-SETUP.md. Its public bootstrap handler is confined to the exact preapproved test Central and test-node HTTPS origins, faction 46978 and initial Leader 3853023; it must never be enabled for arbitrary customers or copied into production. Central fetches a fresh nonce-bound registration proof directly from that fixed node, then reuses the existing registration/renewal validation. Caller-supplied endpoint/key/Leader selection is not accepted. Revoked/different registrations cannot be replaced. A D1 setup gate bounds attempts to one per ten seconds, with a short-lived, deterministic per-window setup token. Identity RPC material is private to the node Worker; HTTP setup proof/certificate responses never expose its private key. The Identity DO storage is therefore a credential store and must not be deleted/reset as an update shortcut. This is controlled test preauthorization, not a completed general customer onboarding authorization design.

- Real clean-account OAuth/deployment, routing and renewal exercise.
- Real deployed hibernation/resume and billing measurements (local workerd is not proof of eviction).
- Load tests of reconnect-resistant abuse limits and Central endpoint abuse protection.
- Deployed inactive-room retention/deletion verification.
- Validate the implemented client/UI on actual Torn pages, including background/visibility rules, CSP and physical PDA devices; local synthetic-browser tests are not proof of those environments.
- Independent security review before describing this as production-ready.
