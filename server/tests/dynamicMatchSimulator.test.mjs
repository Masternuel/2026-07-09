import assert from "node:assert/strict";
import test from "node:test";
import { simulateMatch } from "../game/matchSimulator.mjs";

const POSITIONS = Object.freeze([
  "GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "ATA", "PD",
]);

function attributes(value, overrides = {}) {
  return {
    velocidade: value,
    chute: value,
    drible: value,
    nocao: value,
    defesa: value,
    passe: value,
    peBom: value,
    peRuim: Math.max(1, value - 3),
    forca: value,
    resistencia: value,
    impulsao: value,
    reflexos: value,
    posicionamentoGol: value,
    saidaGol: value,
    penaltis: value,
    ...overrides,
  };
}

function player(prefix, clubId, index, position = POSITIONS[index - 1] ?? "MC", rating = 12) {
  return {
    id: `${prefix}-${String(index).padStart(2, "0")}`,
    clubId,
    name: `${clubId} Jogador ${index}`,
    shortName: `${clubId}-${index}`,
    position,
    overall: rating,
    condition: 100,
    active: true,
    attributes: attributes(rating, position === "GOL" ? {
      chute: 5,
      drible: 7,
      reflexos: rating + 2,
      posicionamentoGol: rating + 1,
      saidaGol: rating,
    } : {}),
  };
}

function roster(prefix, clubId, rating) {
  const starters = POSITIONS.map((position, index) => (
    player(prefix, clubId, index + 1, position, Math.min(20, rating + (index % 3)))
  ));
  return [
    ...starters,
    player(prefix, clubId, 12, "GOL", rating - 1),
    player(prefix, clubId, 13, "ZAG", rating - 1),
    player(prefix, clubId, 14, "MC", rating),
    player(prefix, clubId, 15, "PE", rating),
    player(prefix, clubId, 16, "ATA", rating + 1),
  ];
}

const homeRoster = roster("home", "AUR", 15);
const awayRoster = roster("away", "SAN", 13);
const homePlayers = homeRoster.slice(0, 11);
const awayPlayers = awayRoster.slice(0, 11);

function matchInput(seed = "dynamic-v2") {
  return {
    simulationVersion: 2,
    homeClubId: "AUR",
    awayClubId: "SAN",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeStrength: 14,
    awayStrength: 12,
    homeGoalkeeperRating: 17,
    awayGoalkeeperRating: 14,
    homePlayers,
    awayPlayers,
    homeRoster,
    awayRoster,
    seed,
  };
}

function incidentRoster(prefix, {
  nocao = 1,
  resistencia = 10,
  chute = 10,
  backupGoalkeeper = false,
} = {}) {
  return Array.from({ length: 16 }, (_, index) => {
    const position = index === 0 || (backupGoalkeeper && index === 11)
      ? "GOL"
      : index < 5 ? "ZAG" : index < 8 ? "MC" : "ATA";
    return {
      id: `${prefix}${index}`,
      clubId: prefix,
      name: `${prefix}${index}`,
      position,
      overall: 10,
      condition: 100,
      active: true,
      attributes: attributes(10, { nocao, resistencia, chute }),
    };
  });
}

function incidentMatchInput(seed, options = {}) {
  const incidentHomeRoster = incidentRoster("h", options);
  const incidentAwayRoster = incidentRoster("a", options);
  return {
    simulationVersion: 2,
    seed,
    homeTeam: "H",
    awayTeam: "A",
    homeClubId: "h",
    awayClubId: "a",
    homePlayers: incidentHomeRoster.slice(0, 11),
    awayPlayers: incidentAwayRoster.slice(0, 11),
    homeRoster: incidentHomeRoster,
    awayRoster: incidentAwayRoster,
    ...(options.disciplinary ? {
      homeTacticalProfile: { available: true, disciplineRisk: 0.1 },
      awayTacticalProfile: { available: true, disciplineRisk: 0.1 },
    } : {}),
  };
}

function sideForEvent(event, match) {
  if (event.side === "home" || event.side === "away") return event.side;
  if (event.team === match.homeTeam) return "home";
  if (event.team === match.awayTeam) return "away";
  return null;
}

function firstHalf(match) {
  const halftimeIndex = match.events.findIndex((event) => event.type === "halftime");
  assert.notEqual(halftimeIndex, -1, "simulacao precisa emitir intervalo");
  return match.events.slice(0, halftimeIndex + 1);
}

function playersFor(match, side) {
  const values = match.playerStatistics?.[side];
  assert.ok(Array.isArray(values), `estatisticas individuais ausentes: ${side}`);
  return values;
}

