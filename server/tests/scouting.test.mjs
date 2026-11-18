import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScoutingAction, scoutingSnapshot } from '../game/scouting.mjs';
import { FirestoreRoomPersistence, MemoryRoomPersistence } from '../store/roomPersistence.mjs';
import { RoomStore } from '../store/roomStore.mjs';
import { roomForViewer } from '../services/roomVisibility.mjs';
import { createFakeFirestore } from './helpers/fakeFirestore.mjs';
import { startTestServer } from './testHarness.mjs';

const NOW = '2026-07-10T00:00:00.000Z';
function roomBase(overrides = {}) {
  return { id: 'scouting-room', code: 'BOLA-SCOT', status: 'active', ownerId: 'uid-owner', catalogOwnerId: 'uid-owner',
    managerIds: ['uid-owner', 'uid-second'], managers: [{ id: 'uid-owner', clubId: 'A' }, { id: 'uid-second', clubId: 'B' }],
    revision: 1, currentSeason: 1, seasonYear: 2026, createdAt: NOW, startedAt: NOW,
    competitionCatalog: [{ id: 'L', clubs: [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }] }],
    careerState: { players: [{ id: 'p1', clubId: 'C', name: 'Jogador real', age: 25, overall: 12, potential: 16,
      wage: 45_000, marketValue: 5_000_000, active: true, contract: { wage: 45_000, endsAt: '2028-12-31' } }] },
    ...overrides };
}
const input = (action = 'watch', operationId = action) => ({ playerId: 'p1', clubId: 'A', action, operationId });

for (const backend of ['memory', 'firestore']) {
  test(`${backend}: observar, interesse, contato, recarga e troca de temporada`, async () => {
    const firestore = createFakeFirestore();
    const persistence = backend === 'memory' ? new MemoryRoomPersistence() : new FirestoreRoomPersistence(firestore);
    const room = roomBase();
    await persistence.create(room);
    const store = new RoomStore({ persistence });
    await store.updateScouting(room.code, 'uid-owner', input());
    await store.updateScouting(room.code, 'uid-owner', input('interest'));
    const contact = await store.updateScouting(room.code, 'uid-owner', input('contact-agent'));
    const reply = contact.snapshot.records[0].agentContact;
    assert.equal(reply.currentWage, 45_000);
    assert.equal(reply.marketValue, 5_000_000);
    assert.equal(reply.status, 'conditional');
    const reloaded = new RoomStore({ persistence: backend === 'memory' ? persistence : new FirestoreRoomPersistence(firestore) });
    assert.deepEqual(await reloaded.getScoutingSnapshot(room.code, 'uid-owner'), contact.snapshot);
    assert.equal((await reloaded.getScoutingSnapshot(room.code, 'uid-second')).records.length, 0);
    await persistence.mutate(room.code, (current) => ({ ...current, currentSeason: 2, seasonYear: 2027 }));
    assert.equal((await reloaded.getScoutingSnapshot(room.code, 'uid-owner')).records[0].watching, true);
    await store.updateScouting(room.code, 'uid-owner', input('unwatch'));
    const removed = await store.updateScouting(room.code, 'uid-owner', input('withdraw-interest'));
    assert.equal(removed.snapshot.records[0].watching, false);
    assert.equal(removed.snapshot.records[0].interested, false);
    assert.deepEqual(removed.snapshot.records[0].agentContact, reply);
  });
}

test('idempotencia concorrente, ACK perdido e rollback nao duplicam a acao', async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = roomBase();
  await persistence.create(room);
  const store = new RoomStore({ persistence });
  firestore.failBeforeCommit();
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', input()));
  assert.equal((await store.getScoutingSnapshot(room.code, 'uid-owner')).records.length, 0);
  await Promise.all([store.updateScouting(room.code, 'uid-owner', input()), store.updateScouting(room.code, 'uid-owner', input())]);
  assert.equal((await store.getScoutingSnapshot(room.code, 'uid-owner')).history.length, 1);
  await store.updateScouting(room.code, 'uid-owner', input('unwatch'));
  const retry = await store.updateScouting(room.code, 'uid-owner', input());
  assert.equal(retry.duplicate, true);
  assert.equal(retry.snapshot.records[0].watching, false, 'retry antigo nao desfaz decisao posterior');
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', input('interest', 'watch')), { code: 'SCOUTING_OPERATION_CONFLICT' });
  // A response lost after a confirmed commit is retried with the same intent.
  await store.updateScouting(room.code, 'uid-owner', input('interest', 'lost-response'));
  const lostRetry = await new RoomStore({ persistence: new FirestoreRoomPersistence(firestore) }).updateScouting(room.code, 'uid-owner', input('interest', 'lost-response'));
  assert.equal(lostRetry.duplicate, true);
  assert.equal(lostRetry.snapshot.history.length, 3);
});

