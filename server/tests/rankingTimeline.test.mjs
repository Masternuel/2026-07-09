import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLeagueRankingTimeline,
  compactLeagueRankingTimeline,
  expectedCoachPositions,
  expandCompactLeagueRankingTimeline,
  latestRankingMovement,
} from "../game/rankingTimeline.mjs";
import { buildRoomRankings } from "../services/rankings.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const clubs = [
  { id: "A", name: "Aurora", code: "AUR", active: true },
  { id: "B", name: "Boreal", code: "BOR", active: true },
  { id: "C", name: "Celta", code: "CEL", active: true },
  { id: "D", name: "Delta", code: "DEL", active: true },
];

const league = { id: "L1", name: "Liga Real", active: true, clubs };
const fixtures = [
  { leagueFixtureId: "r1-a-b", leagueId: "L1", round: 1, homeClubId: "A", awayClubId: "B" },
  { leagueFixtureId: "r1-c-d", leagueId: "L1", round: 1, homeClubId: "C", awayClubId: "D" },
  { leagueFixtureId: "r2-a-c", leagueId: "L1", round: 2, homeClubId: "A", awayClubId: "C" },
  { leagueFixtureId: "r2-b-d", leagueId: "L1", round: 2, homeClubId: "B", awayClubId: "D" },
  { leagueFixtureId: "r3-a-d", leagueId: "L1", round: 3, homeClubId: "A", awayClubId: "D" },
  { leagueFixtureId: "r3-b-c", leagueId: "L1", round: 3, homeClubId: "B", awayClubId: "C" },
];
const results = [
  { leagueFixtureId: "r1-a-b", score: [0, 1] },
  { leagueFixtureId: "r1-c-d", score: [0, 0] },
  { leagueFixtureId: "r2-a-c", score: [3, 0] },
  { leagueFixtureId: "r2-b-d", score: [0, 2] },
  // Round 3 is deliberately partial and must not become historical ranking data.
  { leagueFixtureId: "r3-a-d", score: [8, 0] },
];
const managers = [
  { id: "m-a", name: "Ana", clubId: "A" },
  // Manager saves may keep public club code while fixtures use catalog ID.
  { id: "m-b", name: "Beto", clubId: "BOR" },
  { id: "m-free", name: "Zoe", clubId: null },
];

test("expectativa do treinador usa forca e valor reais do elenco", () => {
  const positions = expectedCoachPositions([
    { id: "A", code: "AUR", name: "Aurora", reputation: 10, squadStrength: 8, squadValue: 80_000_000 },
    { id: "B", code: "BOR", name: "Boreal", reputation: 10, squadStrength: 14, squadValue: 220_000_000 },
  ]);

  assert.equal(positions.get("B"), 1);
  assert.equal(positions.get("BOR"), 1);
  assert.equal(positions.get("A"), 2);
});

test("timeline reconstrói posições reais por rodada completa", () => {
  const timeline = buildLeagueRankingTimeline({
    leagues: [league], fixtures, results, managers, seasonNumber: 2, seasonYear: 2027,
  });
  const clubTimeline = timeline.filter((entry) => entry.type === "club");

  assert.equal(clubTimeline.length, 8);
  assert.deepEqual([...new Set(clubTimeline.map((entry) => entry.round))], [1, 2]);
  assert.equal(clubTimeline.some((entry) => entry.round === 3), false);
  assert.deepEqual(clubTimeline.filter((entry) => entry.round === 1).map((entry) => [entry.clubId, entry.position]), [
    ["B", 1], ["C", 2], ["D", 3], ["A", 4],
  ]);
  assert.deepEqual(clubTimeline.filter((entry) => entry.round === 2).map((entry) => [entry.clubId, entry.position, entry.previousPosition, entry.positionChange]), [
    ["D", 1, 3, 2], ["A", 2, 4, 2], ["B", 3, 1, -2], ["C", 4, 2, -2],
  ]);
  assert.deepEqual(
    latestRankingMovement(timeline, "club", "b"),
    clubTimeline.find((entry) => entry.round === 2 && entry.clubId === "B"),
  );

  const withGap = buildLeagueRankingTimeline({
    leagues: [league],
    fixtures,
    results: results.filter((result) => result.leagueFixtureId !== "r1-c-d"),
  });
  assert.deepEqual(withGap, [], "rodada posterior não vira histórico quando existe lacuna anterior");
});

