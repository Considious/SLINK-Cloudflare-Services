CREATE TABLE IF NOT EXISTS leveling_user_activity (
    session_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    last_interaction_at INTEGER NOT NULL,
    active_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_leveling_user_activity_active
    ON leveling_user_activity(active_until, user_id);
