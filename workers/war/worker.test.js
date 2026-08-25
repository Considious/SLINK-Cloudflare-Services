import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregateKey,
  chooseCollectors,
  classifyAttack,
  filterMembers,
  hasScope,
  LOG_SCOPE,
  sanitizeMembers
} from './worker-core.js';

const directory = path.dirname(fileURLToPath(import.meta.url));

test('publishes the exact current shared terms fingerprint', () => {
  const terms = fs.readFileSync(
    path.resolve(directory, '../../terms/2026-08-23/SLINK_API_Data_Terms_of_Service.md'),
    'utf8'
  ).replace(/\r\n?/g, '\n');
  const fingerprint = crypto.createHash('sha256').update(terms, 'utf8').digest('hex');
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /const TERMS_VERSION = '2026-08-24'/);
  assert.match(worker, new RegExp(fingerprint));
});

test('faction capability never makes a non-admin an admin', () => {
  assert.equal(hasScope({ user_id: 12, scopes:['slink.war.faction', 'admin.*'] }, 'admin.*'), false);
  assert.equal(hasScope({ user_id:3853023, scopes:['admin.*'] }, 'admin.*'), true);
});

test('War logs require their explicit scope or the sole administrator wildcard', () => {
  assert.equal(hasScope({ user_id:12, scopes:['slink.war'] }, LOG_SCOPE), false);
  assert.equal(hasScope({ user_id:12, scopes:[LOG_SCOPE] }, LOG_SCOPE), true);
  assert.equal(hasScope({ user_id:3853023, scopes:['admin.*'] }, 'admin.permissions'), true);
  assert.equal(hasScope({ user_id:12, scopes:['admin.*'] }, 'admin.permissions'), false);
});

test('classifies incoming retals and outgoing review events', () => {
  const context = { ownFactionId:46978, opponentFactionId:99 };
  const incoming = classifyAttack({
    id:1, ended:1000, result:'Hospitalized',
    attacker:{ id:10, faction:{ id:99 } }, defender:{ id:20, faction:{ id:46978 } }
  }, context);
  assert.equal(incoming.kind, 'retal');
  assert.equal(incoming.againstWarOpponent, true);

  const loss = classifyAttack({
    id:2, ended:1001, result:'Lost',
    attacker:{ id:20, faction:{ id:46978 } }, defender:{ id:10, faction:{ id:99 } }
  }, context);
  assert.equal(loss.outcome, 'loss');

  const onlineHit = classifyAttack({
    id:3, ended:1002, result:'Attacked',
    attacker:{ id:20, faction:{ id:46978 } }, defender:{ id:10, faction:{ id:99 } }
  }, context, new Map([[10, { activity:'Online' }]]));
  assert.equal(onlineHit.outcome, 'online_hit');
});

test('sanitizes and filters status snapshots by mode', () => {
  const members = sanitizeMembers([
    { id:1, name:'Online', last_action:{ status:'Online', timestamp:1000 }, status:{ state:'Okay' } },
    { id:2, name:'Old idle', last_action:{ status:'Idle', timestamp:1 }, status:{ state:'Okay' } },
    { id:3, name:'Travel', last_action:{ status:'Offline', timestamp:1 }, status:{ state:'Traveling', description:'Traveling to Mexico' } }
  ]);
  assert.deepEqual(filterMembers(members, { mode:'termed', idleMinutes:5 }, 2000).map(member => member.id), [2]);
  assert.deepEqual(filterMembers(members, { mode:'war' }, 2000).map(member => member.id), [1, 2]);
});

test('prioritizes non-faction status contributors and faction attack collectors', () => {
  const now = Date.now();
  const selected = chooseCollectors([
    { sessionId:'faction', factionCapable:true, joinedAt:1, lastSeenAt:now },
    { sessionId:'public', factionCapable:false, joinedAt:2, lastSeenAt:now }
  ], now);
  assert.equal(selected.publicSessionId, 'public');
  assert.equal(selected.factionSessionId, 'faction');
});

test('aggregate keys share a ten-minute bucket but preserve outcome', () => {
  const first = aggregateKey({ ended:100, attackerId:1, defenderId:2, outcome:'loss' });
  const second = aggregateKey({ ended:101, attackerId:1, defenderId:2, outcome:'loss' });
  const third = aggregateKey({ ended:101, attackerId:1, defenderId:2, outcome:'escape' });
  assert.equal(first, second);
  assert.notEqual(first, third);
});

test('keeps live War responses available when historical D1 log storage is unavailable', () => {
  const worker = fs.readFileSync(path.resolve(directory, 'worker.js'), 'utf8');
  assert.match(worker, /storedAvailable:!storedResult\.error/);
  assert.match(worker, /Historical War log storage is unavailable\. Live targets and retals remain available\./);
});
