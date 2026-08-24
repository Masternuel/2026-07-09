import assert from "node:assert/strict";
import test from "node:test";
import {
  CompetitionEngineError,
  applyPromotionRelegation,
  createCompetitionSeason,
  createCompetitionState,
  getCompetitionStandings,
  listPendingCompetitionFixtures,
  recordCompetitionResult,
  recordCompetitionSeasonResult,
} from "../game/competitionEngine.mjs";

function teams(ids) {
  return ids.map((id, index) => ({ id, name: `Clube ${id}`, seed: index + 1 }));
}

function definition({
  id = "TEST-COMP",
  ids = ["A", "B", "C", "D"],
  format = "league",
  legs = "single",
  tiebreakers,
  ...extra
} = {}) {
  return {
    id,
    name: `Competicao ${id}`,
    format,
    legs,
    participants: teams(ids),
    teamCount: ids.length,
    ...(tiebreakers ? { tiebreakers } : {}),
    ...extra,
  };
}

function strongerClubResult(fixture, orderedIds) {
  const strength = new Map(orderedIds.map((id, index) => [id, orderedIds.length - index]));
  return strength.get(fixture.homeClubId) > strength.get(fixture.awayClubId)
    ? { score: [2, 0] }
    : { score: [0, 2] };
}

function completeFixtures(state, fixtures, resultFor) {
  return fixtures.reduce((next, fixture, index) => recordCompetitionResult(
    next,
    fixture.id,
    resultFor(fixture, index),
  ), state);
}

function completeRankedLeague(ids, id) {
  let state = createCompetitionState(definition({ id, ids }));
  state = completeFixtures(
    state,
    [...state.fixtures],
    (fixture) => strongerClubResult(fixture, ids),
  );
  return state;
}

test("liga em turno unico gera todos os pares, rodadas e datas reais", () => {
  const initial = createCompetitionState(definition(), {
    seasonNumber: 3,
    seasonYear: 2030,
    startDate: "2030-01-10",
    roundIntervalDays: 7,
    kickoffTimes: ["20:00"],
  });

  assert.equal(initial.seasonNumber, 3);
  assert.equal(initial.fixtures.length, 6);
  assert.equal(initial.calendar.length, 6);
  assert.deepEqual([...new Set(initial.fixtures.map((fixture) => fixture.round))], [1, 2, 3]);

  const pairs = new Set(initial.fixtures.map((fixture) => (
    [fixture.homeClubId, fixture.awayClubId].sort().join("|")
  )));
  assert.equal(pairs.size, 6);
  assert.equal(initial.fixtures.every((fixture) => fixture.status === "scheduled"), true);
  assert.equal(initial.fixtures.every((fixture) => fixture.scheduledAt.endsWith("T20:00:00.000Z")), true);
  const firstDateByRound = initial.fixtures
    .filter((fixture) => fixture.matchNumber === 1)
    .map((fixture) => fixture.scheduledAt.slice(0, 10));
  assert.deepEqual(firstDateByRound, ["2030-01-10", "2030-01-17", "2030-01-24"]);
  assert.equal(initial.fixtures.every((fixture) => {
    const roundStart = new Date(`2030-01-${String(3 + (fixture.round * 7)).padStart(2, "0")}T00:00:00.000Z`);
    const scheduled = new Date(fixture.scheduledAt);
    return scheduled >= roundStart && scheduled < new Date(roundStart.getTime() + (2 * 86_400_000));
  }), true, "jogos da rodada podem ocupar slots em dias consecutivos");

  const firstId = initial.fixtures[0].id;
  const afterFirst = recordCompetitionResult(initial, firstId, {
    score: [2, 0],
    possession: [58.44, 41.56],
  });
  assert.equal(initial.fixtures[0].status, "scheduled", "API nao deve mutar estado recebido");
  assert.equal(afterFirst.fixtures[0].status, "completed");
  assert.deepEqual(afterFirst.fixtures[0].result.possession, [58.4, 41.6]);

  const completed = completeFixtures(
    afterFirst,
    afterFirst.fixtures.filter((fixture) => fixture.id !== firstId),
    (fixture) => strongerClubResult(fixture, ["A", "B", "C", "D"]),
  );
  const table = getCompetitionStandings(completed);
  assert.equal(completed.status, "completed");
  assert.equal(completed.winnerClubId, "A");
  assert.deepEqual(table.map((row) => [row.clubId, row.points]), [
    ["A", 9], ["B", 6], ["C", 3], ["D", 0],
  ]);
  assert.equal(table.every((row) => row.played === 3), true);
});

