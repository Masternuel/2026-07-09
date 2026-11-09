const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const DEFAULT_FORMATION_ID = "4-3-3";
const MAX_LINEUP_SIZE = 11;
export const MAX_COHESION_CONFIGURATIONS = 32;

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

const TEAM_INSTRUCTION_KEYS = Object.freeze([
  "pressureLine",
  "width",
  "tempo",
  "pressing",
  "offensiveTransition",
  "defensiveTransition",
]);

const SET_PIECE_KEYS = Object.freeze(["corner", "freeKick", "goalKick"]);

function identifier(value) {
  return String(value ?? "").trim();
}

function formationIdFor(tactics, formationRoles) {
  const requested = identifier(tactics?.formationId);
  return Object.hasOwn(formationRoles, requested) ? requested : DEFAULT_FORMATION_ID;
}

function normalizedLineupIds(lineupIds) {
  if (!Array.isArray(lineupIds)) return [];
  return lineupIds.map(identifier).filter(Boolean).slice(0, MAX_LINEUP_SIZE);
}

function lineupSignature(lineupIds) {
  return JSON.stringify(lineupIds);
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function tacticalInstructions(tactics) {
  const teamInstructions = Object.fromEntries(TEAM_INSTRUCTION_KEYS.map((key) => [
    key,
    identifier(tactics?.teamInstructions?.[key]),
  ]));
  const individualInstructions = (Array.isArray(tactics?.individualInstructions)
    ? tactics.individualInstructions
    : [])
    .map((instruction) => ({
      playerId: identifier(instruction?.playerId),
      withBall: identifier(instruction?.withBall),
      withoutBall: identifier(instruction?.withoutBall),
    }))
    .filter((instruction) => instruction.playerId)
    .sort((left, right) => left.playerId.localeCompare(right.playerId))
    .slice(0, MAX_LINEUP_SIZE);
  const setPieces = Object.fromEntries(SET_PIECE_KEYS.map((key) => [key, {
    takerId: identifier(tactics?.setPieces?.[key]?.takerId) || null,
    routine: identifier(tactics?.setPieces?.[key]?.routine),
  }]));
  return {
    teamInstructions,
    individualInstructions,
    setPieces,
  };
}

function positionFit(formationId, lineupIds, players, formationRoles) {
  const roles = formationRoles[formationId] ?? formationRoles[DEFAULT_FORMATION_ID];
  const playersById = new Map((Array.isArray(players) ? players : []).map((player) => [
    identifier(player?.id),
    identifier(player?.position).toUpperCase(),
  ]));
  const measured = [...playersById.values()].some(Boolean);
  let exactPositionCount = 0;
  let outOfPositionCount = 0;
  for (const [index, playerId] of lineupIds.entries()) {
    const role = roles[index];
    const position = playersById.get(playerId);
    if (position && position === role) {
      exactPositionCount += 1;
      continue;
    }
    if (position && !(COMPATIBLE_POSITIONS[role] ?? []).includes(position)) {
      outOfPositionCount += 1;
    }
  }
  return {
    measured,
    exactPositionCount,
    outOfPositionCount,
    missingPlayerCount: Math.max(0, roles.length - lineupIds.filter(Boolean).length),
  };
}

function initialScore(fit) {
  return clamp(Math.round(
    76
      + fit.exactPositionCount * (12 / MAX_LINEUP_SIZE)
      - fit.outOfPositionCount * 3
      - fit.missingPlayerCount * 5,
  ), 0, 100);
}

function previousScore(previous, fallback) {
  const score = Number(previous?.score);
  return Number.isFinite(score) ? clamp(Math.round(score), 0, 100) : fallback;
}

function previousCount(previous, key) {
  const value = Number(previous?.[key]);
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function replacements(previousIds, nextIds) {
  const previousSet = new Set(previousIds);
  const nextSet = new Set(nextIds);
  const removed = [...previousSet].filter((playerId) => !nextSet.has(playerId)).length;
  const added = [...nextSet].filter((playerId) => !previousSet.has(playerId)).length;
  return Math.max(removed, added);
}

function movedSlots(previousIds, nextIds) {
  const previousIndex = new Map(previousIds.map((playerId, index) => [playerId, index]));
  return nextIds.filter((playerId, index) => (
    previousIndex.has(playerId) && previousIndex.get(playerId) !== index
  )).length;
}

function configurationKey(configuration) {
  return JSON.stringify([
    configuration.formationId, configuration.orderedLineupIds, configuration.tactics,
    configuration.outOfPositionCount, configuration.exactPositionCount,
  ]);
}

const INSTRUCTION_SCALES = Object.freeze({
  pressureLine: ["very-low", "low", "medium", "high", "very-high"],
  width: ["very-narrow", "narrow", "normal", "wide", "very-wide"],
  tempo: ["very-slow", "slow", "normal", "fast", "very-fast"],
  pressing: ["passive", "moderate", "intense", "aggressive"],
});

function strategyDistance(previous, next) {
  let distance = 0;
  for (const key of TEAM_INSTRUCTION_KEYS) {
    const oldValue = previous.teamInstructions[key];
    const newValue = next.teamInstructions[key];
    if (oldValue === newValue) continue;
    const scale = INSTRUCTION_SCALES[key];
    distance += scale && scale.includes(oldValue) && scale.includes(newValue)
      ? Math.abs(scale.indexOf(oldValue) - scale.indexOf(newValue)) * 0.75
      : 2;
  }
  if (JSON.stringify(previous.individualInstructions) !== JSON.stringify(next.individualInstructions)) distance += 2;
  if (JSON.stringify(previous.setPieces) !== JSON.stringify(next.setPieces)) distance += 0.5;
  return distance;
}

function configurationDistance(previous, next) {
  let distance = previous.formationId === next.formationId ? 0 : 7;
  distance += replacements(previous.orderedLineupIds, next.orderedLineupIds) * 3;
  distance += movedSlots(previous.orderedLineupIds, next.orderedLineupIds) * 0.8;
  distance += strategyDistance(previous.tactics, next.tactics);
  distance += (next.outOfPositionCount - previous.outOfPositionCount) * 3;
  distance -= (next.exactPositionCount - previous.exactPositionCount) * 0.75;
  distance += (previous.orderedLineupIds.length - next.orderedLineupIds.length) * 5;
  return distance;
}

export function normalizeCohesionExperience(previous, formationRoles) {
  if (previous?.version !== 2 || !Number.isFinite(previous.acquiredScore)
      || !Array.isArray(previous.familiarity)) return {};
  const familiarity = [];
  const seen = new Set();
  for (const entry of previous.familiarity.slice(0, MAX_COHESION_CONFIGURATIONS)) {
    if (!entry || !Object.hasOwn(formationRoles, entry.formationId) || !Array.isArray(entry.orderedLineupIds)) continue;
    const configuration = {
      formationId: entry.formationId,
      orderedLineupIds: normalizedLineupIds(entry.orderedLineupIds),
      tactics: tacticalInstructions(entry.tactics),
      outOfPositionCount: clamp(previousCount(entry, "outOfPositionCount"), 0, 11),
      exactPositionCount: clamp(previousCount(entry, "exactPositionCount"), 0, 11),
      matches: previousCount(entry, "matches"),
      adaptationPenalty: clamp(Number(entry.adaptationPenalty) || 0, 0, 100),
    };
    const key = configurationKey(configuration);
    if (!seen.has(key)) { seen.add(key); familiarity.push(configuration); }
  }
  if (!familiarity.length) return {};
  return {
    version: 2,
    acquiredScore: clamp(Math.round(previous.acquiredScore), 0, 100),
    adaptationPenalty: clamp(Number(previous.adaptationPenalty) || 0, 0, 100),
    familiarity,
    penaltyMultiplier: clamp(Number(previous.penaltyMultiplier) || 1, 0.5, 1),
  };
}

export function calculateTeamCohesion({
  previous = null,
  lineupIds = [],
  tactics = null,
  players = [],
  reason = "save",
  cohesionGainBonus = 0,
  cohesionChangePenaltyMultiplier,
  previousTactics = null,
  formationRoles,
} = {}) {
  const formationId = formationIdFor(tactics, formationRoles);
  const orderedLineupIds = normalizedLineupIds(lineupIds);
  const nextLineupSignature = lineupSignature(orderedLineupIds);
  const instructions = tacticalInstructions(tactics);
  const nextTacticFingerprint = hash(JSON.stringify(instructions));
  const slotIds = Array.isArray(lineupIds) ? lineupIds.map(identifier).slice(0, MAX_LINEUP_SIZE) : [];
  const measuredFit = positionFit(formationId, slotIds, players, formationRoles);
  const fit = previous && !measuredFit.measured
    ? {
        ...measuredFit,
        exactPositionCount: previousCount(previous, "exactPositionCount"),
        outOfPositionCount: previousCount(previous, "outOfPositionCount"),
      }
    : measuredFit;
  const baseScore = initialScore(fit);
  const oldScore = previousScore(previous, baseScore);
  const configuration = {
    formationId, orderedLineupIds, tactics: instructions,
    outOfPositionCount: fit.outOfPositionCount,
    exactPositionCount: fit.exactPositionCount,
  };
  const experience = normalizeCohesionExperience(previous, formationRoles);
  let acquiredScore = experience.acquiredScore ?? oldScore;
  let familiarity = experience.familiarity ?? [{
    ...configuration,
    ...(previous ? {
      formationId: formationIdFor(previous, formationRoles),
      orderedLineupIds: normalizedLineupIds(previous.orderedLineupIds),
      tactics: tacticalInstructions(previousTactics ?? tactics),
      outOfPositionCount: previousCount(previous, "outOfPositionCount"),
      exactPositionCount: previousCount(previous, "exactPositionCount"),
    } : {}),
    matches: previousCount(previous, "stableMatches"),
    adaptationPenalty: 0,
  }];
  const key = configurationKey(configuration);
  const known = familiarity.find((entry) => configurationKey(entry) === key);
  let stableMatches = known?.matches ?? 0;
  let adaptationPenalty = clamp(Math.min(...familiarity.map((entry) => (
    entry.adaptationPenalty + configurationDistance(entry, configuration)
  ))), 0, 100);
  const staffGain = clamp(Number(cohesionGainBonus) || 0, 0, 4);
  const staffPenaltyMultiplier = clamp(Number(cohesionChangePenaltyMultiplier ?? experience.penaltyMultiplier) || 1, 0.5, 1);
  // Saving only projects readiness. Experience is earned by completed matches,
  // never by cycling drafts; reverting reuses the same learned configuration.
  if (reason === "match") {
    stableMatches += 1;
    acquiredScore = clamp(acquiredScore + Math.round(1 + Math.min(stableMatches, 8) / 4 + staffGain), 0, 100);
    adaptationPenalty = Math.max(0, adaptationPenalty - Math.round(2 + staffGain));
    familiarity = [
      { ...configuration, matches: stableMatches, adaptationPenalty },
      ...familiarity.filter((entry) => configurationKey(entry) !== key),
    ].slice(0, MAX_COHESION_CONFIGURATIONS);
  }
  const effectivePenalty = Math.round(adaptationPenalty * staffPenaltyMultiplier);
  const score = clamp(acquiredScore - effectivePenalty, 0, 100);

  return {
    score,
    formationId,
    orderedLineupIds,
    lineupSignature: nextLineupSignature,
    tacticFingerprint: nextTacticFingerprint,
    stableMatches,
    outOfPositionCount: fit.outOfPositionCount,
    exactPositionCount: fit.exactPositionCount,
    changeImpact: previous ? score - oldScore : 0,
    version: 2,
    acquiredScore,
    adaptationPenalty: effectivePenalty,
    penaltyMultiplier: staffPenaltyMultiplier,
    familiarity,
  };
}

export function cohesionModifier(score) {
  const normalized = Number.isFinite(Number(score)) ? Number(score) : 70;
  return Math.round(clamp((normalized - 70) / 100, -0.35, 0.25) * 1_000) / 1_000;
}
