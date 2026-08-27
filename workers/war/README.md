# SLINK War Service

Coordinates the SLINK War target, retaliation, and aggregate logging lanes.

## Cloudflare setup

1. Apply `../../permissions/migrations/0004-war-service.sql`, `0005-permission-catalog.sql`, and `0006-war-officer.sql` to the existing `slink-permissions` D1 database.
2. Create or connect a Worker named `slinkwarworker` to this directory.
3. Confirm the `PERMISSIONS_DB` binding points to `slink-permissions`.
4. Add a Worker secret named `SESSION_SECRET`. This can be a new random secret used only by the War Worker.
5. Deploy. Wrangler creates the SQLite-backed `WarCoordinator` Durable Object namespace from the included migration.

Suggested Git build command:

```text
npm test
```

Suggested Git deploy command:

```text
npx wrangler deploy
```

After deployment, open `/api/health`. A ready response reports the D1 database, coordinator binding, and session secret as configured.

## Data boundary

- API keys are used only during `/api/auth` and are never stored by this service.
- Public status contributors submit sanitized member snapshots without API keys.
- Live snapshots, collector leases, retals, and attack IDs stay in a per-war Durable Object.
- Faction-wide War mode and expiring med-out claims also stay in that Durable Object.
- The officer-controlled inside-hit cap and officer-made med-out assignments
  stay in the same per-war Durable Object; no additional D1 tables are used.
- Only ten-minute loss, escape, and observed-online counters are persisted to D1.
- Clients refresh persisted log counters no more than once per ten minutes;
  ten-second live refreshes read only the Durable Object's pending counters.
- Snapshot pending logs and the log route require `slink.war.officer` or `admin.*`.

## Central theme catalog

`GET /api/themes` reads [`../../themes/catalog.json`](../../themes/catalog.json)
from the repository's raw GitHub URL, validates every field, and returns only
declarative visual tokens. Remote JavaScript, HTML, raw CSS, URLs, and commands
are rejected. Cloudflare's fetch cache reduces GitHub reads, and each extension
keeps its last-known-good catalog in `chrome.storage.local`.

The Worker also supports an optional Workers KV binding named `THEME_CATALOG`.
When that binding is declared with a real namespace ID, successful GitHub
catalog revisions are retained under `themes:catalog:current`. KV is an
optimization and durable fallback, not a deployment prerequisite; the checked-in
configuration intentionally does not contain a fake namespace ID.

## Administration

Signed `admin.*` sessions for Considious [3853023] may use
`/api/admin/users/:tornId/permissions` to inspect and update direct timed grants
for `slink.level`, `slink.war`, `slink.war.officer`, and theme scopes published
by the validated catalog. The allowlist is enforced by
the Worker and cannot create another administrator. Automatic faction grants
are resolved separately and are not revoked by this endpoint.
