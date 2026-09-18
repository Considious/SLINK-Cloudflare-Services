PRAGMA foreign_keys = ON;

-- Donated keys are explicitly scoped to one workload. Existing donations
-- were collected for the mugging project, so the migration assigns them to
-- that service and keeps a conservative per-key default of 20 calls/minute.
ALTER TABLE donated_api_keys
    ADD COLUMN service_scope TEXT NOT NULL DEFAULT 'slink.mug-watch';

ALTER TABLE donated_api_keys
    ADD COLUMN calls_per_minute INTEGER NOT NULL DEFAULT 20
        CHECK(calls_per_minute BETWEEN 1 AND 60);

ALTER TABLE donated_api_keys
    ADD COLUMN rate_window_started_at INTEGER NOT NULL DEFAULT 0;

ALTER TABLE donated_api_keys
    ADD COLUMN rate_window_calls INTEGER NOT NULL DEFAULT 0
        CHECK(rate_window_calls >= 0);

CREATE INDEX IF NOT EXISTS idx_donated_api_keys_service_capacity
    ON donated_api_keys(
        service_scope,
        status,
        rate_window_started_at,
        rate_window_calls,
        last_used_at,
        user_id
    );

UPDATE contribution_services
SET enabled = 1,
    priority = 300,
    updated_at = unixepoch() * 1000
WHERE service_id = 'slink.mug-watch';
