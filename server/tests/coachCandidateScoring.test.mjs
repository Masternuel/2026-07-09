import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_COACH_SELECTION_WEIGHTS,
  buildDesiredCoachProfile,
  evaluateCoachCandidate,
  normalizeCoachReputation100,
  normalizeVacancyDesiredProfile,
} from "../game/coachCandidateScoring.mjs";

const NOW = "2026-07-27T12:00:00.000Z";

function player(id, clubId, age, overall, potential, attributes = {}) {
  return {
    id,
    clubId,
    age,
    overall,
    potential,
    active: true,
    attributes: {
      chute: 10,
      drible: 10,
      passe: 10,
      nocao: 10,
      defesa: 10,
      forca: 10,
      velocidade: 10,
      ...attributes,
    },
    contract: { clubId, status: "active" },
  };
}

function roomFixture() {
  return {
    currentSeason: 4,
    competitionCatalog: [{
      id: "BR-A",
      name: "Série A",
      country: "Brasil",
      level: 1,
      clubs: [{
        id: "ELITE",
        name: "Clube Elite",
        country: "Brasil",
        reputation: 19,
        budget: 200_000_000,
      }, {
        id: "SMALL",
        name: "Clube Pequeno",
        country: "Brasil",
        reputation: 8,
        budget: 15_000_000,
      }],
    }],
    marketState: {
      finances: [{
        clubId: "ELITE",
        balance: 150_000_000,
        committed: 10_000_000,
      }, {
        clubId: "SMALL",
        balance: 12_000_000,
        committed: 2_000_000,
      }],
    },
    careerState: {
      players: [
        player("e1", "ELITE", 19, 16, 19, { passe: 18, drible: 17, nocao: 17 }),
        player("e2", "ELITE", 20, 15, 18, { passe: 17, drible: 16, nocao: 17 }),
        player("e3", "ELITE", 28, 17, 17, { passe: 18, drible: 17, nocao: 18 }),
        player("e4", "ELITE", 27, 16, 16, { passe: 17, drible: 16, nocao: 17 }),
        player("s1", "SMALL", 31, 10, 10, { defesa: 15, forca: 15, velocidade: 8 }),
        player("s2", "SMALL", 30, 11, 11, { defesa: 15, forca: 14, velocidade: 9 }),
        player("s3", "SMALL", 28, 10, 11, { defesa: 14, forca: 15, velocidade: 9 }),
      ],
    },
    lineups: [{
      managerId: "elite-manager",
      clubId: "ELITE",
      tactics: { formationId: "4-3-3" },
    }, {
      managerId: "small-manager",
      clubId: "SMALL",
      tactics: { formationId: "4-4-2" },
    }],
  };
}

function stateFixture() {
  return {
    contracts: [],
    evaluations: [{
      id: "evaluation-1",
      coachId: "coach",
      score: 72,
      evaluatedAt: "2026-07-20T12:00:00.000Z",
    }],
  };
}

function coach(overrides = {}) {
  return {
    id: "coach",
    name: "Treinador",
    status: "unemployed",
    currentClubId: null,
    reputation: 16,
    license: "CONMEBOL Pro",
    nationality: "Brasil",
    languages: ["pt"],
    style: "possession",
    preferredFormation: "4-3-3",
    experienceYears: 10,
    professionalExperienceYears: 8,
    internationalExperienceYears: 2,
    currentDivisionYears: 4,
    youthDevelopment: 72,
    adaptability: 70,
    expectedSalary: 250_000,
    achievements: {
      nationalTitles: 2,
      cups: 1,
      continentalTitles: 0,
      promotions: 0,
    },
    assignments: [{
      clubId: "ELITE",
      startedSeason: 1,
      endedSeason: 3,
      startedAt: "2023-01-01T00:00:00.000Z",
      endedAt: "2025-12-31T00:00:00.000Z",
    }],
    ...overrides,
  };
}

test("normaliza reputação legada 1–20 sem alterar escala 0–100", () => {
  assert.equal(normalizeCoachReputation100(19), 95);
  assert.equal(normalizeCoachReputation100(8), 40);
  assert.equal(normalizeCoachReputation100(80), 80);
  assert.equal(normalizeCoachReputation100(null), 50);
});

