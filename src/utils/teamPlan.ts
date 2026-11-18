import { formations } from '../constants/formations';
import type { Formation, RoomLineup, TacticPlanV1 } from '../types';

export const DEFAULT_TACTIC_PLAN: TacticPlanV1 = {
  version: 1,
  formationId: '4-3-3',
  mentality: 'positive',
  teamInstructions: {
    pressureLine: 'high',
    width: 'wide',
    tempo: 'fast',
    pressing: 'intense',
    offensiveTransition: 'build-up',
    defensiveTransition: 'counter-press',
  },
  individualInstructions: [],
  setPieces: {
    corner: { takerId: null, routine: 'short' },
    freeKick: { takerId: null, routine: 'direct' },
    goalKick: { takerId: null, routine: 'short' },
  },
  secret: true,
};

export function cloneTacticPlan(plan: TacticPlanV1 = DEFAULT_TACTIC_PLAN): TacticPlanV1 {
  return {
    ...plan,
    teamInstructions: { ...plan.teamInstructions },
    individualInstructions: plan.individualInstructions.map((instruction) => ({ ...instruction })),
    setPieces: {
      corner: { ...plan.setPieces.corner },
      freeKick: { ...plan.setPieces.freeKick },
      goalKick: { ...plan.setPieces.goalKick },
    },
  };
}

export function tacticPlanForLineup(lineup?: RoomLineup | null): TacticPlanV1 {
  return cloneTacticPlan(lineup?.tactics ?? DEFAULT_TACTIC_PLAN);
}

export function persistedTacticPlanForLineup(lineup?: RoomLineup | null): TacticPlanV1 | null {
  return lineup?.tactics ? cloneTacticPlan(lineup.tactics) : null;
}

export function formationForPlan(plan?: Pick<TacticPlanV1, 'formationId'> | null): Formation {
  return formations.find((formation) => formation.id === plan?.formationId) ?? formations[0];
}

const mentalityLabels = {
  cautious: 'Cautelosa',
  balanced: 'Equilibrada',
  positive: 'Positiva',
  attacking: 'Ofensiva',
} as const;

const tempoLabels = {
  'very-slow': 'Muito lento',
  slow: 'Lento',
  normal: 'Normal',
  fast: 'Rápido',
  'very-fast': 'Muito rápido',
} as const;

const transitionLabels = {
  'build-up': 'Construção curta',
  direct: 'Jogo direto',
  counter: 'Contra-ataque',
} as const;

const pressureLabels = {
  passive: 'Pressão passiva',
  moderate: 'Pressão moderada',
  intense: 'Pressão intensa',
  aggressive: 'Pressão agressiva',
} as const;

export function tacticPlanLabels(plan: TacticPlanV1) {
  return {
    mentality: mentalityLabels[plan.mentality],
    tempo: tempoLabels[plan.teamInstructions.tempo],
    transition: transitionLabels[plan.teamInstructions.offensiveTransition],
    pressure: pressureLabels[plan.teamInstructions.pressing],
  };
}
