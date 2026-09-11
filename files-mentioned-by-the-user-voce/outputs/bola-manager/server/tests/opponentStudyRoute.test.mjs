import assert from 'node:assert/strict';
import test from 'node:test';
import { studyRoster, studyRoom } from './fixtures/tacticalStudyData.mjs';
import { RoomStore } from '../store/roomStore.mjs';
import { MemoryRoomPersistence, FirestoreRoomPersistence } from '../store/roomPersistence.mjs';
import { createFakeFirestore } from './helpers/fakeFirestore.mjs';
import { startTestServer, jsonRequest } from './testHarness.mjs';
import { roomForViewer } from '../services/roomVisibility.mjs';

const CODE = 'BOLA-STDY';
const NOW = '2026-07-10T00:00:00.000Z';
async function setup(t, { firestore = false } = {}) {
  const database = createFakeFirestore();
  const persistence = firestore ? new FirestoreRoomPersistence(database) : new MemoryRoomPersistence();
  await persistence.create(studyRoom());
  const calls = [];
  let failure = null;
  let roster = null;
  const catalogStore = { forOwner(owner) { calls.push(owner); return { async ensureInitialized() {}, async listPlayers(id) {
    if (failure) throw failure;
    return roster ?? { players: studyRoster(id), count: 11 };
  } }; } };
  const store = new RoomStore({ persistence, catalogStore });
  const { server, url } = await startTestServer({ store, catalogStore });
  t.after(() => server.close());
  const read = (query = '', token = 'owner-token') => jsonRequest(url + '/api/rooms/' + CODE + '/opponent-study' + query, token);
  const start = (body = {}, token = 'owner-token') => jsonRequest(url + '/api/rooms/' + CODE + '/opponent-study', token, {
    method: 'POST', body: { clubId: 'OPP', viewerClubId: 'VIEW', depth: 'deep', ...body },
  });
  const advance = (date) => persistence.mutate(CODE, (room) => { room.clubCareerState.currentDate = date; return room; });
  return { persistence, database, catalogStore, store, read, start, advance, calls,
    setFailure(value) { failure = value; }, setRoster(value) { roster = value; } };
}
test('autenticacao, membership, clube do save e payload verificados antes do catalogo', async (t) => {
  const h = await setup(t);
  assert.equal((await h.read('', null)).status, 401);
  assert.equal((await h.read('', 'intruder-token')).status, 404);
  assert.equal((await h.read('?clubId=OUTSIDE')).status, 404);
  assert.equal((await h.start({ viewerClubId: 'OTHER' })).status, 409);
  assert.equal((await h.start({ managerId: 'uid-second' })).status, 400);
  assert.deepEqual(h.calls, []);
});
test('GET nao inicia estudo; clubId escolhido vence proximo adversario; calendario usa data', async (t) => {
  const h = await setup(t);
  const next = (await (await h.read()).json()).study;
  assert.equal(next.opponentClubId, 'OPP');
  assert.equal(next.fixtureId, 'next');
  const selected = (await (await h.read('?clubId=OTHER&depth=deep')).json()).study;
  assert.equal(selected.opponentClubId, 'OTHER');
  assert.equal(selected.knowledge.status, 'unknown');
  assert.equal(selected.probableFormation, null);
  assert.deepEqual(selected.probableLineup, []);
  assert.deepEqual(selected.weaknesses, []);
  assert.equal((await h.persistence.get(CODE)).tacticalStudyState, undefined);
});
for (const firestore of [false, true]) test('progresso real, retry, reload e segredo: ' + (firestore ? 'firestore' : 'memory'), async (t) => {
  const h = await setup(t, { firestore });
  await Promise.all([h.start(), h.start(), h.start()]);
  const saved = await h.persistence.get(CODE);
  assert.equal(saved.tacticalStudyState.records.length, 1);
  assert.equal(saved.revision, 2);
  const initial = (await (await h.read('?clubId=OPP&depth=deep')).json()).study;
  assert.equal(initial.effectiveDepth, 'none');
  assert.equal(initial.knowledge.progress, 0);
  await h.advance('2026-07-10T05:00:00.000Z');
  const quick = (await (await h.read('?clubId=OPP&depth=deep')).json()).study;
  assert.equal(quick.effectiveDepth, 'quick');
  assert.equal(quick.probableFormation, null);
  assert.equal(quick.dangerousPlayers.length, 1);
  assert.deepEqual(quick.sectors, []);
  await h.advance('2026-07-12T00:00:00.000Z');
  const reloaded = new RoomStore({ persistence: firestore ? new FirestoreRoomPersistence(h.database) : h.persistence, catalogStore: h.catalogStore });
  const deep = await reloaded.getOpponentStudy(CODE, 'uid-owner', { clubId: 'OPP', depth: 'deep' });
  assert.equal(deep.effectiveDepth, 'deep');
  assert.equal(deep.scoutLevel, 5);
  assert.equal(deep.probableFormation, '4-4-2', 'estimativa vem do elenco, nao de formacao fixa');
  assert.equal(deep.source, 'estimated');
  assert.equal(deep.probableLineup.length, 11);
  assert.ok(deep.probableLineup.every((player) => player.id.startsWith('OPP-')));
  assert.doesNotMatch(JSON.stringify(deep), /5-4-1|SECRET_NEVER_EXPOSE|aggressive|very-fast|salary|wage|evidence/);
  const other = (await (await h.read('?clubId=OPP&depth=deep', 'second-token')).json()).study;
  assert.equal(other.effectiveDepth, 'none');
  assert.equal(roomForViewer(await h.persistence.get(CODE), 'uid-second').tacticalStudyState, undefined);
  assert.equal((await h.store.requireViewerRoom(CODE, 'uid-owner')).tacticalStudyState, undefined);
});
test('cache invalida ao mudar segredo, elenco, olheiro, conhecimento e temporada', async (t) => {
  const h = await setup(t);
  await h.start(); await h.advance('2026-07-12T00:00:00.000Z');
  const query = '?clubId=OPP&depth=deep';
  const first = (await (await h.read(query)).json()).study;
  assert.deepEqual((await (await h.read(query)).json()).study, first);
  await h.persistence.mutate(CODE, (room) => { room.lineups[0].tactics.secret = false; return room; });
  assert.equal((await (await h.read(query)).json()).study.probableFormation, '5-4-1');
  await h.persistence.mutate(CODE, (room) => { room.lineups[0].tactics.secret = true; return room; });
  assert.equal((await (await h.read(query)).json()).study.probableFormation, '4-4-2');
  h.setRoster({ players: studyRoster().map((player) => ({ ...player, name: 'Nome atualizado ' + player.id })), count: 11 });
  assert.match((await (await h.read(query)).json()).study.dangerousPlayers[0].name, /Nome atualizado/);
  await h.persistence.mutate(CODE, (room) => { room.clubCareerState.staffContracts[0].status = 'terminated'; return room; });
  const withoutStaff = (await (await h.read(query)).json()).study;
  assert.equal(withoutStaff.scoutLevel, 0);
  assert.equal(withoutStaff.effectiveDepth, 'quick');
  assert.deepEqual(withoutStaff.probableLineup, []);
  await h.persistence.mutate(CODE, (room) => { room.currentSeason = 2; return room; });
  assert.equal((await (await h.read(query)).json()).study.knowledge.status, 'expired');
});
test('upgrade preserva horas acumuladas; expiracao exige nova observacao; troca de clube nao herda segredo', async (t) => {
  const h = await setup(t);
  await h.start({ depth: 'quick' });
  await h.advance('2026-07-10T05:00:00.000Z');
  await h.start({ depth: 'deep' });
  assert.equal((await h.persistence.get(CODE)).tacticalStudyState.records[0].startedAt, NOW);
  await h.advance('2026-07-25T00:00:00.000Z');
  assert.equal((await (await h.read('?clubId=OPP')).json()).study.knowledge.status, 'expired');
  await h.start();
  assert.equal((await h.persistence.get(CODE)).tacticalStudyState.records[0].startedAt, '2026-07-25T00:00:00.000Z');
  await h.persistence.mutate(CODE, (room) => { room.managers[0].clubId = 'OTHER'; return room; });
  assert.equal((await h.start()).status, 409);
  assert.equal((await (await h.read('?clubId=OPP')).json()).study.knowledge.status, 'unknown');
});
test('falha de escrita reverte; falha de catalogo nao devolve cache antigo nem default', async (t) => {
  const h = await setup(t, { firestore: true });
  h.database.failBeforeCommit();
  assert.equal((await h.start()).status, 500);
  assert.equal((await h.persistence.get(CODE)).tacticalStudyState, undefined);
  await h.start(); await h.advance('2026-07-12T00:00:00.000Z');
  assert.equal((await h.read('?clubId=OPP&depth=deep')).status, 200);
  h.setFailure(Object.assign(new Error('timeout catalogo'), { status: 503 }));
  assert.equal((await h.read('?clubId=OPP&depth=deep')).status, 503);
  h.setFailure(null); h.setRoster({ count: 11 });
  assert.equal((await h.read('?clubId=OPP&depth=deep')).status, 503);
  h.setRoster({ players: [], count: 0 });
  assert.equal((await h.read('?clubId=OPP&depth=deep')).status, 409);
});

