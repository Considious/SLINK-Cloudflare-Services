# Officer Work website reports

Website entry: https://sharedliveintelligencenetwork.app/officer-work/

This is a website-only addition. No extension or Torn PDA code is changed. The existing Contribution Worker handles `/api/officer-work/*` and the website reuses the SLINK permission login and current terms. A real Torn key check, current faction membership, current `slink.war.officer` (or `admin.*`) grant and Torn Faction API Access are required. Key-level names alone never authorize the report.

## Deployment and setup

Deploy the normal Contribution Worker and static SLINK website from their existing GitHub builds. No new Worker, database, R2 bucket, CLI deployment or copied test database is required. The Worker retains its existing `PERMISSIONS_DB`, `USER_BACKUPS` and `API_KEY_ENCRYPTION_KEY` bindings. Additive officer tables are created automatically on the first request or minute trigger; the same idempotent SQL is retained in `permissions/migrations/0025-officer-work.sql` for migration-managed installations.

The configuration now contains both the existing hourly trigger and `* * * * *`. The minute handler dispatches Officer Work only; it does not run existing hourly contribution collectors sixty times as often. Cloudflare can take time to propagate a new cron configuration. Check the Worker’s trigger list and scheduled invocation health if no jobs advance. Unattended jobs run on the server and may be closed after scheduling. Unsaved-key jobs are explicitly page-only; the browser advances one checkpoint at a time, and cron never attempts them without a credential.

Keep `slink-mugging-data` / `USER_BACKUPS` private. Do not expose the bucket through a public domain or `r2.dev`. The new objects are under `factions/{factionId}/officer-work/{jobId}/`; item-value cache data is under `officer-work-cache/`. Existing backup and mugging prefixes are not modified.

## Normal use

1. Open Officer Work on the website. Accept current SLINK terms. Encrypted unattended-key storage is optional: leave it unchecked to browse archives and Capture Now using only a key held in page memory. Keep the page open to advance that collection; refreshing or closing pauses it. Sign in again without saving to resume your pending page-only jobs. Future schedules require explicit encrypted storage consent. The browser retains neither the Torn key nor permission token in local/session storage. A page refresh requires login again, but encrypted-key server-side jobs continue.
2. Check the capability list. Missing detailed faction attacks blocks the main report. Optional armory and public-stat failures are separately identified. Prefer a custom Torn key with only the listed selections and Faction API Access.
3. Schedule a labelled snapshot in UTC or choose Capture Now. Choose public fields. Schedule a second capture for comparison. Captures start on a minute-based dispatcher, not an exact-instant guarantee. Per-member observations and their real collection window are retained. A large selection can take several minutes and may cross war start; the report does not pretend otherwise.
4. Choose Ranked War or Custom Event. Set an inclusive From and exclusive To in UTC. Search overlapping war-history pages; the first page also includes the active/scheduled ranked war. Select a war and optionally use its exact window. Active wars are provisional with a recorded cutoff. An event can use an optional officer-supplied target roster.
5. Select completed baseline/comparison snapshots for public-stat deltas. Confirm partial/late snapshots explicitly. Select result categories, supplies and current or manual prices. The table and CSV use the same saved normalized report object.
6. Refresh/reopen private archives to see progress, source limitations and errors. Retry a failed job, cancel pending work, or reschedule a capture before it has started. Revoking the saved credential stops subsequent collection and faction-data access; verifying a replacement updates the owner’s active credential reference.

## Pause and resume behavior

Every collection slice saves progress to the transactional D1 job index and archives immutable source payloads in R2. A dispatcher atomically claims a five-minute lease. It performs bounded, short slices; unattended collection never relies on a browser, a long sleep or an unbounded in-memory loop. Page-only jobs use the same leases and backoff through explicit authenticated continuation requests, never storing their key. They are excluded from cron dispatch. Another invocation can recover an expired lease. Completed jobs are not dispatched again.

Temporary network errors, unreadable responses, HTTP 429/5xx and transient Torn errors retain the current checkpoint and retry with exponential backoff plus jitter. `Retry-After` is honored within the bounded retry policy. Six consecutive failing attempts require an explicit Retry. An exhausted internal API budget pauses until capacity returns without counting as a broken-service failure. Permanent permission/key failures stop rather than retrying forever. The UI displays the reason and next retry time.

The officer subsystem conservatively caps all its calls at 20/minute per officer across keys and jobs, including revalidation and UI requests. Other software using the same player’s Torn allowance is outside SLINK’s visibility; upstream rate limits are still respected. Snapshot requests are explicit selected public fields, at most ten stats per member request. Public item values are cached privately for an hour. No per-listing market scan is made.

## Archives and recovery

Job definitions, per-step status manifests, immutable attempts, sanitized sources, normalized data and checksummed completion manifests are kept separately. R2 never stores credentials. Encryption ciphertext and IV for a Torn key live only in the existing permissions D1 database using the existing authenticated-encryption helper and secret. Job rows reference a credential ID.

