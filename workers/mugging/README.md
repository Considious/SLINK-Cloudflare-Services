# SLINK Mugging Intelligence Worker

## Client FF recovery release — 0.6.3

Known eligible estimates remain first. Missing estimates now fill remaining assignment slots as explicitly unchecked entries, with missing numeric fields omitted (never fabricated zero stats). Hospital/jail timers, federal status and post-mug cooldowns still block both groups; known opponents outside the hard FF range are never reclassified as unchecked. New clients label pending checks and do not show an Attack shortcut for unchecked entries.

Extension0.19.14 and PDA0.4.124 run actual batched FFScouter checks from both Find targets and contribution work, using saved FF keys. Only public BSS estimates are uploaded; private/selected premium values, own stats and observer-dependent FF are excluded. At most200IDs/request, one batch/minute/client, ten-minute missing-result cache, failure backoff and six-second deadline. FF work does not consume Torn API capacity and can continue with zero spare Torn calls. Missing keys/no provider estimate remain honestly unchecked, not zero. Status contributions retain existing Torn limits/reserves.

Successful estimates enter separate acknowledged pending entries, so a later status-only observation cannot erase them. Manual Find targets flushes successful estimates immediately, waits for acknowledgement and fetches assignments again once. Background work uses the existing acknowledged batch schedule. Failed uploads retain their entries. Estimate-only observations never pretend to refresh status/level/bounties. Conditional R2 shard writes retry against concurrent changes and retain newer positive estimates; old clients' zeros cannot erase them. No mass-zeroing, schema migration or broad R2 rewrite is required: active clients progressively recover the existing missing pool. Admin wildcard access is honored.

PDA's release manifest must pin the new source commit, not the prior source release. Its CDN manifest path now follows main; fragments remain pinned by the manifest. Settings/storage identity and keys are unchanged. No unrelated testing-branch modules are promoted.

Validation:28 local worker/pipeline cases pass, including four tests executing real extension service and extracted PDA refresh/contribution functions against the actual worker with SQLite/R2 fixtures. Two tests cover estimate write races and status freshness. Cross-repository cases explicitly require source checkouts: set SLINK_EXTENSION_SOURCE_ROOT to the extension repo root and SLINK_PDA_SOURCE_ROOT to its SLINK-PDA folder; without them these four cases skip rather than falsely claim execution. Client helper/report-safety tests pass. This is not authenticated live PDA/Chrome/R2 certification. After deployment, verify health version0.6.3-client-ff-recovery and increasing estimate coverage as updated keyed clients run.

## Historical client-report safety release (0.6.2)

Worker version: `0.6.2-client-report-safety`. Promoted independently from the audit branch to `main` for urgent release. Publishing this source does not itself confirm a running Cloudflare deployment or perform an R2 repair job. The deployment configuration retains the existing production name/bindings. No migration or secret change is required by this patch.

- Missing, null, zero, negative or invalid target estimates are not allowed to replace a positive estimate. This protection also covers older clients. Client-specific Fair Fight values are not treated as portable raw target estimates.
- Clients may supply `battle_stats_observed_at`. A fresh status observation does not make its cached stat estimate fresh. Legacy client estimates without a stat timestamp can fill a missing estimate but cannot replace an existing positive estimate. The target and FF metadata shard both retain this distinction.
- Failed, omitted or unusable FF results stay queued. The existing ten-minute global request interval and 25-target batch limit remain. A failed attempt is not counted as a successful 14-day refresh. Failed IDs rotate behind other pending work; conditional pending-queue writes preserve concurrent additions.
- Client status reports now detect new mug-related hospital transitions using the existing detection/cooldown rules while monitoring. First observations and repeated identical hospital states are baselines, not new mug events. This path does not require donated Torn keys.
- Health now distinguishes `client_contributions` from the existing scheduled collector's donated-key counts. Client counters start when this instrumentation is installed, are accepted report counts (not unique active-client counts), and do not reconstruct historical activity. `ffscouter_configured` indicates only secret presence, not a successful authentication check.
- `summary.estimate_coverage` counts positive/missing estimates in newly summarized state shards. `counted_shards` describes coverage; partial totals must not be presented as a full-pool audit. Assignment responses additionally expose disjoint exclusion counts under `pool.excluded`, without changing the hard Fair Fight ceiling or filtering rules.

Matching extension/PDA Candidate 6 changes send unknown estimates as null, retain original stat timestamps, share acknowledged reports in five-minute batches, and retry failures after one minute with backoff capped at five minutes. Empty queues do not upload or manufacture successful-delivery timestamps. Existing limits/interactive reserves remain. Higher upload frequency increases Worker/R2 traffic; no production traffic or quota validation is claimed from local tests.

Existing zeroed records are not silently reconstructed. Legacy IDs lost from the old pending queue are not mass-requeued by this patch; normal daily refresh remains, and an explicit recovery plan is still required. Company catalog discovery remains the scheduled backend path; this patch does not claim clients fully replace company discovery. FF collection remains server-side and can run with zero donated Torn capacity if its separate FF key and eligible work are available.

