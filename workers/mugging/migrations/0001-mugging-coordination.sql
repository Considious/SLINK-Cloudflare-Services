PRAGMA foreign_keys = ON;

-- D1 is deliberately coordination-only. The large company/target model and
-- history live in R2 so tens of thousands of targets do not create a D1 row
-- read/write loop.
CREATE TABLE IF NOT EXISTS mugging_runtime (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
    next_run_at INTEGER NOT NULL DEFAULT 0,
    last_run_at INTEGER,
    last_completed_at INTEGER,
    last_result TEXT,
    updated_at INTEGER NOT NULL
);

INSERT INTO mugging_runtime (singleton, next_run_at, updated_at)
VALUES (1, 0, unixepoch() * 1000)
ON CONFLICT(singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS mugging_client_activity (
    client_id TEXT PRIMARY KEY,
    user_id INTEGER,
    last_seen_at INTEGER NOT NULL,
    active_until INTEGER NOT NULL,
    capacity_per_minute INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_mugging_client_activity_active
    ON mugging_client_activity(active_until, last_seen_at);

CREATE TABLE IF NOT EXISTS mugging_assignment_leases (
    company_id INTEGER PRIMARY KEY CHECK(company_id > 0),
    client_id TEXT NOT NULL,
    assigned_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'completed', 'expired')),
    FOREIGN KEY(client_id) REFERENCES mugging_client_activity(client_id)
);

CREATE INDEX IF NOT EXISTS idx_mugging_assignment_leases_expiry
    ON mugging_assignment_leases(status, expires_at);

CREATE TABLE IF NOT EXISTS mugging_report_receipts (
    report_id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mugging_report_receipts_age
    ON mugging_report_receipts(received_at);