function playerIdsForSide(side) {
  return new Set((side === "home" ? homeRoster : awayRoster).map((candidate) => candidate.id));
}

test("simulador v2 e deterministico e mantem eventos ordenados", () => {
  const first = simulateMatch(matchInput());
  const repeated = simulateMatch(matchInput());

  assert.deepEqual(first, repeated);
  assert.equal(first.simulationVersion, 2);
  assert.equal(first.events[0]?.type, "kickoff");
  assert.equal(first.events.at(-1)?.type, "fulltime");
  assert.deepEqual(first.events.at(-1)?.score, first.score);
  assert.equal(new Set(first.events.map((event) => event.id)).size, first.events.length);
  assert.deepEqual(
    first.events.map((event) => event.minute),
    [...first.events].map((event) => event.minute).sort((left, right) => left - right),
  );
});

test("identidade v2 distingue sala, fixture e temporada sem perder determinismo", () => {
  const identity = {
    ...matchInput("same-gameplay-seed"),
    roomCode: "BOLA-ROOM-1",
    fixtureId: "rodada-1",
    seasonNumber: 1,
  };
  const first = simulateMatch(identity);
  const repeated = simulateMatch(identity);
  const otherRoom = simulateMatch({ ...identity, roomCode: "BOLA-ROOM-2" });
  const otherFixture = simulateMatch({ ...identity, fixtureId: "rodada-2" });
  const otherSeason = simulateMatch({ ...identity, seasonNumber: 2 });

  assert.deepEqual(first, repeated);
  assert.equal(new Set([
    first.id,
    otherRoom.id,
    otherFixture.id,
    otherSeason.id,
  ]).size, 4);
});

test("seeds diferentes variam minutos e sequencia dos incidentes", () => {
  const signatures = new Set();
  const minuteSignatures = new Set();

  for (let index = 0; index < 12; index += 1) {
    const match = simulateMatch(matchInput(`dynamic-seed-${index}`));
    const incidents = match.events.filter((event) => !["kickoff", "halftime", "fulltime"].includes(event.type));
    signatures.add(incidents.map((event) => `${event.minute}:${event.type}`).join("|"));
    minuteSignatures.add(incidents.map((event) => event.minute).join("|"));
  }

  assert.ok(signatures.size >= 8, `pouca variacao de sequencia: ${signatures.size}/12`);
  assert.ok(minuteSignatures.size >= 8, `pouca variacao de minutos: ${minuteSignatures.size}/12`);
});

test("ajustes do intervalo preservam integralmente primeiro tempo", () => {
  const original = simulateMatch(matchInput("dynamic-halftime"));
  const adjustedHome = [
    ...homePlayers.slice(0, 9),
    homeRoster[14],
    homeRoster[15],
  ];
  const adjusted = simulateMatch({
    ...matchInput("dynamic-halftime"),
    homeSecondHalfModifier: 3,
    awaySecondHalfModifier: -2,
    homePhysicalSecondHalfModifier: 0.4,
    awayPhysicalSecondHalfModifier: -0.4,
    homeSecondHalfPlayers: adjustedHome,
    awaySecondHalfPlayers: awayPlayers,
  });

  assert.equal(adjusted.id, original.id);
  assert.deepEqual(firstHalf(adjusted), firstHalf(original));
  assert.notDeepEqual(
    adjusted.events.slice(firstHalf(adjusted).length),
    original.events.slice(firstHalf(original).length),
  );
});

test("gols, assistencias e estatisticas individuais fecham com placar", () => {
  const match = simulateMatch(matchInput("dynamic-player-stats"));
  const goals = match.events.filter((event) => event.type === "goal");
  const goalCount = { home: 0, away: 0 };
  const assistCount = { home: 0, away: 0 };

  for (const goal of goals) {
    const side = sideForEvent(goal, match);
    assert.ok(side, "gol precisa identificar lado");
    const validIds = playerIdsForSide(side);
    assert.ok(validIds.has(goal.scorerId), `scorerId invalido: ${goal.scorerId}`);
    goalCount[side] += 1;
    if (goal.assistId != null) {
      assert.ok(validIds.has(goal.assistId), `assistId invalido: ${goal.assistId}`);
      assert.notEqual(goal.assistId, goal.scorerId);
      assistCount[side] += 1;
    }
  }

  assert.deepEqual([goalCount.home, goalCount.away], match.score);
  for (const side of ["home", "away"]) {
    const individual = playersFor(match, side);
    const summed = (field) => individual.reduce((total, candidate) => total + (Number(candidate[field]) || 0), 0);
    assert.equal(summed("goals"), goalCount[side]);
    assert.equal(summed("assists"), assistCount[side]);
    assert.equal(summed("shots"), match.statistics[side].shots);
    assert.equal(summed("shotsOnTarget"), match.statistics[side].shotsOnTarget);
    assert.equal(summed("yellowCards"), match.statistics[side].yellowCards);
    assert.equal(summed("redCards"), match.statistics[side].redCards);
    assert.ok(individual.every((candidate) => candidate.minutesPlayed >= 0 && candidate.minutesPlayed <= 90));
    assert.equal(new Set(individual.map((candidate) => candidate.playerId)).size, individual.length);
  }
});

