const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const rounded = (value) => {
  const result = Math.round(value * 1_000) / 1_000;
  return Object.is(result, -0) ? 0 : result;
};

const FORMATION_DESIGNS = Object.freeze({
  "4-3-3": Object.freeze({ midfield: 0.58, flankAttack: 0.90, flankCover: 0.62, backLine: 0.57, forwards: 0.88 }),
  "4-4-2": Object.freeze({ midfield: 0.62, flankAttack: 0.76, flankCover: 0.74, backLine: 0.62, forwards: 0.72 }),
  "3-5-2": Object.freeze({ midfield: 0.90, flankAttack: 0.72, flankCover: 0.48, backLine: 0.52, forwards: 0.70 }),
  "4-2-3-1": Object.freeze({ midfield: 0.85, flankAttack: 0.76, flankCover: 0.70, backLine: 0.68, forwards: 0.55 }),
  "5-3-2": Object.freeze({ midfield: 0.58, flankAttack: 0.62, flankCover: 0.86, backLine: 0.90, forwards: 0.68 }),
  "3-4-3": Object.freeze({ midfield: 0.55, flankAttack: 0.95, flankCover: 0.38, backLine: 0.45, forwards: 0.95 }),
  "4-1-4-1": Object.freeze({ midfield: 0.92, flankAttack: 0.72, flankCover: 0.76, backLine: 0.77, forwards: 0.42 }),
  "5-4-1": Object.freeze({ midfield: 0.70, flankAttack: 0.58, flankCover: 0.94, backLine: 1, forwards: 0.30 }),
  "4-3-2-1": Object.freeze({ midfield: 0.86, flankAttack: 0.45, flankCover: 0.54, backLine: 0.60, forwards: 0.72 }),
});

const NEUTRAL_DESIGN = Object.freeze({
  midfield: 0.65,
  flankAttack: 0.65,
  flankCover: 0.65,
  backLine: 0.65,
  forwards: 0.65,
});

const WIDTH = Object.freeze({
  "very-narrow": -1,
  narrow: -0.5,
  normal: 0,
  wide: 0.5,
  "very-wide": 1,
});

const PRESSURE_LINE = Object.freeze({
  "very-low": 0,
  low: 0.2,
  medium: 0.45,
  high: 0.75,
  "very-high": 1,
});

const PRESSING = Object.freeze({
  passive: 0,
  moderate: 0.33,
  intense: 0.72,
  aggressive: 1,
});

const BUILD_UP_EXPOSURE = Object.freeze({
  "build-up": 1,
  direct: 0.25,
  counter: 0.10,
});

const COUNTER_THREAT = Object.freeze({
  "build-up": 0,
  direct: 0.35,
  counter: 1,
});

