-- Generic officer feature grants for Torn faction positions and named members.
PRAGMA foreign_keys = ON;

INSERT INTO permission_scope_catalog (
    scope, category, title, description, default_hours, assignable, created_at, updated_at
) VALUES
    ('slink.officer.armory', 'Officer', 'Faction Armory Restock',
     'Monitor configured faction inventory thresholds and send consolidated restock alerts.',
     NULL, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.officer.oc', 'Officer', 'Organized Crime Supplies',
     'Monitor organized-crime supplies and active crime item requirements.',
     NULL, 1, unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(scope) DO UPDATE SET
    category = excluded.category,
    title = excluded.title,
    description = excluded.description,
    default_hours = excluded.default_hours,
    assignable = excluded.assignable,
    updated_at = excluded.updated_at;

CREATE TABLE IF NOT EXISTS faction_position_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    position_name TEXT NOT NULL CHECK(LENGTH(position_name) BETWEEN 1 AND 100),
    position_name_normalized TEXT NOT NULL CHECK(LENGTH(position_name_normalized) BETWEEN 1 AND 100),
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
    granted_by INTEGER NOT NULL CHECK(granted_by > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, position_name_normalized, scope)
);

CREATE INDEX IF NOT EXISTS idx_faction_position_scope_active
    ON faction_position_scope_grants(faction_id, position_name_normalized, status, scope);

CREATE TABLE IF NOT EXISTS faction_member_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    user_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
    granted_by INTEGER NOT NULL CHECK(granted_by > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, user_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_faction_member_scope_active
    ON faction_member_scope_grants(faction_id, user_id, status, scope);

INSERT OR IGNORE INTO faction_position_scope_grants (
    faction_id, position_name, position_name_normalized, scope, status,
    granted_by, created_at, updated_at
)
SELECT faction_id, role_name, role_name_normalized, 'slink.war.officer',
       status, granted_by, created_at, updated_at
FROM faction_officer_role_grants;
