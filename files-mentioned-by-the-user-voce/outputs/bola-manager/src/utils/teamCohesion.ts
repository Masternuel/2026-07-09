import { formations } from '../constants/formations';
import type { Player, RoomLineup, TacticPlanV1 } from '../types';
import { calculateTeamCohesion, normalizeCohesionExperience } from '../../shared/teamCohesion.mjs';

const formationRoles = Object.fromEntries(formations.map((formation) => [
  formation.id, formation.slots.map((slot) => slot.role),
]));

export function normalizeTeamCohesionExperience(value: unknown) {
  return normalizeCohesionExperience(value, formationRoles);
}

export function previewTeamCohesion(
  savedLineup: RoomLineup | undefined,
  draftPlan: TacticPlanV1,
  draftLineup: readonly (Player | undefined)[],
) {
  const starters = draftLineup.flatMap((player) => player ? [player] : []);
  return calculateTeamCohesion({
    formationRoles,
    previous: savedLineup?.cohesion,
    previousTactics: savedLineup?.tactics,
    lineupIds: draftLineup.map((player) => player?.id ?? ''),
    tactics: draftPlan,
    players: starters,
    reason: 'save',
  }).score;
}
