# SLINK Mugging Intelligence Worker

This is a dedicated backend for mugging discovery and heat mapping. It does
not share the Leveling Worker database, R2 bucket, scheduler, or target model.

## Storage boundary

- `MUGGING_BUCKET` owns the company catalog, compact current target state, and
  append-only event batches. Unchanged `Okay` checks do not create history
  objects.
- `MUGGING_DB` owns only the scheduler lock and future client coordination
  rows (heartbeats, leases, and report receipts). It intentionally contains no
  20,000-30,000-row target table.
- `CONTRIBUTION_SERVICE` is a service binding to the Contribution Worker. That
  Worker decrypts mugging-scoped donated keys in request memory, performs only
  allowlisted public Torn API requests, and returns results. Plaintext keys
  never enter this Worker or R2.

## Initial collection rules

- Oil Rig: 7, 8, and 9 stars.
- Mining Corporation: 9 and 10 stars.
- Television Network / TV Station: 9 and 10 stars.
- Logistics Management: 9 and 10 stars.

The daily Torn company snapshot supplies the company catalog. Employee status
is collected company-by-company. The first complete cycle is a baseline, so
existing hospital states are not falsely recorded as new mugs. Later
transitions into a mug-related hospital status create a mug event. A target is
unavailable until the earlier of detected mug time + 11 hours or the next
18:05 TCT payday.

Future client reports can add mug values and battle-stat estimates. Repeated
sub-$300,000 reports lower the target priority. Fair Fight is attempted only
when a target is first populated and only when `FFSCOUTER_API_KEY` is set.

## Cloudflare setup

1. Create a D1 database named `slink-mugging` and replace
   `REPLACE_WITH_MUGGING_D1_DATABASE_ID` in `wrangler.jsonc`.
2. Create a private R2 bucket named `slink-mugging-data`.
3. Apply `migrations/0001-mugging-coordination.sql` to the new D1 database.
4. Apply permission migration
   `permissions/migrations/0011-mugging-contribution-keys.sql` to the existing
   permissions D1 database, then deploy the Contribution Worker.
5. Set the same `CONTRIBUTION_SERVICE_TOKEN` secret on this Worker that the
   Contribution Worker already uses.
6. Set a separate `MUGGING_SERVICE_TOKEN` for internal/client traffic.
7. Optionally set `ADMIN_TOKEN` for manual status/run access and
   `FFSCOUTER_API_KEY` for first-population estimates.
8. Deploy this Worker. Its one-minute cron continuously advances the catalog
   cursor. The status response reports the estimated full-cycle duration and
   whether current donated-key capacity can meet the 15-minute goal.

The `MUGGING_MAX_CALLS_PER_RUN` variable defaults to 100. The Contribution
Worker still enforces each donated key's individual calls-per-minute setting
(default 20) and the 40-external-subrequest safety limit per broker invocation.

## Internal endpoints

- `GET /api/health`: non-secret operational summary.
- `GET /api/internal/status`: authenticated detailed status.
- `POST /api/internal/run`: authenticated one-time collection run.
- `POST /api/reports`: authenticated future client observations.
- `POST /api/clients/heartbeat`: authenticated future client capacity signal.

Authentication uses `X-SLINK-Service-Token`, or `X-Admin-Token` when the
optional admin secret is configured.
