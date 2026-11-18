import type { Player, PlayerCatalogUnknownField } from '../types';

export function hasKnownCatalogField(player: Player, field: PlayerCatalogUnknownField) {
  return player.catalogUnknownFields?.includes(field) !== true;
}

export function knownPlayerCondition(player: Player): number | null {
  return hasKnownCatalogField(player, 'condition') && Number.isFinite(player.condition)
    ? player.condition
    : null;
}

export function playerShirtNumberLabel(player: Player) {
  return hasKnownCatalogField(player, 'shirtNumber') && Number.isFinite(player.number)
    ? String(player.number)
    : '—';
}
