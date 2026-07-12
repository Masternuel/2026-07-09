import type { ClubChoice } from '../types';

export interface ClubOption extends ClubChoice {
  initiallyAvailable: boolean;
}

export const clubOptions: ClubOption[] = [
  { id: 'AUR', name: 'Aurora FC', code: 'AUR', city: 'São Paulo, SP', stars: 4, budget: 'R$ 72 mi', color: '#c8ff3d', initiallyAvailable: true },
  { id: 'SAN', name: 'Santos', code: 'SAN', city: 'Santos, SP', stars: 3.5, budget: 'R$ 49 mi', color: '#e7e7e7', initiallyAvailable: true },
  { id: 'FOR', name: 'Fortaleza', code: 'FOR', city: 'Fortaleza, CE', stars: 3.5, budget: 'R$ 44 mi', color: '#4678e9', initiallyAvailable: true },
  { id: 'BAH', name: 'Bahia', code: 'BAH', city: 'Salvador, BA', stars: 3.5, budget: 'R$ 57 mi', color: '#2d87e5', initiallyAvailable: true },
];

export const defaultClub: ClubChoice = clubOptions[0];

export function clubByCode(
  identifier: string | null | undefined,
  clubs: readonly ClubChoice[] = clubOptions,
): ClubChoice {
  const normalized = identifier?.trim().toUpperCase();
  return clubs.find((club) => club.id === identifier?.trim())
    ?? clubs.find((club) => club.code.toUpperCase() === normalized)
    ?? clubs[0]
    ?? defaultClub;
}