const REASON_LABELS = Object.freeze({
  "formation-shape": Object.freeze({
    advantage: "Desenho da formação explora o encaixe rival",
    risk: "Desenho da formação sofre com o encaixe rival",
  }),
  "width-vs-block": Object.freeze({
    advantage: "Amplitude explora o bloco adversário",
    risk: "Bloco vulnerável à amplitude adversária",
  }),
  "press-vs-build-up": Object.freeze({
    advantage: "Pressão favorecida contra a saída de bola",
    risk: "Saída de bola exposta à pressão adversária",
  }),
  "counter-vs-high-line": Object.freeze({
    advantage: "Contra-ataque explora a linha alta",
    risk: "Linha alta exposta ao contra-ataque",
  }),
  "attack-vs-defense": Object.freeze({
    advantage: "Ataque leva vantagem sobre o setor defensivo rival",
    risk: "Setor defensivo enfrenta ataque superior",
  }),
  "midfield-control": Object.freeze({
    advantage: "Meio-campo favorece o controle territorial",
    risk: "Meio-campo perde o controle territorial",
  }),
  "collective-profile": Object.freeze({
    advantage: "Instruções coletivas produzem encaixe favorável",
    risk: "Instruções coletivas produzem encaixe desfavorável",
  }),
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function enumValue(table, value, fallback = 0) {
  const key = String(value ?? "").trim();
  return Object.hasOwn(table, key) ? table[key] : fallback;
}

function teamInstructions(tactics) {
  return tactics?.teamInstructions ?? {};
}

function formationDesign(tactics, profile) {
  const formationId = String(tactics?.formationId ?? profile?.formationId ?? "").trim();
  return FORMATION_DESIGNS[formationId] ?? NEUTRAL_DESIGN;
}

function formationOpportunity(own, opponent) {
  return own.midfield * (1 - opponent.midfield) * 0.11
    + own.flankAttack * (1 - opponent.flankCover) * 0.13
    + own.forwards * (1 - opponent.backLine) * 0.09
    + own.backLine * opponent.forwards * 0.04;
}

function blockCompactness(tactics) {
  const instructions = teamInstructions(tactics);
  const width = enumValue(WIDTH, instructions.width);
  const line = enumValue(PRESSURE_LINE, instructions.pressureLine, 0.45);
  const transition = String(instructions.defensiveTransition ?? "");
  const transitionCompactness = transition === "drop" ? 0.28 : transition === "regroup" ? 0.18 : -0.08;
  return clamp(-width * 0.52 + (0.45 - line) * 0.55 + transitionCompactness, -1, 1);
}

function widthOpportunity(tactics, opponentTactics) {
  const width = enumValue(WIDTH, teamInstructions(tactics).width);
  const opponentBlock = blockCompactness(opponentTactics);
  return Math.max(0, width) * Math.max(0, opponentBlock) * 0.16
    + Math.max(0, -width) * Math.max(0, -opponentBlock) * 0.10;
}

function pressingIntensity(tactics) {
  const instructions = teamInstructions(tactics);
  const pressing = enumValue(PRESSING, instructions.pressing, 0.33);
  const line = enumValue(PRESSURE_LINE, instructions.pressureLine, 0.45);
  return pressing * 0.65 + line * 0.35;
}

function buildUpExposure(tactics, profile) {
  const transition = String(teamInstructions(tactics).offensiveTransition ?? "");
  const base = enumValue(BUILD_UP_EXPOSURE, transition, 0.4);
  const goalKick = String(
    tactics?.setPieces?.goalKick?.routine
      ?? profile?.setPieces?.goalKick?.routine
      ?? "",
  );
  const goalKickAdjustment = goalKick === "short" ? 0.15 : goalKick === "long" ? -0.10 : 0;
  return clamp(base + goalKickAdjustment, 0, 1);
}

function highLineExposure(tactics) {
  const instructions = teamInstructions(tactics);
  const line = enumValue(PRESSURE_LINE, instructions.pressureLine, 0.45);
  const transition = String(instructions.defensiveTransition ?? "");
  const transitionAdjustment = transition === "counter-press" ? 0.18 : transition === "drop" ? -0.18 : 0;
  return clamp((line - 0.35) / 0.65 + transitionAdjustment, 0, 1);
}

function counterOpportunity(tactics, opponentTactics) {
  const transition = String(teamInstructions(tactics).offensiveTransition ?? "");
  return enumValue(COUNTER_THREAT, transition) * highLineExposure(opponentTactics) * 0.18;
}

function profileOpportunity(profile, opponentProfile) {
  const attack = clamp(finite(profile?.attack), -0.75, 0.75);
  const control = clamp(finite(profile?.control), -0.75, 0.75);
  const opponentDefense = clamp(finite(opponentProfile?.defense), -0.75, 0.75);
  const opponentControl = clamp(finite(opponentProfile?.control), -0.75, 0.75);
  return attack - opponentDefense + (control - opponentControl) * 0.45;
}

function attribute(attributes, key) {
  if (attributes?.available === false) return null;
  const number = Number(attributes?.[key]);
  return Number.isFinite(number) && number >= 1 && number <= 20 ? number : null;
}

function weightedAverage(entries) {
  const present = entries.filter(([value]) => value != null);
  if (present.length === 0) return null;
  const totalWeight = present.reduce((total, [, weight]) => total + weight, 0);
  return present.reduce((total, [value, weight]) => total + value * weight, 0) / totalWeight;
}

function attackAgainstDefense(attackAttributes, defenseAttributes) {
  const attack = attribute(attackAttributes, "attack");
  const defense = weightedAverage([
    [attribute(defenseAttributes, "defense"), 0.78],
    [attribute(defenseAttributes, "goalkeeping"), 0.22],
  ]);
  if (attack == null || defense == null) return 0;
  return clamp((attack - defense) / 10, -1, 1);
}

/** Compare real lineup sectors on a 1-20 scale. Returned values are zero-sum where applicable. */
export function analyzeSectorMatchup(homeAttributes, awayAttributes) {
  const homeAttack = attackAgainstDefense(homeAttributes, awayAttributes);
  const awayAttack = attackAgainstDefense(awayAttributes, homeAttributes);
  const homeMidfield = attribute(homeAttributes, "midfield");
  const awayMidfield = attribute(awayAttributes, "midfield");
  const midfieldEdge = homeMidfield == null || awayMidfield == null
    ? 0
    : clamp((homeMidfield - awayMidfield) / 10, -1, 1);
  const attackContribution = (homeAttack - awayAttack) * 0.15;
  const midfieldContribution = midfieldEdge * 0.10;
  const edge = clamp(attackContribution + midfieldContribution, -0.35, 0.35);

  return {
    home: {
      attackVsDefense: rounded(homeAttack),
      midfieldControl: rounded(midfieldEdge),
      defensiveSecurity: rounded(-awayAttack),
    },
    away: {
      attackVsDefense: rounded(awayAttack),
      midfieldControl: rounded(-midfieldEdge),
      defensiveSecurity: rounded(-homeAttack),
    },
    edge: rounded(edge),
    contributions: {
      attackVsDefense: rounded(attackContribution),
      midfieldControl: rounded(midfieldContribution),
    },
  };
}

function reasonPair(code, contribution) {
  if (Math.abs(contribution) < 0.012) return [];
  const labels = REASON_LABELS[code];
  const favoredSide = contribution > 0 ? "home" : "away";
  const exposedSide = favoredSide === "home" ? "away" : "home";
  const impact = rounded(Math.abs(contribution));
  return [
    { code, side: favoredSide, label: labels.advantage, impact },
    { code, side: exposedSide, label: labels.risk, impact: -impact },
  ];
}

function sortedReasons(contributions) {
  return contributions.flatMap(([code, impact]) => reasonPair(code, impact)).sort((left, right) => (
    Math.abs(right.impact) - Math.abs(left.impact)
      || left.code.localeCompare(right.code, "en")
      || left.side.localeCompare(right.side, "en")
  ));
}

/**
 * Build bounded, deterministic tactical edges. Positive edge favors that side;
 * modifier is intentionally small enough to influence, never decide, a match.
 */
export function calculateTacticalMatchup({
  homeTactics,
  awayTactics,
  homeProfile,
  awayProfile,
  homeAttributes,
  awayAttributes,
} = {}) {
  const homeDesign = formationDesign(homeTactics, homeProfile);
  const awayDesign = formationDesign(awayTactics, awayProfile);
  const formation = clamp(
    formationOpportunity(homeDesign, awayDesign) - formationOpportunity(awayDesign, homeDesign),
    -0.24,
    0.24,
  );
  const width = clamp(
    widthOpportunity(homeTactics, awayTactics) - widthOpportunity(awayTactics, homeTactics),
    -0.16,
    0.16,
  );
  const pressure = clamp(
    pressingIntensity(homeTactics) * buildUpExposure(awayTactics, awayProfile) * 0.17
      - pressingIntensity(awayTactics) * buildUpExposure(homeTactics, homeProfile) * 0.17,
    -0.17,
    0.17,
  );
  const counter = clamp(
    counterOpportunity(homeTactics, awayTactics) - counterOpportunity(awayTactics, homeTactics),
    -0.18,
    0.18,
  );
  const collective = clamp(
    (profileOpportunity(homeProfile, awayProfile) - profileOpportunity(awayProfile, homeProfile)) * 0.09,
    -0.24,
    0.24,
  );
  const sectors = analyzeSectorMatchup(homeAttributes, awayAttributes);
  const contributions = [
    ["formation-shape", formation],
    ["width-vs-block", width],
    ["press-vs-build-up", pressure],
    ["counter-vs-high-line", counter],
    ["attack-vs-defense", sectors.contributions.attackVsDefense],
    ["midfield-control", sectors.contributions.midfieldControl],
    ["collective-profile", collective],
  ];
  const edge = rounded(clamp(
    contributions.reduce((total, [, contribution]) => total + contribution, 0),
    -0.8,
    0.8,
  ));
  const modifier = rounded(clamp(edge * 0.5, -0.4, 0.4));

  return {
    version: 1,
    home: {
      edge,
      modifier,
      sectors: sectors.home,
    },
    away: {
      edge: rounded(-edge),
      modifier: rounded(-modifier),
      sectors: sectors.away,
    },
    reasons: sortedReasons(contributions),
  };
}
