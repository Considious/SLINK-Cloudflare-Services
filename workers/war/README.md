# SLINK War Service

Coordinates the SLINK War target, retaliation, and aggregate logging lanes.

Generic extension permission sessions and administrator grants are owned by the
Contribution Service. This Worker issues only War sessions and serves War
coordination routes.

## Cloudflare setup

1. Apply the ordered permission migrations through `../../permissions/migrations/0008-adhd-dashboard.sql` to the existing `slink-permissions` D1 database.
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

- API keys are used only during War `/api/auth` and are never stored by this service.
- Public status contributors submit sanitized member snapshots without API keys.
- Live snapshots, collector leases, retals, and attack IDs stay in a per-war Durable Object.
- Faction-wide War mode and expiring med-out claims also stay in that Durable Object.
- The officer-controlled inside-hit cap and officer-made med-out assignments
  stay in the same per-war Durable Object; no additional D1 tables are used.
- Major-window inside-gate mode and expiring armory item requests stay in the
  same Durable Object. Armory requests never create D1 rows.
- Only ten-minute loss, escape, and observed-online counters are persisted to D1.
- Clients refresh persisted log counters no more than once per ten minutes;
  ten-second live refreshes read only the Durable Object's pending counters.
- Snapshot pending logs and the log route require `slink.war.officer` or `admin.*`.

## Central theme catalog

[`themes/catalog.json`](../../themes/catalog.json) is the source of truth. The
production Workers Builds deploy uploads it to the existing private
`slink-graphics-assets` bucket before deploying the Worker. It publishes only
the catalog JSON at a key derived from its SHA-256 hash. Each deployment reads
its own revision, including after a Worker rollback.

Add `themes/catalog.json` to the War Worker's existing **Settings → Builds →
Build watch paths** includes so a catalog-only commit triggers a deployment.
The existing build token needs Workers R2 Storage edit access.

`GET /api/themes` validates the R2 copy and uses the same bundled revision if
the copy is unavailable or differs. The endpoint returns `source: "r2"` when
the R2 copy is in use. Extension clients continue to keep their last known
catalog locally. The catalog and Worker deployment do not publish image files.

## Public graphics delivery

After deploying the existing War Worker, request this path on its existing origin.

```text
/api/assets/diagnostics/delivery-proof.1faba9b401a6320c7a8dd1664ad3395ae46b0459ff5c5c01149e22200c6ebbe0.webp
```

The 64 × 64 WebP is a bundled, unrestricted diagnostic graphic. The route uses
a fixed public registry, immutable cache headers, a SHA-256 ETag, and CORS for
GET and HEAD. A browser client can pin this URL and SHA-256 to test fetching
from its background context and rendering inside Torn. Open the URL directly
to check delivery, then test the same bytes in the actual extension surface.

No additional Worker or bucket is needed for the bundled proof. To exercise
private R2 delivery on the same route, upload the exact WebP bytes to the key
shown above with the `/api/` prefix removed, then declare the bucket binding
`GRAPHICS_ASSETS` in the deployment's Wrangler configuration. The Worker checks
size and checksum before serving a bound object. The public route may only
register unrestricted artwork. Entitled artwork requires a session-checked
delivery route.
