# SLINK Cloudflare Services

Authoritative Cloudflare source for SLINK Workers, shared D1 migrations, and
Worker-facing terms. Browser extension code and Torn userscripts live in their
own repositories and do not trigger these deployments.

## Services

| Cloudflare Worker | Git root directory | Build command | Deploy command | Build watch include |
| --- | --- | --- | --- | --- |
| `slinkyleveling` | `workers/leveling` | `npm test` | `npx wrangler deploy` | `workers/leveling/*` |
| `slinkcontributionworker` | `workers/contribution` | `npm test` | `npx wrangler deploy` | `workers/contribution/*` |
| `slinkwarworker` | `workers/war` | `npm test` | `npx wrangler deploy` | `workers/war/*` |

Set each Worker's **Root directory** and **Build watch paths** in Cloudflare
under **Settings → Build**. Build watch paths are Git integration settings and
cannot be declared in `wrangler.jsonc`.

Each checked-in Wrangler configuration is the source of truth for Worker
bindings. Leveling explicitly retains `DB`, `CONSENT_DB`, and `PERMISSIONS_DB`;
Contribution and War explicitly retain `PERMISSIONS_DB`. Secrets remain in
Cloudflare and are not stored in this repository.

## Shared data

- [`permissions`](permissions/README.md) owns the ordered migrations for the
  existing `slink-permissions` D1 database.
- [`terms`](terms) contains the shared API/data terms referenced by Leveling
  and War.
- Contribution-specific donation terms remain with
  [`workers/contribution`](workers/contribution/terms).

## Test everything

The test suites use Node.js built-ins and require no packages to be installed.

```text
npm test
```

## Migration order

Apply the D1 migrations in numeric order. Moving their source does not create,
replace, or reset the existing `slink-permissions` database.

