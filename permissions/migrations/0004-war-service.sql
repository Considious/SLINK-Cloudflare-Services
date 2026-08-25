PRAGMA foreign_keys = ON;

-- SLINK War follows the same entitlement model as Leveling: current Slinky's
-- members receive permanent access, while nonmembers use purchased or manual
-- user_scope_grants. slink.war.faction is deliberately not stored here; the
-- War Worker adds it as a short-lived capability only after Torn confirms the
-- submitted key can read the faction attacks endpoint.
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
    'slink.war',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    'Free permanent SLINK War entitlement for current Slinky members',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(faction_id, scope) DO NOTHING;

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
    'slink.war',
    'owner',
    'active',
    unixepoch() * 1000,
    NULL,
    3853023,
    NULL,
    'Permanent SLINK War access for the SLINK administrator',
    unixepoch() * 1000,
    unixepoch() * 1000
)
ON CONFLICT(user_id, scope) DO NOTHING;

CREATE TABLE IF NOT EXISTS war_terms_acceptances (
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    terms_version TEXT NOT NULL,
    terms_sha256 TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    faction_id INTEGER NOT NULL CHECK(faction_id >= 0),
    PRIMARY KEY (user_id, terms_version, terms_sha256)
);

CREATE INDEX IF NOT EXISTS idx_war_terms_user
    ON war_terms_acceptances(user_id, accepted_at DESC);

-- Only ten-minute summaries are retained in D1. Live rosters, collector
-- leases, retals, and attack-ID deduplication live in a per-war Durable Object.
CREATE TABLE IF NOT EXISTS war_event_aggregates (
    war_id TEXT NOT NULL,
    bucket_start INTEGER NOT NULL,
    war_date TEXT NOT NULL,
    own_faction_id INTEGER NOT NULL CHECK(own_faction_id > 0),
    opponent_faction_id INTEGER NOT NULL CHECK(opponent_faction_id > 0),
    attacker_id INTEGER NOT NULL CHECK(attacker_id > 0),
    attacker_name TEXT NOT NULL DEFAULT '',
    defender_id INTEGER NOT NULL CHECK(defender_id > 0),
    defender_name TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL CHECK(outcome IN ('loss', 'escape', 'online_hit')),
    observed_status TEXT NOT NULL DEFAULT '',
    event_count INTEGER NOT NULL DEFAULT 0 CHECK(event_count >= 0),
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (
        war_id,
        bucket_start,
        attacker_id,
        defender_id,
        outcome
    )
);

CREATE INDEX IF NOT EXISTS idx_war_event_aggregates_lookup
    ON war_event_aggregates(war_id, bucket_start DESC, outcome);

