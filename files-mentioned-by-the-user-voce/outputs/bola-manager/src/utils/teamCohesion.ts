import { formations } from '../constants/formations';
import type { Player, RoomLineup, TacticPlanV1 } from '../types';
import { isPositionCompatible } from './playerRoster';

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

function lineupIds(lineup: readonly (Player | undefined)[]) {
  return lineup.flatMap((player) => player ? [player.id] : []);
}

function tacticFingerprint(plan: TacticPlanV1) {
  return JSON.stringify({
    mentality: plan.mentality,
    teamInstructions: plan.teamInstructions,
    individualInstructions: [...plan.individualInstructions]
      .map(({ playerId, withBall, withoutBall }) => ({ playerId, withBall, withoutBall }))
      .sort((left, right) => left.playerId.localeCompare(right.playerId)),
    setPieces: plan.setPieces,
  });
}

function replacements(previousIds: readonly string[], nextIds: readonly string[]) {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);
  return Math.max(
    previousIds.filter((id) => !next.has(id)).length,
    nextIds.filter((id) => !previous.has(id)).length,
  );
}

function movedSlots(previousIds: readonly string[], nextIds: readonly string[]) {
  const oldIndex = new Map(previousIds.map((id, index) => [id, index]));
  return nextIds.filter((id, index) => oldIndex.has(id) && oldIndex.get(id) !== index).length;
}

function positionFit(plan: TacticPlanV1, lineup: readonly (Player | undefined)[]) {
  const formation = formations.find((candidate) => candidate.id === plan.formationId) ?? formations[0];
  let exactPositionCount = 0;
  let outOfPositionCount = 0;
  formation.slots.forEach((slot, index) => {
    const player = lineup[index];
    if (!player) return;
    if (player.position === slot.role) exactPositionCount += 1;
    else if (!isPositionCompatible(player.position, slot.role)) outOfPositionCount += 1;
  });
  return {
    exactPositionCount,
    outOfPositionCount,
    missingPlayerCount: Math.max(0, 11 - lineupIds(lineup).length),
  };
}

export function previewTeamCohesion(
  savedLineup: RoomLineup | undefined,
  draftPlan: TacticPlanV1,
  draftLineup: readonly (Player | undefined)[],
) {
  const fit = positionFit(draftPlan, draftLineup);
  const nextIds = lineupIds(draftLineup);
  const initial = clamp(
    76
      + fit.exactPositionCount * (12 / 11)
      - fit.outOfPositionCount * 3
      - fit.missingPlayerCount * 5,
  );
  const previous = savedLineup?.cohesion;
  if (!previous) return initial;

  const previousIds = previous.orderedLineupIds.length
    ? previous.orderedLineupIds
    : savedLineup?.lineupIds ?? [];
  const sameFormation = previous.formationId === draftPlan.formationId;
  const sameLineup = previousIds.length === nextIds.length
    && previousIds.every((id, index) => id === nextIds[index]);
  const sameTactics = savedLineup?.tactics
    ? tacticFingerprint(savedLineup.tactics) === tacticFingerprint(draftPlan)
    : false;
  const sameFit = previous.outOfPositionCount === fit.outOfPositionCount
    && previous.exactPositionCount === fit.exactPositionCount;
  if (sameFormation && sameLineup && sameTactics && sameFit) return previous.score;

  let impact = 0;
  if (!sameFormation) impact -= 7;
  impact -= replacements(previousIds, nextIds) * 3;
  impact -= movedSlots(previousIds, nextIds) * 0.8;
  if (!sameTactics) impact -= 4;
  impact -= (fit.outOfPositionCount - previous.outOfPositionCount) * 3;
  impact += (fit.exactPositionCount - previous.exactPositionCount) * 0.75;
  const previousMissing = Math.max(0, 11 - previousIds.length);
  impact -= (fit.missingPlayerCount - previousMissing) * 5;
  return clamp(previous.score + impact);
}