test("gera perfil completo e mais rígido para elite que para clube pequeno", () => {
  const room = roomFixture();
  const elite = buildDesiredCoachProfile(room, stateFixture(), "ELITE", "dismissal", NOW);
  const small = buildDesiredCoachProfile(room, stateFixture(), "SMALL", "dismissal", NOW);

  assert.equal(elite.version, 1);
  assert.equal(elite.tier, "elite");
  assert.equal(elite.strictness, "strict");
  assert.equal(elite.license.minimum, "PRO");
  assert.equal(elite.experience.minimumYears > small.experience.minimumYears, true);
  assert.equal(elite.squad.predominantFormation, "4-3-3");
  assert.equal(elite.squad.youngTalentCount, 2);
  assert.match(elite.squadSummary, /4 jogadores/u);

  assert.equal(small.tier, "small");
  assert.equal(small.strictness, "flexible");
  assert.equal(small.salary.flexibility > elite.salary.flexibility, true);
  assert.equal(small.squad.predominantFormation, "4-4-2");
  assert.equal(
    roundedWeightTotal(elite.weights),
    100,
  );
  assert.equal(
    roundedWeightTotal(small.weights),
    100,
  );
});

test("aceita licença continental equivalente ao requisito Pro", () => {
  const room = roomFixture();
  const profile = buildDesiredCoachProfile(room, stateFixture(), "ELITE", "dismissal", NOW, {
    salary: { minimum: 100_000, ideal: 250_000, maximum: 400_000, flexibility: 0.1 },
  });
  const assessment = evaluateCoachCandidate(
    room,
    stateFixture(),
    coach({ license: "UEFA Pro" }),
    { id: "vacancy-elite", clubId: "ELITE", desiredProfile: profile },
    NOW,
  );

  assert.equal(assessment.eligible, true);
  assert.equal(assessment.hardBlockers.some(({ code }) => code === "license_below_minimum"), false);
  assert.equal(assessment.factors.find(({ code }) => code === "license").rawScore, 90);
});

test("salário acima do teto bloqueia perfil rígido e respeita flexibilidade do pequeno", () => {
  const room = roomFixture();
  const strictProfile = normalizeVacancyDesiredProfile({
    tier: "elite",
    strictness: "strict",
    salary: { minimum: 100_000, ideal: 200_000, maximum: 250_000, flexibility: 0.1 },
    geography: { country: "Brasil", requiredLanguage: "pt" },
  });
  const flexibleProfile = normalizeVacancyDesiredProfile({
    tier: "small",
    strictness: "flexible",
    license: { minimum: "B" },
    salary: { minimum: 50_000, ideal: 150_000, maximum: 250_000, flexibility: 0.5 },
    geography: { country: "Brasil", requiredLanguage: "pt" },
    countryKnowledge: { languageRequired: false },
  });
  const expensiveCoach = coach({ expectedSalary: 350_000, license: "B" });

  const strict = evaluateCoachCandidate(
    room,
    stateFixture(),
    expensiveCoach,
    { id: "strict", clubId: "ELITE", desiredProfile: strictProfile },
    NOW,
  );
  const flexible = evaluateCoachCandidate(
    room,
    stateFixture(),
    expensiveCoach,
    { id: "flexible", clubId: "SMALL", desiredProfile: flexibleProfile },
    NOW,
  );

  assert.equal(strict.eligible, false);
  assert.equal(strict.hardBlockers.some(({ code }) => code === "salary_above_limit"), true);
  assert.equal(flexible.eligible, true);
});

test("clubes com filosofias diferentes priorizam treinadores diferentes", () => {
  const room = roomFixture();
  const state = stateFixture();
  const base = {
    strictness: "balanced",
    license: { minimum: "A" },
    salary: { minimum: 100_000, ideal: 200_000, maximum: 400_000, flexibility: 0.25 },
    geography: { country: "Brasil", requiredLanguage: "pt" },
    weights: {
      ...DEFAULT_COACH_SELECTION_WEIGHTS,
      playingStyle: 34,
      squadCompatibility: 24,
      reputation: 4,
      achievements: 3,
    },
  };
  const possessionProfile = normalizeVacancyDesiredProfile({
    ...base,
    playingStyle: {
      preferred: ["possession"],
      accepted: ["high_press"],
      preferredFormation: "4-3-3",
      acceptedFormations: ["4-2-3-1"],
    },
  });
  const counterProfile = normalizeVacancyDesiredProfile({
    ...base,
    playingStyle: {
      preferred: ["counter_attack"],
      accepted: ["solid_defense"],
      preferredFormation: "4-4-2",
      acceptedFormations: ["5-3-2"],
    },
  });
  const possessionCoach = coach({
    id: "possession",
    style: "possession",
    preferredFormation: "4-3-3",
  });
  const counterCoach = coach({
    id: "counter",
    style: "counter_attack",
    preferredFormation: "4-4-2",
  });

  const possessionScores = [possessionCoach, counterCoach].map((candidate) => evaluateCoachCandidate(
    room,
    state,
    candidate,
    { id: "possession-vacancy", clubId: "ELITE", desiredProfile: possessionProfile },
    NOW,
  ));
  const counterScores = [possessionCoach, counterCoach].map((candidate) => evaluateCoachCandidate(
    room,
    state,
    candidate,
    { id: "counter-vacancy", clubId: "SMALL", desiredProfile: counterProfile },
    NOW,
  ));

  assert.equal(possessionScores[0].score > possessionScores[1].score, true);
  assert.equal(counterScores[1].score > counterScores[0].score, true);
});

