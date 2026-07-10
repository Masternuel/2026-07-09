import type { ClubChoice } from '../types';

export interface ClubOption extends ClubChoice {
  initiallyAvailable: boolean;
}

export const clubOptions: ClubOption[] = [
  { name: 'Aurora FC', code: 'AUR', city: 'São Paulo, SP', stars: 4, budget: 'R$ 72 mi', color: '#c8ff3d', initiallyAvailable: true },
  { name: 'Santos', code: 'SAN', city: 'Santos, SP', stars: 3.5, budget: 'R$ 49 mi', color: '#e7e7e7', initiallyAvailable: true },
  { name: 'Fortaleza', code: 'FOR', city: 'Fortaleza, CE', stars: 3.5, budget: 'R$ 44 mi', color: '#4678e9', initiallyAvailable: true },
  { name: 'Bahia', code: 'BAH', city: 'Salvador, BA', stars: 3.5, budget: 'R$ 57 mi', color: '#2d87e5', initiallyAvailable: true },
];

export const defaultClub: ClubChoice = clubOptions[0];

export function clubByCode(code: string | null | undefined): ClubChoice {
  return clubOptions.find((club) => club.code === code) ?? defaultClub;
}
