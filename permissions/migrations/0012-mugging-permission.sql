PRAGMA foreign_keys = ON;

-- Mugging uses the shared SLINK permission authority. This migration only
-- registers the scope; it intentionally grants access to no user or faction.
-- Operators may activate testing users through user_scope_grants and later
-- activate whole factions through faction_scope_grants without a client build.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours,
    created_at, updated_at
) VALUES (
    'slink.mugging',
    'Combat',
    'SLINK Mugging',
    'Use SLINK Mugging target discovery and shared mugging intelligence.',
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
