PRAGMA foreign_keys = ON;

-- ADHD reminder and future market-watch entitlements use the existing SLINK
-- permission tables. No Torn timers, purchases, alert state, or market data is
-- stored in D1; those remain in the user's browser.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours, created_at, updated_at
) VALUES
    (
        'slink.adhd.alerts',
        'ADHD Dashboard',
        'ADHD API Alerts',
        'Use private, locally stored Torn API timers and daily reminders.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.adhd.marketwatch.5',
        'ADHD Dashboard',
        'Market Watch — 5',
        'Track up to 5 Item Market or Bazaar watches.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.adhd.marketwatch.10',
        'ADHD Dashboard',
        'Market Watch — 10',
        'Track up to 10 Item Market or Bazaar watches.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.adhd.marketwatch.15',
        'ADHD Dashboard',
        'Market Watch — 15',
        'Track up to 15 Item Market or Bazaar watches.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        'slink.adhd.marketwatch.20',
        'ADHD Dashboard',
        'Market Watch — 20',
        'Track up to 20 Item Market or Bazaar watches.',
        1,
        24,
        unixepoch() * 1000,
        unixepoch() * 1000
    )
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;

-- Basic API reminders are included for current Slinky's members.
INSERT INTO faction_scope_grants (
    faction_id, scope, status, starts_at, expires_at, granted_by, note, created_at, updated_at
) VALUES (
    46978,
    'slink.adhd.alerts',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    'Included ADHD API reminders for current Slinky members',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(faction_id, scope) DO UPDATE SET
    status = 'active',
    expires_at = NULL,
    granted_by = excluded.granted_by,
    note = excluded.note,
    updated_at = excluded.updated_at;

-- Ensure the owner can test the module and the highest future watch tier even
-- if faction membership changes. The tier does not activate market polling in
-- extension 0.16.0; it only establishes the entitlement model.
INSERT INTO user_scope_grants (
    user_id, scope, source, status, starts_at, expires_at, granted_by,
    external_reference, note, created_at, updated_at
) VALUES
    (
        3853023,
        'slink.adhd.alerts',
        'owner',
        'active',
        unixepoch() * 1000,
        NULL,
        3853023,
        NULL,
        'Owner ADHD Dashboard access',
        unixepoch() * 1000,
        unixepoch() * 1000
    ),
    (
        3853023,
        'slink.adhd.marketwatch.20',
        'owner',
        'active',
        unixepoch() * 1000,
        NULL,
        3853023,
        NULL,
        'Owner market-watch test tier',
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
