import assert from "node:assert/strict";
import test from "node:test";
import {
  createFixtureSchedule,
  createLeagueFixtureSchedule,
  FIXTURE_SCHEDULE_VERSION,
} from "../game/fixtures.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

function clubs(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    id: `C${index + 1}`,
    name: `Clube ${index + 1}`,
    code: `C${index + 1}`,
    color: "#c8ff3d",
    reputation: 10,
    leagueId: "BR-A",
  }));
}

test("requireMembership migra save v4 iniciado sem legs para turno e returno", async () => {
  const leagueClubs = clubs();
  const managers = [{
    id: "manager-1",
    name: "Emanuel",
    clubId: "C1",
    ready: true,
    joinedAt: "2026-01-01T00:00:00.000Z",
  }];
  const singleLeague = {
    id: "BR-A",
    name: "Brasileirao Serie A",
    country: "Brasil",
    division: "Serie A",
    legs: "single",
    clubs: leagueClubs,
  };
  const scheduleSeed = {
    seasonYear: 2026,
    seasonStartedAt: "2026-01-01T00:00:00.000Z",
    managers,
    competitionCatalog: [singleLeague],
  };
  const oldLeagueSchedule = createLeagueFixtureSchedule(scheduleSeed);
  const oldManagedSchedule = createFixtureSchedule(scheduleSeed, oldLeagueSchedule);
  const completedFixtureId = oldManagedSchedule[0].fixtureId;
  const currentFixtureId = oldManagedSchedule[1].fixtureId;
  const currentRound = oldManagedSchedule[1].round;
  const leagueWithoutLegs = structuredClone(singleLeague);
  delete leagueWithoutLegs.legs;

  assert.equal(Math.max(...oldManagedSchedule.map((fixture) => fixture.round)), 3);

  const legacyRoom = {
    id: "legacy-v4-no-legs",
    code: "BOLA-V4LG",
    name: "Save v4 sem turnos",
    ownerId: "manager-1",
    catalogOwnerId: "manager-1",
    status: "active",
    activeLeagues: ["BR-A"],
    competitionCatalog: [leagueWithoutLegs],
    tournamentCatalog: [],
    competitionSeason: null,
    seasonLength: 1,
    unlimitedSeasons: false,
    currentSeason: 1,
    seasonYear: 2026,
    seasonStartedAt: "2026-01-01T00:00:00.000Z",
    seasonHistory: [],
    careerCompleted: false,
    careerCompletedAt: null,
    maxManagers: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    revision: 4,
    version: 4,
    scheduleVersion: 4,
    currentFixtureId,
    scheduleIssue: null,
    fixtureSchedule: oldManagedSchedule,
    leagueFixtureSchedule: oldLeagueSchedule,
    leagueMatchResults: [],
    lastCompletedRound: 1,
    matchReadiness: { fixtureId: currentFixtureId, managerIds: [] },
    completedFixtureIds: [completedFixtureId],
    completedMatches: [{
      id: "match-completed",
      fixtureId: completedFixtureId,
      score: [2, 1],
      completedAt: "2026-01-12T22:00:00.000Z",
      seasonNumber: 1,
      seasonYear: 2026,
    }],
    lastCompletedMatch: null,
    clubMoraleStates: [],
    playerStates: [],
    careerState: null,
    marketState: null,
    lineups: [],
    managerIds: ["manager-1"],
    managers,
  };
  const persistence = new MemoryRoomPersistence([legacyRoom]);
  const store = new RoomStore({ persistence });

  const migrated = await store.requireMembership(legacyRoom.code, "manager-1");

  assert.equal(migrated.fixtureSchedule.length, 6);
  assert.equal(Math.max(...migrated.fixtureSchedule.map((fixture) => fixture.round)), 6);
  assert.deepEqual(migrated.completedFixtureIds, [completedFixtureId]);
  assert.equal(migrated.currentFixtureId, currentFixtureId);
  assert.equal(
    migrated.fixtureSchedule.find((fixture) => fixture.fixtureId === currentFixtureId)?.round,
    currentRound,
  );
  assert.equal(migrated.scheduleVersion, FIXTURE_SCHEDULE_VERSION);

  const persisted = await persistence.get(legacyRoom.code);
  assert.equal(persisted.fixtureSchedule.length, 6);
  assert.equal(Math.max(...persisted.fixtureSchedule.map((fixture) => fixture.round)), 6);
  assert.deepEqual(persisted.completedFixtureIds, [completedFixtureId]);
  assert.equal(persisted.currentFixtureId, currentFixtureId);
});
