PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS terms_acceptances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    faction_id INTEGER NOT NULL,
    terms_version TEXT NOT NULL,
    document_sha256 TEXT NOT NULL,
    document_url TEXT NOT NULL,
    service_id TEXT NOT NULL,
    disclosure_version TEXT NOT NULL,
    disclosure_sha256 TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    client_name TEXT NOT NULL,
    client_version TEXT NOT NULL,
    acceptance_method TEXT NOT NULL,
    UNIQUE(user_id, terms_version, service_id, disclosure_version)
);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_user
    ON terms_acceptances(user_id, accepted_at);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_version
    ON terms_acceptances(terms_version, accepted_at);

CREATE INDEX IF NOT EXISTS idx_terms_acceptances_service
    ON terms_acceptances(service_id, disclosure_version, accepted_at);

CREATE TRIGGER IF NOT EXISTS prevent_terms_acceptance_update
BEFORE UPDATE ON terms_acceptances
BEGIN
    SELECT RAISE(ABORT, 'Terms acceptance records are append-only.');
END;

CREATE TRIGGER IF NOT EXISTS prevent_terms_acceptance_delete
BEFORE DELETE ON terms_acceptances
BEGIN
    SELECT RAISE(ABORT, 'Terms acceptance records are append-only.');
END;
