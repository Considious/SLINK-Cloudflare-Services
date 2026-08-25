PRAGMA foreign_keys = ON;

-- Cross-product priorities. A service is eligible only while it has recent
-- non-admin demand. Higher numbers run first; inactive future services cost
-- no scheduled work.
CREATE TABLE IF NOT EXISTS contribution_services (
    service_id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO contribution_services (
    service_id, display_name, priority, enabled, created_at, updated_at
)
VALUES
    ('slink.level', 'SLINK Leveling', 200, 1, unixepoch() * 1000, unixepoch() * 1000),
    ('slink.mug-watch', 'SLINK Mug Watch', 300, 0, unixepoch() * 1000, unixepoch() * 1000)
ON CONFLICT(service_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS contribution_service_activity (
    service_id TEXT NOT NULL,
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0, 1)),
    last_seen_at INTEGER NOT NULL,
    active_until INTEGER NOT NULL,
    PRIMARY KEY(service_id, user_id),
    FOREIGN KEY(service_id) REFERENCES contribution_services(service_id)
);

CREATE INDEX IF NOT EXISTS idx_contribution_service_activity_active
    ON contribution_service_activity(service_id, is_admin, active_until);

-- One lightweight state row prevents repeated key lookups after the pool is
-- found empty. A new donation clears next_attempt_at immediately.
CREATE TABLE IF NOT EXISTS contribution_service_state (
    service_id TEXT PRIMARY KEY,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_completed_at INTEGER,
    last_result TEXT,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(service_id) REFERENCES contribution_services(service_id)
);

-- Donated keys behave as virtual collectors, but never become product-user
-- sessions and never receive product permissions.
CREATE TABLE IF NOT EXISTS virtual_collector_sessions (
    session_id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    donor_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'idle', 'ended')),
    started_at INTEGER NOT NULL,
    last_used_at INTEGER NOT NULL,
    ended_at INTEGER,
    FOREIGN KEY(service_id) REFERENCES contribution_services(service_id),
    FOREIGN KEY(donor_user_id) REFERENCES donated_api_keys(user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_virtual_collector_active
    ON virtual_collector_sessions(service_id, donor_user_id)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_virtual_collector_recent
    ON virtual_collector_sessions(service_id, status, last_used_at);

