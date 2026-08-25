PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS client_check_claims (
    target_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE INDEX IF NOT EXISTS idx_client_check_claims_session
    ON client_check_claims(session_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_client_check_claims_expiry
    ON client_check_claims(expires_at);

CREATE TABLE IF NOT EXISTS client_target_leases (
    target_id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    leased_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE INDEX IF NOT EXISTS idx_client_target_leases_session
    ON client_target_leases(session_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_client_target_leases_expiry
    ON client_target_leases(expires_at);

CREATE TABLE IF NOT EXISTS target_activity (
    target_id INTEGER PRIMARY KEY,
    last_seen_at INTEGER NOT NULL,
    observed_at INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE INDEX IF NOT EXISTS idx_target_activity_last_seen
    ON target_activity(last_seen_at);

CREATE TABLE IF NOT EXISTS target_fair_fight (
    target_id INTEGER PRIMARY KEY,
    fair_fight REAL,
    bs_estimate INTEGER,
    source TEXT,
    checked_at INTEGER NOT NULL,
    reported_by INTEGER NOT NULL,
    FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE INDEX IF NOT EXISTS idx_target_fair_fight_value
    ON target_fair_fight(fair_fight);
