# SLINK Leveling Service Cloudflare Worker

SLINK means **Shared Live Intelligence NetworK**. This directory contains the
versioned source for the SLINK Leveling Service API Worker. It contains no
deployment credentials or member API keys.

## Release identification

Every deployable source change updates `WORKER_VERSION` near the top of
`worker.js`. The root route, health route, and every response header expose that
version. The current release is identified as
`0.15.7-indexed-scheduling`. It replaces the recurring 2,000-row scheduling
snapshot with indexed, server-assigned target shards. Active collectors receive
only their own due rows, and donated-key collection runs once from the existing
five-minute Cron Trigger instead of once per user activity report.

## Cloudflare configuration

The Worker expects:

- `DB`: the existing D1 database;
- `CONSENT_DB`: the separate append-only SLINK terms acceptance database;
- `PERMISSIONS_DB`: the standalone `slink-permissions` D1 database described in
  [`../../permissions`](../../permissions/README.md);
- `CONTRIBUTION_SERVICE`: a Worker service binding to
  `slinkcontributionworker`;
- `ADMIN_TOKEN`: the secret protecting `/api/admin/*`;
- `SESSION_SECRET`: the secret signing individual 12-hour member sessions;
- `CONTRIBUTION_SERVICE_TOKEN`: the same trusted service secret configured on
  `slinkcontributionworker`, used only across the Worker service binding;
- `FFSCOUTER_API_KEY`: the operator-owned key used only by scheduled
  FFScouter leveling discovery.

The discovery filter uses three optional, non-secret Worker variables:

- `FFSCOUTER_LEVELING_MIN_LEVEL` (default `30`);
- `FFSCOUTER_LEVELING_MAX_LEVEL` (default `100`);
- `FFSCOUTER_LEVELING_MAX_STATS` (default `2000`).

Keep all secrets in Cloudflare and out of this repository.

## Required versioned consent

The full SLINK API & Data Terms are published in versioned folders under
[`../terms`](../terms/README.md). The current August 24, 2026 release is consent
version `2026-08-24` and includes the paid-product and SLINK War access model.

Authentication fails closed unless the request explicitly accepts the current
version. The Worker performs this check before contacting Torn. After Torn
returns the user's identity and current faction, the Worker resolves active
`slink.level` grants from `PERMISSIONS_DB`, writes one permanent acceptance row
for that Torn user, terms version, service, and disclosure version to
`CONSENT_DB`, and only then issues the session. Re-authentication to the same versions uses
the existing row without overwriting its original timestamp. Future overall
terms or Leveling-disclosure versions create another row, and sessions carrying
older versions stop authenticating.

The ledger stores the Torn user and faction IDs, terms version, document URL and
SHA-256 fingerprint, service/disclosure identity and fingerprint, first
acceptance time, client identity/version, and the explicit-checkbox method. It
does not store the Torn API key, IP address, or browser user-agent. The Worker
has no update or deletion path for acceptance records, and database triggers
reject accidental updates or deletions.

## Product access and permissions

Current Slinky's faction members receive `slink.level` from the faction grant
for faction `46978`. A nonmember must have an active direct `slink.level` grant,
normally from a purchase or a manual assignment. Future grants, expired grants,
and revoked grants do not authorize a session. When the effective Leveling
grant expires in less than 12 hours, the signed session expires at that same
time instead of outliving the purchase.

`admin.*` is reserved for Considious, Torn user `3853023`. The Worker filters
that scope from every other user's resolved grants even if an erroneous D1 row
exists. Normal Leveling routes require `slink.level`; signed admin sessions may
also access `/api/admin/*`, while the existing `X-Admin-Token` remains available
for operator automation.

Permissions are read during authentication and embedded in the signed session.
Routine recommendation and collection requests therefore do not query the
permissions database on every poll. Revoked or changed grants take effect on
the next authentication; existing sessions remain bounded by their signed
expiration, with a maximum lifetime of 12 hours.

## Data ownership

D1 stores shared service facts: targets, status observations, hospital events,
scheduling, activity exclusions, stable recommendation assignments, and
per-user collector leases. Scheduled check assignments are calculated without
creating per-target claim rows.

