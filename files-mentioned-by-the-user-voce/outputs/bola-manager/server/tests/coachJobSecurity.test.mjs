import assert from "node:assert/strict";
import test from "node:test";

import {
  applyFanAtmosphereToFixture,
  DEFAULT_COACH_JOB_SECURITY_CONFIG,
  evaluateCoachJobSecurity,
} from "../game/coachJobSecurity.mjs";

const NOW = "2026-07-28T12:00:00.000Z";
const CLUB_IDS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function appointment(overrides = {}) {
  return {
    id: "appointment:coach-a:A",
    coachId: "coach-a",
    clubId: "A",
    role: "head_coach",
    status: "active",
    startedSeason: 1,
    startedRound: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function club(id, overrides = {}) {
  return {
    id,
    name: `Clube ${id}`,
    reputation: id === "A" ? 60 : 50,
    squadStrength: 70 - CLUB_IDS.indexOf(id),
    ...overrides,
  };
}

function leagueFixture(overrides = {}) {
  const clubs = CLUB_IDS.map((id) => club(id));
  return {
    id: "L1",
    name: "Liga Nacional",
    totalRounds: 10,
    relegationSlots: 2,
    clubs,
    ...overrides,
    clubs: overrides.clubs ?? clubs,
  };
}

function roomFixture(options = {}) {
  const league = options.league ?? leagueFixture();
  const targetClub = league.clubs.find(({ id }) => id === "A");
  if (options.profile) targetClub.coachSecurityProfile = structuredClone(options.profile);
  const coach = {
    id: "coach-a",
    name: "Treinador A",
    managerType: options.managerType ?? "human",
    status: "employed",
    currentClubId: "A",
    reputation: options.coachReputation ?? 60,
    boardConfidence: options.boardConfidence ?? 55,
    titles: structuredClone(options.titles ?? []),
    assignments: [{
      clubId: "A",
      coachId: "coach-a",
      role: "head_coach",
      startedSeason: 1,
      startedRound: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      endedSeason: null,
      endedRound: null,
      endedAt: null,
    }],
  };
  return {
    code: "SECURITY",
    currentSeason: 1,
    seasonYear: 2026,
    managers: [{ id: "coach-a", name: "Treinador A", clubId: "A" }],
    coachCareerState: { coaches: [coach] },
    competitionCatalog: [league],
    tournamentCatalog: [],
    competitionSeason: { competitions: [], winners: [] },
    seasonHistory: structuredClone(options.seasonHistory ?? []),
    completedMatches: structuredClone(options.completedMatches ?? []),
    leagueFixtureSchedule: structuredClone(options.leagueFixtureSchedule ?? []),
    leagueMatchResults: structuredClone(options.leagueMatchResults ?? []),
    rivalries: options.withRivalry === false
      ? []
      : [{ id: "rivalry:A:B", clubIds: ["A", "B"], importance: 90 }],
    clubMoraleStates: [{ clubId: "A", score: options.squadMorale ?? 65 }],
    marketState: { finances: [{ clubId: "A", balance: options.balance ?? 50_000_000 }] },
  };
}

function match(round, homeClubId, awayClubId, score, fixture = {}) {
  return {
    fixture: {
      leagueFixtureId: fixture.leagueFixtureId ?? `fixture:${round}:${homeClubId}:${awayClubId}`,
      leagueId: "L1",
      round,
      homeClubId,
      awayClubId,
      ...fixture,
    },
    score,
  };
}

function statistics(matches, clubId = "A") {
  return matches.reduce((result, entry) => {
    const home = entry.fixture.homeClubId === clubId;
    const own = entry.score[home ? 0 : 1];
    const opponent = entry.score[home ? 1 : 0];
    result.games += 1;
    result.goalsFor += own;
    result.goalsAgainst += opponent;
    if (own > opponent) {
      result.wins += 1;
      result.points += 3;
    } else if (own === opponent) {
      result.draws += 1;
      result.points += 1;
    } else {
      result.losses += 1;
    }
    return result;
  }, { games: 0, points: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
}

function standingsAt(position, options = {}) {
  const order = CLUB_IDS.filter((id) => id !== "A");
  order.splice(position - 1, 0, "A");
  const defaultPoints = [27, 24, 21, 18, 16, 14, 12, 10, 7, 4];
  return order.map((clubId, index) => ({
    clubId,
    played: options.played ?? options.round ?? 1,
    points: clubId === "A"
      ? (options.targetPoints ?? defaultPoints[index])
      : (index === 7 && options.safetyPoints != null ? options.safetyPoints : defaultPoints[index]),
    goalDifference: 10 - index,
  }));
}

function employmentState(previous = null, jobSecurity = undefined) {
  return {
    evaluations: previous ? [previous] : [],
    jobSecurity,
  };
}

function appendEvaluation(state, result) {
  return {
    ...state,
    evaluations: [...(state.evaluations ?? []), result.evaluation],
    jobSecurity: result.jobSecurityState,
  };
}

function evaluate(options = {}) {
  const league = options.league ?? leagueFixture();
  const room = options.room ?? roomFixture({ league });
  const matches = options.matches ?? [];
  const stats = options.statistics ?? statistics(matches);
  const round = options.round ?? Math.max(1, ...matches.map((entry) => entry.fixture.round));
  const position = options.position ?? 6;
  return evaluateCoachJobSecurity({
    room,
    league,
    appointment: options.appointment ?? appointment(),
    contract: options.contract ?? { id: "contract-a", clubId: "A", coachId: "coach-a", status: "active", objectives: [] },
    employmentState: options.employmentState ?? employmentState(),
    relevantMatches: matches,
    standings: options.standings ?? standingsAt(position, { round }),
    statistics: stats,
    expectation: options.expectation ?? { expectedPosition: 6, expectedPointsPerGame: 1.35 },
    position,
    round,
    seasonNumber: 1,
    now: options.now ?? NOW,
    minimumGames: options.minimumGames ?? 99,
    config: options.config,
    evaluationId: options.evaluationId,
  });
}

function severity(recommendation) {
  return ({ insufficient_data: 0, retain: 1, review: 2, dismiss: 3 })[recommendation] ?? 0;
}

test("1. vitoria em classico aumenta o apoio da torcida", () => {
  const league = leagueFixture();
  const room = roomFixture({ league });
  const classic = evaluate({
    league,
    room,
    matches: [match(1, "A", "B", [2, 0])],
    position: 3,
  });
  const ordinary = evaluate({
    league,
    room,
    matches: [match(1, "A", "C", [2, 0])],
    position: 3,
  });

  assert.equal(classic.evaluation.classics.wins, 1);
  assert.equal(classic.evaluation.memory.at(-1).type, "classic_win");
  assert.equal(classic.evaluation.factors.some(({ code }) => code === "classic_support"), true);
  assert.ok(classic.evaluation.fanSupport.value > ordinary.evaluation.fanSupport.value);
});

test("2. sequencia de derrotas em classicos reduz a seguranca", () => {
  const league = leagueFixture();
  const room = roomFixture({ league });
  const matches = [
    match(1, "A", "B", [0, 1]),
    match(2, "B", "A", [2, 0]),
    match(3, "A", "B", [0, 2]),
  ];
  let state = employmentState();
  const evaluations = [];
  for (let round = 1; round <= 3; round += 1) {
    const relevant = matches.slice(0, round);
    const result = evaluate({
      league,
      room,
      matches: relevant,
      employmentState: state,
      round,
      position: 8,
      standings: standingsAt(8, { round, targetPoints: 10 - round }),
    });
    evaluations.push(result.evaluation);
    state = appendEvaluation(state, result);
  }

  assert.equal(evaluations[2].classics.losses, 3);
  assert.equal(evaluations[2].classics.winlessStreak, 3);
  assert.ok(evaluations[2].classics.impact < evaluations[0].classics.impact);
  assert.ok(evaluations[2].score < evaluations[0].score);
  assert.ok(evaluations[2].fanSupport.value < evaluations[0].fanSupport.value);
});

test("3. goleada sofrida para rival causa impacto adicional", () => {
  const league = leagueFixture();
  const room = roomFixture({ league });
  const narrow = evaluate({ league, room, matches: [match(1, "A", "B", [0, 1])], position: 7 });
  const heavy = evaluate({ league, room, matches: [match(1, "A", "B", [0, 4])], position: 7 });

  assert.equal(narrow.evaluation.classics.heavyLosses, 0);
  assert.equal(heavy.evaluation.classics.heavyLosses, 1);
  assert.equal(heavy.evaluation.factors.some(({ code }) => code === "classic_heavy_losses"), true);
  assert.ok(heavy.evaluation.memory.at(-1).impact < narrow.evaluation.memory.at(-1).impact);
  assert.ok(heavy.evaluation.score < narrow.evaluation.score);
});

test("4. entrada na zona de rebaixamento derruba a seguranca", () => {
  const league = leagueFixture();
  const room = roomFixture({ league, withRivalry: false });
  const matches = [match(1, "A", "C", [1, 1]), match(2, "D", "A", [2, 0])];
  const safe = evaluate({
    league,
    room,
    matches: matches.slice(0, 1),
    round: 1,
    position: 7,
    standings: standingsAt(7, { round: 1, targetPoints: 10 }),
  });
  const state = appendEvaluation(employmentState(), safe);
  const inZone = evaluate({
    league,
    room,
    matches,
    employmentState: state,
    round: 2,
    position: 9,
    standings: standingsAt(9, { round: 2, targetPoints: 4, safetyPoints: 8 }),
  });

  assert.equal(safe.evaluation.relegation.inZone, false);
  assert.equal(inZone.evaluation.relegation.state, "in_zone");
  assert.equal(inZone.evaluation.relegation.consecutiveRounds, 1);
  assert.ok(inZone.evaluation.score < safe.evaluation.score);
  assert.equal(inZone.evaluation.factors.some(({ code }) => code === "relegation_zone"), true);
});

test("5. permanencia prolongada na zona aumenta gradualmente o risco", () => {
  const league = leagueFixture();
  const room = roomFixture({ league, withRivalry: false });
  const matches = [
    match(1, "A", "C", [0, 1]),
    match(2, "D", "A", [2, 0]),
    match(3, "A", "E", [0, 2]),
  ];
  let state = employmentState();
  const evaluations = [];
  for (let round = 1; round <= 3; round += 1) {
    const relevant = matches.slice(0, round);
    const result = evaluate({
      league,
      room,
      matches: relevant,
      employmentState: state,
      round,
      position: 9,
      standings: standingsAt(9, { round, targetPoints: 3, safetyPoints: 8 }),
      minimumGames: 99,
    });
    evaluations.push(result.evaluation);
    state = appendEvaluation(state, result);
  }

  assert.equal(evaluations[2].relegation.state, "prolonged_zone");
  assert.equal(evaluations[2].relegation.consecutiveRounds, 3);
  assert.ok(evaluations[2].relegation.risk > evaluations[0].relegation.risk);
  assert.ok(evaluations[2].score < evaluations[0].score);
});

test("6. rebaixamento confirmado provoca reavaliacao imediata", () => {
  const league = leagueFixture({ totalRounds: 10 });
  const room = roomFixture({ league, withRivalry: false });
  const result = evaluate({
    league,
    room,
    matches: [match(9, "A", "C", [0, 2])],
    statistics: { games: 9, points: 2, wins: 0, draws: 2, losses: 7, goalsFor: 4, goalsAgainst: 20 },
    round: 9,
    position: 9,
    standings: standingsAt(9, { played: 9, targetPoints: 2, safetyPoints: 8 }),
    minimumGames: 1,
  });

  assert.equal(result.evaluation.relegation.confirmed, true);
  assert.equal(result.evaluation.relegation.risk, 100);
  assert.equal(result.evaluation.activeUltimatum?.objective.type, "leave_relegation_zone");
  assert.equal(result.actions.some(({ type }) => type === "COACH_SECURITY_ULTIMATUM_CREATED"), true);
  assert.ok(["review", "dismiss"].includes(result.evaluation.recommendation));
});

test("7. permanencia conquistada recupera parte da confianca", () => {
  const league = leagueFixture({ totalRounds: 10 });
  const room = roomFixture({ league, withRivalry: false });
  const matches = [match(9, "A", "C", [0, 1]), match(10, "A", "D", [2, 0])];
  const threatened = evaluate({
    league,
    room,
    matches: matches.slice(0, 1),
    statistics: { games: 9, points: 8, wins: 1, draws: 5, losses: 3, goalsFor: 8, goalsAgainst: 12 },
    round: 9,
    position: 9,
    standings: standingsAt(9, { played: 9, targetPoints: 8, safetyPoints: 10 }),
  });
  const state = appendEvaluation(employmentState(), threatened);
  const survived = evaluate({
    league,
    room,
    matches,
    statistics: { games: 10, points: 11, wins: 2, draws: 5, losses: 3, goalsFor: 10, goalsAgainst: 12 },
    employmentState: state,
    round: 10,
    position: 8,
    standings: standingsAt(8, { played: 10, targetPoints: 11 }),
  });

  assert.equal(survived.evaluation.relegation.state, "survival_secured");
  assert.equal(survived.evaluation.factors.some(({ code, impact }) => code === "survival_secured" && impact > 0), true);
  assert.ok(survived.evaluation.boardSupport.privateValue > threatened.evaluation.boardSupport.privateValue);
  assert.ok(survived.evaluation.score > threatened.evaluation.score);
});

test("8. diretoria forte mantem treinador apesar da rejeicao da torcida", () => {
  const profile = {
    type: "structured",
    presidentPower: 100,
    fanInfluence: 20,
    politicalStability: 95,
    badResultsTolerance: 90,
    meetingThreshold: 25,
    ultimatumThreshold: 15,
    dismissalThreshold: 5,
  };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, boardConfidence: 95, withRivalry: false });
  const result = evaluate({
    league,
    room,
    matches: [match(1, "A", "C", [0, 1])],
    position: 7,
    employmentState: employmentState(null, {
      fanSupportByClubId: { A: { value: 10, state: "unsustainable", trend: "falling", updatedAt: NOW } },
    }),
    minimumGames: 1,
  });

  assert.ok(result.evaluation.fanSupport.value < 32);
  assert.ok(result.evaluation.boardSupport.privateValue >= 58);
  assert.equal(result.evaluation.boardSupport.realIntent, "retain");
  assert.equal(result.evaluation.recommendation, "retain");
});

test("9. diretoria fragil cede mais rapidamente a pressao da torcida", () => {
  const stableProfile = {
    type: "structured",
    presidentPower: 100,
    fanInfluence: 20,
    politicalStability: 95,
    badResultsTolerance: 90,
    meetingThreshold: 25,
    ultimatumThreshold: 15,
    dismissalThreshold: 5,
  };
  const weakProfile = {
    type: "unstable",
    presidentPower: 10,
    fanInfluence: 100,
    politicalStability: 5,
    badResultsTolerance: 0,
    meetingThreshold: 80,
    ultimatumThreshold: 70,
    dismissalThreshold: 55,
  };
  const stableLeague = leagueFixture();
  const weakLeague = leagueFixture();
  const fanState = {
    fanSupportByClubId: { A: { value: 8, state: "unsustainable", trend: "falling", updatedAt: NOW } },
  };
  const common = {
    matches: [match(1, "A", "C", [0, 3])],
    statistics: { games: 6, points: 2, wins: 0, draws: 2, losses: 4, goalsFor: 3, goalsAgainst: 13 },
    round: 6,
    position: 8,
    standings: standingsAt(8, { round: 6, targetPoints: 2 }),
    minimumGames: 1,
  };
  const strong = evaluate({
    ...common,
    league: stableLeague,
    room: roomFixture({ league: stableLeague, profile: stableProfile, boardConfidence: 55, withRivalry: false }),
    employmentState: employmentState(null, fanState),
  });
  const weak = evaluate({
    ...common,
    league: weakLeague,
    room: roomFixture({ league: weakLeague, profile: weakProfile, boardConfidence: 55, withRivalry: false }),
    employmentState: employmentState(null, fanState),
  });

  assert.ok(weak.evaluation.boardSupport.privateValue < strong.evaluation.boardSupport.privateValue);
  assert.ok(severity(weak.evaluation.recommendation) > severity(strong.evaluation.recommendation));
  assert.equal(weak.actions.some(({ type }) => type === "COACH_SECURITY_MEETING_HELD"), true);
});

test("10. credito acumulado protege treinador durante ma fase", () => {
  const profile = {
    type: "structured",
    projectPatience: 100,
    meetingThreshold: 46,
    ultimatumThreshold: 32,
    dismissalThreshold: 20,
  };
  const veteranLeague = leagueFixture();
  const newcomerLeague = leagueFixture();
  const badMatches = [
    match(1, "A", "C", [0, 1]),
    match(2, "D", "A", [2, 0]),
    match(3, "A", "E", [0, 1]),
  ];
  const veteran = evaluate({
    league: veteranLeague,
    room: roomFixture({
      league: veteranLeague,
      profile,
      titles: [{ id: "title-1" }, { id: "title-2" }, { id: "title-3" }, { id: "title-4" }],
      boardConfidence: 75,
      withRivalry: false,
    }),
    matches: badMatches,
    statistics: { games: 8, points: 7, wins: 2, draws: 1, losses: 5, goalsFor: 7, goalsAgainst: 13 },
    round: 8,
    position: 8,
    standings: standingsAt(8, { round: 8, targetPoints: 7 }),
    minimumGames: 1,
  });
  const newcomer = evaluate({
    league: newcomerLeague,
    room: roomFixture({ league: newcomerLeague, profile, titles: [], boardConfidence: 75, withRivalry: false }),
    matches: badMatches,
    statistics: { games: 8, points: 7, wins: 2, draws: 1, losses: 5, goalsFor: 7, goalsAgainst: 13 },
    round: 8,
    position: 8,
    standings: standingsAt(8, { round: 8, targetPoints: 7 }),
    minimumGames: 1,
  });

  assert.ok(veteran.evaluation.accumulatedCredit.value > newcomer.evaluation.accumulatedCredit.value);
  assert.ok(veteran.evaluation.score > newcomer.evaluation.score);
  assert.notEqual(veteran.evaluation.recommendation, "dismiss");
  assert.ok(severity(veteran.evaluation.recommendation) <= severity(newcomer.evaluation.recommendation));
});

test("11. sequencia ruim reduz o credito acumulado", () => {
  const league = leagueFixture();
  const room = roomFixture({ league, withRivalry: false });
  const seeded = {
    id: "coach-evaluation:appointment:coach-a:A:s1:r1",
    appointmentId: appointment().id,
    coachId: "coach-a",
    clubId: "A",
    seasonNumber: 1,
    round: 1,
    score: 70,
    securityLevel: "safe",
    accumulatedCredit: { value: 70, label: "Credito alto", delta: 0, knownTitles: 0 },
    dimensions: [],
    boardSupport: { privateValue: 70, publicValue: 72 },
    fanSupport: { value: 60 },
    relegation: { inZone: false, consecutiveRounds: 0 },
    memory: [],
  };
  const matches = [
    match(2, "A", "C", [0, 1]),
    match(3, "D", "A", [2, 0]),
    match(4, "A", "E", [0, 3]),
  ];
  let state = employmentState(seeded);
  const values = [seeded.accumulatedCredit.value];
  for (let round = 2; round <= 4; round += 1) {
    const relevant = matches.filter((entry) => entry.fixture.round <= round);
    const result = evaluate({
      league,
      room,
      matches: relevant,
      employmentState: state,
      round,
      position: 8,
      standings: standingsAt(8, { round, targetPoints: 7 }),
    });
    values.push(result.evaluation.accumulatedCredit.value);
    state = appendEvaluation(state, result);
  }

  assert.ok(values[1] < values[0]);
  assert.ok(values[2] < values[1]);
  assert.ok(values[3] < values[2]);
});

test("12. apoio publico pode divergir da confianca privada", () => {
  const profile = { type: "structured", presidentPower: 100, fanInfluence: 20 };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, boardConfidence: 30, withRivalry: false });
  const result = evaluate({
    league,
    room,
    matches: [match(1, "A", "C", [0, 1])],
    position: 7,
    minimumGames: 99,
  });
  const board = result.evaluation.boardSupport;

  assert.ok(board.publicValue > board.privateValue);
  assert.equal(board.privateEstimate.source, "public_signals");
  assert.ok(board.privateEstimate.min < board.privateEstimate.max);
  assert.ok(board.privateValue >= board.privateEstimate.min && board.privateValue <= board.privateEstimate.max);
});

