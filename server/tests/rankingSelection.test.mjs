import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRankingQuery, rankingQueryKey } from '../../shared/rankingQuery.mjs';
import { selectRankings } from '../services/rankingSelection.mjs';

function snapshot() {
  return {
    scope: { competitionId: 'L1', leagueIds: ['L1'] },
    players: [
      { id: 'p1', name: 'Álvaro', clubId: 'A', clubCode: 'ALF', nationality: 'BRA', position: 'ATA', age: 20, goals: 5, minutesPerGoal: 80, assists: 1, saves: null },
      { id: 'p2', name: 'Bruno', clubId: 'B', clubCode: 'BET', nationality: 'ARG', position: 'MEI', age: 28, goals: 5, minutesPerGoal: 100, assists: 4, saves: 8 },
      { id: 'p3', name: 'Carlos', clubId: 'A', nationality: 'BRA', position: 'GOL', age: null, goals: 0, saves: 0 },
    ],
    clubs: [
      { id: 'A', name: 'Alfa', points: 4, wins: 1, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, squadValue: 90, possessionPercent: 52, averageAttendance: null, recentForm: ['V', 'E'] },
      { id: 'B', name: 'Beta', points: 6, wins: 2, goalsFor: 4, goalsAgainst: 5, goalDifference: -1, squadValue: 50, possessionPercent: 60, averageAttendance: 500, recentForm: ['D', 'D'] },
    ],
    managers: [{ id: 'm1', name: 'José', managerType: 'human', clubId: 'A', clubName: 'Alfa', nationality: 'BRA', status: 'employed', points: 99, played: 40, rankingPoints: 300, titles: 4, recentForm: ['V'], currentStreak: 'V8',
      matchHistory: [
        ...Array.from({ length: 6 }, (_, index) => ({ fixtureId: `f${index}`, seasonNumber: 2, competitionId: 'L1', round: index + 1, goalsFor: index === 0 ? 8 : 1, goalsAgainst: 0 })),
        { fixtureId: 'cup', seasonNumber: 2, competitionId: 'CUP', round: 90, goalsFor: 9, goalsAgainst: 0 },
        { fixtureId: 'old', seasonNumber: 1, competitionId: 'L1', round: 95, goalsFor: 9, goalsAgainst: 0 },
      ],
      seasonStats: [
        { seasonNumber: 1, competitionId: 'L1', clubId: 'OLD', clubName: 'Antigo', played: 3, wins: 2, draws: 1, losses: 0, points: 7, goalsFor: 6, goalsAgainst: 3, titles: 1, rankingPoints: 20 },
        { seasonNumber: 1, competitionId: 'L1', clubId: 'A', clubName: 'Alfa', played: 2, wins: 1, draws: 0, losses: 1, points: 3, goalsFor: 2, goalsAgainst: 1, titles: 1, rankingPoints: 30 },
        { seasonNumber: 2, competitionId: 'L1', clubId: 'A', clubName: 'Alfa', played: 1, wins: 1, points: 3, titles: 0, rankingPoints: 5 },
        { seasonNumber: 1, competitionId: 'CUP', played: 9, points: 27, titles: 1, rankingPoints: 90 },
      ],
    }, { id: 'm2', name: 'Márcio', clubId: 'B', nationality: 'ARG', managerType: 'ai', status: 'dismissed', points: 4, played: 2 }],
  };
}

test('consulta canônica valida limites, colunas, enums e parâmetros desconhecidos', () => {
  assert.equal(rankingQueryKey({ search: '  José ' }), rankingQueryKey(parseRankingQuery({ search: 'José' })));
  for (const query of [{ managerPeriod: 'last-five' }, { playerColumn: '__proto__' }, { clubDirection: 'random' },
    { search: 'x'.repeat(121) }, { ageFilter: 'young' }, { season: '-1' }, { page: '1' }]) assert.throws(() => parseRankingQuery(query));
});

test('filtros combinados respeitam clube, idade, posição, nacionalidade e acentos', () => {
  const data = snapshot(); const before = structuredClone(data);
  assert.deepEqual(selectRankings(data, { search: 'alvaro', clubFilter: 'alf', nationalityFilter: 'bra', positionFilter: 'ata', ageFilter: 'u21' }, 2).playerIds, ['p1']);
  assert.deepEqual(selectRankings(data, { clubFilter: 'A', ageFilter: '31+' }, 2).playerIds, []);
  assert.deepEqual(selectRankings(data, { managerTypeFilter: 'ai', managerNationalityFilter: 'ARG', managerStatusFilter: 'dismissed' }, 2).managers.map((m) => m.id), ['m2']);
  assert.deepEqual(data, before, 'consulta não altera carreira ou arrays originais');
});

