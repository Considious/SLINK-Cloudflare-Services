-- TEST ONLY: run in slink-faction-chat-test, never slink-permissions.
-- No admin wildcard grants, production data, API keys or signing secrets.

CREATE TABLE IF NOT EXISTS user_scope_grants (
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    scope TEXT NOT NULL CHECK(LENGTH(scope) BETWEEN 1 AND 100),
    source TEXT NOT NULL CHECK(LENGTH(source) BETWEEN 1 AND 50),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked')),
    starts_at INTEGER NOT NULL,
    expires_at INTEGER,
    granted_by INTEGER,
    external_reference TEXT,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, scope),
    CHECK(expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS faction_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    scope TEXT NOT NULL CHECK(LENGTH(scope) BETWEEN 1 AND 100),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active', 'revoked')),
    starts_at INTEGER NOT NULL,
    expires_at INTEGER,
    granted_by INTEGER,
    note TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, scope),
    CHECK(expires_at IS NULL OR expires_at > starts_at)
);

CREATE TABLE IF NOT EXISTS war_terms_acceptances (
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    terms_version TEXT NOT NULL,
    terms_sha256 TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    faction_id INTEGER NOT NULL CHECK(faction_id >= 0),
    PRIMARY KEY (user_id, terms_version, terms_sha256)
);

CREATE TABLE IF NOT EXISTS permission_scope_catalog (
    scope TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'Products',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    assignable INTEGER NOT NULL DEFAULT 1 CHECK(assignable IN (0, 1)),
    default_hours INTEGER CHECK(default_hours IS NULL OR default_hours > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS faction_position_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    position_name TEXT NOT NULL CHECK(LENGTH(position_name) BETWEEN 1 AND 100),
    position_name_normalized TEXT NOT NULL CHECK(LENGTH(position_name_normalized) BETWEEN 1 AND 100),
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
    granted_by INTEGER NOT NULL CHECK(granted_by > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, position_name_normalized, scope)
);

CREATE TABLE IF NOT EXISTS faction_member_scope_grants (
    faction_id INTEGER NOT NULL CHECK(faction_id > 0),
    user_id INTEGER NOT NULL CHECK(user_id > 0),
    user_name TEXT NOT NULL,
    scope TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
    granted_by INTEGER NOT NULL CHECK(granted_by > 0),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (faction_id, user_id, scope)
);

-- Small Central registry only. Customer chat history stays in customer Durable Objects.
CREATE TABLE IF NOT EXISTS faction_chat_nodes (
 faction_id INTEGER PRIMARY KEY CHECK(faction_id>0),
 node_id TEXT UNIQUE NOT NULL,
 endpoint TEXT UNIQUE NOT NULL,
 public_key TEXT NOT NULL,
 protocol INTEGER NOT NULL,
 leader_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS faction_chat_setup_tokens (
 token_hash TEXT PRIMARY KEY,
 faction_id INTEGER NOT NULL,
 leader_id INTEGER NOT NULL,
 endpoint TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 used_at INTEGER,
 consumed_by TEXT,
 granted_by INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_setup_expiry ON faction_chat_setup_tokens(expires_at);
INSERT INTO permission_scope_catalog(scope,category,title,description,assignable,default_hours,created_at,updated_at)
VALUES ('slink.chat','Faction Node','Faction-hosted Chat','License to use a faction-owned SLINK chat node.',1,24,unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(scope) DO UPDATE SET title=excluded.title,description=excluded.description,updated_at=excluded.updated_at;
INSERT INTO permission_scope_catalog(scope,category,title,description,assignable,default_hours,created_at,updated_at)
VALUES ('slink.chat.leader','Faction Node','Chat Leader','Explicitly assigned faction chat administration. Never grant to every member.',1,24,unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(scope) DO UPDATE SET title=excluded.title,description=excluded.description,updated_at=excluded.updated_at;
-- Intentionally NO faction-wide Leader grant, and NO automatic paid chat license grants.


-- Fourteen-day test faction license. Rerunning does not extend an existing grant.
INSERT INTO faction_scope_grants(faction_id,scope,status,starts_at,expires_at,granted_by,note,created_at,updated_at)
VALUES(46978,'slink.chat','active',unixepoch()*1000,(unixepoch()+14*86400)*1000,3853023,'Isolated faction chat test',unixepoch()*1000,unixepoch()*1000)
ON CONFLICT(faction_id,scope) DO NOTHING;
-- Initial Leader 3853023 is assigned through the signed node registration, not admin.*.
SELECT faction_id,scope,status,expires_at FROM faction_scope_grants WHERE scope='slink.chat';
