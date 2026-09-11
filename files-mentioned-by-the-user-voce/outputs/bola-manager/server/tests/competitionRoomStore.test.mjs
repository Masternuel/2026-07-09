import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const OWNER_ID = "competition-owner";
const CLUB_IDS = ["A", "B", "C", "D"];
const POSITIONS = ["GOL", "LD", "ZAG", "ZAG", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"];
const SQUAD_POSITIONS = [...POSITIONS, "GOL", "ZAG", "LD", "VOL", "MC", "ATA"];
const ATTRIBUTE_KEYS = [
  "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
  "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
];

function attributes(value = 11) {
  return Object.fromEntries(ATTRIBUTE_KEYS.map((key) => [key, value]));
}

function catalogFixture() {
  const unavailableClubIds = new Set();
  const rosterRequests = [];
  const clubs = CLUB_IDS.map((id, index) => ({
    id,
    name: `Clube ${id}`,
    code: id,
    color: `#${String(index + 1).repeat(6)}`,
    reputation: 14 - index,
    leagueId: "TEST-L1",
    country: "Brasil",
    academyLevel: 12,
  }));
  const league = {
    id: "TEST-L1",
    name: "Liga Integrada",
    country: "Brasil",
    division: "Serie A",
    level: 1,
    prizeMoney: 1_000_000,
    clubs,
  };
  const tournaments = [
    {
      id: "TEST-KO",
      name: "Copa Integrada",
      format: "knockout",
      teamCount: 4,
      legs: "single",
      tiebreakers: ["extra_time", "penalties"],
      teamIds: [...CLUB_IDS],
      active: true,
      prizeMoney: 2_000_000,
    },
    {
      id: "TEST-GROUPS",
      name: "Copa de Grupos",
      format: "groups_knockout",
      teamCount: 4,
      legs: "single",
      tiebreakers: ["wins", "goal_difference", "goals_scored", "extra_time", "penalties"],
      teamIds: [...CLUB_IDS],
      active: true,
      prizeMoney: 3_000_000,
    },
  ];
  const players = clubs.flatMap((club) => SQUAD_POSITIONS.map((position, index) => ({
    id: `${club.id}-P${index + 1}`,
    clubId: club.id,
    name: `${club.name} ${index + 1}`,
    position,
    age: 19 + (index % 12),
    nationality: "Brasil",
    overall: 11,
    potential: 15,
    attributes: attributes(11),
    condition: 100,
    wage: 10_000 + index * 500,
    active: true,
  })));
  return {
    league,
    tournaments,
    players,
    async listCompetitionCatalog() {
      return [structuredClone(league)];
    },
    async listActiveTournaments() {
      return { tournaments: structuredClone(tournaments), count: tournaments.length };
    },
    async listPlayers(clubId) {
      rosterRequests.push(clubId);
      const roster = unavailableClubIds.has(clubId)
        ? []
        : players.filter((player) => player.clubId === clubId);
      return { players: structuredClone(roster), count: roster.length, source: "competition-test" };
    },
    unavailableClubIds,
    rosterRequests,
  };
}

function harness({ seasonLength = 2 } = {}) {
  const persistence = new MemoryRoomPersistence();
  const catalog = catalogFixture();
  let now = new Date("2026-07-16T12:00:00.000Z");
  const catalogStore = {
    forOwner(ownerId) {
      assert.equal(ownerId, OWNER_ID);
      return catalog;
    },
  };
  const storeOptions = {
    persistence,
    catalogStore,
    codeFactory: () => "BOLA-CP01",
    now: () => now,
  };
  const store = new RoomStore(storeOptions);
  return {
    store,
    catalog,
    persistence,
    reloadStore() { return new RoomStore(storeOptions); },
    seasonLength,
    tick() { now = new Date(now.getTime() + 60_000); },
  };
}

function useThreeClubKnockout(context) {
  const knockout = context.catalog.tournaments.find((tournament) => tournament.id === "TEST-KO");
  context.catalog.tournaments.splice(0, context.catalog.tournaments.length, {
    ...knockout,
    teamCount: 3,
    teamIds: ["B", "A", "C"],
  });
}

async function startedRoom(options = {}) {
  const context = harness(options);
  const created = await context.store.createRoom({
    name: "Competicoes integradas",
    creatorId: OWNER_ID,
    creatorName: "Manager",
    clubId: "A",
    activeLeagues: ["TEST-L1"],
    seasonLength: context.seasonLength,
    maxManagers: 2,
  });
  await context.store.setReady(created.code, OWNER_ID, true);
  const started = await context.store.startRoom(created.code, OWNER_ID);
  return { ...context, room: started };
}

function resultFor(room, sequence) {
  const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
  assert.ok(fixture, `fixture atual ${room.currentFixtureId} deve existir`);
  return {
    id: `manager-result-${sequence}`,
    fixtureId: fixture.fixtureId,
    homeClubId: fixture.homeClubId,
    awayClubId: fixture.awayClubId,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    score: [2, 0],
    statistics: { home: {}, away: {} },
    events: [],
    playerStatistics: { home: [], away: [] },
    skipped: false,
  };
}

async function completeCurrent(context, room, sequence) {
  context.tick();
  return context.store.completeMatch(
    room.code,
    room.currentFixtureId,
    resultFor(room, sequence),
  );
}

async function advanceToKnockoutSemifinal(context, room) {
  for (let sequence = 0; sequence < 12; sequence += 1) {
    const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
    if (fixture?.tournamentId === "TEST-KO") return room;
    room = (await completeCurrent(context, room, 500 + sequence)).room;
  }
  assert.fail("semifinal do mata-mata nao foi encontrada");
}

function knockoutLossResult(room, sequence) {
  const fixture = room.fixtureSchedule.find((candidate) => candidate.fixtureId === room.currentFixtureId);
  const managerIsHome = fixture.homeClubId === "A";
  return {
    ...resultFor(room, sequence),
    score: managerIsHome ? [0, 2] : [2, 0],
  };
}

test("start cria temporada de torneios e calendario unificado por data", async () => {
  const { room } = await startedRoom();

  assert.equal(room.status, "active");
  assert.equal(room.competitionSeason.seasonNumber, 1);
  assert.deepEqual(room.competitionSeason.tournamentIds, ["TEST-KO", "TEST-GROUPS"]);
  assert.equal(room.competitionSeason.competitions.length, 2);
  assert.equal(room.competitionSeason.fixtures.length, 4);
  assert.equal(room.competitionSeason.fixtures.every((fixture) => (
    Number.isFinite(Date.parse(fixture.scheduledAt))
  )), true);

  const leagueFixtures = room.fixtureSchedule.filter((fixture) => fixture.leagueFixtureId);
  const tournamentFixtures = room.fixtureSchedule.filter((fixture) => fixture.competitionFixtureId);
  assert.equal(leagueFixtures.length, 6);
  assert.equal(tournamentFixtures.length, 2);
  assert.equal(tournamentFixtures.every((fixture) => fixture.managerIds.includes(OWNER_ID)), true);
  assert.equal(room.fixtureSchedule.every((fixture, index, fixtures) => (
    index === 0 || Date.parse(fixture.scheduledAt) >= Date.parse(fixtures[index - 1].scheduledAt)
  )), true);
  assert.equal(room.currentFixtureId, room.fixtureSchedule[0].fixtureId);

  const managedTournamentIds = new Set(tournamentFixtures.map((fixture) => fixture.competitionFixtureId));
  assert.equal(room.competitionSeason.fixtures.some((fixture) => (
    !managedTournamentIds.has(fixture.competitionFixtureId)
  )), true, "engine deve manter jogos somente IA fora do calendario do manager");
});

test("conclusao do manager registra torneio, simula IA e materializa proxima chave", async () => {
  const context = await startedRoom();
  let room = context.room;

  const initialAiOnly = room.competitionSeason.fixtures.filter((fixture) => (
    !room.fixtureSchedule.some((managed) => managed.competitionFixtureId === fixture.competitionFixtureId)
  ));
  const firstCompletion = await completeCurrent(context, room, 1);
  room = firstCompletion.room;

  let safety = 0;
  while (safety < 10) {
    const current = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
    if (current?.tournamentId === "TEST-KO") break;
    const completion = await completeCurrent(context, room, 2 + safety);
    room = completion.room;
    safety += 1;
  }
  const cupFixture = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
  assert.equal(cupFixture.tournamentId, "TEST-KO");
  const beforeCup = room.competitionSeason.competitions.find((competition) => competition.id === "TEST-KO");
  assert.equal(beforeCup.fixtures.length, 2);

  const cupCompletion = await completeCurrent(context, room, 20);
  room = cupCompletion.room;
  const afterCup = room.competitionSeason.competitions.find((competition) => competition.id === "TEST-KO");
  assert.equal(afterCup.completedFixtureIds.includes(cupFixture.competitionFixtureId), true);
  assert.equal(initialAiOnly.some((fixture) => (
    room.competitionSeason.completedFixtureIds.includes(fixture.competitionFixtureId)
  )), true, "conclusao do manager deve simular jogos IA anteriores ao proximo compromisso");
  assert.equal(afterCup.fixtures.length, 3, "final deve nascer depois das duas semifinais");
  assert.equal(afterCup.fixtures.some((fixture) => fixture.status === "scheduled" && fixture.round === 2), true);
  assert.equal(room.fixtureSchedule.some((fixture) => (
    fixture.tournamentId === "TEST-KO" && fixture.round === 2
  )), true, "final do manager deve entrar no calendario unificado");
});

test("bye e vencedor dinamico carregam roster apos reload antes de semifinal e final", async () => {
  const context = harness();
  useThreeClubKnockout(context);
  const created = await context.store.createRoom({
    name: "Mata-mata dinamico",
    creatorId: OWNER_ID,
    creatorName: "Manager",
    clubId: "A",
    activeLeagues: ["TEST-L1"],
    seasonLength: 2,
    maxManagers: 1,
  });
  await context.store.setReady(created.code, OWNER_ID, true);
  let room = await context.store.startRoom(created.code, OWNER_ID);
  room = await advanceToKnockoutSemifinal(context, room);

  const semifinal = room.fixtureSchedule.find((fixture) => fixture.fixtureId === room.currentFixtureId);
  assert.equal(semifinal.round, 1);
  assert.deepEqual([semifinal.homeClubId, semifinal.awayClubId], ["A", "C"]);
  context.catalog.rosterRequests.length = 0;

  const reloadedStore = context.reloadStore();
  context.tick();
  const completion = await reloadedStore.completeMatch(
    room.code,
    room.currentFixtureId,
    knockoutLossResult(room, 700),
  );
  room = completion.room;
  let competition = room.competitionSeason.competitions.find(({ id }) => id === "TEST-KO");
  let final = competition.fixtures.find((fixture) => fixture.round === 2);
  assert.equal(final.status, "scheduled", "final futura nao pode ser antecipada na semifinal");
  for (let step = 0; final.status !== "completed" && step < 16; step += 1) {
    context.tick();
    const next = await reloadedStore.completeMatch(room.code, room.currentFixtureId, knockoutLossResult(room, 710 + step));
    room = next.room;
    competition = room.competitionSeason.competitions.find(({ id }) => id === "TEST-KO");
    final = competition.fixtures.find((fixture) => fixture.round === 2);
  }

  assert.equal(context.catalog.rosterRequests.includes("B"), true, "clube classificado por bye deve ser carregado");
  assert.equal(final.status, "completed");
  assert.deepEqual([final.homeClubId, final.awayClubId], ["B", "C"]);
  assert.equal(competition.status, "completed");
  assert.equal(room.playerStates.some((player) => player.clubId === "B"), true);
  assert.equal(room.playerStates.some((player) => player.clubId === "C"), true);
});

test("final dinamica sem roster valido bloqueia avancar sua data sem persistencia parcial", async () => {
  const context = harness();
  useThreeClubKnockout(context);
  const created = await context.store.createRoom({
    name: "Mata-mata incompleto",
    creatorId: OWNER_ID,
    creatorName: "Manager",
    clubId: "A",
    activeLeagues: ["TEST-L1"],
    seasonLength: 2,
    maxManagers: 1,
  });
  await context.store.setReady(created.code, OWNER_ID, true);
  let room = await context.store.startRoom(created.code, OWNER_ID);
  room = await advanceToKnockoutSemifinal(context, room);
  context.catalog.unavailableClubIds.add("B");
  await context.persistence.mutate(room.code, (current) => {
    current.careerState.players = current.careerState.players.map((player) => (
      player.clubId === "B" ? { ...player, active: false, retired: true } : player
    ));
    return current;
  });

  const reloadedStore = context.reloadStore();
  context.tick();
  let blocked = false;
  for (let step = 0; step < 16; step += 1) {
    try {
      const completion = await reloadedStore.completeMatch(room.code, room.currentFixtureId, knockoutLossResult(room, 701 + step));
      room = completion.room;
    } catch (error) {
      assert.equal(error.code, "DYNAMIC_KNOCKOUT_ROSTER_INVALID");
      blocked = true;
      break;
    }
  }
  assert.equal(blocked, true);

  const persisted = await reloadedStore.requireRoom(room.code);
  const competition = persisted.competitionSeason.competitions.find(({ id }) => id === "TEST-KO");
  const final = competition.fixtures.find((fixture) => fixture.round === 2);
  assert.equal(persisted.currentFixtureId, room.currentFixtureId);
  assert.equal(final.status, "scheduled");
  assert.deepEqual(persisted.completedFixtureIds, room.completedFixtureIds);
});

test("fim de temporada recria torneios e liga na temporada seguinte", async () => {
  const context = await startedRoom({ seasonLength: 2 });
  let room = context.room;
  let lastSummary = null;
  let safety = 0;

  while (room.currentSeason === 1 && safety < 30) {
    const completion = await completeCurrent(context, room, 100 + safety);
    room = completion.room;
    lastSummary = completion.summary;
    safety += 1;
  }

  assert.equal(room.currentSeason, 2, `rollover deve ocorrer; jogos processados: ${safety}`);
  assert.equal(room.seasonYear, 2027);
  assert.equal(room.seasonHistory.length, 1);
  assert.equal(room.seasonHistory[0].seasonNumber, 1);
  assert.equal(room.seasonHistory[0].tournamentWinners.length, 2);
  assert.equal(lastSummary.nextSeasonNumber, 2);
  assert.equal(lastSummary.nextFixtureId, room.currentFixtureId);

  assert.equal(room.competitionSeason.seasonNumber, 2);
  assert.deepEqual(room.competitionSeason.tournamentIds, ["TEST-KO", "TEST-GROUPS"]);
  assert.equal(room.competitionSeason.status, "scheduled");
  assert.deepEqual(room.competitionSeason.completedFixtureIds, []);
  assert.deepEqual(room.completedFixtureIds, []);
  assert.deepEqual(room.leagueMatchResults, []);
  assert.equal(room.leagueFixtureSchedule.length, 12);
  assert.equal(room.fixtureSchedule.some((fixture) => fixture.leagueFixtureId), true);
  assert.equal(room.fixtureSchedule.some((fixture) => fixture.competitionFixtureId), true);
  assert.ok(room.currentFixtureId);

  assert.equal(room.careerState.currentSeason, 2);
  assert.equal(room.careerState.players.some((player) => player.academy === true), true);
  assert.equal(room.careerCompleted, false);
  const prizeTransactions = room.clubCareerState.financialTransactions.filter(
    (transaction) => transaction.category === "prize",
  );
  assert.equal(prizeTransactions.length, 3, "liga e dois torneios devem pagar somente premio configurado");
  assert.deepEqual(
    [...prizeTransactions.map((transaction) => transaction.amount)].sort((a, b) => a - b),
    [1_000_000, 2_000_000, 3_000_000],
  );
  assert.equal(
    room.clubCareerState.events.filter((event) => event.type === "COMPETITION_WON").length,
    3,
  );
});

test("metodos de carreira expõem elenco, treino e renovacao do clube do manager", async () => {
  const context = await startedRoom();
  const snapshot = await context.store.getCareerSnapshot(context.room.code, OWNER_ID);
  assert.equal(snapshot.currentSeason, 1);
  assert.equal(snapshot.players.filter((player) => !player.academy).length, SQUAD_POSITIONS.length);
  assert.equal(snapshot.players.filter((player) => player.academy).length, 2);
  assert.equal(snapshot.players.every((player) => player.clubId === "A"), true);
  const player = snapshot.players[0];

  await context.store.setTrainingPlan(context.room.code, OWNER_ID, {
    playerId: player.id,
    focus: "technical",
    intensity: "high",
    active: true,
  });
  const trained = await context.store.getCareerSnapshot(context.room.code, OWNER_ID);
  assert.deepEqual(trained.trainingPlans, [{
    playerId: player.id,
    focus: "technical",
    intensity: "high",
    active: true,
  }]);

  const renewedRoom = await context.store.renewPlayerContract(context.room.code, OWNER_ID, {
    playerId: player.id,
    years: 4,
    wage: 25_000,
  });
  const renewed = renewedRoom.careerState.players.find((candidate) => candidate.id === player.id);
  assert.equal(renewed.contract.endSeason, 4);
  assert.equal(renewed.contract.wage, 25_000);
  assert.equal(renewed.wage, 25_000);
});