test("13. ultimato possui prazo, objetivo e consequencia", () => {
  const profile = {
    type: "unstable",
    meetingThreshold: 90,
    ultimatumThreshold: 90,
    dismissalThreshold: 10,
  };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, withRivalry: false });
  const result = evaluate({
    league,
    room,
    matches: [match(1, "A", "C", [0, 2])],
    statistics: { games: 5, points: 1, wins: 0, draws: 1, losses: 4, goalsFor: 2, goalsAgainst: 11 },
    round: 5,
    position: 8,
    standings: standingsAt(8, { round: 5, targetPoints: 1 }),
    minimumGames: 1,
  });
  const ultimatum = result.evaluation.activeUltimatum;

  assert.ok(ultimatum);
  assert.equal(ultimatum.deadlineRound, 5 + DEFAULT_COACH_JOB_SECURITY_CONFIG.ultimatumRounds);
  assert.ok(ultimatum.objective.type);
  assert.ok(ultimatum.objective.label);
  assert.ok(ultimatum.objective.target > 0);
  assert.ok(ultimatum.consequence);
  assert.equal(result.actions.some(({ type }) => type === "COACH_SECURITY_ULTIMATUM_CREATED"), true);
});

test("14. cumprimento do ultimato recupera parte da seguranca", () => {
  const profile = {
    type: "unstable",
    meetingThreshold: 90,
    ultimatumThreshold: 90,
    dismissalThreshold: 10,
  };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, withRivalry: false });
  const initialMatches = [match(1, "A", "C", [0, 2])];
  const initial = evaluate({
    league,
    room,
    matches: initialMatches,
    statistics: { games: 5, points: 1, wins: 0, draws: 1, losses: 4, goalsFor: 2, goalsAgainst: 11 },
    round: 5,
    position: 8,
    standings: standingsAt(8, { round: 5, targetPoints: 1 }),
    minimumGames: 1,
  });
  assert.equal(initial.evaluation.activeUltimatum.objective.type, "points");
  const state = appendEvaluation(employmentState(), initial);
  const recoveredMatches = [
    ...initialMatches,
    match(6, "A", "D", [2, 0]),
    match(7, "E", "A", [1, 1]),
  ];
  const recovered = evaluate({
    league,
    room,
    matches: recoveredMatches,
    statistics: { games: 7, points: 5, wins: 1, draws: 2, losses: 4, goalsFor: 5, goalsAgainst: 12 },
    employmentState: state,
    round: 7,
    position: 7,
    standings: standingsAt(7, { round: 7, targetPoints: 5 }),
    minimumGames: 1,
  });

  assert.equal(recovered.evaluation.ultimatumOutcome, "fulfilled");
  assert.equal(recovered.evaluation.activeUltimatum, null);
  assert.equal(recovered.jobSecurityState.ultimatums.at(-1).status, "fulfilled");
  assert.equal(recovered.actions.some(({ type }) => type === "COACH_SECURITY_ULTIMATUM_FULFILLED"), true);
  assert.ok(recovered.evaluation.score > initial.evaluation.score);
  assert.ok(recovered.evaluation.score - initial.evaluation.score <= DEFAULT_COACH_JOB_SECURITY_CONFIG.maximumNormalChange);
});

