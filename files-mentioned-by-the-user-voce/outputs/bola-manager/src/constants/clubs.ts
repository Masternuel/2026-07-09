import type { ClubChoice, LeagueChoice } from '../types';

export interface ClubOption extends ClubChoice {
  initiallyAvailable: boolean;
}

export const demoLeagueOptions: LeagueChoice[] = [{
  id: 'BR-A',
  name: 'Brasileirão Série A',
  country: 'Brasil',
  division: 'Série A',
  level: 1,
  clubCount: 4,
}];

const demoLeague = demoLeagueOptions[0];

export const clubOptions: ClubOption[] = [
  { id: 'AUR', name: 'Aurora FC', code: 'AUR', city: 'São Paulo, SP', stars: 4, budget: 'R$ 72 mi', color: '#c8ff3d', stadium: 'Estádio Boreal', stadiumCapacity: 36_250, initiallyAvailable: true, leagueId: demoLeague.id, leagueName: demoLeague.name, division: demoLeague.division, country: demoLeague.country },
  { id: 'SAN', name: 'Santos', code: 'SAN', city: 'Santos, SP', stars: 3.5, budget: 'R$ 49 mi', color: '#e7e7e7', darkThemeColor: '#e7e7e7', lightThemeColor: '#171a17', stadium: 'Vila Belmiro', stadiumCapacity: 16_068, initiallyAvailable: true, leagueId: demoLeague.id, leagueName: demoLeague.name, division: demoLeague.division, country: demoLeague.country },
  { id: 'FOR', name: 'Fortaleza', code: 'FOR', city: 'Fortaleza, CE', stars: 3.5, budget: 'R$ 44 mi', color: '#4678e9', stadium: 'Castelão', stadiumCapacity: 63_903, initiallyAvailable: true, leagueId: demoLeague.id, leagueName: demoLeague.name, division: demoLeague.division, country: demoLeague.country },
  { id: 'BAH', name: 'Bahia', code: 'BAH', city: 'Salvador, BA', stars: 3.5, budget: 'R$ 57 mi', color: '#2d87e5', stadium: 'Arena Fonte Nova', stadiumCapacity: 48_747, initiallyAvailable: true, leagueId: demoLeague.id, leagueName: demoLeague.name, division: demoLeague.division, country: demoLeague.country },
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
