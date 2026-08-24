import { FORMATION_ROLES } from "./tactics.mjs";

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const DEFAULT_FORMATION_ID = "4-3-3";
const MAX_LINEUP_SIZE = 11;

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

function formationIdFor(tactics) {
  const requested = identifier(tactics?.formationId);
  return FORMATION_ROLES[requested] ? requested : DEFAULT_FORMATION_ID;
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

function tacticalFingerprint(tactics) {
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
    .sort((left, right) => left.playerId.localeCompare(right.playerId));
  const setPieces = Object.fromEntries(SET_PIECE_KEYS.map((key) => [key, {
    takerId: identifier(tactics?.setPieces?.[key]?.takerId) || null,
    routine: identifier(tactics?.setPieces?.[key]?.routine),
  }]));
  return hash(JSON.stringify({
    mentality: identifier(tactics?.mentality),
    teamInstructions,
    individualInstructions,
    setPieces,
  }));
}

function positionFit(formationId, lineupIds, players) {
  const roles = FORMATION_ROLES[formationId] ?? FORMATION_ROLES[DEFAULT_FORMATION_ID];
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
    missingPlayerCount: Math.max(0, roles.length - lineupIds.length),
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

export function calculateTeamCohesion({
  previous = null,
  lineupIds = [],
  tactics = null,
  players = [],
  reason = "save",
  cohesionGainBonus = 0,
  cohesionChangePenaltyMultiplier = 1,
} = {}) {
  const formationId = formationIdFor(tactics);
  const orderedLineupIds = normalizedLineupIds(lineupIds);
  const nextLineupSignature = lineupSignature(orderedLineupIds);
  const nextTacticFingerprint = tacticalFingerprint(tactics);
  const measuredFit = positionFit(formationId, orderedLineupIds, players);
  const fit = previous && !measuredFit.measured
    ? {
        ...measuredFit,
        exactPositionCount: previousCount(previous, "exactPositionCount"),
        outOfPositionCount: previousCount(previous, "outOfPositionCount"),
      }
    : measuredFit;
  const baseScore = initialScore(fit);

  if (!previous || typeof previous !== "object") {
    return {
      score: baseScore,
      formationId,
      orderedLineupIds,
      lineupSignature: nextLineupSignature,
      tacticFingerprint: nextTacticFingerprint,
      stableMatches: reason === "match" ? 1 : 0,
      outOfPositionCount: fit.outOfPositionCount,
      exactPositionCount: fit.exactPositionCount,
      changeImpact: 0,
    };
  }

  const oldIds = normalizedLineupIds(previous.orderedLineupIds);
  const sameFormation = identifier(previous.formationId) === formationId;
  const sameLineup = identifier(previous.lineupSignature) === nextLineupSignature;
  const sameTactics = identifier(previous.tacticFingerprint) === nextTacticFingerprint;
  const sameFit = previousCount(previous, "outOfPositionCount") === fit.outOfPositionCount
    && previousCount(previous, "exactPositionCount") === fit.exactPositionCount;
  const unchanged = sameFormation && sameLineup && sameTactics && sameFit;
  const oldScore = previousScore(previous, baseScore);
  const oldStableMatches = previousCount(previous, "stableMatches");

  let score = oldScore;
  let stableMatches = oldStableMatches;
  const staffGain = clamp(Number(cohesionGainBonus) || 0, 0, 4);
  const staffPenaltyMultiplier = clamp(Number(cohesionChangePenaltyMultiplier) || 1, 0.5, 1);
  if (unchanged) {
    if (reason === "match") {
      stableMatches += 1;
      score = clamp(score + Math.round(1 + Math.min(stableMatches, 8) / 4 + staffGain), 0, 100);
    }
  } else {
    stableMatches = 0;
    let impact = 0;
    if (!sameFormation) impact -= 7;
    impact -= replacements(oldIds, orderedLineupIds) * 3;
    impact -= movedSlots(oldIds, orderedLineupIds) * 0.8;
    if (!sameTactics) impact -= 4;
    impact -= (fit.outOfPositionCount - previousCount(previous, "outOfPositionCount")) * 3;
    impact += (fit.exactPositionCount - previousCount(previous, "exactPositionCount")) * 0.75;
    const oldMissing = Math.max(0, MAX_LINEUP_SIZE - oldIds.length);
    impact -= (fit.missingPlayerCount - oldMissing) * 5;
    if (impact < 0) impact *= staffPenaltyMultiplier;
    score = clamp(Math.round(score + impact), 0, 100);
  }

  return {
    score,
    formationId,
    orderedLineupIds,
    lineupSignature: nextLineupSignature,
    tacticFingerprint: nextTacticFingerprint,
    stableMatches,
    outOfPositionCount: fit.outOfPositionCount,
    exactPositionCount: fit.exactPositionCount,
    changeImpact: score - oldScore,
  };
}

export function cohesionModifier(score) {
  const normalized = Number.isFinite(Number(score)) ? Number(score) : 70;
  return Math.round(clamp((normalized - 70) / 100, -0.35, 0.25) * 1_000) / 1_000;
}
