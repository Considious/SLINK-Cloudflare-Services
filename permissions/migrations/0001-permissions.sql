PRAGMA foreign_keys = ON;

-- Direct grants are used for purchases, promotions, and operator assignments.
-- One current grant exists per Torn user and scope; extending access updates
-- the existing row without changing the user's identity.
CREATE TABLE IF NOT EXISTS user_scope_grants (
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    scope TEXT NOT NULL CHECK(LENGTH(scope) BETWEEN 1 AND 100),
    source TEXT NOT NULL CHECK(LENGTH(source) BETWEEN 1 AND 50),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked')),
    starts_at INTEGER NOT NULL,
    expires_at INTEGER,
    granted_by INTEGER,
    external_reference TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, scope),
    CHECK(expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_user_scope_grants_active
    ON user_scope_grants(user_id, status, starts_at, expires_at, scope);

-- Faction grants are automatic entitlements derived from the faction returned
-- by Torn during authentication. They do not create a row per faction member.
CREATE TABLE IF NOT EXISTS faction_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    scope TEXT NOT NULL CHECK(LENGTH(scope) BETWEEN 1 AND 100),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked')),
    starts_at INTEGER NOT NULL,
    expires_at INTEGER,
    granted_by INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, scope),
    CHECK(expires_at IS NULL OR expires_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_faction_scope_grants_active
    ON faction_scope_grants(faction_id, status, starts_at, expires_at, scope);

-- Every current Slinky's [46978] member receives Leveling automatically.
INSERT INTO faction_scope_grants (
    faction_id,
    scope,
    status,
    starts_at,
    expires_at,
    granted_by,
    note,
    created_at,
    updated_at
)
VALUES (
    46978,
    'slink.level',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    'Free permanent Leveling entitlement for current Slinky members',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(faction_id, scope) DO NOTHING;

-- Considious [3853023] is the sole SLINK administrator.
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
    3853023,
    'admin.*',
    'owner',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    NULL,
    'Initial sole SLINK administrator',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(user_id, scope) DO NOTHING;
