import type { Formation, Player, PlayerPosition } from '../types';

export const compatiblePositions: Partial<Record<PlayerPosition, PlayerPosition[]>> = {
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

export function isPlayerAvailableForLineup(player: Player): boolean {
  return player.status !== 'Lesionado'
    && player.status !== 'Suspenso'
    && !(Number(player.injuryMatches) > 0)
    && !(Number(player.suspensionMatches) > 0);
}

export function buildAvailableLineupIds(
  players: readonly Player[],
  preferredIds: readonly string[] | undefined,
  maximum = 11,
): string[] {
  const limit = Math.max(0, Math.trunc(maximum));
  const availablePlayers = players.filter(isPlayerAvailableForLineup);
  const availableById = new Map(availablePlayers.map((player) => [player.id, player]));
  const lineupIds: string[] = [];

  for (const playerId of preferredIds ?? []) {
    if (lineupIds.length >= limit) break;
    if (availableById.has(playerId) && !lineupIds.includes(playerId)) lineupIds.push(playerId);
  }
  for (const player of availablePlayers) {
    if (lineupIds.length >= limit) break;
    if (!lineupIds.includes(player.id)) lineupIds.push(player.id);
  }

  return lineupIds;
}

export function isPositionCompatible(playerPosition: PlayerPosition, role: PlayerPosition): boolean {
  return playerPosition === role || (compatiblePositions[role] ?? [role]).includes(playerPosition);
}

export function createFormationLineup(players: readonly Player[], formation: Formation): Array<Player | undefined> {
  const remaining = players.filter(isPlayerAvailableForLineup);
  return formation.slots.map((slot) => {
    return takePlayerForRole(remaining, slot.role);
  });
}

function takePlayerForRole(remaining: Player[], role: PlayerPosition): Player | undefined {
  const preferences = compatiblePositions[role] ?? [role];
  const compatibleIndex = preferences.reduce((found, position) => (
    found >= 0 ? found : remaining.findIndex((player) => player.position === position)
  ), -1);
  const selectedIndex = compatibleIndex >= 0 ? compatibleIndex : remaining.length ? 0 : -1;
  return selectedIndex >= 0 ? remaining.splice(selectedIndex, 1)[0] : undefined;
}

export function buildSavedLineup(
  players: readonly Player[],
  formation: Formation,
  savedLineupIds: readonly string[] | undefined,
): Array<Player | undefined> {
  const playersById = new Map(players.map((player) => [player.id, player]));
  const ids = savedLineupIds ?? [];
  const usedIds = new Set<string>();
  const lineup = formation.slots.map((_, index) => {
    const savedId = ids[index];
    if (!savedId) return undefined;
    const player = playersById.get(savedId);
    if (!player || usedIds.has(player.id)) return undefined;
    usedIds.add(player.id);
    return player;
  });
  const remainingPlayers = players.filter((player) => (
    isPlayerAvailableForLineup(player) && !usedIds.has(player.id)
  ));

  formation.slots.forEach((slot, index) => {
    if (ids[index] || lineup[index]) return;
    const player = takePlayerForRole(remainingPlayers, slot.role);
    if (!player) return;
    lineup[index] = player;
    usedIds.add(player.id);
  });

  return lineup;
}

export function createBench(players: readonly Player[], lineup: readonly (Player | undefined)[], limit?: number): Player[] {
  const starters = new Set(lineup.flatMap((player) => player ? [player.id] : []));
  const candidates = players.filter((player) => !starters.has(player.id));
  const orderedBench = [
    ...candidates.filter(isPlayerAvailableForLineup),
    ...candidates.filter((player) => !isPlayerAvailableForLineup(player)),
  ];
  return typeof limit === 'number'
    ? orderedBench.slice(0, Math.max(0, limit))
    : orderedBench;
}
