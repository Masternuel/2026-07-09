import assert from "node:assert/strict";
import test from "node:test";
import {
  coordinateRoomFixtureCalendar,
  createFixtureSchedule,
  createLeagueFixtureSchedule,
  createUnifiedFixtureSchedule,
  ensureFixtureSchedule,
} from "../game/fixtures.mjs";

function room() {
  const clubs = ["A", "B", "C", "D", "E"].map((id) => ({
    id,
    code: id,
    name: `Clube ${id}`,
    color: "#c8ff3d",
    leagueId: "LIGA",
  }));
  return {
    managers: [{ id: "M1", clubId: "A" }],
    completedFixtureIds: [],
    leagueMatchResults: [],
    competitionCatalog: [{ id: "LIGA", name: "Liga", clubs }],
    tournamentCatalog: [{ id: "COPA", name: "Copa", teamIds: clubs.map(({ id }) => id) }],
  };
}

function competitionSeason(fixture) {
  const competition = {
    id: "COPA",
    fixtures: [structuredClone(fixture)],
    calendar: [fixture.id],
  };
  return {
    competitions: [competition],
    fixtures: [structuredClone(fixture)],
    calendar: [fixture.id],
    completedFixtureIds: [],
  };
}

test("coordenacao persiste a mesma data nas fontes e no calendario gerenciado", () => {
  const current = room();
  const leagueSchedule = [{
    leagueFixtureId: "L1",
    leagueId: "LIGA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
  }];
  const cupFixture = {
    id: "C1",
    competitionFixtureId: "C1",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
    status: "scheduled",
  };

  const coordinated = coordinateRoomFixtureCalendar(
    current,
    leagueSchedule,
    competitionSeason(cupFixture),
  );
  const managed = createUnifiedFixtureSchedule(
    current,
    coordinated.leagueSchedule,
    coordinated.competitionSeason,
  );

  assert.equal(coordinated.competitionSeason.fixtures[0].scheduledAt, cupFixture.scheduledAt);
  assert.equal(
    coordinated.competitionSeason.competitions[0].fixtures[0].scheduledAt,
    cupFixture.scheduledAt,
  );
  assert.equal(coordinated.leagueSchedule[0].scheduledAt, "2026-01-04T20:00:00.000Z");
  assert.deepEqual(
    managed.map(({ scheduledAt }) => scheduledAt),
    ["2026-01-01T20:00:00.000Z", "2026-01-04T20:00:00.000Z"],
  );
  assert.equal(coordinated.rescheduled.length, 1);
  assert.equal(coordinated.rescheduled[0].id, "L1");
});

test("partida concluida fica fixa e desloca a copa pendente", () => {
  const current = room();
  current.leagueMatchResults = [{ leagueFixtureId: "L1", score: [1, 0] }];
  const leagueSchedule = [{
    leagueFixtureId: "L1",
    leagueId: "LIGA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
  }];
  const cupFixture = {
    id: "C1",
    competitionFixtureId: "C1",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
    status: "scheduled",
  };

  const coordinated = coordinateRoomFixtureCalendar(
    current,
    leagueSchedule,
    competitionSeason(cupFixture),
  );

  assert.equal(coordinated.leagueSchedule[0].scheduledAt, "2026-01-01T20:00:00.000Z");
  assert.equal(coordinated.competitionSeason.fixtures[0].scheduledAt, "2026-01-04T20:00:00.000Z");
});

test("ids gerenciados da liga permanecem ligados ao confronto apos remarcacao", () => {
  const current = room();
  current.managers.push({ id: "M2", clubId: "D" });
  const leagueSchedule = [{
    leagueFixtureId: "L1",
    leagueId: "LIGA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
  }, {
    leagueFixtureId: "L2",
    leagueId: "LIGA",
    round: 2,
    scheduledAt: "2026-01-02T20:00:00.000Z",
    homeClubId: "D",
    awayClubId: "C",
  }];
  current.fixtureSchedule = createUnifiedFixtureSchedule(current, leagueSchedule, null);
  assert.deepEqual(
    current.fixtureSchedule.map(({ fixtureId, leagueFixtureId }) => [fixtureId, leagueFixtureId]),
    [["abertura", "L1"], ["rodada-2", "L2"]],
  );
  const cupFixture = {
    id: "C1",
    competitionFixtureId: "C1",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "E",
    status: "scheduled",
  };

  const coordinated = coordinateRoomFixtureCalendar(
    current,
    leagueSchedule,
    competitionSeason(cupFixture),
  );
  const managed = createUnifiedFixtureSchedule(
    current,
    coordinated.leagueSchedule,
    coordinated.competitionSeason,
  );

  assert.deepEqual(
    managed.filter(({ leagueFixtureId }) => leagueFixtureId)
      .map(({ fixtureId, leagueFixtureId }) => [fixtureId, leagueFixtureId]),
    [["rodada-2", "L2"], ["abertura", "L1"]],
  );
});