Personalized Fair Fight is not a shared service fact. The userscript reads the member's own
battle stats from Torn once per day and stores only a local score and total in
Tampermonkey. It immediately estimates Fair Fight from that score and the
master target estimate. Exact member battle stats and Fair Fight values are not
uploaded or stored in D1.

The scheduled leveling-catalog collector makes one randomized, inactive-target
FFScouter request per Cron Trigger. By default, it stores only level 30-100
candidates with an absolute battle-stat estimate of 2,000 or less in the
existing `targets` table. Those three bounds are ordinary Worker variables, so
they can be expanded without editing or redeploying the source. The collector
ignores personalized Fair Fight, writes no search history, and uses a
conditional upsert so unchanged candidates consume no additional D1 row
writes. The operator key remains a Cloudflare secret and is never returned by a
route.

The browser sends only a temporary minimum and maximum target-stat range with
the recommendation request. The Worker uses that range for assignment without
persisting it. FFScouter then refines displayed values in one background batch,
and those results remain in local browser storage for seven days.

The old authenticated `POST /api/fair-fight` route remains temporarily as a
no-op for compatibility with an older client. It does not write anything.

## Multi-device coordination

`GET /api/recommendations` elects or renews the active collector while returning
the target list. This avoids a separate heartbeat request. One signed session
per Torn user receives routine Torn API work, while other sessions remain
standby. The normal client interval defaults to 300 seconds and remains
configurable from 60 to 300 seconds.

The collector lease is twice the calling client's configured interval. At the
300-second default, another device can take over after roughly two missed loads,
or ten minutes. At a 90-second interval, failover takes roughly three minutes.
Expired rows are replaced or cleaned up by the next request. They do not run
background work while every device is offline.

Recommendation leases are keyed by Torn user ID and remain stable for the
12-hour member session, so a user's PC and mobile sessions see the same target
set. They are replaced early only when a target becomes invalid for that list,
and released after that user has no live collector device.
Collector ownership is keyed by signed session ID, allowing another device to
take over after the collector lease expires.

Scheduled checks are shared by active Torn user, not by device. The Worker
assigns 64 stable scheduling shards across the active collectors for each
five-minute bucket, uses partial expression indexes to select only due rows from
the current collector's shards, and returns at most that collector's advertised
capacity. This keeps assignments disjoint without per-target claim writes while
preventing collector count from multiplying whole-catalog D1 reads. PC and
mobile sessions for one Torn user still consume one collector share, because
only that user's elected session participates.

Recommendation ranking is source-neutral. Baldr, Legacy, Extra, and every other
source label are metadata only and never boost or penalize a target. The
member's locally derived stat range removes obvious strength mismatches before
assignment. Inside that range, the Worker favors low competition, useful target
level, lower estimated target stats, and targets that are not already leased to
another member. This gives different members their own lists whenever the
available pool permits it.

## Routes

