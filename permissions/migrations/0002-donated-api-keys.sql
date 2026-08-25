PRAGMA foreign_keys = ON;

-- Encrypted key material is owned exclusively by the SLINK Contribution
-- Worker. Other product Workers may share this D1 but do not receive the
-- encryption secret and must never read or return these columns.
CREATE TABLE IF NOT EXISTS donated_api_keys (
    user_id INTEGER PRIMARY KEY CHECK(user_id > 0),
    encrypted_key TEXT,
    encryption_iv TEXT,
    encryption_version INTEGER NOT NULL DEFAULT 1,
    management_token_sha256 TEXT NOT NULL,
    access_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked', 'invalid')),
    terms_version TEXT NOT NULL,
    terms_sha256 TEXT NOT NULL,
    terms_accepted_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_validated_at INTEGER,
    last_used_at INTEGER,
    failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
    last_error TEXT,
    CHECK(
        (status = 'active' AND encrypted_key IS NOT NULL AND encryption_iv IS NOT NULL)
        OR status <> 'active'
    )
);

CREATE INDEX IF NOT EXISTS idx_donated_api_keys_available
    ON donated_api_keys(status, last_used_at, failure_count, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_donated_api_keys_management_token
    ON donated_api_keys(management_token_sha256);

-- Product services submit only allowlisted work kinds. The Contribution
-- Worker owns decryption and execution; jobs never contain donated keys.
CREATE TABLE IF NOT EXISTS contribution_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('torn.user.basic')),
    payload_json TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'running', 'completed', 'failed')),
    available_at INTEGER NOT NULL,
    claimed_at INTEGER,
    completed_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
    donor_user_id INTEGER,
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contribution_jobs_queue
    ON contribution_jobs(status, available_at, created_at);

CREATE INDEX IF NOT EXISTS idx_contribution_jobs_requester
    ON contribution_jobs(requested_by, status, created_at);
