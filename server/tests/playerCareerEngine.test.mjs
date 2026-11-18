import assert from "node:assert/strict";
import test from "node:test";
import {
  CAREER_ATTRIBUTE_KEYS,
  applyAnnualPlayerDevelopment,
  applyTrainingCycle,
  generateYouthIntake,
  nationalTeamEligibility,
  normalizeCareerPlayer,
  normalizeTrainingPlans,
  processCareerSeasonTransition,
  promoteYouthPlayer,
  resolveContractCycle,
  resolveRetirements,
  retirementDecision,
  selectNationalTeamSquad,
  selectNationalTeamSquads,
  youthDevelopmentProfileForClub,
} from "../game/playerCareerEngine.mjs";

function attributes(value = 10, overrides = {}) {
  return {
    ...Object.fromEntries(CAREER_ATTRIBUTE_KEYS.map((key) => [key, value])),
    ...overrides,
  };
}

function player(overrides = {}) {
  return {
    id: "p1",
    clubId: "SAN",
    name: "Jogador",
    position: "MC",
    age: 20,
    nationality: "Brasil",
    overall: 10,
    potential: 17,
    attributes: attributes(),
    active: true,
    contract: {
      clubId: "SAN",
      startSeason: 1,
      endSeason: 3,
      wage: 10_000,
      status: "active",
      renewalCount: 0,
    },
    ...overrides,
  };
}

test("normaliza roster compacto, atributos 1-20 e contrato legado", () => {
  const normalized = normalizeCareerPlayer({
    id: "legacy",
    clubId: "A",
    age: 17,
    position: "ATA",
    overall: 25,
    attributes: { chute: 99, defesa: -3 },
  }, { seasonNumber: 4 });

  assert.equal(normalized.id, "legacy");
  assert.equal(normalized.attributes.chute, 20);
  assert.equal(normalized.attributes.defesa, 1);
  assert.equal(CAREER_ATTRIBUTE_KEYS.every((key) => normalized.attributes[key] >= 1 && normalized.attributes[key] <= 20), true);
  assert.equal(normalized.overall >= 1 && normalized.overall <= 20, true);
  assert.deepEqual(normalized.contract, {
    clubId: "A",
    startSeason: 4,
    endSeason: 6,
    wage: 10_000,
    status: "active",
    renewalCount: 0,
  });
  assert.equal(normalized.youth, false);
});

test("contratos vencem, viram sem contrato, renovam e recebem bootstrap", () => {
  const result = resolveContractCycle([
    player({ id: "expired", contract: { clubId: "SAN", startSeason: 1, endSeason: 1, wage: 5_000, status: "active" } }),
    player({ id: "renewed", contract: { clubId: "SAN", startSeason: 1, endSeason: 1, wage: 5_000, status: "active" } }),
    { ...player({ id: "bootstrap" }), contract: undefined },
    player({ id: "free", clubId: null, contract: { clubId: null, startSeason: null, endSeason: null, wage: 0, status: "free_agent" } }),
  ], {
    seasonNumber: 2,
    renewals: [{ playerId: "renewed", years: 3, wage: 12_500 }],
  });

  const byId = new Map(result.players.map((candidate) => [candidate.id, candidate]));
  assert.equal(byId.get("expired").clubId, null);
  assert.equal(byId.get("expired").contract.status, "free_agent");
  assert.equal(byId.get("renewed").clubId, "SAN");
  assert.equal(byId.get("renewed").contract.endSeason, 4);
  assert.equal(byId.get("renewed").contract.wage, 12_500);
  assert.equal(byId.get("renewed").contract.renewalCount, 1);
  assert.equal(byId.get("bootstrap").contract.status, "active");
  assert.deepEqual(result.expiredPlayerIds, ["expired"]);
  assert.deepEqual(result.renewedPlayerIds, ["renewed"]);
  assert.deepEqual(result.bootstrappedPlayerIds, ["bootstrap"]);
  assert.deepEqual(result.freeAgentPlayerIds.sort(), ["expired", "free"]);
});

