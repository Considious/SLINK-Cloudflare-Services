import { DurableObject } from 'cloudflare:workers';
import {
  ADMIN_SCOPE,
  FACTION_SCOPE,
  LOG_SCOPE,
  SOLE_ADMIN_USER_ID,
  WAR_SCOPE,
  attackEnded,
  attackId,
  bucketStart,
  chooseCollectors,
  classifyAttack,
  factionId,
  filterMembers,
  hasScope,
  isSuccessfulAttack,
  playerId,
  sanitizeMembers,
  scopeMatches
} from './worker-core.js';

const WORKER_VERSION = '0.2.2-resilient-log-storage';
const TERMS_VERSION = '2026-08-24';
const TERMS_SHA256 = '72a933d69ec99cabeb92b426208e9d0c47e90acaf960818e0b4da38f3f2f5b0a';
const TERMS_URL = 'https://github.com/Considious/SLINK-Cloudflare-Services/blob/main/terms/2026-08-23/SLINK_API_Data_Terms_of_Service.md';
const SESSION_LIFETIME_SECONDS = 2 * 60 * 60;
const MAX_BODY_BYTES = 256 * 1024;
const CLIENT_ACTIVE_MS = 30_000;
const CLIENT_RETENTION_MS = 2 * 60 * 1000;
const ATTACK_RETENTION_SECONDS = 2 * 24 * 60 * 60;
const FLUSH_DELAY_MS = 10 * 60 * 1000;
const encoder = new TextEncoder();
const ASSIGNABLE_SCOPES = Object.freeze([
  Object.freeze({ scope:'slink.level', title:'SLINK Leveling', description:'Use SLINK Leveling and receive shared leveling targets.' }),
  Object.freeze({ scope:'slink.war', title:'SLINK War', description:'Use shared War targets, status collection, and retaliation alerts.' }),
  Object.freeze({ scope:LOG_SCOPE, title:'SLINK War Logs', description:'View retained SLINK War loss, escape, and online-hit summaries.' })
]);

const WAR_TERMS_SUMMARY =
  'Your Torn API key is sent to SLINK only during authentication to verify your identity, faction, and whether your faction position can read faction attacks. The key is not stored by the War Worker. Public enemy-status checks run locally and submit only sanitized member status data. Live war rosters, retals, attack-ID deduplication, and collector leases are held by a per-war coordinator; only ten-minute loss, escape, and observed-online counters are retained in D1.';

function log(level, message, data = {}) {
  const payload = { level, message, at:new Date().toISOString(), ...data };
  if (level === 'error') console.error(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    'X-SLINK-War-Version': WORKER_VERSION
  };
}

function json(data, status = 200) {
  return Response.json(data, { status, headers:corsHeaders() });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

async function readJson(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('Request body is too large.');
  return text ? JSON.parse(text) : {};
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function validWarId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9:_-]{3,120}$/.test(id) ? id : '';
}

function sessionView(session) {
  return {
    userId:Number(session.user_id),
    factionId:Number(session.faction_id),
    sessionId:String(session.session_id),
    factionCapable:hasScope(session, FACTION_SCOPE),
    admin:hasScope(session, ADMIN_SCOPE),
    canViewLogs:hasScope(session, LOG_SCOPE) || hasScope(session, ADMIN_SCOPE)
  };
}

