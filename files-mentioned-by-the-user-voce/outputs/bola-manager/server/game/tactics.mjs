import { calculateTacticalMatchup } from "./tacticalAnalysis.mjs";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const rounded = (value) => Math.round(value * 1_000) / 1_000;

export const FORMATION_ROLES = Object.freeze({
  "4-3-3": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "PE", "ATA", "PD"]),
  "4-4-2": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "PE", "MC", "MC", "PD", "ATA", "ATA"]),
  "3-5-2": Object.freeze(["GOL", "ZAG", "ZAG", "ZAG", "LE", "VOL", "MC", "MC", "LD", "ATA", "ATA"]),
  "4-2-3-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "VOL", "PE", "MEI", "PD", "ATA"]),
  "5-3-2": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "ATA", "ATA"]),
  "3-4-3": Object.freeze(["GOL", "ZAG", "ZAG", "ZAG", "PE", "MC", "MC", "PD", "PE", "ATA", "PD"]),
  "4-1-4-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "PE", "MC", "MC", "PD", "ATA"]),
  "5-4-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "ZAG", "LD", "PE", "MC", "MC", "PD", "ATA"]),
  "4-3-2-1": Object.freeze(["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MC", "MEI", "MEI", "ATA"]),
});

export const FORMATION_IDS = Object.freeze(Object.keys(FORMATION_ROLES));

export const DEFAULT_TACTIC_PLAN = Object.freeze({
  version: 1,
  formationId: "4-3-3",
  mentality: "positive",
  teamInstructions: Object.freeze({
    pressureLine: "high",
    width: "wide",
    tempo: "fast",
    pressing: "intense",
    offensiveTransition: "build-up",
    defensiveTransition: "counter-press",
  }),
  individualInstructions: Object.freeze([]),
  setPieces: Object.freeze({
    corner: Object.freeze({ takerId: null, routine: "short" }),
    freeKick: Object.freeze({ takerId: null, routine: "direct" }),
    goalKick: Object.freeze({ takerId: null, routine: "short" }),
  }),
  secret: true,
});

const FORMATION_SHAPES = Object.freeze({
  "4-3-3": { attack: 0.15, control: 0.05, defense: -0.20 },
  "4-4-2": { attack: 0.10, control: -0.20, defense: 0.10 },
  "3-5-2": { attack: 0.05, control: 0.20, defense: -0.25 },
  "4-2-3-1": { attack: -0.10, control: 0.10, defense: 0 },
  "5-3-2": { attack: -0.10, control: -0.05, defense: 0.15 },
  "3-4-3": { attack: 0.25, control: 0, defense: -0.25 },
  "4-1-4-1": { attack: -0.15, control: 0.05, defense: 0.10 },
  "5-4-1": { attack: -0.25, control: 0, defense: 0.25 },
  "4-3-2-1": { attack: 0.05, control: 0.15, defense: -0.20 },
});

const MENTALITY = Object.freeze({
  cautious: { attack: -0.25, control: -0.05, defense: 0.30, disciplineRisk: -0.04, fatigue: 0.03 },
  balanced: { attack: 0, control: 0, defense: 0, disciplineRisk: 0, fatigue: 0 },
  positive: { attack: 0.15, control: 0.10, defense: -0.10, disciplineRisk: 0.02, fatigue: -0.03 },
  attacking: { attack: 0.30, control: 0, defense: -0.30, disciplineRisk: 0.05, fatigue: -0.07 },
});

const PRESSURE_LINE = Object.freeze({
  "very-low": { attack: -0.08, defense: 0.08, control: -0.04, fatigue: 0.03 },
  low: { attack: -0.04, defense: 0.04, control: -0.02, fatigue: 0.02 },
  medium: {},
  high: { attack: 0.05, defense: -0.02, control: 0.04, fatigue: -0.04 },
  "very-high": { attack: 0.09, defense: -0.07, control: 0.05, fatigue: -0.07 },
});

const WIDTH = Object.freeze({
  "very-narrow": { attack: -0.06, control: 0.09, defense: 0.03 },
  narrow: { attack: -0.03, control: 0.05, defense: 0.02 },
  normal: {},
  wide: { attack: 0.05, control: -0.02, defense: -0.02 },
  "very-wide": { attack: 0.09, control: -0.05, defense: -0.05 },
});