test("15. descumprimento do ultimato inicia demissao", () => {
  const profile = {
    type: "unstable",
    meetingThreshold: 90,
    ultimatumThreshold: 90,
    dismissalThreshold: 10,
  };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, withRivalry: false });
  const initialMatches = [match(1, "A", "C", [0, 2])];
  const initial = evaluate({
    league,
    room,
    matches: initialMatches,
    statistics: { games: 5, points: 1, wins: 0, draws: 1, losses: 4, goalsFor: 2, goalsAgainst: 11 },
    round: 5,
    position: 8,
    standings: standingsAt(8, { round: 5, targetPoints: 1 }),
    minimumGames: 1,
  });
  const state = appendEvaluation(employmentState(), initial);
  const deadlineMatches = [
    ...initialMatches,
    match(6, "A", "D", [0, 1]),
    match(7, "E", "A", [2, 0]),
    match(8, "A", "F", [0, 1]),
  ];
  const failed = evaluate({
    league,
    room,
    matches: deadlineMatches,
    statistics: { games: 8, points: 1, wins: 0, draws: 1, losses: 7, goalsFor: 2, goalsAgainst: 15 },
    employmentState: state,
    round: 8,
    position: 8,
    standings: standingsAt(8, { round: 8, targetPoints: 1 }),
    minimumGames: 1,
  });

  assert.equal(failed.evaluation.ultimatumOutcome, "failed");
  assert.equal(failed.jobSecurityState.ultimatums.at(-1).status, "failed");
  assert.equal(failed.evaluation.recommendation, "dismiss");
  assert.equal(failed.evaluation.boardSupport.realIntent, "dismiss");
  assert.ok(failed.evaluation.score <= 18);
  assert.equal(failed.actions.some(({ type }) => type === "COACH_SECURITY_ULTIMATUM_FAILED"), true);
});