test("avaliação é determinística, ponderada e auditável", () => {
  const room = roomFixture();
  const state = stateFixture();
  const profile = buildDesiredCoachProfile(room, state, "ELITE", "dismissal", NOW, {
    salary: { minimum: 100_000, ideal: 250_000, maximum: 400_000, flexibility: 0.1 },
  });
  const vacancy = { id: "deterministic", clubId: "ELITE", desiredProfile: profile };
  const first = evaluateCoachCandidate(room, state, coach(), vacancy, NOW);
  const second = evaluateCoachCandidate(room, state, coach(), vacancy, NOW);

  assert.deepEqual(second, first);
  assert.equal(first.profileVersion, 1);
  assert.equal(first.evaluatedAt, NOW);
  assert.equal(first.factors.some(({ code }) => code === "deterministicTieBreaker"), false);
  assert.equal(Math.abs(first.tieBreaker) <= 1, true);
  assert.equal(
    first.score,
    Math.round(first.factors.reduce((sum, factor) => sum + factor.weightedScore, 0) * 100) / 100,
  );
  assert.equal(roundedWeightTotal(
    Object.fromEntries(first.factors.filter(({ weight }) => weight > 0).map(({ code, weight }) => [code, weight])),
  ), 100);
});

test("dados legados sem licenca ou idioma nao bloqueiam o candidato", () => {
  const room = roomFixture();
  const state = stateFixture();
  const profile = buildDesiredCoachProfile(room, state, "ELITE", "dismissal", NOW, {
    strictness: "balanced",
    salary: { minimum: 100_000, ideal: 250_000, maximum: 400_000, flexibility: 0.1 },
  });
  const legacyCoach = coach({
    reputation: 12,
    license: undefined,
    coachingLicense: undefined,
    nationality: undefined,
    languages: undefined,
    language: undefined,
    expectedSalary: 200_000,
  });
  const assessment = evaluateCoachCandidate(
    room,
    state,
    legacyCoach,
    { id: "legacy-vacancy", clubId: "ELITE", desiredProfile: profile },
    NOW,
  );

  assert.equal(assessment.eligible, true);
  assert.equal(assessment.hardBlockers.some(({ code }) => code === "license_below_minimum"), false);
  assert.equal(assessment.hardBlockers.some(({ code }) => code === "required_language_missing"), false);
  assert.match(assessment.factors.find(({ code }) => code === "license").detail, /não informada/iu);
  assert.equal(assessment.factors.find(({ code }) => code === "license").rawScore < 90, true);
});

test("vaga estrita bloqueia licença ausente sem inferir pela reputação", () => {
  const profile = normalizeVacancyDesiredProfile({
    strictness: "strict",
    license: { minimum: "PRO" },
    salary: { minimum: 100_000, ideal: 250_000, maximum: 500_000 },
    countryKnowledge: { minimum: 0 },
  });
  const assessment = evaluateCoachCandidate(
    roomFixture(),
    stateFixture(),
    coach({ license: undefined, coachingLicense: undefined, reputation: 20 }),
    { id: "strict-missing-license", clubId: "ELITE", desiredProfile: profile },
    NOW,
  );

  assert.equal(assessment.eligible, false);
  assert.equal(assessment.hardBlockers.some(({ code }) => code === "license_missing"), true);
  assert.match(assessment.factors.find(({ code }) => code === "license").detail, /^não informada/iu);
});

test("vaga estrita aplica mínimos de experiência e conquistas", () => {
  const profile = normalizeVacancyDesiredProfile({
    strictness: "strict",
    license: { minimum: "PRO" },
    experience: { minimumYears: 8 },
    achievements: { minimumNationalTitles: 1 },
    salary: { minimum: 100_000, ideal: 250_000, maximum: 500_000 },
    countryKnowledge: { minimum: 0 },
  });
  const assessment = evaluateCoachCandidate(
    roomFixture(),
    stateFixture(),
    coach({
      license: "PRO",
      experienceYears: 0,
      assignments: [],
      achievements: {},
    }),
    { id: "strict-minimums", clubId: "ELITE", desiredProfile: profile },
    NOW,
  );

  assert.equal(assessment.hardBlockers.some(({ code }) => code === "experience_below_minimum"), true);
  assert.equal(
    assessment.hardBlockers.some(({ code }) => code === "achievement_requirements_not_met"),
    true,
  );
});