test("timeline de treinadores inclui humanos e IA para todos os clubes", () => {
  const timeline = buildLeagueRankingTimeline({ leagues: [league], fixtures, results, managers });
  const managerTimeline = timeline.filter((entry) => entry.type === "manager");

  assert.equal(managerTimeline.length, 8);
  assert.deepEqual(managerTimeline.filter((entry) => entry.round === 1).map((entry) => [entry.managerId, entry.position, entry.points]), [
    ["m-b", 1, 3], ["ai-coach:C", 2, 1], ["ai-coach:D", 3, 1], ["m-a", 4, 0],
  ]);
  assert.deepEqual(managerTimeline.filter((entry) => entry.round === 2).map((entry) => [entry.managerId, entry.position, entry.previousPosition, entry.positionChange]), [
    ["ai-coach:D", 1, 3, 2], ["m-a", 2, 4, 2], ["m-b", 3, 1, -2], ["ai-coach:C", 4, 2, -2],
  ]);
});

test("timeline compacta preserva posições e campanha entre temporadas", () => {
  const timeline = buildLeagueRankingTimeline({
    leagues: [league], fixtures, results, managers, seasonNumber: 4, seasonYear: 2029,
  });
  const compact = compactLeagueRankingTimeline(timeline);
  const restored = expandCompactLeagueRankingTimeline(structuredClone(compact));

  assert.equal(compact.length, 1);
  assert.equal(compact[0].format, "ranking-timeline-v1");
  assert.equal(compact[0].rounds.length, 2);
  assert.equal(
    restored.find((entry) => entry.type === "manager" && entry.managerId === "m-a")?.clubName,
    "Aurora",
    "arquivo compacto preserva o nome do clube comandado",
  );
  assert.deepEqual(
    restored.map(({ type, round, entityId, position, previousPosition, positionChange, points }) => (
      { type, round, entityId, position, previousPosition, positionChange, points }
    )),
    timeline.map(({ type, round, entityId, position, previousPosition, positionChange, points }) => (
      { type, round, entityId, position, previousPosition, positionChange, points }
    )),
  );
});

test("nome historico do clube nao muda quando o catalogo atual e renomeado", async () => {
  const archivedTimeline = compactLeagueRankingTimeline(buildLeagueRankingTimeline({
    leagues: [league], fixtures, results, managers, seasonNumber: 1, seasonYear: 2026,
  }));
  const renamedLeague = {
    ...league,
    clubs: league.clubs.map((club) => (club.id === "A" ? { ...club, name: "Aurora Novo Nome" } : club)),
  };
  const room = {
    code: "RENAMED",
    ownerId: "m-a",
    currentSeason: 2,
    seasonYear: 2027,
    competitionCatalog: [renamedLeague],
    leagueFixtureSchedule: fixtures,
    leagueMatchResults: [],
    managers,
    playerStates: [],
    seasonHistory: [{ seasonNumber: 1, seasonYear: 2026, rankingTimeline: archivedTimeline }],
  };
  const catalogStore = {
    async listPlayers(clubId) {
      return { players: [{ id: `${clubId}-1`, clubId, name: `Jogador ${clubId}`, position: "MC", overall: 10 }], count: 1, source: "test" };
    },
  };

  const rankings = await buildRoomRankings({
    room, catalogStore, competitionId: "L1", viewerId: "m-a",
  });
  const archivedSeason = rankings.managers.find((manager) => manager.id === "m-a")
    ?.seasonStats.find((entry) => entry.seasonNumber === 1);

  assert.equal(archivedSeason?.clubName, "Aurora");
});

