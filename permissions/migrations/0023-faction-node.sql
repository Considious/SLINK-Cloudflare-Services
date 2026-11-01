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