Conditional pending-queue updates are not a transaction across all target, FF, index and status objects. Existing broader multi-object concurrency limitations remain outside this batch; local tests do not prove production-scale R2 ordering or cost.

Run `npm test` for the local synthetic worker tests. Use the single extension-branch `TESTER-CHANGELOG.md` for the combined client test instructions; do not create a second user changelog here.

This is a dedicated backend for mugging discovery and heat mapping. It does
not share the Leveling Worker database, R2 bucket, scheduler, or target model.

## Storage boundary

- `MUGGING_BUCKET` owns the company catalog, compact current target state, and
  append-only event batches. Target state is split across 15 automatically
  managed objects in the existing bucket; these are logical shards, not
  separate buckets. Unchanged `Okay` checks do not create history objects.
- `MUGGING_DB` owns only the scheduler lock and future client coordination
  rows (heartbeats, leases, and report receipts). It intentionally contains no
  20,000-30,000-row target table.
- `CONTRIBUTION_SERVICE` is a service binding to the Contribution Worker. That
  Worker decrypts mugging-scoped donated keys in request memory, performs only
  allowlisted public Torn API requests, and returns results. Plaintext keys
  never enter this Worker or R2.

## Initial collection rules

- Oil Rig: 7 through 10 stars.
- Mining Corporation: 8 through 10 stars.
- Television Network / TV Station: 8 through 10 stars.
- Logistics Management: 8 through 10 stars.
- Cruise Line Agency: 9 and 10 stars.
- Private Security Firm: 8 through 10 stars.

The daily Torn company snapshot supplies the company catalog. Employee status
is collected company-by-company. The first complete cycle is a baseline, so
existing hospital states are not falsely recorded as new mugs. Later
transitions into a mug-related hospital status create a mug event. A target is
unavailable until the earlier of detected mug time + 11 hours or the next
18:05 TCT payday.

Future client reports can add mug values and battle-stat estimates. Repeated
sub-$300,000 reports lower the target priority. When `FFSCOUTER_API_KEY` is
set, Fair Fight collection is limited to 25 targets in one request every 10
minutes. Fair Fight metadata is split into 14 objects in the same R2 bucket;
one shard becomes eligible each day, so established targets are refreshed at
most once every 14 days. Genuinely new targets enter a small immediate queue,
receive their initial estimate at the next permitted Fair Fight interval, and
then remain in their assigned rotation shard. A recent client battle-stat
observation also satisfies the freshness window. Failed requests remain pending
for a later permitted ten-minute interval, rather than receiving a successful
14-day freshness window. Missing/zero estimates are not successful refreshes.

On the first run after upgrading, the Worker automatically converts
`mugging/state/v1.json` into the sharded layout. The legacy object is retained
unchanged as a rollback copy. No R2 objects or additional buckets need to be
created manually.

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

Each scheduled run asks the Contribution Worker for the active mugging-key
pool's current capacity. The run budget is the sum of the capacity remaining
on every key in that minute, so 50 keys configured for 20 calls each provide a
1,000-call run budget. The Contribution Worker still reserves and enforces
each key's individual limit and processes at most 40 external requests per
broker invocation.

## Internal endpoints

- `GET /api/health`: non-secret operational summary.
- `POST /api/assignments/rough`: permission-session authenticated candidate assignment using the requesting player's battle-stat total and cached target estimates. The response labels its Fair Fight values as rough estimates.
- `POST /api/contributor/tasks`: permission-session authenticated, deterministic player-status work. Active clients receive a 10-check/minute budget; clients inactive for five minutes receive 5 checks/minute and cannot request new personal assignments. It reads one existing R2 state shard per request and skips Federal or known-timed unavailable targets.
- `POST /api/contributor/reports`: permission-session authenticated Phase 10 batch ingestion. Clients send at most 100 deduplicated observations per request; the Worker acknowledges report IDs and merges status, bounty, battle-estimate, and confidence inputs into the existing R2 shards without creating per-target D1 rows.
- `GET /api/internal/status`: authenticated detailed status.
- `POST /api/internal/run`: authenticated one-time collection run.
- `POST /api/reports`: authenticated future client observations.
- `POST /api/clients/heartbeat`: authenticated future client capacity signal.

`/api/assignments/rough`, `/api/contributor/tasks`, and `/api/contributor/reports` use the caller's live SLINK permission session and require `slink.mugging`. Internal routes use `X-SLINK-Service-Token`, or `X-Admin-Token` when the optional admin secret is configured.

Candidate 6 clients run contributor checks through their existing shared Torn API limiter, deduplicate observations locally by player, and normally publish queued results in acknowledged five-minute batches. Failed uploads retry with one-to-five-minute backoff. Older stable clients may still wait six hours until upgraded. Failed batches remain queued; acknowledged rows are removed only if their report ID still matches. The shared Worker rejects self-observations, clamps observation age, and merges into R2 target/Fair Fight shards without per-observation D1 writes.
