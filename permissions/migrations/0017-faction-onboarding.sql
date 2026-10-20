PRAGMA foreign_keys = ON;

-- Torn faction roles selected by an administrator inherit the existing
-- slink.war.officer permission during permission authentication.
CREATE TABLE IF NOT EXISTS faction_officer_role_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    role_name TEXT NOT NULL CHECK(LENGTH(role_name) BETWEEN 1 AND 100),
    role_name_normalized TEXT NOT NULL CHECK(LENGTH(role_name_normalized) BETWEEN 1 AND 100),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked')),
    granted_by INTEGER NOT NULL CHECK(granted_by > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, role_name_normalized)
);

CREATE INDEX IF NOT EXISTS idx_faction_officer_roles_active
    ON faction_officer_role_grants(faction_id, status, role_name_normalized);

-- The first roster sync is a baseline. Later active-member transitions create
-- onboarding alerts without treating every existing member as newly joined.
CREATE TABLE IF NOT EXISTS faction_roster_state (
    faction_id INTEGER PRIMARY KEY CHECK(faction_id > 0),
    initialized_at INTEGER NOT NULL,
    last_sync_at INTEGER NOT NULL,
    synced_by INTEGER NOT NULL CHECK(synced_by > 0)
);

CREATE TABLE IF NOT EXISTS faction_member_roster (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    user_name TEXT NOT NULL,
    position TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 0 CHECK(level >= 0),
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_faction_roster_active
    ON faction_member_roster(faction_id, active, user_id);

CREATE TABLE IF NOT EXISTS faction_onboarding_checks (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    user_name TEXT NOT NULL,
    position TEXT NOT NULL,
    level INTEGER NOT NULL DEFAULT 0 CHECK(level >= 0),
    joined_at INTEGER NOT NULL,
    officer_verified_at INTEGER,
    officer_verified_by INTEGER,
    admin_verified_at INTEGER,
    admin_verified_by INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_faction_onboarding_pending
    ON faction_onboarding_checks(
        faction_id,
        admin_verified_at,
        officer_verified_at,
        joined_at
    );
