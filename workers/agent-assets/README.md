# SLINK agent artwork upload API

This Worker has one R2 binding, to the private `slink-graphics-assets` bucket.
The API only accepts WebP, PNG and JPEG uploads of up to 4 MiB. It checks
the file signature and verifies the SHA-256 in the object key before writing.
Uploads are create-only. Repeating an upload safely returns the existing upload
result when the stored metadata matches.

## One-time setup

1. Confirm the `slink-graphics-assets` bucket exists and its public access is disabled.
2. Connect a Worker named `slink-agent-assets` to this repository with the project root
   `workers/agent-assets`, build command `npm test`, and deploy command
   `npx wrangler deploy`. The checked-in configuration supplies the R2 binding.
3. For optional password-based uploads, generate a random 32-byte token as 64 lowercase hex characters in your
   credential store. Save the SHA-256 of that exact token string as the Worker
   secret `ASSET_UPLOAD_TOKEN_SHA256`. Keep the original token in the credential
   store used by the authorized upload client.
4. For password-based uploads, supply the client environment variables `SLINK_ASSET_UPLOAD_URL` (the
   Worker HTTPS origin) and `SLINK_ASSET_UPLOAD_TOKEN` from that credential store.
   Rotate the token by replacing its hash in the Worker secret and updating
   the client credential. Never put the original token in Git or chat.

## Upload artwork

```text
npm run upload -- <path-to-image> assets/companions/jack-o-slink/animations
```

Omit the namespace to upload a versioned legacy asset to the bucket root.
The client computes the hash and prints the resulting key and byte count.
Names should be lowercase and dash-separated.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/v1/health` | Confirms the token and configured binding |
| PUT | `/v1/assets/<object-key>` | Uploads a raw image and returns its SHA-256 and key |

Send `Authorization: Bearer <token>` and the matching image MIME type.
Object keys end in `name.<sha256>.<extension>`. The supported namespaces are
`assets/themes/<pack>` and `assets/companions/<pack>`, with an optional
`animations`, `effects`, or `artwork` subfolder.
HTTP 201 means created, HTTP 200 means already present, and HTTP 409 means the
existing object's metadata does not match. The uploader never replaces that object.

This credential allows uploads only. Production asset delivery and entitlement
checks stay on the serving Worker. Torn API research uses a separate approval
and credential flow (see below).

## Browser Extension repository sync

The `sync-r2-artwork.yml` workflow in `Considious/SLINK-Browser-Extension`
can upload with a short-lived GitHub Actions identity. The Worker verifies
GitHub's signature and checks the audience, repository ID, workflow path,
branch and event. This workflow needs no upload password or Cloudflare token.

Place image files under `r2-assets/` in the Browser Extension repository and
push to `main`. The workflow adds the SHA-256 to each filename if needed and
uses the path beneath `r2-assets/` as the R2 object key. Existing objects are
retained if a file is removed from Git.


## Private Torn research API

Research routes are separate from artwork uploads; neither a GitHub Actions
identity nor an artwork upload password grants research access. Do not expose
the research token to extension users, distribute it in scripts, or commit it.

Set these **Cloudflare Worker secrets** on the existing slink-agent-assets Worker:

| Secret | Value |
| --- | --- |
| RESEARCH_TOKEN_SHA256 | SHA-256 of a separate randomly generated 64-character lowercase hex token; retain the original token privately |
| TORN_API_KEY | Dedicated Torn API key, with only the selections required for your work |
| KAL_API_KEY | Torn public API key registered with KAL, with required consent accepted |
| FFSCOUTER_API_KEY | Torn API key separately registered with FFScouter and approved under its data policy |

Use Authorization: Bearer <original research token> on requests below. Set
secrets through Cloudflare or npx wrangler secret put SECRET_NAME from this
directory. Do not pass the key through a Worker query string. A Torn v1 or
FFScouter upstream call may require the provider key in the outbound query;
do not enable full upstream URL logging. Torn v2 and KAL use ApiKey headers.
All research routes are read-only, fixed-origin, and no-store.

| GET route | Purpose |
| --- | --- |
| /v1/research/health | Shows which provider keys are configured, never their values |
| /v1/research/torn/v2/faction/46978/members?striptags=true | Official Torn v2 call; replace the path and query for other supported selections |
| /v1/research/torn/user/3853023?selections=basic | Official Torn v1 example |
| /v1/research/kal/user/3853023/loadout | KAL latest observed equipment |
| /v1/research/kal/faction/46978/loadouts | KAL stored faction roster and loadouts |
| /v1/research/ffscouter/stats?ids=3853023,2032147 | FFScouter estimates for up to 100 unique IDs |
| /v1/research/faction/46978 | Combined JSON, with current Torn member IDs and per-provider coverage |
| /v1/research/faction/46978/export.xlsx | Excel workbook, with rarity fills, stat and loadout timestamps, equipment detail and artwork URLs |

The faction ID above is an example, not a default. The export uses Torn as
the roster source and joins by numeric player ID. KAL's faction snapshot
can lag Torn's roster; the Worker attempts up to 20 individual lookups for missing members (four at a time), stopping further batches on rate-limit errors. Any remaining unverified rows are explicitly marked and can be checked using the single-player KAL route. Partial provider failures
do not erase valid roster rows; check coverage columns and Read me warnings.
FFScouter estimates are not exact stats and fair fight depends on the key owner.

Example (shell; SLINK_RESEARCH_TOKEN must already be set locally):

```sh
curl --fail-with-body -H "Authorization: Bearer ${SLINK_RESEARCH_TOKEN}" \
  "https://YOUR-WORKER/v1/research/faction/46978/export.xlsx" \
  --output faction-46978.xlsx
