# SLINK Contribution Service

This Cloudflare Worker owns the cross-product pool of donated Torn **Public
Only** API keys. It validates each key with Torn, encrypts it with AES-GCM, and
stores only ciphertext in the existing `slink-permissions` D1 database.

Product Workers never receive donated keys. They may submit a narrowly
allowlisted contribution job with the service token; this Worker decrypts a
rotated key only in request memory, performs the Torn request, and stores the
public result. The first supported job is `torn.user.basic`.

For live products, donated keys run as separate virtual collectors. A virtual
collector is not a product login and receives no product permission. It runs
only while a recent non-admin product user is active. Enabled services are
selected by database priority, so a future high-priority mug service can take
precedence over `slink.level` without changing the key vault.

## Cloudflare setup

1. Run both
   [`permissions/migrations/0002-donated-api-keys.sql`](../../permissions/migrations/0002-donated-api-keys.sql)
   and
   [`permissions/migrations/0003-demand-driven-collectors.sql`](../../permissions/migrations/0003-demand-driven-collectors.sql)
   in the existing `slink-permissions` D1 SQL console, in that order.
2. Create a Worker named `slinkcontributionworker` and paste `worker.js` into it.
3. Bind the existing `slink-permissions` database as `PERMISSIONS_DB`.
4. Add these encrypted Worker secrets in **Settings > Variables and Secrets**:
   - `API_KEY_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded as
     base64url. Keep this backed up securely; losing it makes active donations
     undecryptable.
   - `CONTRIBUTION_SERVICE_TOKEN`: a separate long random value used only by
     trusted product Workers when they submit or read contribution jobs.
5. Add a Cron Trigger of `0 * * * *` as a low-frequency recovery pass. New
   jobs and donations wake work immediately; an empty key pool backs off for
   one hour instead of polling every minute.
6. Deploy the Worker and confirm `/api/health` reports the database connected.

For SLINK Leveling, bind this Worker to the Leveling Worker as
`CONTRIBUTION_SERVICE` and add the same `CONTRIBUTION_SERVICE_TOKEN` secret to
the Leveling Worker. The checked-in Leveling `wrangler.jsonc` contains the
service binding.

Do not put either secret in this repository, extension storage, D1, logs, or a
product Worker that does not need to submit jobs. Rotating the encryption key
requires a planned ciphertext migration; changing it without migration will
invalidate existing donations.

## Endpoints

- `GET /api/terms` — fingerprinted current donation terms.
- `POST /api/donations` — validate and encrypt a newly accepted donation.
- `GET /api/donations` — donor status using the donation management token.
- `DELETE /api/donations` — revoke and erase encrypted key material.
- `POST /api/internal/jobs` — authenticated allowlisted job submission.
- `GET /api/internal/jobs/:id` — authenticated job/result lookup.

- `POST /api/internal/collect` accepts authenticated demand and runs a virtual
  collector for an enabled product service.

The extension stores only the random donation management token. It never saves
the donated key locally and cannot retrieve plaintext from this service.

## Test

The tests use Node.js only and cover encryption, Public Only validation,
revocation, replacement, job execution, and response redaction.

```text
node --test worker.test.js
```