test("desenvolvimento anual usa idade, potencial, treino e minutos sem mutar roster", () => {
  const source = [
    player({ id: "young", age: 17, position: "ATA", potential: 19 }),
    player({ id: "old", age: 35, position: "ATA", potential: 12, attributes: attributes(12), overall: 12 }),
    player({ id: "keeper", age: 34, position: "GOL", potential: 12, attributes: attributes(12), overall: 12 }),
  ];
  const copy = structuredClone(source);
  const result = applyAnnualPlayerDevelopment(source, {
    seasonNumber: 2,
    trainingPlans: [
      { playerId: "young", focus: "attacking", intensity: "high" },
      { playerId: "old", focus: "physical", intensity: "high" },
      { playerId: "keeper", focus: "goalkeeping", intensity: "normal" },
    ],
    minutesByPlayer: { young: 2_700, old: 1_000, keeper: 2_700 },
  });
  const byId = new Map(result.players.map((candidate) => [candidate.id, candidate]));

  assert.deepEqual(source, copy);
  assert.equal(byId.get("young").age, 18);
  assert.ok(byId.get("young").attributes.chute > 10);
  assert.ok(byId.get("young").attributes.chute > byId.get("young").attributes.defesa);
  assert.equal(byId.get("young").training.focus, "attacking");
  assert.ok(byId.get("old").attributes.velocidade < 12);
  assert.ok(byId.get("keeper").attributes.reflexos > byId.get("old").attributes.reflexos);
  assert.equal(result.players.every((candidate) => CAREER_ATTRIBUTE_KEYS.every((key) => (
    candidate.attributes[key] >= 1 && candidate.attributes[key] <= 20
  ))), true);
});

test("aposentadoria e deterministica, respeita idade minima e limite", () => {
  const young = retirementDecision(player({ id: "young", age: 31 }), { seasonNumber: 3, seed: "save" });
  const forced = retirementDecision(player({ id: "veteran", age: 41 }), { seasonNumber: 3, seed: "save" });
  const first = retirementDecision(player({ id: "maybe", age: 36 }), { seasonNumber: 3, seed: "save" });
  const second = retirementDecision(player({ id: "maybe", age: 36 }), { seasonNumber: 3, seed: "save" });

  assert.deepEqual(first, second);
  assert.equal(young.retire, false);
  assert.equal(young.reason, "too_young");
  assert.equal(forced.retire, true);
  assert.equal(forced.reason, "age_limit");

  const resolved = resolveRetirements([player({ id: "veteran", age: 41 })], { seasonNumber: 3, seed: "save" });
  assert.deepEqual(resolved.retiredPlayerIds, ["veteran"]);
  assert.equal(resolved.players[0].active, false);
  assert.equal(resolved.players[0].clubId, null);
  assert.equal(resolved.players[0].contract.status, "retired");
});

test("categorias de base geram IDs e atletas deterministicos por clube/temporada", () => {
  const input = {
    clubs: [
      { id: "SAN", country: "Brasil", reputation: 16, academyLevel: 18, active: true },
      { id: "RIV", country: "Argentina", reputation: 15, academyLevel: 14, active: true },
    ],
    seasonNumber: 4,
    countPerClub: 4,
    seed: "save-123",
  };
  const first = generateYouthIntake(input);
  const second = generateYouthIntake(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, 8);
  assert.equal(new Set(first.map((candidate) => candidate.id)).size, 8);
  assert.equal(first.every((candidate) => candidate.youth && candidate.academy && candidate.careerStage === "academy"), true);
  assert.equal(first.every((candidate) => candidate.age >= 15 && candidate.age <= 18), true);
  assert.equal(first.every((candidate) => candidate.overall >= 1 && candidate.overall <= 20), true);
  assert.equal(first.filter((candidate) => candidate.clubId === "RIV").every((candidate) => candidate.nationality === "Argentina"), true);
});

