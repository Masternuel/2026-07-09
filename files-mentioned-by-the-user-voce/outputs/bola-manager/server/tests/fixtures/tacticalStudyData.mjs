import { FORMATION_ROLES } from '../../game/tactics.mjs';
import { REQUIRED_ATTRIBUTE_KEYS } from '../../game/lineupStrength.mjs';
const CODE = 'BOLA-STDY';
const NOW = '2026-07-10T00:00:00.000Z';
export function studyRoster(clubId = 'OPP') {
  return FORMATION_ROLES['4-4-2'].map((position, index) => ({
    id: clubId + '-' + index, clubId, name: clubId + ' Atleta ' + index, position,
    overall: 12, active: true, age: 25, nationality: 'BRA', shirtNumber: index + 1,
    attributes: Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((attribute) => [attribute, 12])),
  }));
}
export function studyRoom() {
  return { id: 'study-room', code: CODE, status: 'active', revision: 1, currentSeason: 1,
    createdAt: NOW, startedAt: NOW, ownerId: 'uid-owner', catalogOwnerId: 'database-owner',
    managerIds: ['uid-owner', 'uid-second'], managers: [{ id: 'uid-owner', clubId: 'VIEW' }, { id: 'uid-second', clubId: 'OTHER' }],
    competitionCatalog: [{ id: 'L', clubs: ['VIEW', 'OPP', 'OTHER'].map((id) => ({ id, name: 'Clube ' + id })) }],
    completedFixtureIds: [], fixtureSchedule: [
      { fixtureId: 'later', homeClubId: 'VIEW', awayClubId: 'OTHER', scheduledAt: '2026-07-20T12:00:00.000Z' },
      { fixtureId: 'next', homeClubId: 'VIEW', awayClubId: 'OPP', scheduledAt: '2026-07-12T12:00:00.000Z' },
    ],
    lineups: [{ clubId: 'OPP', lineupIds: studyRoster().map((player) => player.id), tactics: {
      formationId: '5-4-1', mentality: 'attacking', secret: true, marker: 'SECRET_NEVER_EXPOSE',
      teamInstructions: { pressing: 'aggressive', pressureLine: 'very-high', tempo: 'very-fast' },
    } }],
    clubCareerState: { currentDate: NOW,
      staffMembers: [{ id: 'scout', clubId: 'VIEW', name: 'Olheiro', role: 'scout', status: 'employed', attributes: { scouting: 20 } }],
      staffContracts: [{ id: 'scout-contract', staffId: 'scout', clubId: 'VIEW', status: 'active', startDate: '2026-01-01', endDate: '2028-12-31', wage: 1000 }],
    },
  };
}
