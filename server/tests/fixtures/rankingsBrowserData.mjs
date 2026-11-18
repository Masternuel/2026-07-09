export const clubs = [
  { id: 'A', name: 'Alfa', code: 'ALF', color: '#77c99d', country: 'Brasil', leagueId: 'L1', leagueName: 'Liga Teste', division: 'Série A' },
  { id: 'B', name: 'Beta', code: 'BET', color: '#6c9ee8', country: 'Brasil', leagueId: 'L1', leagueName: 'Liga Teste', division: 'Série A' },
];
export const players = Array.from({ length: 26 }, (_, index) => ({ id: 'p' + index, clubId: index < 13 ? 'A' : 'B',
  name: `Atleta ${String(index + 1).padStart(2, '0')}`, position: index % 2 ? 'MEI' : 'ATA', shirtNumber: index + 1,
  age: 20 + index % 15, nationality: index % 2 ? 'ARG' : 'BRA', overall: 12, potential: 15,
  marketValue: 1000000 + index * 10000, wage: 20000, condition: 100, morale: 'Boa', attributes: {},
}));
export const room = { code: 'BOLA-RANK', ownerId: 'owner', catalogOwnerId: 'owner', currentSeason: 2, seasonYear: 2027, revision: 1,
  managers: [{ id: 'owner', name: 'Treinador Alfa', clubId: 'A' }, { id: 'guest', name: 'Treinador Beta', clubId: 'B' }],
  competitionCatalog: [{ id: 'L1', name: 'Liga Teste', country: 'Brasil', division: 'Série A', active: true, clubs }],
  leagueFixtureSchedule: Array.from({ length: 8 }, (_, index) => ({ leagueFixtureId: 'f' + index, leagueId: 'L1', round: index + 1,
    homeClubId: 'A', awayClubId: 'B', scheduledAt: `2027-08-${String(index + 1).padStart(2, '0')}T20:00:00.000Z` })),
  leagueMatchResults: Array.from({ length: 6 }, (_, index) => ({ leagueFixtureId: 'f' + index,
    score: index === 0 ? [4, 0] : [0, 1], possession: [45, 55], completedAt: `2027-08-0${index + 1}T22:00:00.000Z` })),
  playerStates: players.map((player, index) => ({ playerId: player.id, clubId: player.clubId, condition: 100,
    seasonStats: { seasonNumber: 2, appearances: 6, goals: index % 3, assists: index % 4, minutes: 540, starts: 6 } })),
  seasonHistory: [],
};
