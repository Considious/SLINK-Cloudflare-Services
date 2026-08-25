export const WAR_SCOPE = 'slink.war';
export const LOG_SCOPE = 'slink.war.log';
export const FACTION_SCOPE = 'slink.war.faction';
export const ADMIN_SCOPE = 'admin.*';
export const SOLE_ADMIN_USER_ID = 3853023;
export const TEN_MINUTES_MS = 10 * 60 * 1000;
export const RETAL_WINDOW_SECONDS = 5 * 60;

export function scopeMatches(grantedScope, requiredScope) {
  const granted = String(grantedScope || '');
  const required = String(requiredScope || '');
  if (granted === '*' || granted === required) return true;
  return granted.endsWith('.*') && required.startsWith(granted.slice(0, -1));
}

export function hasScope(session, requiredScope) {
  if ((requiredScope === ADMIN_SCOPE || String(requiredScope).startsWith('admin.')) && Number(session?.user_id) !== SOLE_ADMIN_USER_ID) return false;
  return (Array.isArray(session?.scopes) ? session.scopes : [])
    .some(scope => scopeMatches(scope, requiredScope));
}

export function playerId(entity) {
  const value = Number(entity?.id ?? entity?.player_id ?? entity?.user_id ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function factionId(entity) {
  const value = Number(entity?.faction?.id ?? entity?.faction_id ?? 0);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

export function attackId(attack) {
  return String(attack?.id ?? attack?.attack_id ?? '').trim();
}

export function attackEnded(attack) {
  return Number(attack?.ended ?? attack?.ended_at ?? attack?.timestamp_ended ?? attack?.started ?? attack?.started_at ?? 0) || 0;
}

export function attackResult(attack) {
  return String(attack?.result ?? attack?.outcome ?? attack?.attack_result ?? '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isSuccessfulAttack(attack) {
  return ['attacked', 'hospitalized', 'mugged'].includes(attackResult(attack));
}

export function classifyAttack(attack, context, statusById = new Map()) {
  const id = attackId(attack);
  const ended = attackEnded(attack);
  const attacker = playerId(attack?.attacker);
  const defender = playerId(attack?.defender);
  const attackerFaction = factionId(attack?.attacker);
  const defenderFaction = factionId(attack?.defender);
  if (!id || !ended || !attacker || !defender) return null;

  const base = {
    attackId: id,
    ended,
    attackerId: attacker,
    attackerName: String(attack?.attacker?.name || ''),
    defenderId: defender,
    defenderName: String(attack?.defender?.name || ''),
    attackerFactionId: attackerFaction,
    defenderFactionId: defenderFaction,
    opponentFactionId: Number(context.opponentFactionId) || 0
  };

  if (
    defenderFaction === Number(context.ownFactionId) &&
    attackerFaction !== Number(context.ownFactionId) &&
    isSuccessfulAttack(attack)
  ) {
    return {
      ...base,
      kind: 'retal',
      expiresAt: ended + RETAL_WINDOW_SECONDS,
      againstWarOpponent: attackerFaction === Number(context.opponentFactionId)
    };
  }

  if (attackerFaction !== Number(context.ownFactionId) || defenderFaction === Number(context.ownFactionId)) return null;
  const result = attackResult(attack);
  if (result === 'lost' || result === 'loss') return { ...base, kind: 'aggregate', outcome: 'loss', observedStatus: '' };
  if (result === 'escape' || result === 'escaped') return { ...base, kind: 'aggregate', outcome: 'escape', observedStatus: '' };

  if (
    defenderFaction === Number(context.opponentFactionId) &&
    isSuccessfulAttack(attack)
  ) {
    const observed = statusById.get(defender);
    const status = String(observed?.activity || observed?.last_action?.status || '').trim();
    if (status.toLowerCase() === 'online') {
      return { ...base, kind: 'aggregate', outcome: 'online_hit', observedStatus: 'Online' };
    }
  }
  return null;
}

export function sanitizeMember(member) {
  const id = Number(member?.id ?? member?.player_id ?? 0);
  if (!Number.isInteger(id) || id <= 0) return null;
  const lastAction = member?.last_action || member?.lastAction || {};
  const status = member?.status || {};
  return {
    id,
    name: String(member?.name || `Player ${id}`).slice(0, 80),
    level: Math.max(0, Number(member?.level) || 0),
    activity: String(lastAction?.status || member?.activity || 'Unknown').slice(0, 20),
    lastActionTimestamp: Math.max(0, Number(lastAction?.timestamp ?? member?.lastActionTimestamp) || 0),
    lastActionRelative: String(lastAction?.relative ?? member?.lastActionRelative ?? '').slice(0, 80),
    statusState: String(status?.state ?? member?.statusState ?? '').slice(0, 40),
    statusDescription: String(status?.description ?? member?.statusDescription ?? '').slice(0, 180),
    statusUntil: Math.max(0, Number(status?.until ?? member?.statusUntil) || 0),
    position: String(member?.position || '').slice(0, 80)
  };
}

export function sanitizeMembers(values, limit = 250) {
  const input = Array.isArray(values) ? values : [];
  const seen = new Set();
  const result = [];
  for (const value of input) {
    const member = sanitizeMember(value);
    if (!member || seen.has(member.id)) continue;
    seen.add(member.id);
    result.push(member);
    if (result.length >= limit) break;
  }
  return result;
}

export function isAbroad(member) {
  const text = `${member?.statusState || ''} ${member?.statusDescription || ''}`.toLowerCase();
  return /travel|travelling|abroad|returning to|in (mexico|canada|hawaii|cayman|switzerland|argentina|japan|china|uae|south africa|united kingdom)/.test(text);
}

export function filterMembers(members, options = {}, nowSeconds = Math.floor(Date.now() / 1000)) {
  const mode = options.mode === 'termed' ? 'termed' : 'war';
  const idleMinutes = Math.max(0, Number(options.idleMinutes) || 5);
  return sanitizeMembers(members).filter(member => {
    if (mode === 'termed') {
      if (isAbroad(member)) return false;
      if (member.activity === 'Online') return false;
      if (member.activity !== 'Offline') {
        if (member.activity !== 'Idle') return false;
        if (member.lastActionTimestamp && (nowSeconds - member.lastActionTimestamp) / 60 < idleMinutes) return false;
      }
    } else if (isAbroad(member) && !/traveling to torn|returning to torn/i.test(member.statusDescription)) {
      return false;
    }
    return true;
  });
}

export function bucketStart(timestampMs) {
  const value = Math.max(0, Number(timestampMs) || 0);
  return Math.floor(value / TEN_MINUTES_MS) * TEN_MINUTES_MS;
}

export function aggregateKey(event) {
  return [
    bucketStart(Number(event.ended) * 1000),
    Number(event.attackerId) || 0,
    Number(event.defenderId) || 0,
    String(event.outcome || '')
  ].join(':');
}

export function chooseCollectors(clients, now = Date.now()) {
  const active = (Array.isArray(clients) ? clients : [])
    .filter(client => Number(client.lastSeenAt) >= now - 30_000)
    .sort((a, b) => Number(a.joinedAt) - Number(b.joinedAt) || String(a.sessionId).localeCompare(String(b.sessionId)));
  const publicCollector = active.find(client => !client.factionCapable) || active[0] || null;
  const factionCollector = active.find(client => client.factionCapable) || null;
  return {
    publicSessionId: publicCollector?.sessionId || null,
    factionSessionId: factionCollector?.sessionId || null
  };
}