test("16. clubes com perfis diferentes reagem de maneira distinta", () => {
  const patientProfile = {
    type: "development",
    badResultsTolerance: 100,
    projectPatience: 100,
    fanInfluence: 20,
    meetingThreshold: 25,
    ultimatumThreshold: 15,
    dismissalThreshold: 5,
  };
  const volatileProfile = {
    type: "unstable",
    badResultsTolerance: 0,
    projectPatience: 0,
    fanInfluence: 100,
    politicalStability: 0,
    meetingThreshold: 80,
    ultimatumThreshold: 70,
    dismissalThreshold: 55,
  };
  const patientLeague = leagueFixture();
  const volatileLeague = leagueFixture();
  const common = {
    matches: [match(1, "A", "C", [0, 2]), match(2, "D", "A", [1, 0])],
    statistics: { games: 6, points: 3, wins: 1, draws: 0, losses: 5, goalsFor: 4, goalsAgainst: 13 },
    round: 6,
    position: 8,
    standings: standingsAt(8, { round: 6, targetPoints: 3 }),
    minimumGames: 1,
  };
  const patient = evaluate({
    ...common,
    league: patientLeague,
    room: roomFixture({ league: patientLeague, profile: patientProfile, withRivalry: false }),
  });
  const volatile = evaluate({
    ...common,
    league: volatileLeague,
    room: roomFixture({ league: volatileLeague, profile: volatileProfile, withRivalry: false }),
  });

  assert.notEqual(patient.evaluation.score, volatile.evaluation.score);
  assert.ok(severity(volatile.evaluation.recommendation) > severity(patient.evaluation.recommendation));
  assert.equal(patient.evaluation.recommendation, "retain");
  assert.equal(volatile.actions.some(({ type }) => type === "COACH_SECURITY_ULTIMATUM_CREATED"), true);
});