test("liga em turno e returno inverte mando e preserva equilibrio", () => {
  const initial = createCompetitionState(definition({ legs: "double" }));
  assert.equal(initial.fixtures.length, 12);
  assert.deepEqual([...new Set(initial.fixtures.map((fixture) => fixture.round))], [1, 2, 3, 4, 5, 6]);
  assert.equal(initial.fixtures.filter((fixture) => fixture.leg === 1).length, 6);
  assert.equal(initial.fixtures.filter((fixture) => fixture.leg === 2).length, 6);

  const directions = new Map();
  for (const fixture of initial.fixtures) {
    const pair = [fixture.homeClubId, fixture.awayClubId].sort().join("|");
    const entries = directions.get(pair) ?? [];
    entries.push(`${fixture.homeClubId}>${fixture.awayClubId}`);
    directions.set(pair, entries);
  }
  assert.equal(directions.size, 6);
  assert.equal([...directions.values()].every((entries) => (
    entries.length === 2 && entries[0] !== entries[1]
  )), true);

  const completed = completeFixtures(initial, initial.fixtures, () => ({ score: [0, 0] }));
  assert.equal(completed.status, "completed");
  assert.deepEqual(getCompetitionStandings(completed).map((row) => (
    [row.clubId, row.played, row.points]
  )), [
    ["A", 6, 6], ["B", 6, 6], ["C", 6, 6], ["D", 6, 6],
  ]);
});

test("grupos classificam por desempenho e criam mata-mata ate final", () => {
  const ids = ["A", "B", "C", "D", "E", "F", "G", "H"];
  let state = createCompetitionState(definition({
    id: "GROUP-CUP",
    ids,
    format: "groups_knockout",
    tiebreakers: ["wins", "goal_difference", "goals_scored", "extra_time", "penalties"],
    groupCount: 2,
    qualifiersPerGroup: 2,
  }));
  const groupStage = state.stages.find((stage) => stage.type === "groups");
  assert.equal(groupStage.groups.length, 2);
  assert.equal(groupStage.groups.every((group) => group.participantIds.length === 4), true);
  assert.equal(state.fixtures.length, 12);

  state = completeFixtures(
    state,
    [...state.fixtures],
    (fixture) => strongerClubResult(fixture, ids),
  );
  const completedGroups = state.stages.find((stage) => stage.type === "groups");
  const knockout = state.stages.find((stage) => stage.type === "knockout");
  assert.equal(completedGroups.status, "completed");
  assert.equal(completedGroups.groups.every((group) => group.qualifiers.length === 2), true);
  assert.equal(knockout.rounds.length, 2);
  assert.equal(knockout.ties.filter((tie) => tie.round === 1).length, 2);

  let safety = 0;
  while (state.status !== "completed" && safety < 10) {
    const pending = listPendingCompetitionFixtures(state);
    assert.notEqual(pending.length, 0, "chave deve materializar proxima fase");
    state = completeFixtures(state, pending, (fixture) => ({
      score: [1, 1],
      penalties: [5, 4],
      winnerClubId: fixture.homeClubId,
    }));
    safety += 1;
  }
  assert.equal(state.status, "completed");
  assert.equal(Boolean(state.winnerClubId), true);
  assert.equal(state.stages.find((stage) => stage.type === "knockout").status, "completed");
});

test("mata-mata com quantidade nao-potencia-de-dois aplica byes sem jogo fantasma", () => {
  let state = createCompetitionState(definition({
    id: "BYE-CUP",
    ids: ["A", "B", "C", "D", "E"],
    format: "knockout",
    tiebreakers: ["extra_time", "penalties"],
  }));
  const stage = state.stages[0];
  assert.equal(stage.rounds.length, 3);
  assert.equal(stage.ties.filter((tie) => tie.decidedBy === "bye").length, 3);
  assert.equal(state.fixtures.every((fixture) => fixture.homeClubId && fixture.awayClubId), true);

  let safety = 0;
  while (state.status !== "completed" && safety < 10) {
    const pending = listPendingCompetitionFixtures(state);
    assert.notEqual(pending.length, 0);
    state = completeFixtures(state, pending, () => ({ score: [2, 0] }));
    safety += 1;
  }
  assert.equal(state.status, "completed");
  assert.equal(state.fixtures.length, 4, "cinco clubes devem disputar quatro jogos");
  assert.equal(state.completedFixtureIds.length, 4);
});