test("estrutura e treinador da base elevam de forma deterministica a qualidade da fornada", () => {
  const baseClub = { id: "ACA", country: "Brasil", academyLevel: 7, active: true };
  const weakClub = {
    ...baseClub,
    youthDevelopment: { infrastructureBonus: 0, staffBonus: 0 },
  };
  const facilityClub = {
    ...baseClub,
    youthDevelopment: { infrastructureBonus: 5, staffBonus: 0 },
  };
  const strongClub = {
    ...baseClub,
    youthDevelopment: { infrastructureBonus: 5, staffBonus: 2 },
  };
  const input = { seasonNumber: 5, countPerClub: 10, seed: "academy-quality" };
  const weak = generateYouthIntake({ ...input, clubs: [weakClub] });
  const facility = generateYouthIntake({ ...input, clubs: [facilityClub] });
  const strong = generateYouthIntake({ ...input, clubs: [strongClub] });
  const average = (players, field) => players.reduce((sum, player) => sum + player[field], 0) / players.length;

  assert.deepEqual(strong, generateYouthIntake({ ...input, clubs: [strongClub] }));
  assert.deepEqual(youthDevelopmentProfileForClub(strongClub), {
    schemaVersion: 1,
    baseAcademyQuality: 7,
    infrastructureBonus: 5,
    staffBonus: 2,
    totalBonus: 7,
    effectiveAcademyQuality: 14,
  });
  assert.ok(average(facility, "overall") > average(weak, "overall"));
  assert.ok(average(strong, "overall") > average(facility, "overall"));
  assert.ok(average(strong, "potential") > average(weak, "potential"));
  assert.equal(strong.every((player) => player.youthIntake?.effectiveAcademyQuality === 14), true);
  assert.equal(strong.every((player) => player.youthIntake?.infrastructureBonus === 5), true);
  assert.equal(strong.every((player) => player.youthIntake?.staffBonus === 2), true);
});

test("promocao da base cria contrato profissional e valida idade", () => {
  const youth = generateYouthIntake({
    clubs: [{ id: "SAN", country: "Brasil", academyLevel: 12 }],
    seasonNumber: 2,
    countPerClub: 6,
    seed: "promotion",
  }).find((candidate) => candidate.age >= 16);
  const promoted = promoteYouthPlayer(youth, { seasonNumber: 3, contractYears: 4, wage: 9_000 });

  assert.equal(promoted.youth, false);
  assert.equal(promoted.academy, false);
  assert.equal(promoted.careerStage, "senior");
  assert.equal(promoted.contract.status, "active");
  assert.equal(promoted.contract.startSeason, 3);
  assert.equal(promoted.contract.endSeason, 6);
  assert.equal(promoted.contract.wage, 9_000);
  assert.throws(() => promoteYouthPlayer({ ...youth, age: 15 }, { seasonNumber: 3 }), /ao menos 16 anos/);
});

test("planos de treino deduplicam, melhoram foco, cobram condicao e calculam risco", () => {
  const plans = normalizeTrainingPlans([
    { playerId: "p1", focus: "attacking", intensity: "normal" },
    { playerId: "p1", focus: "physical", intensity: "high" },
    { playerId: "p2", focus: "unknown", intensity: "unknown" },
    { playerId: "", focus: "defending", intensity: "low" },
  ]);
  assert.deepEqual(plans, [
    { playerId: "p1", focus: "physical", intensity: "high", active: true },
    { playerId: "p2", focus: "balanced", intensity: "normal", active: true },
  ]);

  const result = applyTrainingCycle([
    player({ id: "p1", condition: 90 }),
    player({ id: "p2", condition: 70 }),
  ], {
    seasonNumber: 2,
    plans: [
      { playerId: "p1", focus: "physical", intensity: "high" },
      { playerId: "p2", focus: "recovery", intensity: "low" },
    ],
    cycleId: "s2-w5",
  });
  const byId = new Map(result.players.map((candidate) => [candidate.id, candidate]));
  assert.equal(byId.get("p1").condition, 85);
  assert.ok(byId.get("p1").attributes.forca > 10);
  assert.equal(byId.get("p1").lastTrainingCycleId, "s2-w5");
  assert.equal(byId.get("p2").condition, 77);
  assert.equal(result.effects.find((effect) => effect.playerId === "p2").injuryRisk, 0);
});

test("treinador de goleiros acelera desenvolvimento apenas do goleiro", () => {
  const squad = [
    player({ id: "gk", position: "GOL", currentClubId: "SAN" }),
    player({ id: "outfield", position: "ZAG", currentClubId: "SAN" }),
  ];
  const plans = squad.map((candidate) => ({ playerId: candidate.id, focus: "balanced", intensity: "normal" }));
  const baseline = applyTrainingCycle(squad, { plans, clubEffects: { SAN: {} } });
  const improved = applyTrainingCycle(squad, {
    plans,
    clubEffects: { SAN: { goalkeeperDevelopmentMultiplier: 1.2 } },
  });
  const byId = (result, id) => result.players.find((candidate) => candidate.id === id);

  assert.ok(byId(improved, "gk").attributes.defesa > byId(baseline, "gk").attributes.defesa);
  assert.equal(byId(improved, "outfield").attributes.defesa, byId(baseline, "outfield").attributes.defesa);
  assert.equal(improved.effects.find((effect) => effect.playerId === "gk").goalkeeperDevelopmentMultiplier, 1.2);
});