test("17. reexecucao do calculo nao duplica eventos", () => {
  const profile = {
    type: "unstable",
    meetingThreshold: 90,
    ultimatumThreshold: 90,
    dismissalThreshold: 10,
  };
  const league = leagueFixture();
  const room = roomFixture({ league, profile, withRivalry: false });
  const first = evaluate({
    league,
    room,
    matches: [match(5, "A", "C", [0, 2])],
    statistics: { games: 5, points: 1, wins: 0, draws: 1, losses: 4, goalsFor: 2, goalsAgainst: 11 },
    round: 5,
    position: 8,
    standings: standingsAt(8, { round: 5, targetPoints: 1 }),
    minimumGames: 1,
    evaluationId: "security-idempotency",
  });
  const persisted = {
    evaluations: [first.evaluation],
    jobSecurity: first.jobSecurityState,
  };
  const replay = evaluate({
    league,
    room,
    matches: [match(5, "A", "C", [0, 2])],
    statistics: { games: 5, points: 1, wins: 0, draws: 1, losses: 4, goalsFor: 2, goalsAgainst: 11 },
    employmentState: persisted,
    round: 5,
    position: 8,
    standings: standingsAt(8, { round: 5, targetPoints: 1 }),
    minimumGames: 1,
    evaluationId: "security-idempotency",
  });

  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.evaluation, first.evaluation);
  assert.deepEqual(replay.actions, []);
  assert.equal(replay.jobSecurityState.history.length, first.jobSecurityState.history.length);
  assert.equal(replay.jobSecurityState.meetings.length, first.jobSecurityState.meetings.length);
  assert.equal(replay.jobSecurityState.ultimatums.length, first.jobSecurityState.ultimatums.length);
  assert.equal(new Set(replay.jobSecurityState.processedSignalIds).size, replay.jobSecurityState.processedSignalIds.length);
});

