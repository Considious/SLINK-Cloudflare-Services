CREATE TABLE IF NOT EXISTS client_user_collectors (
    user_id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    claimed_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_client_user_collectors_expiry
    ON client_user_collectors(expires_at);