test("serviço publica timeline e variação de clubes/managers", async () => {
  const room = {
    code: "REAL",
    ownerId: "m-a",
    currentSeason: 2,
    seasonYear: 2027,
    competitionCatalog: [league],
    leagueFixtureSchedule: fixtures,
    leagueMatchResults: results.slice(0, 4),
    managers,
    playerStates: [],
  };
  const catalogStore = {
    async listPlayers(clubId) {
      return {
        players: [{ id: `${clubId}-1`, clubId, name: `Jogador ${clubId}`, position: "MC", overall: 10 }],
        count: 1,
        source: "test",
      };
    },
  };
  const rankings = await buildRoomRankings({
    room, catalogStore, competitionId: "L1", viewerId: "m-a",
  });

  assert.equal(rankings.timeline.length, 16);
  assert.deepEqual(
    (({ previousPosition, positionChange, rankChange }) => ({ previousPosition, positionChange, rankChange }))(
      rankings.clubs.find((club) => club.id === "A"),
    ),
    { previousPosition: 4, positionChange: 2, rankChange: 2 },
  );
  const rankedManager = rankings.managers.find((manager) => manager.id === "m-b");
  const movement = rankings.timeline.filter((entry) => entry.type === "manager" && entry.managerId === "m-b").at(-1);
  assert.deepEqual(
    (({ position, previousPosition, positionChange, rankChange }) => ({ position, previousPosition, positionChange, rankChange }))(rankedManager),
    {
      position: movement.position,
      previousPosition: movement.previousPosition,
      positionChange: movement.positionChange,
      rankChange: movement.positionChange,
    },
  );
});

test("rollover arquiva timeline compacta e rankings da temporada seguinte a recuperam", async () => {
  const rolloverLeague = { ...league, clubs: clubs.slice(0, 2) };
  const catalogStore = {
    async listCompetitionCatalog() { return structuredClone([rolloverLeague]); },
    async listPlayers(clubId) {
      return {
        players: [{ id: `${clubId}-1`, clubId, name: `Jogador ${clubId}`, position: "MC", overall: 10 }],
        count: 1,
        source: "test",
      };
    },
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore,
    codeFactory: () => "RANK-HISTORY",
    now: () => new Date("2027-01-01T12:00:00.000Z"),
  });
  const created = await store.createRoom({
    name: "Histórico",
    creatorId: "m-a",
    creatorName: "Ana",
    clubId: "A",
    activeLeagues: ["L1"],
    seasonLength: 1,
    unlimitedSeasons: true,
    maxManagers: 1,
  });
  await store.setReady(created.code, "m-a", true, "A");
  await store.startRoom(created.code, "m-a");

  let guard = 0;
  while ((await store.getRoom(created.code)).currentSeason === 1 && guard < 10) {
    const current = await store.getRoom(created.code);
    const fixture = current.fixtureSchedule.find((entry) => entry.fixtureId === current.currentFixtureId);
    assert.ok(fixture);
    await store.completeMatch(created.code, fixture.fixtureId, {
      id: `season-one-${guard}`,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      score: guard === 0 ? [1, 0] : [0, 2],
      statistics: { home: {}, away: {} },
      skipped: false,
    });
    guard += 1;
  }

  const transitioned = await store.getRoom(created.code);
  assert.equal(transitioned.currentSeason, 2);
  const compact = transitioned.seasonHistory[0]?.rankingTimeline;
  const restored = expandCompactLeagueRankingTimeline(compact);
  assert.equal(Array.isArray(compact) && compact[0]?.format === "ranking-timeline-v1", true);
  assert.equal(restored.some((entry) => entry.type === "club" && entry.seasonNumber === 1), true);
  assert.equal(restored.some((entry) => entry.type === "manager" && entry.managerId === "m-a"), true);

  const rankings = await buildRoomRankings({
    room: transitioned,
    catalogStore,
    competitionId: "L1",
    viewerId: "m-a",
  });
  assert.equal(rankings.timeline.some((entry) => entry.seasonNumber === 1), true);
  assert.equal(rankings.timeline.some((entry) => entry.seasonNumber === 2), false);
});
