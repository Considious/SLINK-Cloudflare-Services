# Shared crime recipes

The existing Contribution Worker accepts authenticated batches at
`POST /api/crime-recipes`. It uses the existing `USER_BACKUPS` R2 binding
and writes to `crime-recipes/v1/`, separate from backups and mugging.
No new bucket, binding, database, or secret is required.

Clients queue newly confirmed observations only after the user opts in.
There is one successful upload per UTC half-day per account and client
type. The Worker conditionally writes that slot and acknowledges an
identical replay; a different batch cannot overwrite it. Each observation
has a stable random ID, so a downstream reader can deduplicate observations
across slots. An upload does not make a recipe authoritative.

The API accepts only the versioned observation envelope and passes records
through a validator for each crime. Arson sends native job/scenario labels,
requirements, materials, action names and damage before the action. It
does not include Torn API keys, payout amounts, raw HTML, or player names.
R2 object keys contain the authenticated account ID for upload limits; the
bucket is not exposed by the API. Disabling sharing discards unsent
observations but does not remove batches already received.

Future crimes can add their own validator without changing the batching
protocol. Shared recipe lookup and confidence scoring are not part of this
upload endpoint.