test("estatisticas coletivas e referencias de cartao/lesao permanecem coerentes", () => {
  let cardEvents = 0;
  let injuryEvents = 0;

  for (let index = 0; index < 24; index += 1) {
    const match = simulateMatch(matchInput(`dynamic-coherence-${index}`));
    assert.equal(match.statistics.home.possession + match.statistics.away.possession, 100);

    for (const side of ["home", "away"]) {
      const stats = match.statistics[side];
      assert.ok(stats.shots >= stats.shotsOnTarget);
      assert.ok(stats.shotsOnTarget >= match.score[side === "home" ? 0 : 1]);
      assert.ok(stats.fouls >= stats.yellowCards + stats.redCards);
      for (const value of Object.values(stats)) assert.ok(Number.isFinite(value) && value >= 0);
    }

    for (const event of match.events) {
      if (["yellow-card", "red-card", "injury"].includes(event.type)) {
        const side = sideForEvent(event, match);
        assert.ok(side, `${event.type} precisa identificar lado`);
        assert.ok(playerIdsForSide(side).has(event.playerId), `${event.type} sem playerId valido`);
      }
      if (["yellow-card", "red-card"].includes(event.type)) cardEvents += 1;
      if (event.type === "injury") injuryEvents += 1;
    }
  }

  assert.ok(cardEvents > 0, "amostra v2 nao gerou cartoes");
  assert.ok(injuryEvents > 0, "amostra v2 nao gerou lesoes");
});

test("departamento medico reduz lesoes sem quebrar determinismo", () => {
  let baselineInjuries = 0;
  let protectedInjuries = 0;

  for (let index = 0; index < 96; index += 1) {
    const input = matchInput(`medical-risk-${index}`);
    const baseline = simulateMatch({
      ...input,
      homeInjuryRiskMultiplier: 1,
      awayInjuryRiskMultiplier: 1,
    });
    const protectedInput = {
      ...input,
      clubCareerEffects: {
        home: { injuryRiskMultiplier: 0.4 },
        away: { injuryRiskMultiplier: 0.4 },
      },
    };
    const protectedMatch = simulateMatch(protectedInput);

    baselineInjuries += baseline.events.filter((event) => event.type === "injury").length;
    protectedInjuries += protectedMatch.events.filter((event) => event.type === "injury").length;
    assert.deepEqual(protectedMatch, simulateMatch(protectedInput));
  }

  assert.ok(baselineInjuries > 0, "amostra base precisa gerar lesoes");
  assert.ok(
    protectedInjuries < baselineInjuries,
    `protecao medica nao reduziu lesoes: ${protectedInjuries}/${baselineInjuries}`,
  );
});

test("intervalo nao recoloca lesionados nem expulsos no campo", () => {
  const injuryInput = incidentMatchInput("inj3", { resistencia: 1 });
  const injuredMatch = simulateMatch({
    ...injuryInput,
    homeSecondHalfPlayers: injuryInput.homePlayers,
    awaySecondHalfPlayers: injuryInput.awayPlayers,
  });
  const injury = injuredMatch.events.find((event) => event.type === "injury" && event.minute < 45);
  assert.ok(injury, "cenario precisa ter lesao no primeiro tempo");
  assert.ok(injuredMatch.events.some((event) => (
    event.type === "substitution"
    && event.minute === injury.minute
    && event.playerOutId === injury.playerId
  )), "lesionado precisa ter sido substituido");
  assert.equal(injuredMatch.events.some((event) => (
    event.type === "substitution"
    && event.minute >= 46
    && event.playerInId === injury.playerId
  )), false, "lesionado retornou no intervalo");

  const dismissalInput = incidentMatchInput("red2", {
    nocao: 1,
    resistencia: 20,
    disciplinary: true,
  });
  const firstSimulation = simulateMatch(dismissalInput);
  const dismissed = firstSimulation.events.find((event) => {
    const starters = event.side === "home" ? dismissalInput.homePlayers : dismissalInput.awayPlayers;
    return event.type === "red-card"
      && event.minute < 45
      && starters.some((candidate) => candidate.id === event.playerId);
  });
  assert.ok(dismissed, "cenario precisa ter expulsao no primeiro tempo");
  const side = dismissed.side;
  const starters = side === "home" ? dismissalInput.homePlayers : dismissalInput.awayPlayers;
  const fullRoster = side === "home" ? dismissalInput.homeRoster : dismissalInput.awayRoster;
  const dismissedPlayer = starters.find((candidate) => candidate.id === dismissed.playerId);
  const outgoing = starters.find((candidate) => candidate.id !== dismissed.playerId);
  assert.ok(dismissedPlayer && outgoing);
  const desired = [
    dismissedPlayer,
    ...starters.filter((candidate) => (
      candidate.id !== dismissed.playerId && candidate.id !== outgoing.id
    )),
    fullRoster[11],
  ];
  const adjusted = simulateMatch({
    ...dismissalInput,
    homeSecondHalfPlayers: side === "home" ? desired : dismissalInput.homePlayers,
    awaySecondHalfPlayers: side === "away" ? desired : dismissalInput.awayPlayers,
  });
  assert.equal(adjusted.events.some((event) => (
    event.type === "substitution"
    && event.minute >= 46
    && event.playerInId === dismissed.playerId
  )), false, "expulso retornou no intervalo");
});