test("ida e volta resolve empate agregado por gol fora", () => {
  let state = createCompetitionState(definition({
    id: "AWAY-GOALS",
    ids: ["A", "B"],
    format: "knockout",
    legs: "double",
    tiebreakers: ["away_goals", "extra_time", "penalties"],
  }), {
    startDate: "2031-03-01",
    roundIntervalDays: 2,
    knockoutLegIntervalDays: 7,
    kickoffTimes: ["21:30"],
  });
  const [firstLeg, secondLeg] = state.fixtures.sort((left, right) => left.leg - right.leg);
  assert.deepEqual(
    [firstLeg.homeClubId, firstLeg.awayClubId, secondLeg.homeClubId, secondLeg.awayClubId],
    ["A", "B", "B", "A"],
  );
  assert.equal(new Date(secondLeg.scheduledAt) > new Date(firstLeg.scheduledAt), true);

  state = recordCompetitionResult(state, firstLeg.id, { score: [1, 0] });
  state = recordCompetitionResult(state, secondLeg.id, { score: [2, 1] });
  const tie = state.stages[0].ties[0];
  assert.deepEqual(tie.aggregate, [2, 2]);
  assert.equal(tie.winnerClubId, "A");
  assert.equal(tie.decidedBy, "away_goals");
  assert.equal(state.status, "completed");
});

test("desempate usa prorrogacao, penaltis e exige decisao quando necessario", () => {
  const extraTimeInitial = createCompetitionState(definition({
    id: "EXTRA-TIME",
    ids: ["A", "B"],
    format: "knockout",
    tiebreakers: ["extra_time", "penalties"],
  }));
  const extraTime = recordCompetitionResult(extraTimeInitial, extraTimeInitial.fixtures[0].id, {
    score: [1, 1],
    extraTime: [1, 0],
  });
  assert.equal(extraTime.winnerClubId, "A");
  assert.equal(extraTime.stages[0].ties[0].decidedBy, "extra_time");

  const penaltiesInitial = createCompetitionState(definition({
    id: "PENALTIES",
    ids: ["A", "B"],
    format: "knockout",
    tiebreakers: ["extra_time", "penalties"],
  }));
  const penalties = recordCompetitionResult(penaltiesInitial, penaltiesInitial.fixtures[0].id, {
    score: [0, 0],
    extraTime: [0, 0],
    penalties: [4, 5],
  });
  assert.equal(penalties.winnerClubId, "B");
  assert.equal(penalties.stages[0].ties[0].decidedBy, "penalties");

  const unresolved = createCompetitionState(definition({
    id: "NO-TIEBREAK",
    ids: ["A", "B"],
    format: "knockout",
    tiebreakers: ["extra_time"],
  }));
  assert.throws(
    () => recordCompetitionResult(unresolved, unresolved.fixtures[0].id, { score: [0, 0] }),
    (error) => error instanceof CompetitionEngineError && error.code === "TIEBREAK_REQUIRED",
  );
});

test("pacote da temporada combina torneios ativos, ordena calendario e avanca resultado", () => {
  const league = definition({ id: "LEAGUE", ids: ["A", "B", "C", "D"] });
  const cup = definition({
    id: "CUP",
    ids: ["A", "D"],
    format: "knockout",
    tiebreakers: ["extra_time", "penalties"],
  });
  const inactive = { ...definition({ id: "ARCHIVED", ids: ["B", "C"] }), active: false };
  const initial = createCompetitionSeason([league, cup, inactive], {
    seasonNumber: 4,
    seasonYear: 2032,
    startDates: {
      LEAGUE: "2032-02-10",
      CUP: "2032-01-20",
    },
    kickoffTimes: ["19:00"],
  });

  assert.deepEqual(initial.tournamentIds, ["LEAGUE", "CUP"]);
  assert.equal(initial.competitions.length, 2);
  assert.equal(initial.fixtures.length, 7);
  assert.deepEqual(initial.calendar, initial.fixtures.map((fixture) => fixture.id));
  assert.equal(initial.fixtures[0].competitionId, "CUP");
  assert.equal(initial.fixtures.every((fixture, index, fixtures) => (
    index === 0 || fixture.scheduledAt >= fixtures[index - 1].scheduledAt
  )), true);

  const cupFixture = initial.fixtures.find((fixture) => fixture.competitionId === "CUP");
  const advanced = recordCompetitionSeasonResult(initial, cupFixture.id, { score: [3, 1] });
  assert.equal(initial.completedFixtureIds.length, 0, "pacote recebido deve permanecer imutavel");
  assert.deepEqual(advanced.completedFixtureIds, [cupFixture.id]);
  assert.deepEqual(advanced.winners, [{ tournamentId: "CUP", clubId: cupFixture.homeClubId }]);
  assert.equal(advanced.status, "active");
});