```

Append ?images=true to the Excel export route for an additional Preview column in Item artwork. The previews use the Excel IMAGE function (Excel for Microsoft 365 or Excel 2024, external images permitted). They are not embedded; the default export includes links only for compatibility. No API credentials are used in the image URLs.

Run npm test before merging. The Worker does not create any new R2 bucket,
database or scheduled task. The research Workflow below is on demand; use provider quotas
and avoid concurrent export loops. The token is for a single trusted operator,
not an entitlement mechanism for a public service. A global distributed rate
limiter is not included; keep request volume within your provider limits.

Provider docs: https://www.torn.com/swagger.php, https://kalends.dev/api-docs,
https://ffscouter.com/.

## Cloudflare-authenticated research Workflow

The same Worker also exports SlinkAgentResearch, registered as
slink-agent-research. No new Worker, bucket, API key, or schedule.
Cloudflare's authenticated instance creation API is the access control;
RESEARCH_TOKEN_SHA256 is still required for direct HTTP requests only.
Do not grant public access to the Workflow binding.

Start via POST /accounts/{account_id}/workflows/slink-agent-research/instances
(Workers Scripts Write). The params property is a JSON-encoded string.
Retrieve via GET /accounts/{account_id}/workflows/slink-agent-research/instances/{instance_id}
(Workers Scripts Read); check status and the research-result step or output.
The full step output endpoint can be used if the instance summary truncates it.
Use short instance retention where supported. No API credentials belong in parameters.

Accepted JSON parameter examples:

- {"operation":"health"}
- {"operation":"torn","path":"/v2/faction/16247/members","query":{"striptags":true}}
- {"operation":"kal","path":"/faction/16247/loadouts"}
- {"operation":"ffscouter","ids":[123,456]}
- {"operation":"faction","faction_id":16247}
- {"operation":"faction_export","faction_id":16247,"images":true}

Results contain ok, format, and data; errors contain ok:false, status where
available, and descriptive error details. Ordinary JSON is returned directly.
XLSX results contain filename, bytes, download_url, and expires_at. Click the
download_url to download the original workbook; it is a random bearer link
valid for one hour, not a public bucket URL. Anyone with the link can use it
until expiry; treat it as confidential and avoid logging full download URLs.
The original workbook is temporarily stored under research-exports/v1/ in
the existing private GRAPHICS_ASSETS bucket. Configure an R2 lifecycle rule
to expire only that prefix after one day; never apply this rule to artwork.
RESEARCH_DOWNLOAD_ORIGIN is the HTTPS origin of this Worker.
Large JSON (not XLSX) is gzip+base64 encoded; if compressed JSON exceeds the
700 KiB result budget, use smaller requests. Workflow results are retained
according to Cloudflare account/instance settings.
Provider errors are not automatically retried to avoid consuming API quotas.