const TEMPO = Object.freeze({
  "very-slow": { attack: -0.08, control: 0.10, fatigue: 0.05 },
  slow: { attack: -0.04, control: 0.05, fatigue: 0.03 },
  normal: {},
  fast: { attack: 0.05, control: -0.02, fatigue: -0.05 },
  "very-fast": { attack: 0.10, control: -0.06, fatigue: -0.10 },
});

const PRESSING = Object.freeze({
  passive: { attack: -0.05, defense: -0.03, disciplineRisk: -0.04, fatigue: 0.05 },
  moderate: {},
  intense: { attack: 0.04, defense: 0.05, disciplineRisk: 0.03, fatigue: -0.08 },
  aggressive: { attack: 0.07, defense: 0.08, disciplineRisk: 0.09, fatigue: -0.16 },
});

const OFFENSIVE_TRANSITION = Object.freeze({
  "build-up": { control: 0.08, attack: -0.02 },
  direct: { attack: 0.06, control: -0.04 },
  counter: { attack: 0.09, control: -0.07, defense: 0.02 },
});

const DEFENSIVE_TRANSITION = Object.freeze({
  "counter-press": { attack: 0.03, defense: 0.06, fatigue: -0.07, disciplineRisk: 0.02 },
  regroup: { control: 0.03, defense: 0.04, fatigue: 0.02 },
  drop: { attack: -0.05, defense: 0.08, control: -0.03, fatigue: 0.04 },
});

const WITH_BALL = Object.freeze({
  "support-inside": { control: 0.02 },
  "hold-width": { attack: 0.02 },
  "attack-space": { attack: 0.03, defense: -0.01 },
});

const WITHOUT_BALL = Object.freeze({
  "press-more": { defense: 0.02, disciplineRisk: 0.005, fatigue: -0.01 },
  "hold-position": { defense: 0.02, attack: -0.005 },
  "man-mark": { defense: 0.025, control: -0.01, disciplineRisk: 0.005 },
});

const COMPATIBLE_POSITIONS = Object.freeze({
  GOL: Object.freeze(["GOL"]),
  ZAG: Object.freeze(["ZAG", "VOL", "LD", "LE"]),
  LD: Object.freeze(["LD", "ZAG", "PD"]),
  LE: Object.freeze(["LE", "ZAG", "PE"]),
  VOL: Object.freeze(["VOL", "MC", "ZAG"]),
  MC: Object.freeze(["MC", "VOL", "MEI"]),
  MEI: Object.freeze(["MEI", "MC", "PD", "PE"]),
  PD: Object.freeze(["PD", "MEI", "ATA"]),
  PE: Object.freeze(["PE", "MEI", "ATA"]),
  ATA: Object.freeze(["ATA", "PD", "PE", "MEI"]),
});

function addVector(target, source = {}) {
  for (const key of ["attack", "control", "defense", "disciplineRisk", "fatigue"]) {
    target[key] += Number(source[key]) || 0;
  }
}

function positionFit(plan, playersById, lineupIds) {
  const roles = FORMATION_ROLES[plan.formationId] ?? FORMATION_ROLES[DEFAULT_TACTIC_PLAN.formationId];
  const scores = lineupIds.flatMap((playerId, index) => {
    const position = String(playersById.get(String(playerId))?.position ?? "").trim().toUpperCase();
    const role = roles[index];
    if (!position || !role) return [];
    if (position === role) return [1];
    return [(COMPATIBLE_POSITIONS[role] ?? []).includes(position) ? 0.65 : 0.15];
  });
  if (scores.length === 0) return { rating: null, bonus: 0 };
  const rating = scores.reduce((total, value) => total + value, 0) / scores.length;
  return {
    rating: rounded(rating),
    bonus: rounded(clamp((rating - 0.65) * 0.8, -0.4, 0.2)),
  };
}