test('registro de transferencia e disponibilidade invalidam leitura do elenco', async (t) => {
  const h = await setup(t);
  await h.start(); await h.advance('2026-07-12T00:00:00.000Z');
  const query = '?clubId=OPP&depth=deep';
  assert.equal((await (await h.read(query)).json()).study.probableLineup.length, 11);
  await h.persistence.mutate(CODE, (room) => {
    room.marketState = { registrations: [{ playerId: 'OPP-10', currentClubId: 'OTHER' }] }; return room;
  });
  const partial = (await (await h.read(query)).json()).study;
  assert.equal(partial.dataStatus, 'partial');
  assert.ok(partial.confidence <= 50);
  assert.equal(partial.probableLineup.some((player) => player.id === 'OPP-10'), false);
  await h.persistence.mutate(CODE, (room) => {
    room.marketState.registrations.push({ playerId: 'incoming', currentClubId: 'OPP', playerSnapshot: {
      ...studyRoster()[10], id: 'incoming', name: 'Contratado real', clubId: 'OTHER',
    } }); return room;
  });
  assert.ok((await (await h.read(query)).json()).study.probableLineup.some((player) => player.id === 'incoming'));
  await h.persistence.mutate(CODE, (room) => { delete room.marketState.registrations[1].playerSnapshot; return room; });
  assert.equal((await h.read(query)).status, 503, 'contratado sem snapshot exige catalogo, nao desaparece silenciosamente');
  h.setRoster({ players: studyRoster() });
  await h.persistence.mutate(CODE, (room) => {
    room.marketState.registrations = [];
    room.playerStates = studyRoster().map((player) => ({ playerId: player.id, clubId: 'OPP', injuryMatches: 2 }));
    return room;
  });
  assert.equal((await h.read(query)).status, 409);
});

test('escalaçao antiga de outro clube nao revela plano apos troca de treinador', async (t) => {
  const h = await setup(t);
  await h.start(); await h.advance('2026-07-12T00:00:00.000Z');
  await h.persistence.mutate(CODE, (room) => {
    room.managers[1].clubId = 'OPP';
    room.lineups = [{ ...room.lineups[0], clubId: 'OTHER', managerId: 'uid-second',
      tactics: { formationId: '5-4-1', secret: false, mentality: 'attacking' } }];
    return room;
  });
  const study = (await (await h.read('?clubId=OPP&depth=deep')).json()).study;
  assert.equal(study.probableFormation, '4-4-2');
  assert.equal(study.mentality, null);
  await h.persistence.mutate(CODE, (room) => { room.tacticalStudyState.records[0].startedAt = 'invalid'; return room; });
  assert.equal((await h.read('?clubId=OPP')).status, 500);
});