test('permissoes, clube alterado, escopo de jogadores e dados privados', async () => {
  const room = roomBase();
  const persistence = new MemoryRoomPersistence([room]);
  const store = new RoomStore({ persistence });
  await assert.rejects(store.updateScouting(room.code, 'intruso', input()), { code: 'ROOM_NOT_FOUND' });
  await assert.rejects(store.updateScouting(room.code, 'uid-second', input()), { code: 'SCOUTING_CLUB_CHANGED' });
  await store.updateScouting(room.code, 'uid-owner', input());
  const visible = roomForViewer(await persistence.get(room.code), 'uid-second');
  assert.equal(visible.scoutingState, undefined);
  assert.equal((await store.requireViewerRoom(room.code, 'uid-owner')).scoutingState, undefined);
  await persistence.mutate(room.code, (current) => { current.managers[0].clubId = 'C'; return current; });
  assert.equal((await store.getScoutingSnapshot(room.code, 'uid-owner')).records.length, 0);
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', input('interest')), { code: 'SCOUTING_CLUB_CHANGED' });
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', { ...input('watch', 'own-player'), clubId: 'C' }), { code: 'SCOUTING_OWN_PLAYER' });
  await persistence.mutate(room.code, (current) => { current.careerState.players[0].clubId = 'outside'; return current; });
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', { ...input('watch', 'outside-player'), clubId: 'C' }), { code: 'SCOUTING_PLAYER_OUT_OF_SCOPE' });
});

test('contato considera agentes livres, fim de contrato, inegociavel e dados ausentes', () => {
  for (const [player, expected] of [
    [{ clubId: null, wage: undefined, marketValue: undefined, contract: null }, 'open'],
    [{ contract: { endsAt: '2026-10-01', wage: 20_000 } }, 'open'],
    [{ negotiability: 'inegociavel' }, 'unavailable'],
    [{ retired: true }, 'unavailable'],
  ]) {
    const room = roomBase();
    Object.assign(room.careerState.players[0], player);
    applyScoutingAction(room, 'uid-owner', input('contact-agent'));
    const contact = scoutingSnapshot(room, 'uid-owner').records[0].agentContact;
    assert.equal(contact.status, expected);
    if (player.clubId === null) { assert.equal(contact.currentWage, null); assert.equal(contact.marketValue, null); }
  }
});

test('contato repetido tem cooldown e segue clube atual apos transferencia', () => {
  const room = roomBase();
  applyScoutingAction(room, 'uid-owner', input('contact-agent'));
  const first = structuredClone(room.scoutingState.records[0].agentContact);
  const repeated = applyScoutingAction(room, 'uid-owner', input('contact-agent', 'contact-2'));
  assert.equal(repeated.changed, false);
  assert.deepEqual(room.scoutingState.records[0].agentContact, first);
  room.marketState = { registrations: [{ playerId: 'p1', currentClubId: 'B', contract: { wage: 60_000 } }] };
  const changed = applyScoutingAction(room, 'uid-owner', input('contact-agent', 'contact-3'));
  assert.equal(changed.changed, true);
  assert.equal(room.scoutingState.records[0].agentContact.playerClubId, 'B');
  assert.equal(room.scoutingState.records[0].agentContact.currentWage, 60_000);
  room.clubCareerState = { currentDate: '2026-07-14T00:00:00.000Z' };
  assert.equal(applyScoutingAction(room, 'uid-owner', input('contact-agent', 'contact-4')).changed, true);
});

test('falha transitoria de catalogo nao grava ausencia como sucesso', async () => {
  const room = roomBase({ careerState: { players: [] } });
  const persistence = new MemoryRoomPersistence([room]);
  const store = new RoomStore({ persistence, catalogStore: { async get() { throw Object.assign(new Error('timeout real'), { code: 'CATALOG_TIMEOUT', status: 503 }); } } });
  await assert.rejects(store.updateScouting(room.code, 'uid-owner', input()), { code: 'CATALOG_TIMEOUT' });
  assert.equal((await persistence.get(room.code)).scoutingState, undefined);
});

test('retry confirmado e remocao dispensam catalogo de jogador que deixou o save', async () => {
  const room = roomBase();
  const persistence = new MemoryRoomPersistence([room]);
  const store = new RoomStore({ persistence, catalogStore: { async get() { throw new Error('Nao deve consultar catalogo'); } } });
  await store.updateScouting(room.code, 'uid-owner', input());
  await persistence.mutate(room.code, (current) => { current.careerState.players = []; return current; });
  assert.equal((await store.updateScouting(room.code, 'uid-owner', input())).duplicate, true);
  const removed = await store.updateScouting(room.code, 'uid-owner', input('unwatch'));
  assert.equal(removed.snapshot.records[0].watching, false);
});

test('API autenticada valida payload, salva e carrega acao sem expor outro clube', async (t) => {
  const persistence = new MemoryRoomPersistence([roomBase()]);
  const harness = await startTestServer({ store: new RoomStore({ persistence }) });
  t.after(() => harness.server.close());
  const url = `${harness.url}/api/scouting/BOLA-SCOT`;
  assert.equal((await fetch(url)).status, 401);
  const post = (body, token = 'owner-token') => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ ...input(), managerId: 'uid-second' })).status, 400);
  assert.equal((await post(input(), 'intruder-token')).status, 404);
  for (const action of ['watch', 'interest', 'contact-agent']) assert.equal((await post(input(action))).status, 200);
  const loaded = await (await fetch(`${url}?playerId=p1`, { headers: { Authorization: 'Bearer owner-token' } })).json();
  assert.equal(loaded.snapshot.records[0].watching, true);
  assert.equal(loaded.snapshot.records[0].interested, true);
  assert.ok(loaded.snapshot.records[0].agentContact);
  const other = await (await fetch(url, { headers: { Authorization: 'Bearer second-token' } })).json();
  assert.deepEqual(other.snapshot.records, []);
});