test("segundo amarelo vira vermelho e encerra os minutos do jogador", () => {
  const match = simulateMatch(incidentMatchInput("y10", { disciplinary: true }));
  const repeatedYellow = [
    ...playersFor(match, "home"),
    ...playersFor(match, "away"),
  ].find((candidate) => candidate.yellowCards >= 2);
  assert.ok(repeatedYellow, "cenario precisa ter segundo amarelo");
  assert.equal(repeatedYellow.redCards, 1);
  const dismissal = match.events.find((event) => (
    event.type === "red-card"
    && event.playerId === repeatedYellow.playerId
    && event.secondYellow === true
  ));
  assert.ok(dismissal, "segundo amarelo precisa emitir expulsao identificada");
  assert.ok(repeatedYellow.minutesPlayed <= dismissal.minute);
});

test("goleiros recebem somente gols sofridos enquanto estavam em campo", () => {
  const input = incidentMatchInput("gk1", {
    nocao: 12,
    resistencia: 12,
    chute: 15,
    backupGoalkeeper: true,
  });
  const startingGoalkeeper = input.awayPlayers[0];
  const backupGoalkeeper = input.awayRoster[11];
  const match = simulateMatch({
    ...input,
    homeSecondHalfPlayers: input.homePlayers,
    awaySecondHalfPlayers: [backupGoalkeeper, ...input.awayPlayers.slice(1)],
  });
  const homeGoals = match.events.filter((event) => event.type === "goal" && event.side === "home");
  assert.ok(homeGoals.length > 0, "cenario precisa ter gol do mandante");
  const goalkeeperStats = new Map(playersFor(match, "away").map((candidate) => [candidate.playerId, candidate]));
  const startingStats = goalkeeperStats.get(startingGoalkeeper.id);
  const backupStats = goalkeeperStats.get(backupGoalkeeper.id);
  assert.ok(startingStats && backupStats);
  const firstHalfGoals = homeGoals.filter((event) => event.minute < 46).length;
  const secondHalfGoals = homeGoals.length - firstHalfGoals;
  assert.equal(startingStats.goalsConceded, firstHalfGoals);
  assert.equal(backupStats.goalsConceded, secondHalfGoals);
  assert.equal(startingStats.cleanSheet, firstHalfGoals === 0);
  assert.equal(backupStats.cleanSheet, secondHalfGoals === 0);
});

test("cartao do penalti e emitido antes da cobranca", () => {
  const match = simulateMatch(incidentMatchInput("ord10"));
  const penaltyIndex = match.events.findIndex((event) => event.type === "penalty");
  assert.notEqual(penaltyIndex, -1, "cenario precisa ter penalti");
  const penalty = match.events[penaltyIndex];
  const cardIndex = match.events.findIndex((event) => (
    event.minute === penalty.minute && ["yellow-card", "red-card"].includes(event.type)
  ));
  const kickIndex = match.events.findIndex((event) => (
    event.minute === penalty.minute + 1
    && ["goal", "save", "post", "attack"].includes(event.type)
  ));
  assert.ok(cardIndex > penaltyIndex, "cenario precisa ter cartao na penalidade");
  assert.ok(kickIndex > cardIndex, "cobranca saiu antes do cartao");
  assert.deepEqual(
    match.events.map((event) => event.minute),
    [...match.events].map((event) => event.minute).sort((left, right) => left - right),
  );
});