test("nova partida nao reutiliza id reservado por confronto existente", () => {
  const current = room();
  current.fixtureSchedule = [{ fixtureId: "abertura", leagueFixtureId: "L2" }];
  const managed = createFixtureSchedule(current, [{
    leagueFixtureId: "L1",
    leagueId: "LIGA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
  }, {
    leagueFixtureId: "L2",
    leagueId: "LIGA",
    round: 2,
    scheduledAt: "2026-01-08T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
  }]);

  assert.deepEqual(
    managed.map(({ fixtureId, leagueFixtureId }) => [fixtureId, leagueFixtureId]),
    [["rodada-2", "L1"], ["abertura", "L2"]],
  );
});

test("save v2 ordena copa anterior antes da proxima liga preservada", () => {
  const current = room();
  const leagueFixture = createLeagueFixtureSchedule(current)
    .find(({ homeClubId, awayClubId }) => homeClubId === "A" || awayClubId === "A");
  current.fixtureSchedule = [{
    fixtureId: "abertura",
    ...leagueFixture,
    homeTeam: `Clube ${leagueFixture.homeClubId}`,
    awayTeam: `Clube ${leagueFixture.awayClubId}`,
    managerIds: ["M1"],
  }];
  current.scheduleCompatibility = "v2-preserved";
  current.competitionSeason = competitionSeason({
    id: "C1",
    competitionFixtureId: "C1",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
    status: "scheduled",
  });

  ensureFixtureSchedule(current);

  assert.equal(current.fixtureSchedule[0].competitionFixtureId, "C1");
  assert.equal(current.fixtureSchedule[1].fixtureId, "abertura");
});

test("fase dinamica nunca fica antes da partida classificatoria concluida", () => {
  const current = room();
  const semifinal = {
    id: "SEMI",
    competitionFixtureId: "SEMI",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-03-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
    status: "completed",
  };
  const final = {
    id: "FINAL",
    competitionFixtureId: "FINAL",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 2,
    scheduledAt: "2026-01-15T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
    status: "scheduled",
  };
  const season = competitionSeason(semifinal);
  season.competitions[0].fixtures.push(structuredClone(final));
  season.fixtures.push(structuredClone(final));
  season.competitions[0].calendar.push(final.id);
  season.calendar.push(final.id);

  const coordinated = coordinateRoomFixtureCalendar(current, [], season);
  const coordinatedFinal = coordinated.competitionSeason.fixtures.find(({ id }) => id === "FINAL");

  assert.equal(coordinatedFinal.scheduledAt, "2026-03-04T20:00:00.000Z");
});

test("save antigo preserva conflitos historicos e corrige apenas jogos pendentes", () => {
  const current = room();
  current.leagueMatchResults = [{ leagueFixtureId: "L1", score: [1, 0] }];
  const leagueSchedule = [{
    leagueFixtureId: "L1",
    leagueId: "LIGA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "B",
  }];
  const completedCup = {
    id: "C1",
    competitionFixtureId: "C1",
    competitionId: "COPA",
    tournamentId: "COPA",
    round: 1,
    scheduledAt: "2026-01-01T20:00:00.000Z",
    homeClubId: "A",
    awayClubId: "C",
    status: "completed",
  };
  const pendingCup = {
    ...completedCup,
    id: "C2",
    competitionFixtureId: "C2",
    scheduledAt: "2026-01-02T20:00:00.000Z",
    awayClubId: "D",
    status: "scheduled",
  };
  const season = competitionSeason(completedCup);
  season.competitions[0].fixtures.push(structuredClone(pendingCup));
  season.fixtures.push(structuredClone(pendingCup));

  const coordinated = coordinateRoomFixtureCalendar(current, leagueSchedule, season);

  assert.equal(coordinated.leagueSchedule[0].scheduledAt, "2026-01-01T20:00:00.000Z");
  assert.equal(
    coordinated.competitionSeason.fixtures.find(({ id }) => id === "C1").scheduledAt,
    "2026-01-01T20:00:00.000Z",
  );
  assert.equal(
    coordinated.competitionSeason.fixtures.find(({ id }) => id === "C2").scheduledAt,
    "2026-01-04T20:00:00.000Z",
  );
});
