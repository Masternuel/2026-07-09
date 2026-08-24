import type { Morale, Player } from '../types';

const DEFAULT_SCORES: Record<Morale, number> = {
  Excelente: 92,
  Boa: 75,
  Neutra: 52,
  Baixa: 30,
  'Não informada': 52,
};

export function normalizeMoraleScore(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(Math.min(100, Math.max(0, parsed)));
}

export function moraleLabelForScore(score: number): Morale {
  if (score >= 85) return 'Excelente';
  if (score >= 65) return 'Boa';
  if (score >= 45) return 'Neutra';
  return 'Baixa';
}

export function playerMoraleScore(player: Pick<Player, 'morale' | 'moraleScore'>): number {
  return normalizeMoraleScore(player.moraleScore) ?? DEFAULT_SCORES[player.morale] ?? DEFAULT_SCORES.Boa;
}
