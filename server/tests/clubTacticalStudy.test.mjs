import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClubTacticalStudy, startTacticalStudy, tacticalStudyContext, STUDY_POLICY } from '../game/clubTacticalStudy.mjs';
import { studyRoom, studyRoster } from './fixtures/tacticalStudyData.mjs';

test('cache limitado, isolado de mutacao do consumidor e com TTL', () => {
  const room = studyRoom();
  startTacticalStudy(room, 'uid-owner', { clubId: 'OPP', depth: 'deep' });
  room.clubCareerState.currentDate = '2026-07-12T00:00:00Z';
  const cache = new Map();
  const context = tacticalStudyContext(room, 'uid-owner', 'OPP');
  const build = () => buildClubTacticalStudy(room, context, studyRoster(), 'deep', cache);
  build().dangerousPlayers[0].name = 'changed by consumer';
  assert.notEqual(build().dangerousPlayers[0].name, 'changed by consumer');
  const entry = [...cache.values()][0];
  entry.expiresAt = 0;
  entry.report.opponentName = 'expired cache';
  assert.equal(build().opponentName, 'Clube OPP');
  for (let index = 0; index < STUDY_POLICY.cacheEntries + 5; index++) {
    room.code = 'ROOM-' + index; build();
  }
  assert.equal(cache.size, STUDY_POLICY.cacheEntries);
});

test('clube proprio nao gasta estudo; carreira encerrada nao aceita consulta', () => {
  const room = studyRoom();
  assert.equal(startTacticalStudy(room, 'uid-owner', { clubId: 'VIEW', depth: 'deep' }), false);
  assert.equal(room.tacticalStudyState, undefined);
  const own = buildClubTacticalStudy(room, tacticalStudyContext(room, 'uid-owner', 'VIEW'), studyRoster('VIEW'), 'deep');
  assert.equal(own.knowledge.status, 'known');
  assert.equal(own.probableLineup.length, 11);
  room.careerCompleted = true;
  assert.throws(() => tacticalStudyContext(room, 'uid-owner', 'OPP'), { code: 'STUDY_CAREER_INACTIVE' });
});