| Method | Route | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/` | Public | Worker identity check |
| `GET` | `/api/health` | Public | D1 connectivity and table counts |
| `GET` | `/api/terms` | Public | Current required terms, fingerprint, link, and Leveling disclosure |
| `POST` | `/api/auth` | Public | Record current consent, verify a Torn key once, and issue a version-bound session |
| `GET` | `/api/session` | Signed session | Inspect roles and effective scopes |
| `GET` | `/api/targets` | `slink.level` | Read paginated leveling targets |
| `GET` | `/api/recommendations` | `slink.level` | Return targets and renew collector coordination |
| `POST` | `/api/user/activity` | `slink.level` | Record an explicit interface interaction and maintain the 20-minute real-user demand window |
| `POST` | `/api/collector/heartbeat` | `slink.level` | Backward-compatible manual collector renewal |
| `POST` | `/api/checks/claim` | `slink.level` | Receive due targets from the current collector's indexed scheduling shards |
| `POST` | `/api/observations` | `slink.level` | Submit status observations |
| `POST` | `/api/contributor/checks/claim` | `slink.contribute` | Receive scheduled contribution work only while real-user demand exists |
| `POST` | `/api/contributor/observations` | `slink.contribute` | Submit contributor-only observations without product access |
| `POST` | `/api/activity` | `slink.level` | Share activity-snapshot matches |
| `POST` | `/api/fair-fight` | `slink.level` | Deprecated no-op; Fair Fight stays local |
| `POST` | `/api/admin/bootstrap-targets` | `admin.*` or admin token | Refresh targets from the master CSV |
| `POST` | `/api/admin/discover-targets` | `admin.*` or admin token | Run one FFScouter leveling-catalog discovery pass |
| `GET` | `/api/admin/targets` | `admin.*` or admin token | Inspect paginated targets |

Scoped routes use `Authorization: Bearer <session token>`. Admin routes accept
the sole administrator's signed session or `X-Admin-Token: <admin token>`.

The client derives its interval capacity from Considious Torn Core Lib's shared
60-per-minute allowance. At the five-minute default it can accept up to 300
checks. The Worker computes its due shard share, and the client spaces those
checks across the interval. Every Torn request still passes through Core Lib,
so other installed scripts remain part of the same rate limit. Observation
uploads use up to 200 rows per Worker request to avoid unnecessary invocations.

Only the `admin.*` session may set its routine API contribution capacity to
zero. All other users must contribute through the normal Core Lib-controlled
allowance; the Worker rejects a zero-capacity claim even if a client bypasses
the GUI restriction.

Release 0.11.0 also handles each observation upload as bounded D1 batches.
Targets, prior statuses, and seven-day hospital history are preloaded in groups;
status and hospital changes are then written with multi-row statements. Routine
`Okay` and `Unknown` results no longer issue no-op recommendation-lease deletes.
The maximum 200-observation upload is sized to use no more than 47 D1 statements,
including the worst case where every row creates a hospital event and releases a
lease.

Scheduled rows mark targets currently assigned in a recommendation list.
Clients sort those targets behind unassigned work when creating Torn API check
plans.
Opening an assigned target through the panel starts the userscript in that attack
tab; visible status and hospital time are submitted as an attack-page observation
and enter the same shared state. Assigned targets remain a fallback for API
checks if no unassigned due work is available.

## Migrations

Migrations 0001 and 0002 created the original coordination tables. Release
0.10.0 stops using `client_check_claims`, but leaves the legacy table in place
so this Worker update requires no destructive database migration. Migration
0003 only removes the unused experimental `user_target_fair_fight` table if it
was manually created while 0.5.0 was being developed.

Release 0.11.0 changes only how observation queries are grouped. It uses the
existing schema and requires no migration.

Release 0.15.0 requires
[`migrations/0004-active-user-demand.sql`](migrations/0004-active-user-demand.sql)
on the main Leveling D1 database. It creates the small activity table used to
expire real-user demand after 20 minutes. Apply it before or alongside the
Worker deployment; it does not alter existing target data.

Release 0.15.7 requires
[`migrations/0005-indexed-target-scheduling.sql`](migrations/0005-indexed-target-scheduling.sql)
on the main `slinkies-leveling-data` database. It fills missing target status
rows once, adds a trigger for future catalog inserts, and creates partial
scheduling indexes for the 64-shard due-target queries. Apply this migration
before deploying Worker 0.15.7. It belongs only to the Leveling database, not
the permissions or consent databases.

The separate consent database uses
`consent-database/0001-terms-acceptances.sql`. Run that schema only against the
consent database, then bind it to the Worker as `CONSENT_DB`. It is intentionally
not numbered as a migration for the main target database.

The standalone permissions database uses
[`../../permissions/migrations/0001-permissions.sql`](../../permissions/migrations/0001-permissions.sql).
Bind that database as `PERMISSIONS_DB`. It is intentionally separate from the
Leveling target database so future SLINK products can use the same grants
without routing through Leveling.

## Test

Run `npm test` in this directory. The test suite uses Node's built-in test
runner and covers auth/session protection, bounded observation query counts,
low-write coordination, scheduling, activity, personal target-stat ranges,
source-neutral ranking, unique target leasing,
local-only Fair Fight estimates, collector failover, fair check sharing,
interval pacing, fail-closed versioned consent, append-only acceptance records,
old-session invalidation, centralized grants, purchase-expiry capping,
admin-only zero contribution, parsing, and CORS.
