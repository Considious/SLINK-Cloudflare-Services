PRAGMA foreign_keys = ON;

-- Human-readable scope metadata for the administrator dashboard. Product
-- Workers still enforce each scope independently; this table does not grant
-- access by itself.
CREATE TABLE IF NOT EXISTS permission_scope_catalog (
    scope TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    assignable INTEGER NOT NULL DEFAULT 1 CHECK(assignable IN (0, 1)),
    default_hours INTEGER CHECK(default_hours IS NULL OR default_hours > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO permission_scope_catalog (
    scope, title, description, assignable, default_hours, created_at, updated_at
) VALUES
    ('slink.level', 'SLINK Leveling', 'Use SLINK Leveling and receive shared leveling targets.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.war', 'SLINK War', 'Use shared War targets, status collection, and retaliation alerts.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.war.log', 'SLINK War Logs', 'View retained SLINK War loss, escape, and online-hit summaries.', 1, 24, unixepoch() * 1000, unixepoch() * 1000),
    ('admin.*', 'SLINK Administrator', 'Full SLINK administration. Reserved exclusively for Considious [3853023].', 0, NULL, unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(scope) DO UPDATE SET
    title = excluded.title,
    description = excluded.description,
    assignable = excluded.assignable,
    default_hours = excluded.default_hours,
    updated_at = excluded.updated_at;