test('ordenação e desempates são estáveis; valores ausentes ficam por último nas duas direções', () => {
  assert.deepEqual(selectRankings(snapshot(), {}, 2).playerIds, ['p1', 'p2', 'p3']);
  assert.deepEqual(selectRankings(snapshot(), { playerColumn: 'assists', playerDirection: 'desc' }, 2).playerIds, ['p2', 'p1', 'p3']);
  for (const [direction, expected] of [['asc', ['p3', 'p2', 'p1']], ['desc', ['p2', 'p3', 'p1']]]) {
    assert.deepEqual(selectRankings(snapshot(), { playerColumn: 'saves', playerDirection: direction }, 2).playerIds, expected);
  }
  const data = snapshot(); data.players.reverse();
  assert.deepEqual(selectRankings(data, {}, 2).playerIds, selectRankings(snapshot(), {}, 2).playerIds);
});

test('clubes ordenam pelas métricas exibidas: posse, público, defesa e forma V/E/D', () => {
  for (const [column, direction, expected] of [
    ['possession', 'desc', ['B', 'A']], ['attendance', 'asc', ['B', 'A']],
    ['goalsAgainst', 'asc', ['A', 'B']], ['form', 'desc', ['A', 'B']],
  ]) assert.deepEqual(selectRankings(snapshot(), { clubColumn: column, clubDirection: direction }, 2).clubIds, expected);
});

test('últimos cinco jogos excluem outras temporadas e copas, deduplicam e não reutilizam score anual', () => {
  const data = snapshot(); data.managers[0].recentResults = data.managers[0].matchHistory.slice(1, 4);
  const [manager] = selectRankings(data, { managerPeriod: 'last5' }, 2).managers;
  assert.equal(manager.played, 5); assert.equal(manager.points, 15); assert.equal(manager.goalsFor, 5);
  assert.equal(manager.currentStreak, 'V5'); assert.equal(manager.position, 1);
  assert.equal(manager.rankingPoints, null); assert.equal(manager.titles, null);
  assert.deepEqual(manager.matchHistory.map((match) => match.fixtureId), ['f5', 'f4', 'f3', 'f2', 'f1']);
  data.managers[0].matchHistory = data.managers[0].matchHistory.slice(0, 2); data.managers[0].recentResults = [];
  assert.equal(selectRankings(data, { managerPeriod: 'last5' }, 2).managers[0].played, 2, 'janela aceita menos de cinco jogos existentes');
});

test('temporadas históricas e carreira somam passagens sem duplicar títulos e score acumulado', () => {
  const data = snapshot();
  const historical = selectRankings(data, { season: '1' }, 2);
  assert.deepEqual(historical.playerIds, []); assert.deepEqual(historical.clubIds, []);
  assert.equal(historical.managers[0].points, 10); assert.equal(historical.managers[0].played, 5);
  assert.equal(historical.managers[0].titles, 1); assert.equal(historical.managers[0].rankingPoints, 30);
  assert.equal(historical.managers[0].reputation, null); assert.equal(historical.managers[0].currentStreak, null);
  assert.equal(historical.managers[0].clubName, 'Antigo → Alfa');
  assert.equal(selectRankings(data, { season: '1', managerClubFilter: 'OLD' }, 2).managers.length, 1);
  const [career] = selectRankings(data, { managerPeriod: 'career' }, 2).managers;
  assert.equal(career.points, 13); assert.equal(career.rankingPoints, 35); assert.equal(career.titles, 1);
  assert.throws(() => selectRankings(data, { season: '3' }, 2), { code: 'RANKING_SEASON_INVALID' });
});

test('metadados e perfis continuam completos; resultados filtrados recebem posição sem duplicar', () => {
  const data = snapshot();
  const selected = selectRankings(data, { managerTypeFilter: 'ai', managerColumn: 'points', managerDirection: 'asc' }, 2);
  assert.equal(selected.managerScope.length, 2);
  assert.equal(selected.managers.length, 1); assert.equal(selected.managers[0].position, 1);
  assert.equal(data.managers.length, 2); assert.equal(data.managers[0].position, undefined);
});