test("elegibilidade respeita nacionalidade, idade e vinculo internacional", () => {
  const brazil = { id: "BRA", name: "Brasil", country: "Brasil", aliases: ["Brazil"] };
  assert.deepEqual(nationalTeamEligibility(player({ nationality: "BRA" }), brazil), { eligible: true, reason: "nationality" });
  assert.deepEqual(
    nationalTeamEligibility(player({ nationality: "Brasil", nationalTeamId: "ARG", internationalCaps: 2 }), brazil),
    { eligible: false, reason: "cap_tied" },
  );
  assert.deepEqual(
    nationalTeamEligibility(player({ nationality: "Argentina" }), brazil),
    { eligible: false, reason: "nationality_mismatch" },
  );
  assert.deepEqual(
    nationalTeamEligibility(player({ age: 15 }), { ...brazil, minimumAge: 16 }),
    { eligible: false, reason: "underage" },
  );
});

test("convocacao prioriza overall, cobre setores e evita dupla convocacao", () => {
  const positions = ["GOL", "GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA", "ATA"];
  const candidates = positions.map((position, index) => player({
    id: `br-${index}`,
    position,
    nationality: "Brasil",
    attributes: attributes(20 - index * 0.25),
    overall: 20 - index * 0.25,
    potential: 20,
  }));
  const dual = player({ id: "dual", nationality: "Brasil", eligibleNationalities: ["Argentina"], attributes: attributes(20), overall: 20, potential: 20 });
  candidates.push(dual);
  const brazil = { id: "BRA", country: "Brasil" };
  const argentina = { id: "ARG", country: "Argentina" };

  const squad = selectNationalTeamSquad(brazil, candidates, { seasonNumber: 2, squadSize: 8, seed: "selection" });
  assert.equal(squad.playerIds.length, 8);
  assert.equal(squad.players.some((candidate) => candidate.position === "GOL"), true);
  assert.equal(squad.players.some((candidate) => ["ZAG", "LD", "LE"].includes(candidate.position)), true);
  assert.equal(squad.players.some((candidate) => ["PD", "PE", "ATA"].includes(candidate.position)), true);

  const squads = selectNationalTeamSquads([brazil, argentina], [...candidates, player({ id: "arg", nationality: "Argentina" })], {
    seasonNumber: 2,
    squadSize: 8,
    seed: "selection",
  });
  const allIds = squads.flatMap((entry) => entry.playerIds);
  assert.equal(new Set(allIds).size, allIds.length);
});

test("transicao completa retorna overlay compacto, resumo e e idempotente", () => {
  const roster = [
    player({ id: "veteran", age: 40, contract: { clubId: "SAN", startSeason: 1, endSeason: 1, wage: 20_000, status: "active" } }),
    player({ id: "prospect", age: 18, nationality: "Brasil", potential: 19 }),
  ];
  const transition = processCareerSeasonTransition({
    saveId: "save-final",
    currentSeason: 1,
    trainingPlans: [{ playerId: "prospect", focus: "technical", intensity: "high" }],
  }, {
    roster,
    toSeason: 2,
    clubs: [{ id: "SAN", country: "Brasil", academyLevel: 15 }],
    renewals: [{ playerId: "veteran", years: 1 }],
    youthCountPerClub: 2,
    nationalTeams: [{ id: "BRA", country: "Brasil" }],
    nationalSquadSize: 3,
  });

  assert.equal(transition.careerState.currentSeason, 2);
  assert.equal(transition.careerState.lastCareerTransitionSeason, 2);
  assert.equal(transition.players, transition.careerState.players);
  assert.equal(transition.summary.generatedYouthPlayerIds.length, 2);
  assert.deepEqual(transition.state, transition.careerState);
  assert.deepEqual(transition.report, transition.summary);
  assert.equal(Array.isArray(transition.careerState.nationalSquads), true);

  const repeated = processCareerSeasonTransition(transition.careerState, { toSeason: 2 });
  assert.equal(repeated.summary.skipped, true);
  assert.deepEqual(repeated.players, transition.players);
});