Completed is published only after the data object, source objects and checksummed manifest exist. An interrupted archive write leaves a recoverable non-complete job. Re-running a step may create an orphan immutable attempt, but stable event IDs deduplicate report math and no completed capture is re-executed.

The website’s Archive recovery action paginates this authorized faction’s objects and rebuilds completed browsing entries from completion manifests. It never imports another faction’s objects or overwrites a newer/cancelled index record. Definitions and failed attempt/status manifests remain available for operator recovery. Recovery of an uncompleted job whose D1 credential reference has been lost requires an officer to verify a key and schedule/retry a capture; a past observation cannot be recreated by backdating it.

Default archive retention is indefinite; the Worker does not delete existing archives or backups. Configure an explicit R2 lifecycle rule for the officer prefix if a finite retention period is chosen, and disclose that period to officers. Do not apply a broad lifecycle rule to the shared bucket. Remove/cancel corresponding index entries when retiring archives, or missing-object errors will correctly remain visible. Credential rotation uses Verify Access; old snapshots remain readable only to a currently authorized officer in the matching faction.

## Evidence and limitations

All selected API contracts were checked against Torn’s official OpenAPI 6.15.5 on 5 November 2026: https://www.torn.com/swagger/openapi.json . The capability registry is `officer-work/model.js`.

- Detailed events: `/v2/faction/attacks`, complete next-link pagination with event-ID deduplication, outgoing attacker-faction-at-time filtering and end-time interval checks. Successful finishing results are Attacked, Mugged and Hospitalized. Interrupted, assisted and other results are retained separately.
- Wars: `/v2/faction/rankedwars` uses offset pagination (its from/to parameters no longer filter); `/v2/faction/wars` supplies current war data. `/v2/faction/{rankedWarId}/rankedwarreport` provides completed-war participants and official scores. Today’s opponent roster is never silently used for a historic war. SLINK War Respect / War Points means roster-classified respect, not the official ranked-war score.
- Armory: `/v2/faction/news?cat=armoryAction,armoryDeposit`, paginated. Parsing is conservative and item-based. Source text, timestamps and unknown formats are retained for inspection, never rendered as HTML. Loans and withdrawals do not imply consumption. Every drug and recognized medical/candy/can subtype remains separately priced; empty blood bags and pepper-spray actions remain distinct. Points consumption has no verified adapter in this implementation and is unavailable rather than inferred.
- Public stats: explicit `/v2/user/{id}/personalstats?stat=...` selections and roster levels, compared only across compatible completed snapshots. Missing member/field pairs, counter resets and source errors produce unavailable results. The public `awards` counter is exposed as Awards gained, and `meritsbought` as Merits purchased. They are separate snapshot deltas, not a fabricated current spendable balance or complete merit total. The former unsupported `merits` field remains readable for old requests but is not offered in the UI. Bounty value uses `totalbountyreward`, never a count multiplied by an assumed reward. Historical personalstats timestamps round to a date and are not treated as exact war boundaries.
- Prices: `/v2/torn/items`, `value.market_price`, frozen in the report with retrieval time or manual override. They are estimates of historical consumption value, not historical purchase receipts. Missing prices/coverage stay partial; known priced consumption is separate from an unavailable total.
- Historical retention: pagination reaching its end does not prove Torn retained every event since an old From timestamp. Reports are labelled partial when that coverage cannot be verified. A member with no evidence does not receive a fabricated zero. Snapshot observation times identify response receipt; source cache dates/ages are retained where provided.
- Torn Intel: https://torn-intel.com/developers and https://torn-intel.com/openapi.json expose no public officer faction-history integration. The option defaults off and makes no calls. Turning it on records an explicit unavailable diagnostic; it never forwards a Torn key, invents an export format, scrapes a signed-in session or overwrites primary sources.

Each member’s metric evidence includes value/null, source, source IDs, interval, observation/retrieval timestamps, calculation version, completeness and unavailable reason. Detailed provenance can be downloaded privately. Numeric sorting/filtering/columns are reflected in CSV; CSV quoting and spreadsheet formula-injection protection apply.

## Tests and operator checks

Run `node --test officer-work/officer-work.test.mjs` from this worker directory and the existing contribution tests. Tests use real SQLite with mocked Torn/R2, covering all result checkbox combinations, boundaries, duplicate IDs, respect precision, missing/reset snapshots, armory actions/prices, CSV safety, concurrent leases, browser-closed retries, archived recovery, report generation/export, past schedule rejection and permission revocation. Website checks are in `SLINK-Website/qa/officer-work.browser.mjs` (desktop and 390px).

After deployment, verify a real authorized custom key’s capability checklist and schedule a short test capture, close the page, return and inspect observation times. Real keys and production faction data are deliberately not used in automated tests. For overdue jobs inspect the Scheduled/Running rows, `next_run`, `lease_until` and error codes; do not clear archived data. Cloudflare scheduled invocation logs and the faction-scoped `officer_work_audit` table provide scheduling/selection/retrieval history without secrets.
