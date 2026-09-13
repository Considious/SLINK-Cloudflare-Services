PRAGMA foreign_keys = ON;

-- Register Dragon's Breath as a separately assignable cosmetic entitlement.
-- Existing admin.* access continues to unlock every theme through the client
-- permission resolver, so administrators do not need a duplicate direct grant.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours,
    created_at, updated_at
) VALUES (
    'slink.theme.dragons-breath',
    'Themes',
    'Dragon''s Breath',
    'Use the obsidian, ember, and pale-gold Dragon''s Breath interface theme.',
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