test("promocao e rebaixamento usam classificacoes reais sem mutar divisoes", () => {
  const upper = completeRankedLeague(["A", "B", "C", "D"], "DIV-1");
  const lower = completeRankedLeague(["E", "F", "G", "H"], "DIV-2");
  const divisions = [
    { id: "SERIE-A", competitionId: "DIV-1", level: 1, teamIds: ["A", "B", "C", "D"] },
    { id: "SERIE-B", competitionId: "DIV-2", level: 2, teamIds: ["E", "F", "G", "H"] },
  ];
  const result = applyPromotionRelegation({
    divisions,
    competitionStates: [upper, lower],
    transitions: [{
      upperDivisionId: "SERIE-A",
      lowerDivisionId: "SERIE-B",
      promotionSlots: 2,
      relegationSlots: 2,
    }],
  });

  assert.deepEqual(divisions[0].teamIds, ["A", "B", "C", "D"]);
  assert.deepEqual(result.divisions.map((division) => [division.id, division.teamIds]), [
    ["SERIE-A", ["A", "B", "E", "F"]],
    ["SERIE-B", ["G", "H", "C", "D"]],
  ]);
  assert.deepEqual(result.movements, [
    { clubId: "E", type: "promotion", fromDivisionId: "SERIE-B", toDivisionId: "SERIE-A", position: 1 },
    { clubId: "F", type: "promotion", fromDivisionId: "SERIE-B", toDivisionId: "SERIE-A", position: 2 },
    { clubId: "C", type: "relegation", fromDivisionId: "SERIE-A", toDivisionId: "SERIE-B", position: 3 },
    { clubId: "D", type: "relegation", fromDivisionId: "SERIE-A", toDivisionId: "SERIE-B", position: 4 },
  ]);
});

test("promocao recusa temporada incompleta e configuracoes invalidas", () => {
  const upper = createCompetitionState(definition({ id: "OPEN-1", ids: ["A", "B"] }));
  const lower = createCompetitionState(definition({ id: "OPEN-2", ids: ["C", "D"] }));
  assert.throws(() => applyPromotionRelegation({
    divisions: [
      { id: "A", competitionId: "OPEN-1", level: 1, teamIds: ["A", "B"] },
      { id: "B", competitionId: "OPEN-2", level: 2, teamIds: ["C", "D"] },
    ],
    competitionStates: [upper, lower],
    transitions: [{
      upperDivisionId: "A", lowerDivisionId: "B", promotionSlots: 1, relegationSlots: 1,
    }],
  }), (error) => error instanceof CompetitionEngineError && error.code === "DIVISION_NOT_COMPLETED");

  assert.throws(
    () => createCompetitionState(definition({ ids: ["A", "A"] })),
    (error) => error instanceof CompetitionEngineError && error.code === "DUPLICATE_PARTICIPANT",
  );
  assert.throws(
    () => createCompetitionState(definition({
      ids: ["A", "B"], format: "knockout", legs: "single", tiebreakers: ["away_goals"],
    })),
    (error) => error instanceof CompetitionEngineError && error.code === "AWAY_GOALS_REQUIRES_DOUBLE_LEG",
  );
});

test("mesma definicao gera ids e calendario deterministas e serializaveis", () => {
  const input = definition({
    id: "COPA-SAO-PAULO",
    ids: ["A", "B", "C", "D", "E"],
    format: "knockout",
    tiebreakers: ["extra_time", "penalties"],
  });
  const options = { seasonNumber: 2, seasonYear: 2033, startDate: "2033-05-05" };
  const left = createCompetitionState(input, options);
  const right = createCompetitionState(input, options);
  assert.deepEqual(left, right);
  assert.doesNotThrow(() => JSON.stringify(left));
  assert.equal(new Set(left.fixtures.map((fixture) => fixture.id)).size, left.fixtures.length);
});
