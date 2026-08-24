import type { AttributeKey, EditorPlayer, Player } from '../types';

type RatedPlayer = Pick<Player, 'position' | 'attributes'>;
type InternalRatedPlayer = Pick<EditorPlayer, 'position' | 'attributes'>;
type AttributeWeight = readonly [AttributeKey, number];

const GOALKEEPER_WEIGHTS: AttributeWeight[] = [
  ['reflexos', 35],
  ['posicionamentoGol', 25],
  ['saidaGol', 20],
  ['penaltis', 10],
  ['resistencia', 10],
];

const DEFENSE_WEIGHTS: AttributeWeight[] = [
  ['defesa', 30],
  ['nocao', 20],
  ['passe', 15],
  ['velocidade', 10],
  ['forca', 10],
  ['resistencia', 10],
  ['impulsao', 5],
];

const MIDFIELD_WEIGHTS: AttributeWeight[] = [
  ['passe', 25],
  ['nocao', 20],
  ['drible', 15],
  ['velocidade', 10],
  ['forca', 10],
  ['resistencia', 10],
  ['chute', 5],
  ['peBom', 5],
];

const ATTACK_WEIGHTS: AttributeWeight[] = [
  ['chute', 25],
  ['drible', 20],
  ['velocidade', 15],
  ['nocao', 10],
  ['peBom', 10],
  ['forca', 10],
  ['resistencia', 5],
  ['impulsao', 5],
];

const PHYSICAL_WEIGHTS: AttributeWeight[] = [
  ['velocidade', 25],
  ['forca', 30],
  ['resistencia', 30],
  ['impulsao', 15],
];

function attributeValue(player: RatedPlayer | InternalRatedPlayer, key: AttributeKey, maximum = 10) {
  const value = Number(player.attributes[key]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(1, value)) : maximum / 2;
}

function weightedRating(player: RatedPlayer | InternalRatedPlayer, weights: AttributeWeight[], maximum = 10) {
  const totalWeight = weights.reduce((total, [, weight]) => total + weight, 0);
  if (!totalWeight) return maximum / 2;
  return weights.reduce((total, [key, weight]) => total + attributeValue(player, key, maximum) * weight, 0) / totalWeight;
}

function positionWeights(position: Player['position']) {
  if (position === 'GOL') return GOALKEEPER_WEIGHTS;
  if (['ZAG', 'LD', 'LE'].includes(position)) return DEFENSE_WEIGHTS;
  if (['VOL', 'MC', 'MEI'].includes(position)) return MIDFIELD_WEIGHTS;
  return ATTACK_WEIGHTS;
}

export function playerGoalkeeperRating(player: RatedPlayer) {
  return weightedRating(player, GOALKEEPER_WEIGHTS);
}

export function playerPhysicalRating(player: RatedPlayer) {
  return weightedRating(player, PHYSICAL_WEIGHTS);
}

export function playerPositionRating(player: RatedPlayer) {
  return weightedRating(player, positionWeights(player.position));
}

export function calculatePlayerOverall(player: InternalRatedPlayer) {
  return Math.min(20, Math.max(1, Math.round(weightedRating(player, positionWeights(player.position), 20))));
}