export function validateLineupForFormation(tactics, lineupIds = [], players = []) {
  const ids = Array.isArray(lineupIds) ? lineupIds.map(String) : [];
  const formationId = String(tactics?.formationId ?? "").trim();
  const roles = FORMATION_ROLES[formationId];
  const errors = [];
  const warnings = [];
  if (!roles) {
    errors.push({ code: "FORMATION_INVALID", message: "A formação selecionada não existe." });
    return { valid: false, errors, warnings, assignments: [] };
  }
  if (ids.length !== roles.length) {
    errors.push({
      code: "LINEUP_REQUIRES_ELEVEN",
      message: `A formação ${formationId} exige exatamente 11 titulares.`,
      expected: roles.length,
      received: ids.length,
    });
  }
  if (new Set(ids).size !== ids.length) {
    errors.push({ code: "LINEUP_DUPLICATE_PLAYER", message: "A escalação não pode repetir jogadores." });
  }
  const playersById = new Map((Array.isArray(players) ? players : []).map((player) => [String(player?.id ?? ""), player]));
  const assignments = ids.map((playerId, index) => {
    const player = playersById.get(playerId);
    const role = roles[index] ?? null;
    const actual = String(player?.position ?? "").trim().toUpperCase() || null;
    const exact = Boolean(actual && role && actual === role);
    const compatible = Boolean(exact || (actual && role && (COMPATIBLE_POSITIONS[role] ?? []).includes(actual)));
    if (player && role && !compatible) {
      warnings.push({
        code: "PLAYER_OUT_OF_POSITION",
        message: `${playerName(player) ?? playerId} atua fora da função ${role}.`,
        playerId,
        role,
        position: actual,
      });
    }
    return { playerId, role, position: actual, exact, compatible };
  });
  if (playersById.size > 0) {
    const goalkeepers = ids.filter((playerId) => String(playersById.get(playerId)?.position ?? "").trim().toUpperCase() === "GOL");
    if (goalkeepers.length !== 1) {
      errors.push({
        code: "LINEUP_GOALKEEPER_COUNT",
        message: "A escalação precisa de exatamente um goleiro.",
        received: goalkeepers.length,
      });
    } else if (assignments[0]?.position !== "GOL") {
      errors.push({ code: "LINEUP_GOALKEEPER_SLOT", message: "O goleiro precisa ocupar a função GOL." });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    assignments,
    exactPositionCount: assignments.filter((assignment) => assignment.exact).length,
    outOfPositionCount: warnings.length,
  };
}

function averagePlayerAttribute(players, keys) {
  const values = players.flatMap((player) => keys.flatMap((key) => {
    const value = Number(player?.attributes?.[key]);
    return Number.isFinite(value) && value >= 1 && value <= 20 ? [value] : [];
  }));
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 10;
}

function bestTaker(players, keys) {
  return [...players].sort((left, right) => (
    attributeAverage(right, keys) - attributeAverage(left, keys)
    || String(left?.id ?? "").localeCompare(String(right?.id ?? ""), "pt-BR")
  ))[0]?.id ?? null;
}

export function createAiTacticPlan(players = [], lineupIds = []) {
  const catalog = Array.isArray(players) ? players : [];
  const playersById = new Map(catalog.map((player) => [String(player?.id ?? ""), player]));
  const selectedIds = Array.isArray(lineupIds) ? lineupIds.map(String).slice(0, 11) : [];
  const selected = selectedIds.map((playerId) => playersById.get(playerId)).filter(Boolean);
  const formationId = FORMATION_IDS.map((candidate, index) => {
    const plan = { ...DEFAULT_TACTIC_PLAN, formationId: candidate };
    return { id: candidate, fit: positionFit(plan, playersById, selectedIds).rating ?? 0, index };
  }).sort((left, right) => right.fit - left.fit || left.index - right.index)[0]?.id ?? DEFAULT_TACTIC_PLAN.formationId;
  const attack = averagePlayerAttribute(selected.filter((player) => ["ATA", "PD", "PE", "MEI"].includes(String(player.position))), ["chute", "drible", "velocidade", "nocao"]);
  const defense = averagePlayerAttribute(selected.filter((player) => ["ZAG", "LD", "LE", "VOL", "GOL"].includes(String(player.position))), ["defesa", "nocao", "forca", "resistencia"]);
  const passing = averagePlayerAttribute(selected, ["passe", "nocao", "peBom"]);
  const speed = averagePlayerAttribute(selected, ["velocidade", "drible"]);
  const stamina = averagePlayerAttribute(selected, ["resistencia", "forca"]);
  const plan = structuredClone(DEFAULT_TACTIC_PLAN);
  plan.formationId = formationId;
  plan.mentality = attack >= defense + 2 ? "attacking" : attack >= defense ? "positive" : defense >= attack + 2 ? "cautious" : "balanced";
  plan.teamInstructions.width = selected.filter((player) => ["PD", "PE", "LD", "LE"].includes(String(player.position))).length >= 3 ? "wide" : "normal";
  plan.teamInstructions.tempo = speed >= 13 ? "fast" : speed <= 9 ? "slow" : "normal";
  plan.teamInstructions.pressing = stamina >= 13 && defense >= 11 ? "intense" : stamina <= 9 ? "passive" : "moderate";
  plan.teamInstructions.pressureLine = plan.teamInstructions.pressing === "intense" ? "high" : plan.teamInstructions.pressing === "passive" ? "low" : "medium";
  plan.teamInstructions.offensiveTransition = speed >= passing + 1 ? "counter" : passing >= 12 ? "build-up" : "direct";
  plan.teamInstructions.defensiveTransition = stamina >= 13 ? "counter-press" : defense >= 12 ? "regroup" : "drop";
  plan.setPieces.corner.takerId = bestTaker(selected, ["passe", "peBom", "nocao"]);
  plan.setPieces.freeKick.takerId = bestTaker(selected, ["chute", "peBom", "passe"]);
  plan.setPieces.goalKick.takerId = selected.find((player) => player.position === "GOL")?.id ?? null;
  plan.secret = true;
  return plan;
}

function playerName(player) {
  const value = String(player?.shortName ?? player?.name ?? "").trim();
  return value || null;
}

function attributeAverage(player, keys) {
  const values = keys
    .map((key) => Number(player?.attributes?.[key]))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 20);
  if (values.length === 0) {
    const overall = Number(player?.overall);
    return Number.isFinite(overall) ? clamp(overall, 1, 20) : 10;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function setPieceDetails(plan, playersById) {
  const read = (kind, keys) => {
    const selected = plan.setPieces?.[kind] ?? DEFAULT_TACTIC_PLAN.setPieces[kind];
    const player = selected.takerId ? playersById.get(String(selected.takerId)) : null;
    const takerRating = attributeAverage(player, keys);
    return {
      routine: selected.routine,
      takerId: player?.id ? String(player.id) : null,
      takerName: playerName(player),
      takerRating: rounded(takerRating),
    };
  };
  return {
    corner: read("corner", ["passe", "peBom", "nocao"]),
    freeKick: read("freeKick", ["chute", "peBom", "passe"]),
    goalKick: read("goalKick", ["passe", "peBom", "nocao"]),
  };
}

function setPieceImpact(setPieces) {
  const routineBonus = {
    short: 0.005,
    "near-post": 0.02,
    "far-post": 0.015,
    direct: 0.025,
    cross: 0.015,
    mixed: 0.01,
    long: 0.015,
  };
  const corner = (setPieces.corner.takerRating - 10) * 0.004 + (routineBonus[setPieces.corner.routine] ?? 0);
  const freeKick = (setPieces.freeKick.takerRating - 10) * 0.005 + (routineBonus[setPieces.freeKick.routine] ?? 0);
  return rounded(clamp((corner + freeKick) / 2, -0.08, 0.08));
}

export function calculateTacticalProfile(tactics, players = [], lineupIds = []) {
  if (!tactics || tactics.version !== 1 || !FORMATION_ROLES[tactics.formationId]) return null;
  const playersById = new Map((Array.isArray(players) ? players : []).map((player) => [String(player?.id ?? ""), player]));
  const vector = { attack: 0, control: 0, defense: 0, disciplineRisk: 0, fatigue: 0 };
  addVector(vector, FORMATION_SHAPES[tactics.formationId]);
  addVector(vector, MENTALITY[tactics.mentality]);
  addVector(vector, PRESSURE_LINE[tactics.teamInstructions?.pressureLine]);
  addVector(vector, WIDTH[tactics.teamInstructions?.width]);
  addVector(vector, TEMPO[tactics.teamInstructions?.tempo]);
  addVector(vector, PRESSING[tactics.teamInstructions?.pressing]);
  addVector(vector, OFFENSIVE_TRANSITION[tactics.teamInstructions?.offensiveTransition]);
  addVector(vector, DEFENSIVE_TRANSITION[tactics.teamInstructions?.defensiveTransition]);

  const lineupSet = new Set(lineupIds.map(String));
  const individual = { attack: 0, control: 0, defense: 0, disciplineRisk: 0, fatigue: 0 };
  for (const instruction of tactics.individualInstructions ?? []) {
    if (!lineupSet.has(String(instruction.playerId))) continue;
    addVector(individual, WITH_BALL[instruction.withBall]);
    addVector(individual, WITHOUT_BALL[instruction.withoutBall]);
  }
  for (const key of ["attack", "control", "defense"]) {
    individual[key] = clamp(individual[key], -0.2, 0.2);
  }
  individual.disciplineRisk = clamp(individual.disciplineRisk, -0.04, 0.06);
  individual.fatigue = clamp(individual.fatigue, -0.12, 0.04);
  addVector(vector, individual);

  const fit = positionFit(tactics, playersById, lineupIds);
  const setPieces = setPieceDetails(tactics, playersById);
  const goalKickControl = {
    short: 0.04,
    mixed: 0,
    long: -0.03,
  }[setPieces.goalKick.routine] ?? 0;
  vector.control += goalKickControl;

  return {
    version: 1,
    available: true,
    formationId: tactics.formationId,
    attack: rounded(clamp(vector.attack, -0.75, 0.75)),
    control: rounded(clamp(vector.control, -0.75, 0.75)),
    defense: rounded(clamp(vector.defense, -0.75, 0.75)),
    setPiece: setPieceImpact(setPieces),
    disciplineRisk: rounded(clamp(vector.disciplineRisk, -0.1, 0.1)),
    fatigueSecondHalfModifier: rounded(clamp(vector.fatigue, -0.25, 0.05)),
    formationFitRating: fit.rating,
    formationFitBonus: fit.bonus,
    individualImpact: {
      attack: rounded(individual.attack),
      control: rounded(individual.control),
      defense: rounded(individual.defense),
    },
    setPieces,
  };
}

function lineupCohesionModifier(lineup) {
  const score = Number(lineup?.cohesion?.score);
  if (!Number.isFinite(score)) return 0;
  return rounded(clamp((score - 70) / 100, -0.25, 0.2));
}

function applySideProfile(fixture, side, profile, matchupModifier = 0, cohesion = 0) {
  if (!profile) return null;
  const previous = fixture?.strengthProfile?.[side] ?? {};
  const strengthField = side === "home" ? "homeStrength" : "awayStrength";
  const currentEffective = Number.isFinite(previous.effective)
    ? previous.effective
    : Number.isFinite(fixture?.[strengthField]) ? fixture[strengthField] : 10;
  const effective = rounded(currentEffective + profile.formationFitBonus + matchupModifier + cohesion);
  return {
    strength: effective,
    strengthProfile: {
      ...previous,
      formationFitBonus: profile.formationFitBonus,
      tacticalMatchupBonus: matchupModifier,
      cohesionBonus: cohesion,
      effective,
    },
  };
}

export function applyPregameTacticsToFixture(fixture, homeLineup, awayLineup, homeRoster, awayRoster) {
  if (!homeLineup?.tactics && !awayLineup?.tactics) return fixture;
  const homeProfile = calculateTacticalProfile(
    homeLineup?.tactics,
    homeRoster?.players,
    homeRoster?.initialLineupIds ?? homeLineup?.lineupIds ?? [],
  );
  const awayProfile = calculateTacticalProfile(
    awayLineup?.tactics,
    awayRoster?.players,
    awayRoster?.initialLineupIds ?? awayLineup?.lineupIds ?? [],
  );
  const matchup = calculateTacticalMatchup({
    homeTactics: homeLineup?.tactics,
    awayTactics: awayLineup?.tactics,
    homeProfile,
    awayProfile,
    homeAttributes: fixture?.lineupAttributeProfile?.home,
    awayAttributes: fixture?.lineupAttributeProfile?.away,
  });
  const homeCohesion = lineupCohesionModifier(homeLineup);
  const awayCohesion = lineupCohesionModifier(awayLineup);
  const homeApplied = applySideProfile(fixture, "home", homeProfile, matchup.home.modifier, homeCohesion);
  const awayApplied = applySideProfile(fixture, "away", awayProfile, matchup.away.modifier, awayCohesion);
  return {
    ...fixture,
    ...(homeApplied ? {
      homeStrength: homeApplied.strength,
      homePhysicalSecondHalfModifier: clamp(
        (Number(fixture.homePhysicalSecondHalfModifier) || 0) + homeProfile.fatigueSecondHalfModifier,
        -0.4,
        0.4,
      ),
      homeTacticalProfile: homeProfile,
    } : {}),
    ...(awayApplied ? {
      awayStrength: awayApplied.strength,
      awayPhysicalSecondHalfModifier: clamp(
        (Number(fixture.awayPhysicalSecondHalfModifier) || 0) + awayProfile.fatigueSecondHalfModifier,
        -0.4,
        0.4,
      ),
      awayTacticalProfile: awayProfile,
    } : {}),
    tacticalMatchup: matchup,
    strengthProfile: {
      ...(fixture.strengthProfile ?? {}),
      ...(homeApplied ? { home: homeApplied.strengthProfile } : {}),
      ...(awayApplied ? { away: awayApplied.strengthProfile } : {}),
    },
  };
}