test("códigos de país e idiomas aceitos influenciam conhecimento regional", () => {
  const profile = normalizeVacancyDesiredProfile({
    strictness: "balanced",
    geography: {
      country: "BRA",
      preferredNationality: "BR",
      acceptedNationalities: ["ARG"],
      requiredLanguage: "pt",
      acceptedLanguages: ["es"],
    },
    countryKnowledge: { minimum: 50, languageRequired: true },
  });
  const assessment = evaluateCoachCandidate(
    roomFixture(),
    stateFixture(),
    coach({ nationality: "BRA", languages: ["pt-BR"] }),
    { id: "country-aliases", clubId: "ELITE", desiredProfile: profile },
    NOW,
  );

  assert.equal(assessment.factors.find(({ code }) => code === "countryKnowledge").rawScore >= 80, true);
  assert.equal(assessment.hardBlockers.some(({ code }) => code === "required_language_missing"), false);
});

test("caixa zerado permanece zerado no perfil da vaga", () => {
  const room = roomFixture();
  room.marketState.finances[0] = { clubId: "ELITE", balance: 10_000_000, committed: 10_000_000 };
  const profile = buildDesiredCoachProfile(room, stateFixture(), "ELITE", "dismissal", NOW);

  assert.equal(profile.availableBudget, 0);
});

test("experiência ausente não é inventada pela reputação", () => {
  const profile = normalizeVacancyDesiredProfile({
    strictness: "balanced",
    license: { minimum: "B" },
    experience: { minimumYears: 10, professionalYears: 8 },
  });
  const withoutExperience = (reputation) => coach({
    reputation,
    experienceYears: undefined,
    yearsExperience: undefined,
    professionalExperienceYears: undefined,
    assignments: [],
  });
  const vacancy = { id: "no-inferred-experience", clubId: "ELITE", desiredProfile: profile };
  const high = evaluateCoachCandidate(roomFixture(), stateFixture(), withoutExperience(20), vacancy, NOW);
  const low = evaluateCoachCandidate(roomFixture(), stateFixture(), withoutExperience(2), vacancy, NOW);

  assert.equal(
    high.factors.find(({ code }) => code === "experience").rawScore,
    low.factors.find(({ code }) => code === "experience").rawScore,
  );
});

test("ambição e objetivo alteram exigência da vaga", () => {
  const ambitiousRoom = roomFixture();
  const cautiousRoom = roomFixture();
  Object.assign(ambitiousRoom.competitionCatalog[0].clubs[0], {
    reputation: 14,
    ambition: 100,
    objective: "Disputar o título",
  });
  Object.assign(cautiousRoom.competitionCatalog[0].clubs[0], {
    reputation: 14,
    ambition: 20,
    objective: "Permanecer na divisão",
  });
  const ambitious = buildDesiredCoachProfile(ambitiousRoom, stateFixture(), "ELITE", "vacancy", NOW);
  const cautious = buildDesiredCoachProfile(cautiousRoom, stateFixture(), "ELITE", "vacancy", NOW);

  assert.equal(ambitious.tier, "elite");
  assert.equal(cautious.tier, "small");
  assert.equal(ambitious.weights.achievements > cautious.weights.achievements, true);
});

test("normaliza aliases planos de estilo e formação da vaga", () => {
  const direct = normalizeVacancyDesiredProfile({
    style: "possession",
    preferredFormation: "4-3-3",
  });
  const alternatives = normalizeVacancyDesiredProfile({
    playStyle: "counter",
    formations: ["4-4-2", "5-3-2"],
  });

  assert.deepEqual(direct.playingStyle.preferred, ["possession"]);
  assert.equal(direct.playingStyle.preferredFormation, "4-3-3");
  assert.deepEqual(alternatives.playingStyle.preferred, ["counter_attack"]);
  assert.equal(alternatives.playingStyle.preferredFormation, "4-4-2");
  assert.deepEqual(alternatives.playingStyle.acceptedFormations, ["5-3-2"]);
});

function roundedWeightTotal(weights) {
  return Math.round(Object.values(weights).reduce((sum, value) => sum + value, 0) * 100) / 100;
}
