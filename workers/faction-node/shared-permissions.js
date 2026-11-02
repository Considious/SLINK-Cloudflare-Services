import {ensure,publicKey,ChatError} from './protocol.js';

const ID='shared-permissions-46978-v1',FACTION=46978,NODE='slink-node-46978-hosted-test';
const ENDPOINT='https://slink-faction-node-46978-test.richard-johnson554.workers.dev';
const jobs=new WeakMap();
const sameKey=(a,b)=>a?.kty===b?.kty&&a?.crv===b?.crv&&a?.x===b?.x&&a?.y===b?.y;
function sameNode(a,b){return a?.status==='active'&&a.faction_id===FACTION&&a.node_id===b.node_id&&a.endpoint===b.endpoint&&a.leader_id===b.leader_id&&a.protocol===b.protocol&&sameKey(JSON.parse(a.public_key),JSON.parse(b.public_key));}

// A one-time, additive transfer for the owner's existing installation. The old
// database is READ ONLY here. Never copy general user/admin grants or secrets,
// extend a license, replace an identity, or bypass a production revocation.
export async function ensureSharedChatPermissions(env){
 if(env.CHAT_PERMISSION_STORE!=='shared')return;
 ensure(env.PERMISSIONS_DB&&env.LEGACY_CHAT_DB,'CHAT_MIGRATION_BINDING_MISSING','Chat needs the shared permissions binding and its read-only legacy registry binding. Existing rooms have not been changed.',503);
 let job=jobs.get(env.PERMISSIONS_DB);
 if(!job){job=migrate(env).catch(error=>{jobs.delete(env.PERMISSIONS_DB);if(/no such table|no such column/i.test(String(error?.message||error)))throw new ChatError('CHAT_SHARED_SCHEMA_NOT_READY','Chat could not read the required permission or legacy registry tables. The service database binding/schema needs checking; accepting terms again will not fix this. [SLINK_SERVER_SETUP]',503);throw error;});jobs.set(env.PERMISSIONS_DB,job);}
 return job;
}
async function migrate(env){
 const db=env.PERMISSIONS_DB,legacy=env.LEGACY_CHAT_DB;
 // Check the production permission schema before making any new tables.
 await db.prepare('SELECT faction_id FROM faction_scope_grants LIMIT 1').first();
 await db.batch([
  db.prepare("CREATE TABLE IF NOT EXISTS faction_chat_nodes (faction_id INTEGER PRIMARY KEY CHECK(faction_id>0),node_id TEXT UNIQUE NOT NULL,endpoint TEXT UNIQUE NOT NULL,public_key TEXT NOT NULL,protocol INTEGER NOT NULL,leader_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL)"),
  db.prepare('CREATE TABLE IF NOT EXISTS faction_chat_setup_tokens (token_hash TEXT PRIMARY KEY,faction_id INTEGER NOT NULL,leader_id INTEGER NOT NULL,endpoint TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER,consumed_by TEXT,granted_by INTEGER NOT NULL)'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_chat_setup_expiry ON faction_chat_setup_tokens(expires_at)'),
  // Same shared roster schema as permissions migration 0017. Keep this before
  // the cutover marker check: already-migrated installations need this repair too.
  db.prepare('CREATE TABLE IF NOT EXISTS faction_member_roster (faction_id INTEGER NOT NULL CHECK(faction_id>0),user_id INTEGER NOT NULL CHECK(user_id>0),user_name TEXT NOT NULL,position TEXT NOT NULL,level INTEGER NOT NULL DEFAULT 0 CHECK(level>=0),first_seen_at INTEGER NOT NULL,last_seen_at INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),updated_at INTEGER NOT NULL,PRIMARY KEY(faction_id,user_id))'),
  db.prepare('CREATE INDEX IF NOT EXISTS idx_faction_roster_active ON faction_member_roster(faction_id,active,user_id)'),
  db.prepare('CREATE TABLE IF NOT EXISTS faction_chat_migrations (id TEXT PRIMARY KEY,completed_at INTEGER NOT NULL)')
 ]);
 if(await db.prepare('SELECT id FROM faction_chat_migrations WHERE id=?').bind(ID).first())return;
 const source=await legacy.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=?').bind(FACTION).first();
 ensure(source&&source.status==='active'&&source.node_id===NODE&&source.endpoint===ENDPOINT&&source.leader_id===3853023&&source.protocol===1,'CHAT_MIGRATION_IDENTITY_MISMATCH','The existing faction chat registration could not be safely matched. No node identity or room history was replaced.',503);
 await publicKey(JSON.parse(source.public_key));
 const existing=await db.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=?').bind(FACTION).first();
 ensure(!existing||sameNode(existing,source),'CHAT_MIGRATION_REGISTRY_CONFLICT','Shared permissions already contains a different or revoked chat registration. It was not overwritten.',409);
 const grant=await legacy.prepare("SELECT * FROM faction_scope_grants WHERE faction_id=? AND scope='slink.chat'").bind(FACTION).first(),now=Date.now();
 const statements=[db.prepare('INSERT INTO faction_chat_nodes(faction_id,node_id,endpoint,public_key,protocol,leader_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(faction_id) DO NOTHING').bind(FACTION,source.node_id,source.endpoint,source.public_key,source.protocol,source.leader_id,source.status,source.created_at,source.updated_at)];
 if(grant?.status==='active'&&grant.starts_at<=now&&(grant.expires_at===null||grant.expires_at>now))statements.push(db.prepare("INSERT INTO faction_scope_grants(faction_id,scope,status,starts_at,expires_at,granted_by,note,created_at,updated_at) VALUES(?,'slink.chat','active',?,?,?,?,?,?) ON CONFLICT(faction_id,scope) DO NOTHING").bind(FACTION,grant.starts_at,grant.expires_at,grant.granted_by,grant.note,grant.created_at,grant.updated_at));
 for(const [scope,title,description]of [['slink.chat','Faction-hosted Chat','License to use a faction-owned SLINK chat node.'],['slink.chat.leader','Chat Leader','Explicitly assigned faction chat administration. Never grant to every member.']])statements.push(db.prepare("INSERT INTO permission_scope_catalog(scope,category,title,description,assignable,default_hours,created_at,updated_at) VALUES(?,'Faction Node',?,?,1,24,?,?) ON CONFLICT(scope) DO NOTHING").bind(scope,title,description,now,now));
 await db.batch(statements);
 ensure(sameNode(await db.prepare('SELECT * FROM faction_chat_nodes WHERE faction_id=?').bind(FACTION).first(),source),'CHAT_MIGRATION_REGISTRY_CONFLICT','The shared chat registry did not retain the expected identity. No existing registration was overwritten.',409);
 await db.prepare('INSERT INTO faction_chat_migrations(id,completed_at) VALUES(?,?) ON CONFLICT(id) DO NOTHING').bind(ID,now).run();
}
