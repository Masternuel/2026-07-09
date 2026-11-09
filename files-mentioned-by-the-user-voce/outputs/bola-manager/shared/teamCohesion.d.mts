import type { TacticPlanV1, TeamCohesionState } from '../src/types';

export const MAX_COHESION_CONFIGURATIONS: number;
export interface CohesionCalculationOptions {
  formationRoles: Readonly<Record<string, readonly string[]>>;
  previous?: TeamCohesionState | null;
  previousTactics?: TacticPlanV1 | null;
  lineupIds?: readonly string[];
  tactics?: TacticPlanV1 | null;
  players?: readonly { id: string; position?: string }[];
  reason?: 'save' | 'match';
  cohesionGainBonus?: number;
  cohesionChangePenaltyMultiplier?: number;
}
export function calculateTeamCohesion(options: CohesionCalculationOptions): TeamCohesionState;
export function normalizeCohesionExperience(
  previous: unknown,
  formationRoles: CohesionCalculationOptions['formationRoles'],
): Partial<Pick<TeamCohesionState, 'version' | 'acquiredScore' | 'adaptationPenalty' | 'familiarity' | 'penaltyMultiplier'>>;
export function cohesionModifier(score: unknown): number;