export class WarCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clients (
          session_id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          faction_capable INTEGER NOT NULL,
          joined_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_clients_active ON clients(last_seen_at DESC);
        CREATE TABLE IF NOT EXISTS status_snapshots (
          faction_id INTEGER PRIMARY KEY,
          observed_at INTEGER NOT NULL,
          source_session_id TEXT NOT NULL,
          members_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS processed_attacks (
          attack_id TEXT PRIMARY KEY,
          ended_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_processed_attacks_expiry ON processed_attacks(expires_at);
        CREATE TABLE IF NOT EXISTS retals (
          attack_id TEXT PRIMARY KEY,
          attacker_id INTEGER NOT NULL,
          incoming_ended INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          against_war_opponent INTEGER NOT NULL,
          resolved_at INTEGER,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_retals_active ON retals(expires_at, resolved_at);
        CREATE TABLE IF NOT EXISTS pending_aggregates (
          aggregate_key TEXT PRIMARY KEY,
          bucket_start INTEGER NOT NULL,
          attacker_id INTEGER NOT NULL,
          attacker_name TEXT NOT NULL,
          defender_id INTEGER NOT NULL,
          defender_name TEXT NOT NULL,
          outcome TEXT NOT NULL,
          observed_status TEXT NOT NULL,
          event_count INTEGER NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL
        );
      `);
    });
  }

  metadata() {
    return Object.fromEntries(
      this.ctx.storage.sql.exec('SELECT key, value FROM metadata').toArray()
        .map(row => [String(row.key), String(row.value)])
    );
  }

  initialize(warId, ownFactionId, opponentFactionId) {
    const id = validWarId(warId);
    const own = positiveInteger(ownFactionId);
    const opponent = positiveInteger(opponentFactionId);
    if (!id || !own || !opponent || own === opponent) throw new Error('A valid active war is required.');
    const current = this.metadata();
    if (current.war_id && current.war_id !== id) throw new Error('War coordinator identity does not match.');
    if (current.own_faction_id && Number(current.own_faction_id) !== own) throw new Error('War faction does not match this coordinator.');
    if (current.opponent_faction_id && Number(current.opponent_faction_id) !== opponent) throw new Error('War opponent does not match this coordinator.');
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO metadata(key, value) VALUES
        ('war_id', ?), ('own_faction_id', ?), ('opponent_faction_id', ?), ('created_at', ?)`,
      id, String(own), String(opponent), String(Date.now())
    );
    return { warId:id, ownFactionId:own, opponentFactionId:opponent };
  }

  collectors(now = Date.now()) {
    const clients = this.ctx.storage.sql.exec(
      'SELECT session_id, user_id, faction_capable, joined_at, last_seen_at FROM clients WHERE last_seen_at >= ?',
      now - CLIENT_ACTIVE_MS
    ).toArray().map(row => ({
      sessionId:String(row.session_id),
      userId:Number(row.user_id),
      factionCapable:Boolean(row.faction_capable),
      joinedAt:Number(row.joined_at),
      lastSeenAt:Number(row.last_seen_at)
    }));
    return chooseCollectors(clients, now);
  }

  async heartbeat(session, input) {
    const state = this.initialize(input?.warId, session.factionId, input?.opponentFactionId);
    const now = Date.now();
    this.ctx.storage.sql.exec('DELETE FROM clients WHERE last_seen_at < ?', now - CLIENT_RETENTION_MS);
    this.ctx.storage.sql.exec(`
      INSERT INTO clients(session_id, user_id, faction_capable, joined_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        faction_capable = excluded.faction_capable,
        last_seen_at = excluded.last_seen_at
    `, session.sessionId, session.userId, session.factionCapable ? 1 : 0, now, now);
    const selected = this.collectors(now);
    return {
      ...state,
      serverTime:now,
      collectStatus:selected.publicSessionId === session.sessionId,
      collectAttacks:selected.factionSessionId === session.sessionId,
      statusCollectorAvailable:Boolean(selected.publicSessionId),
      attackCollectorAvailable:Boolean(selected.factionSessionId)
    };
  }

  async submitStatus(session, input) {
    const state = this.initialize(input?.warId, session.factionId, input?.opponentFactionId);
    const selected = this.collectors();
    if (selected.publicSessionId !== session.sessionId && !session.admin) throw new Error('This session is not the elected status collector.');
    const members = sanitizeMembers(input?.members);
    if (!members.length) throw new Error('A non-empty faction member snapshot is required.');
    const observedAt = Math.min(Date.now(), Math.max(Date.now() - 120_000, Number(input?.observedAt) || Date.now()));
    this.ctx.storage.sql.exec(`
      INSERT INTO status_snapshots(faction_id, observed_at, source_session_id, members_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(faction_id) DO UPDATE SET
        observed_at = excluded.observed_at,
        source_session_id = excluded.source_session_id,
        members_json = excluded.members_json
      WHERE excluded.observed_at >= status_snapshots.observed_at
    `, state.opponentFactionId, observedAt, session.sessionId, JSON.stringify(members));
    return { ok:true, accepted:members.length, observedAt };
  }

  statusMap(opponentFactionId) {
    const row = this.ctx.storage.sql.exec(
      'SELECT observed_at, members_json FROM status_snapshots WHERE faction_id = ?',
      opponentFactionId
    ).toArray()[0];
    if (!row) return { observedAt:0, members:[], byId:new Map() };
    let members = [];
    try { members = sanitizeMembers(JSON.parse(String(row.members_json || '[]'))); } catch { members = []; }
    return { observedAt:Number(row.observed_at) || 0, members, byId:new Map(members.map(member => [member.id, member])) };
  }

  addAggregate(event) {
    const bucket = bucketStart(event.ended * 1000);
    const key = `${bucket}:${event.attackerId}:${event.defenderId}:${event.outcome}`;
    const seenAt = event.ended * 1000;
    this.ctx.storage.sql.exec(`
      INSERT INTO pending_aggregates(
        aggregate_key, bucket_start, attacker_id, attacker_name, defender_id,
        defender_name, outcome, observed_status, event_count, first_seen_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(aggregate_key) DO UPDATE SET
        attacker_name = CASE WHEN excluded.attacker_name <> '' THEN excluded.attacker_name ELSE pending_aggregates.attacker_name END,
        defender_name = CASE WHEN excluded.defender_name <> '' THEN excluded.defender_name ELSE pending_aggregates.defender_name END,
        observed_status = CASE WHEN excluded.observed_status <> '' THEN excluded.observed_status ELSE pending_aggregates.observed_status END,
        event_count = pending_aggregates.event_count + 1,
        first_seen_at = CASE WHEN pending_aggregates.first_seen_at = 0 THEN excluded.first_seen_at ELSE MIN(pending_aggregates.first_seen_at, excluded.first_seen_at) END,
        last_seen_at = MAX(pending_aggregates.last_seen_at, excluded.last_seen_at)
    `, key, bucket, event.attackerId, event.attackerName, event.defenderId, event.defenderName, event.outcome, event.observedStatus || '', seenAt, seenAt);
  }

  async submitAttacks(session, input) {
    if (!session.factionCapable && !session.admin) throw new Error('Faction API capability is required to submit attacks.');
    const state = this.initialize(input?.warId, session.factionId, input?.opponentFactionId);
    const selected = this.collectors();
    if (selected.factionSessionId !== session.sessionId && !session.admin) throw new Error('This session is not the elected faction attack collector.');
    const attacks = Array.isArray(input?.attacks) ? input.attacks.slice(0, 100) : [];
    const status = this.statusMap(state.opponentFactionId);
    const nowSeconds = Math.floor(Date.now() / 1000);
    let accepted = 0;
    let retals = 0;
    let aggregates = 0;
    for (const attack of attacks) {
      const id = attackId(attack);
      const ended = attackEnded(attack);
      if (!id || !ended) continue;
      const existing = this.ctx.storage.sql.exec('SELECT 1 AS found FROM processed_attacks WHERE attack_id = ?', id).toArray()[0];
      if (existing) continue;
      this.ctx.storage.sql.exec(
        'INSERT INTO processed_attacks(attack_id, ended_at, expires_at) VALUES (?, ?, ?)',
        id, ended, Math.max(nowSeconds + 3600, ended + ATTACK_RETENTION_SECONDS)
      );
      accepted += 1;

      if (
        factionId(attack?.attacker) === state.ownFactionId &&
        isSuccessfulAttack(attack)
      ) {
        const targetId = playerId(attack?.defender);
        if (targetId) {
          this.ctx.storage.sql.exec(
            'UPDATE retals SET resolved_at = ? WHERE attacker_id = ? AND resolved_at IS NULL AND incoming_ended < ?',
            ended, targetId, ended
          );
        }
      }

      const event = classifyAttack(attack, state, status.byId);
      if (!event) continue;
      if (event.kind === 'retal' && event.expiresAt > nowSeconds) {
        this.ctx.storage.sql.exec(`
          INSERT OR IGNORE INTO retals(
            attack_id, attacker_id, incoming_ended, expires_at,
            against_war_opponent, resolved_at, payload_json
          ) VALUES (?, ?, ?, ?, ?, NULL, ?)
        `, event.attackId, event.attackerId, event.ended, event.expiresAt, event.againstWarOpponent ? 1 : 0, JSON.stringify(event));
        retals += 1;
      } else if (event.kind === 'aggregate') {
        this.addAggregate(event);
        aggregates += 1;
      }
    }

    this.ctx.storage.sql.exec('DELETE FROM processed_attacks WHERE expires_at <= ?', nowSeconds);
    this.ctx.storage.sql.exec('DELETE FROM retals WHERE expires_at <= ? OR resolved_at IS NOT NULL', nowSeconds);
    if (aggregates) {
      const alarm = await this.ctx.storage.getAlarm();
      if (alarm === null) await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
    }
    return { ok:true, accepted, retals, aggregates, statusObservedAt:status.observedAt };
  }

  async snapshot(session, options = {}) {
    const state = this.initialize(options?.warId, session.factionId, options?.opponentFactionId);
    const nowSeconds = Math.floor(Date.now() / 1000);
    this.ctx.storage.sql.exec('DELETE FROM retals WHERE expires_at <= ? OR resolved_at IS NOT NULL', nowSeconds);
    const status = this.statusMap(state.opponentFactionId);
    const mode = options?.mode === 'termed' ? 'termed' : 'war';
    const retalRows = this.ctx.storage.sql.exec(`
      SELECT payload_json, against_war_opponent
      FROM retals
      WHERE expires_at > ? AND resolved_at IS NULL
      ORDER BY incoming_ended DESC
    `, nowSeconds).toArray();
    const retals = [];
    for (const row of retalRows) {
      if (mode === 'termed' && !session.factionCapable && Boolean(row.against_war_opponent)) continue;
      try { retals.push(JSON.parse(String(row.payload_json))); } catch { /* Ignore corrupt transient rows. */ }
    }
    const collectors = this.collectors();
    return {
      ok:true,
      version:WORKER_VERSION,
      ...state,
      mode,
      observedAt:status.observedAt,
      members:filterMembers(status.members, { mode, idleMinutes:options?.idleMinutes }),
      retals,
      pendingLogs:session.canViewLogs ? this.pendingLogs(200) : [],
      collectors:{
        status:Boolean(collectors.publicSessionId),
        attacks:Boolean(collectors.factionSessionId)
      },
      serverTime:Date.now()
    };
  }

  pendingLogs(limit = 200) {
    return this.ctx.storage.sql.exec(`
      SELECT bucket_start, attacker_id, attacker_name, defender_id, defender_name,
             outcome, observed_status, event_count, first_seen_at, last_seen_at
      FROM pending_aggregates
      WHERE event_count > 0
      ORDER BY bucket_start DESC, outcome ASC
      LIMIT ?
    `, Math.max(1, Math.min(500, Number(limit) || 200))).toArray();
  }

  async alarm() {
    const meta = this.metadata();
    const rows = this.pendingLogs(500);
    if (!rows.length) return;
    const captured = rows.map(row => ({ ...row }));
    for (const row of captured) {
      const key = `${row.bucket_start}:${row.attacker_id}:${row.defender_id}:${row.outcome}`;
      this.ctx.storage.sql.exec(
        'UPDATE pending_aggregates SET event_count = 0, first_seen_at = 0, last_seen_at = 0 WHERE aggregate_key = ?',
        key
      );
    }
    try {
      const now = Date.now();
      const statements = captured.map(row => this.env.PERMISSIONS_DB.prepare(`
        INSERT INTO war_event_aggregates(
          war_id, bucket_start, war_date, own_faction_id, opponent_faction_id,
          attacker_id, attacker_name, defender_id, defender_name, outcome,
          observed_status, event_count, first_seen_at, last_seen_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(war_id, bucket_start, attacker_id, defender_id, outcome)
        DO UPDATE SET
          attacker_name = CASE WHEN excluded.attacker_name <> '' THEN excluded.attacker_name ELSE war_event_aggregates.attacker_name END,
          defender_name = CASE WHEN excluded.defender_name <> '' THEN excluded.defender_name ELSE war_event_aggregates.defender_name END,
          observed_status = CASE WHEN excluded.observed_status <> '' THEN excluded.observed_status ELSE war_event_aggregates.observed_status END,
          event_count = war_event_aggregates.event_count + excluded.event_count,
          first_seen_at = MIN(war_event_aggregates.first_seen_at, excluded.first_seen_at),
          last_seen_at = MAX(war_event_aggregates.last_seen_at, excluded.last_seen_at),
          updated_at = excluded.updated_at
      `).bind(
        meta.war_id,
        Number(row.bucket_start),
        new Date(Number(row.bucket_start)).toISOString().slice(0, 10),
        Number(meta.own_faction_id),
        Number(meta.opponent_faction_id),
        Number(row.attacker_id),
        String(row.attacker_name || ''),
        Number(row.defender_id),
        String(row.defender_name || ''),
        String(row.outcome),
        String(row.observed_status || ''),
        Number(row.event_count),
        Number(row.first_seen_at),
        Number(row.last_seen_at),
        now
      ));
      await this.env.PERMISSIONS_DB.batch(statements);
      this.ctx.storage.sql.exec('DELETE FROM pending_aggregates WHERE event_count = 0');
      log('info', 'war aggregates flushed', { warId:meta.war_id, rows:captured.length });
    } catch (error) {
      for (const row of captured) {
        const key = `${row.bucket_start}:${row.attacker_id}:${row.defender_id}:${row.outcome}`;
        this.ctx.storage.sql.exec(`
          UPDATE pending_aggregates SET
            event_count = event_count + ?,
            first_seen_at = CASE WHEN first_seen_at = 0 THEN ? ELSE MIN(first_seen_at, ?) END,
            last_seen_at = MAX(last_seen_at, ?)
          WHERE aggregate_key = ?
        `, Number(row.event_count), Number(row.first_seen_at), Number(row.first_seen_at), Number(row.last_seen_at), key);
      }
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      log('error', 'war aggregate flush failed', { warId:meta.war_id, error:errorMessage(error) });
      throw error;
    }
    if (this.pendingLogs(1).length) await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
  }
}

async function loadPermissions(env, userId, factionId, now) {
  const result = await env.PERMISSIONS_DB.prepare(`
    SELECT scope, expires_at FROM user_scope_grants
    WHERE user_id = ?1 AND status = 'active' AND starts_at <= ?3
      AND (expires_at IS NULL OR expires_at > ?3)
    UNION ALL
    SELECT scope, expires_at FROM faction_scope_grants
    WHERE faction_id = ?2 AND status = 'active' AND starts_at <= ?3
      AND (expires_at IS NULL OR expires_at > ?3)
    ORDER BY scope ASC
  `).bind(userId, factionId, now).all();
  const expirations = new Map();
  for (const row of result.results || []) {
    const scope = String(row?.scope || '').trim();
    if (!scope) continue;
    if (scopeMatches(scope, ADMIN_SCOPE) && userId !== SOLE_ADMIN_USER_ID) continue;
    const expiration = row.expires_at === null || row.expires_at === undefined ? null : Number(row.expires_at);
    const previous = expirations.get(scope);
    if (!expirations.has(scope)) expirations.set(scope, expiration);
    else if (previous === null || expiration === null) expirations.set(scope, null);
    else expirations.set(scope, Math.max(previous, expiration));
  }
  const scopes = [...expirations.keys()].sort();
  const finiteExpirations = [...expirations.values()].filter(Number.isFinite);
  const expiresAt = finiteExpirations.length ? Math.min(...finiteExpirations) : null;
  return { scopes, roles:scopes.includes(ADMIN_SCOPE) ? ['admin'] : ['member'], expiresAt:Number.isFinite(expiresAt) ? expiresAt : null };
}

async function validateTornKey(apiKey) {
  const headers = { Authorization:`ApiKey ${apiKey}`, Accept:'application/json', 'User-Agent':'SLINK-War-Service' };
  const keyResponse = await fetch('https://api.torn.com/v2/key/info', { headers });
  const keyData = await keyResponse.json().catch(() => null);
  if (!keyResponse.ok || keyData?.error) throw new Error('Torn API key could not be validated.');
  const userId = positiveInteger(keyData?.info?.user?.id);
  const factionIdValue = Number(keyData?.info?.user?.faction_id || 0);
  if (!userId || !Number.isInteger(factionIdValue) || factionIdValue < 0) throw new Error('Torn returned an invalid identity.');
  let factionCapable = false;
  if (factionIdValue > 0) {
    try {
      const probe = await fetch('https://api.torn.com/v2/faction/attacks?limit=1&sort=desc', { headers });
      const data = await probe.json().catch(() => null);
      factionCapable = probe.ok && !data?.error;
    } catch {
      factionCapable = false;
    }
  }
  return { userId, factionId:factionIdValue, factionCapable };
}

async function handleAuth(request, env) {
  if (!env.SESSION_SECRET) return json({ ok:false, error:'Session authentication is not configured.' }, 500);
  if (!env.PERMISSIONS_DB) return json({ ok:false, error:'Permission storage is not configured.' }, 500);
  let body;
  try { body = await readJson(request); } catch (error) { return json({ ok:false, error:errorMessage(error) }, 400); }
  if (body?.terms_accepted !== true || body?.terms_version !== TERMS_VERSION || body?.terms_sha256 !== TERMS_SHA256) {
    return json({ ok:false, error:'You must accept the current SLINK API & Data Terms.', terms_required:true, terms_version:TERMS_VERSION, terms_sha256:TERMS_SHA256, terms_url:TERMS_URL }, 428);
  }
  const apiKey = String(body?.api_key || '').trim();
  if (!apiKey) return json({ ok:false, error:'Torn API key is required.' }, 400);
  try {
    const identity = await validateTornKey(apiKey);
    const acceptedAt = Date.now();
    const permissions = await loadPermissions(env, identity.userId, identity.factionId, acceptedAt);
    if (!permissions.scopes.some(scope => scopeMatches(scope, WAR_SCOPE))) return json({ ok:false, error:`Your SLINK account does not have ${WAR_SCOPE} permission.`, required_scope:WAR_SCOPE }, 403);
    const scopes = [...permissions.scopes];
    if (identity.factionCapable && !scopes.includes(FACTION_SCOPE)) scopes.push(FACTION_SCOPE);
    scopes.sort();
    await env.PERMISSIONS_DB.prepare(`
      INSERT INTO war_terms_acceptances(user_id, terms_version, terms_sha256, accepted_at, faction_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, terms_version, terms_sha256) DO UPDATE SET
        accepted_at = excluded.accepted_at,
        faction_id = excluded.faction_id
    `).bind(identity.userId, TERMS_VERSION, TERMS_SHA256, acceptedAt, identity.factionId).run();
    const iat = Math.floor(acceptedAt / 1000);
    const grantExp = permissions.expiresAt === null ? Number.POSITIVE_INFINITY : Math.floor(permissions.expiresAt / 1000);
    const exp = Math.min(iat + SESSION_LIFETIME_SECONDS, grantExp);
    if (!Number.isFinite(exp) || exp <= iat) return json({ ok:false, error:`Your ${WAR_SCOPE} grant has expired.` }, 403);
    const payload = {
      user_id:identity.userId,
      faction_id:identity.factionId,
      session_id:crypto.randomUUID(),
      terms_version:TERMS_VERSION,
      roles:permissions.roles,
      scopes,
      iat,
      exp
    };
    return json({ ok:true, authenticated:true, ...payload, expires_at:new Date(exp * 1000).toISOString(), session_token:await createToken(payload, env.SESSION_SECRET) });
  } catch (error) {
    return json({ ok:false, error:errorMessage(error) }, /could not be validated|invalid identity/i.test(errorMessage(error)) ? 401 : 500);
  }
}

async function importSessionKey(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(String(secret)), { name:'HMAC', hash:'SHA-256' }, false, usages);
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function createToken(payload, secret) {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await importSessionKey(secret, ['sign']), encoder.encode(body));
  return `${body}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyToken(token, secret) {
  const [body, encodedSignature, extra] = String(token || '').split('.');
  if (!body || !encodedSignature || extra) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await importSessionKey(secret, ['verify']), base64UrlDecode(encodedSignature), encoder.encode(body));
    if (!valid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(body)));
    const now = Math.floor(Date.now() / 1000);
    if (
      !positiveInteger(payload.user_id) ||
      !Number.isInteger(payload.faction_id) || payload.faction_id < 0 ||
      typeof payload.session_id !== 'string' || !payload.session_id ||
      payload.terms_version !== TERMS_VERSION ||
      !Array.isArray(payload.scopes) || !payload.scopes.every(scope => typeof scope === 'string') ||
      !Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) ||
      payload.iat > now || payload.exp <= now || payload.exp - payload.iat > SESSION_LIFETIME_SECONDS
    ) return null;
    return payload;
  } catch { return null; }
}

async function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || !env.SESSION_SECRET) return null;
  const session = await verifyToken(header.slice(7).trim(), env.SESSION_SECRET);
  return session && hasScope(session, WAR_SCOPE) ? session : null;
}

function coordinator(env, warId) {
  return env.WAR_COORDINATOR.getByName(warId);
}

async function logsResponse(env, stub, warId, limit, includeStored = true) {
  const capped = Math.max(1, Math.min(500, Number(limit) || 200));
  const [storedResult, pending] = await Promise.all([
    includeStored
      ? env.PERMISSIONS_DB.prepare(`
          SELECT bucket_start, war_date, attacker_id, attacker_name, defender_id,
                 defender_name, outcome, observed_status, event_count,
                 first_seen_at, last_seen_at
          FROM war_event_aggregates
          WHERE war_id = ?
          ORDER BY bucket_start DESC, outcome ASC
          LIMIT ?
        `).bind(warId, capped).all().then(result => ({ result, error:null })).catch(error => ({ result:{ results:[] }, error }))
      : Promise.resolve({ result:{ results:[] }, error:null }),
    stub.pendingLogs(capped)
  ]);
  if (storedResult.error) log('warn', 'historical War logs unavailable', { warId, error:errorMessage(storedResult.error) });
  return json({
    ok:true,
    warId,
    stored:storedResult.result.results || [],
    pending,
    storedIncluded:includeStored,
    storedAvailable:!storedResult.error,
    storageWarning:storedResult.error ? 'Historical War log storage is unavailable. Live targets and retals remain available.' : ''
  });
}

function adminAllowed(session) {
  return Number(session?.user_id) === SOLE_ADMIN_USER_ID && hasScope(session, ADMIN_SCOPE);
}

async function adminPermissionsResponse(env, userId) {
  const result = await env.PERMISSIONS_DB.prepare(`
    SELECT scope, source, status, starts_at, expires_at, granted_by, note, created_at, updated_at
    FROM user_scope_grants
    WHERE user_id = ?
    ORDER BY scope ASC
  `).bind(userId).all();
  const direct = result.results || [];
  const byScope = new Map(direct.map(row => [String(row.scope), row]));
  const now = Date.now();
  return json({
    ok:true,
    user_id:userId,
    scopes:ASSIGNABLE_SCOPES.map(definition => {
      const row = byScope.get(definition.scope) || null;
      const active = Boolean(row && row.status === 'active' && Number(row.starts_at) <= now && (row.expires_at === null || Number(row.expires_at) > now));
      return {
        ...definition,
        active,
        source:row?.source || null,
        starts_at:row ? Number(row.starts_at) : null,
        expires_at:row?.expires_at === null || row?.expires_at === undefined ? null : Number(row.expires_at),
        status:row?.status || 'not_granted',
        note:row?.note || ''
      };
    })
  });
}

async function updateAdminPermissions(env, session, userId, request) {
  let body;
  try { body = await readJson(request); } catch (error) { return json({ ok:false, error:errorMessage(error) }, 400); }
  const selected = new Set(Array.isArray(body?.scopes) ? body.scopes.map(value => String(value)) : []);
  const allowed = new Set(ASSIGNABLE_SCOPES.map(entry => entry.scope));
  if ([...selected].some(scope => !allowed.has(scope))) return json({ ok:false, error:'One or more requested scopes cannot be assigned.' }, 400);
  const hours = Number(body?.hours);
  if (!Number.isFinite(hours) || hours < 1 || hours > 8760) return json({ ok:false, error:'Grant duration must be between 1 and 8760 hours.' }, 400);
  const now = Date.now();
  const expiresAt = now + Math.round(hours * 60 * 60 * 1000);
  const note = String(body?.note || 'Assigned from the SLINK administrator dashboard').trim().slice(0, 500);
  const statements = [];
  for (const definition of ASSIGNABLE_SCOPES) {
    if (selected.has(definition.scope)) {
      statements.push(env.PERMISSIONS_DB.prepare(`
        INSERT INTO user_scope_grants(
          user_id, scope, source, status, starts_at, expires_at, granted_by,
          external_reference, note, created_at, updated_at
        ) VALUES (?, ?, 'manual_admin', 'active', ?, ?, ?, NULL, ?, ?, ?)
        ON CONFLICT(user_id, scope) DO UPDATE SET
          source = 'manual_admin', status = 'active', starts_at = excluded.starts_at,
          expires_at = excluded.expires_at, granted_by = excluded.granted_by,
          note = excluded.note, updated_at = excluded.updated_at
      `).bind(userId, definition.scope, now, expiresAt, Number(session.user_id), note, now, now));
    } else {
      statements.push(env.PERMISSIONS_DB.prepare(`
        UPDATE user_scope_grants
        SET status = 'revoked', granted_by = ?, note = ?, updated_at = ?
        WHERE user_id = ? AND scope = ? AND status = 'active'
      `).bind(Number(session.user_id), note || 'Revoked from the SLINK administrator dashboard', now, userId, definition.scope));
    }
  }
  await env.PERMISSIONS_DB.batch(statements);
  return adminPermissionsResponse(env, userId);
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsHeaders() });
  if (request.method === 'GET' && url.pathname === '/api/health') {
    let database = 'not configured';
    try {
      if (env.PERMISSIONS_DB) { await env.PERMISSIONS_DB.prepare('SELECT 1 AS ok').first(); database = 'connected'; }
    } catch { database = 'error'; }
    return json({ ok:true, version:WORKER_VERSION, database, coordinator:env.WAR_COORDINATOR ? 'configured' : 'not configured', session_secret:env.SESSION_SECRET ? 'configured' : 'not configured' });
  }
  if (request.method === 'GET' && url.pathname === '/api/terms') {
    return json({ ok:true, version:WORKER_VERSION, terms:{ version:TERMS_VERSION, sha256:TERMS_SHA256, url:TERMS_URL, summary:WAR_TERMS_SUMMARY } });
  }
  if (request.method === 'POST' && url.pathname === '/api/auth') return handleAuth(request, env);
  const session = await authorized(request, env);
  if (!session) return json({ ok:false, error:'A valid SLINK War session is required.' }, 401);
  if (request.method === 'GET' && url.pathname === '/api/session') {
    return json({ ok:true, user_id:session.user_id, faction_id:session.faction_id, session_id:session.session_id, roles:session.roles, scopes:session.scopes, expires_at:new Date(session.exp * 1000).toISOString() });
  }
  if (url.pathname === '/api/admin/scopes') {
    if (!adminAllowed(session)) return json({ ok:false, error:'admin.* permission is required.' }, 403);
    if (request.method !== 'GET') return json({ ok:false, error:'Method not allowed.' }, 405);
    return json({ ok:true, scopes:ASSIGNABLE_SCOPES });
  }
  const adminUserMatch = url.pathname.match(/^\/api\/admin\/users\/(\d+)\/permissions$/);
  if (adminUserMatch) {
    if (!adminAllowed(session)) return json({ ok:false, error:'admin.* permission is required.' }, 403);
    const userId = positiveInteger(adminUserMatch[1]);
    if (!userId) return json({ ok:false, error:'A valid Torn user ID is required.' }, 400);
    if (request.method === 'GET') return adminPermissionsResponse(env, userId);
    if (request.method === 'POST') return updateAdminPermissions(env, session, userId, request);
    return json({ ok:false, error:'Method not allowed.' }, 405);
  }
  const match = url.pathname.match(/^\/api\/wars\/([^/]+)\/(heartbeat|status|attacks|snapshot|logs)$/);
  if (!match) return json({ ok:false, error:'Route not found.' }, 404);
  const warId = validWarId(decodeURIComponent(match[1]));
  if (!warId) return json({ ok:false, error:'Invalid war ID.' }, 400);
  const action = match[2];
  const stub = coordinator(env, warId);
  const view = sessionView(session);
  if (action === 'logs' && request.method === 'GET') {
    if (!view.canViewLogs) return json({ ok:false, error:`${LOG_SCOPE} permission is required to view War logs.`, required_scope:LOG_SCOPE }, 403);
    return logsResponse(env, stub, warId, url.searchParams.get('limit'), url.searchParams.get('include_stored') !== '0');
  }
  if (action === 'snapshot' && request.method === 'GET') {
    const result = await stub.snapshot(view, {
      warId,
      opponentFactionId:positiveInteger(url.searchParams.get('opponent_faction_id')),
      mode:url.searchParams.get('mode'),
      idleMinutes:Number(url.searchParams.get('idle_minutes')) || 5
    });
    return json(result);
  }
  if (request.method !== 'POST') return json({ ok:false, error:'Method not allowed.' }, 405);
  let body;
  try { body = await readJson(request); } catch (error) { return json({ ok:false, error:errorMessage(error) }, 400); }
  body.warId = warId;
  body.opponentFactionId = positiveInteger(body.opponent_faction_id ?? body.opponentFactionId);
  if (action === 'heartbeat') return json(await stub.heartbeat(view, body));
  if (action === 'status') return json(await stub.submitStatus(view, body));
  if (action === 'attacks') return json(await stub.submitAttacks(view, body));
  return json({ ok:false, error:'Route not found.' }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      log('error', 'request failed', { path:new URL(request.url).pathname, error:errorMessage(error) });
      return json({ ok:false, error:errorMessage(error) }, 500);
    }
  }
};

export const __test = { createToken, verifyToken, validateTornKey };
