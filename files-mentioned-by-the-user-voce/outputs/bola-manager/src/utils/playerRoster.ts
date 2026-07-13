import type { Formation, Player, PlayerPosition } from '../types';

const compatiblePositions: Partial<Record<PlayerPosition, PlayerPosition[]>> = {
  GOL: ['GOL'],
  ZAG: ['ZAG', 'VOL', 'LD', 'LE'],
  LD: ['LD', 'PD', 'ZAG'],
  LE: ['LE', 'PE', 'ZAG'],
  VOL: ['VOL', 'MC', 'ZAG'],
  MC: ['MC', 'MEI', 'VOL'],
  MEI: ['MEI', 'MC', 'PD', 'PE'],
  PD: ['PD', 'MEI', 'ATA'],
  PE: ['PE', 'MEI', 'ATA'],
  ATA: ['ATA', 'PD', 'PE', 'MEI'],
};

export function createFormationLineup(players: readonly Player[], formation: Formation): Array<Player | undefined> {
  const remaining = [...players];
  return formation.slots.map((slot) => {
    const preferences = compatiblePositions[slot.role] ?? [slot.role];
    const playerIndex = preferences.reduce((found, position) => (
      found >= 0 ? found : remaining.findIndex((player) => player.position === position)
    ), -1);
    const fallbackIndex = playerIndex >= 0 ? playerIndex : remaining.length ? 0 : -1;
    if (fallbackIndex < 0) return undefined;
    return remaining.splice(fallbackIndex, 1)[0];
  });
}

export function buildSavedLineup(
  players: readonly Player[],
  formation: Formation,
  savedLineupIds: readonly string[] | undefined,
): Array<Player | undefined> {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const savedPlayers = (savedLineupIds ?? []).flatMap((id) => {
    const player = playersById.get(id);
    return player ? [player] : [];
  }).slice(0, formation.slots.length);
  const usedIds = new Set(savedPlayers.map((player) => player.id));
  const remainingPlayers = players.filter((player) => !usedIds.has(player.id));
  const remainingFormation = { ...formation, slots: formation.slots.slice(savedPlayers.length) };
  const fallbackPlayers = createFormationLineup(remainingPlayers, remainingFormation).flatMap((player) => player ? [player] : []);
  const lineup: Array<Player | undefined> = [...savedPlayers, ...fallbackPlayers].slice(0, formation.slots.length);
  while (lineup.length < formation.slots.length) lineup.push(undefined);
  return lineup;
}

export function createBench(players: readonly Player[], lineup: readonly (Player | undefined)[], limit = 7): Player[] {
  const starters = new Set(lineup.flatMap((player) => player ? [player.id] : []));
  return players.filter((player) => !starters.has(player.id)).slice(0, limit);
}
