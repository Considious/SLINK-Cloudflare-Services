# SLINK Permissions

This folder owns the cross-product SLINK permission authority. The D1 database
is named `slink-permissions` and is deliberately separate from every product's
operational database.

Torn authentication establishes a user ID and current faction ID. Product
access is then resolved from this database:

- a current Slinky's [46978] member receives `slink.level` automatically from
  `faction_scope_grants`;
- a user outside Slinky's can receive `slink.level` through an active direct
  grant in `user_scope_grants`;
- Considious [3853023] receives `admin.*` through a permanent direct grant.

Product Workers must additionally reject `admin.*` for every user except Torn
ID `3853023`. The Leveling Worker performs that hard check, so an accidental or
malicious grant row cannot create another administrator.

Each product Worker binds this same database as `PERMISSIONS_DB` and enforces
its own required scope. Browser clients never connect to D1 directly.

## Initial setup

1. Create a D1 database named `slink-permissions`.
2. Run [`migrations/0001-permissions.sql`](migrations/0001-permissions.sql) in
   that database's SQL console.
3. Add a `PERMISSIONS_DB` D1 binding to each product Worker that needs SLINK
   authorization. For the Leveling Worker, keep `DB` bound to
   `slinkies-leveling-data` and `CONSENT_DB` bound to the consent ledger.

For encrypted, extension-wide API key donations, also run
[`migrations/0002-donated-api-keys.sql`](migrations/0002-donated-api-keys.sql)
in this same database. Those tables are owned by the separate SLINK
Contribution Worker. Product Workers submit allowlisted work to that service
and must not read encrypted key columns directly.

Then run
[`migrations/0003-demand-driven-collectors.sql`](migrations/0003-demand-driven-collectors.sql)
to add product priorities, recent non-admin demand, one-hour empty-pool
backoff, and virtual collector sessions. `slink.level` is enabled at priority
200. The future `slink.mug-watch` entry is seeded at priority 300 but remains
disabled until that product exists.

Run
[`migrations/0004-war-service.sql`](migrations/0004-war-service.sql) and then
[`migrations/0005-permission-catalog.sql`](migrations/0005-permission-catalog.sql), followed by
[`migrations/0006-war-officer.sql`](migrations/0006-war-officer.sql)
to add SLINK War storage and the assignable permission catalog used by the
extension administrator dashboard. `slink.war.officer` is not granted to the
faction automatically: faction-wide War settings and retained logs require
either `admin.*` or a direct active `slink.war.officer` grant. Legacy
`slink.war.log` grants are revoked by migration 0006.

The initial migration is additive and rerunnable. It seeds the Slinky's faction
grant and the sole owner administration grant.

Apply [`migrations/0007-theme-permissions.sql`](migrations/0007-theme-permissions.sql)
to add the `Themes` catalog category and the separately assignable
`slink.theme.pursuit`, `slink.theme.underglow`, and
`slink.theme.black-chrome` cosmetic entitlements. These rows use the same
`user_scope_grants` table and authentication flow as every other direct SLINK
permission; no additional database or permission service is required.

## Grant paid or manual Leveling access

All timestamps use Unix milliseconds. Replace the example user, expiration,
source, and reference values before running this query:

```sql
INSERT INTO user_scope_grants (
    user_id,
    scope,
    source,
    status,
    starts_at,
    expires_at,
    granted_by,
    external_reference,
    note,
    created_at,
    updated_at
)
VALUES (
    1234567,
    'slink.level',
    'purchase',
    'active',
    unixepoch() * 1000,
    (unixepoch() + 30 * 24 * 60 * 60) * 1000,
    3853023,
    'ORDER-REFERENCE',
    '30-day Leveling access',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(user_id, scope) DO UPDATE SET
    source = excluded.source,
    status = 'active',
    starts_at = excluded.starts_at,
    expires_at = excluded.expires_at,
    granted_by = excluded.granted_by,
    external_reference = excluded.external_reference,
    note = excluded.note,
    updated_at = excluded.updated_at;
```

Use `NULL` for `expires_at` when access should be permanent.

## Revoke a direct grant

Revocation affects only the direct grant. A current Slinky's member still has
the automatic faction entitlement.

```sql
UPDATE user_scope_grants
SET status = 'revoked',
    updated_at = unixepoch() * 1000,
    note = 'Revoked by operator'
WHERE user_id = 1234567
  AND scope = 'slink.level';
```

Existing signed product sessions may remain valid until their short session
expiration. New authentication attempts use the current database state.

The Leveling Worker reads this database only when authenticating a session, not
on every polling request. Active paid grants cap the signed session expiration
at the purchase expiration; all other sessions last no more than 12 hours.
