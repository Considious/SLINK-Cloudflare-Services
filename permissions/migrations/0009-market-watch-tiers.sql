PRAGMA foreign_keys = ON;

-- Extend the locally executed Market Watch entitlement ladder to 40 slots.
-- This stores permissions only; watch definitions and market results remain in
-- the user's browser and never enter D1.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours, created_at, updated_at
) VALUES
    ('slink.adhd.marketwatch.25', 'ADHD Dashboard', 'Market Watch — 25', 'Track up to 25 Item Market, Points Market, or Bazaar watches.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.adhd.marketwatch.30', 'ADHD Dashboard', 'Market Watch — 30', 'Track up to 30 Item Market, Points Market, or Bazaar watches.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.adhd.marketwatch.35', 'ADHD Dashboard', 'Market Watch — 35', 'Track up to 35 Item Market, Points Market, or Bazaar watches.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.adhd.marketwatch.40', 'ADHD Dashboard', 'Market Watch — 40', 'Track up to 40 Item Market, Points Market, or Bazaar watches.', 1, 24, unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;

INSERT INTO user_scope_grants (
    user_id, scope, source, status, starts_at, expires_at, granted_by,
    external_reference, note, created_at, updated_at
) VALUES (
    3853023,
    'slink.adhd.marketwatch.40',
    'owner',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    NULL,
    'Owner market-watch 40-slot test tier',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(user_id, scope) DO UPDATE SET
    source = excluded.source,
    status = 'active',
    starts_at = excluded.starts_at,
    expires_at = NULL,
    granted_by = excluded.granted_by,
    note = excluded.note,
    updated_at = excluded.updated_at;