test("declaracao publica persistida altera o apoio da torcida uma unica vez", () => {
  const league = leagueFixture();
  const publicStatement = {
    id: "match:press",
    pressConferenceSubmissions: [{
      matchId: "match:press",
      managerId: "coach-a",
      clubId: "A",
      submittedAt: "2026-07-27T12:00:00.000Z",
      effects: { squadMoraleDelta: 5 },
    }],
  };
  const withStatement = evaluate({
    league,
    room: roomFixture({ league, completedMatches: [publicStatement] }),
    matches: [match(1, "A", "C", [1, 1])],
  });
  const withoutStatement = evaluate({
    league,
    room: roomFixture({ league }),
    matches: [match(1, "A", "C", [1, 1])],
  });

  assert.ok(withStatement.evaluation.fanSupport.value > withoutStatement.evaluation.fanSupport.value);
  assert.equal(withStatement.evaluation.fanSupport.publicDeclarations.count, 1);
  assert.equal(withStatement.evaluation.factors.some(({ code }) => code === "public_declarations_support"), true);
});

test("apoio da torcida gera bonus pequeno e auditavel apenas para o mandante", () => {
  const room = roomFixture();
  room.coachEmploymentState = {
    jobSecurity: {
      fanSupportByClubId: {
        A: { value: 90, state: "idolized" },
      },
    },
  };
  const adjusted = applyFanAtmosphereToFixture(room, {
    homeClubId: "A",
    awayClubId: "B",
    homeStrength: 10,
    awayStrength: 10,
    strengthProfile: {
      home: { effective: 10 },
      away: { effective: 10 },
    },
  });

  assert.ok(adjusted.homeStrength > 10);
  assert.equal(adjusted.awayStrength, 10);
  assert.equal(adjusted.fanAtmosphere.support, 90);
  assert.equal(adjusted.strengthProfile.home.fanAtmosphereBonus, adjusted.fanAtmosphere.strengthModifier);
});
