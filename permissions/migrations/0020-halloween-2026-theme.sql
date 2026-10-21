PRAGMA foreign_keys = ON;

-- Halloween 2026 is a separately assignable cosmetic entitlement. The
-- existing admin.* override continues to unlock it automatically.
INSERT INTO permission_scope_catalog (
    scope, category, title, description, assignable, default_hours,
    created_at, updated_at
) VALUES (
    'slink.theme.halloween',
    'Themes',
    'Halloween 2026',
    'Use the exclusive image-backed Halloween 2026 interface theme.',
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