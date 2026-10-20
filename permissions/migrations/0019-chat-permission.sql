-- Add the Chat quality-of-life permission and include it in the primary faction grant.
PRAGMA foreign_keys = ON;

INSERT INTO permission_scope_catalog (
    scope, category, title, description, default_hours, assignable, created_at, updated_at
) VALUES (
    'slink.qol.chat',
    'Quality of Life',
    'Chat',
    'Use SLINK custom chat buttons and configurable chat-term highlighting.',
    NULL,
    1,
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    default_hours = excluded.default_hours,
    assignable = excluded.assignable,
    updated_at = excluded.updated_at;

INSERT INTO faction_scope_grants (
    faction_id, scope, status, starts_at, expires_at, granted_by, note, created_at, updated_at
) VALUES (
    46978,
    'slink.qol.chat',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    'Included regular SLINK feature access for current Slinky members',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(faction_id, scope) DO UPDATE SET
    status = 'active',
    starts_at = excluded.starts_at,
    expires_at = NULL,
    granted_by = excluded.granted_by,
    note = excluded.note,
    updated_at = excluded.updated_at;
