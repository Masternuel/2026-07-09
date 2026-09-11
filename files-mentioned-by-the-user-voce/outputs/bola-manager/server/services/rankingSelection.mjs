import { parseRankingQuery } from '../../shared/rankingQuery.mjs';

const key = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
const num = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const sum = (rows, field) => rows.reduce((total, row) => total + (num(row[field]) ?? 0), 0);
const formPoints = (form) => (form ?? []).reduce((total, value) => total + (value === 'V' ? 3 : value === 'E' ? 1 : 0), 0);
const compare = (a, b, direction = 'desc') => {
  if (a == null || b == null) return a == null ? b == null ? 0 : 1 : -1;
  const result = typeof a === 'number' && typeof b === 'number' ? a - b
    : String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
  return direction === 'asc' ? result : -result;
};
const identityOrder = (a, b) => compare(a.name, b.name, 'asc') || compare(a.id, b.id, 'asc');
const same = (a, b) => key(a) === key(b);
const matchesClub = (row, value) => !value || [row.clubId, row.clubCode, row.clubName].some((field) => same(field, value));
const search = (row, value) => !value || key([row.name, row.clubName, row.clubCode, row.code, row.leagueName, row.position, row.nationality].join(' ')).includes(key(value));

function metric(row, column, entity) {
  const aliases = { player: 'name', manager: 'name', type: 'managerType', performance: 'performancePercent', possession: 'possessionPercent', attendance: 'averageAttendance' };
  if (column === 'club') return entity === 'clubs' ? row.name : row.clubName;
  if (column === 'form') return formPoints(row.recentForm);
  if (column === 'rankChange') return row.positionChange ?? row.rankChange ?? null;
  const field = aliases[column] ?? column;
  if (entity === 'players' && row.statisticsAvailable === false && !['name', 'clubName', 'position', 'age', 'nationality', 'overall'].includes(field)) return null;
  return row[field] ?? null;
}

function playerTie(a, b, category) {
  if (category === 'goals') return compare(a.minutesPerGoal, b.minutesPerGoal, 'asc') || compare(a.penaltyGoals, b.penaltyGoals, 'asc') || compare(a.assists, b.assists) || compare(a.averageRating, b.averageRating);
  if (category === 'assists') return compare(a.goals, b.goals) || compare(a.averageRating, b.averageRating);
  if (category === 'contributions') return compare(a.contributionsPerGame, b.contributionsPerGame) || compare(a.averageRating, b.averageRating);
  if (category === 'appearances') return compare(a.starts, b.starts) || compare(a.minutes, b.minutes);
  if (category === 'saves') return compare(a.cleanSheets, b.cleanSheets);
  if (category === 'cleanSheets') return compare(a.saves, b.saves);
  return 0;
}

function ordered(rows, entity, column, direction, category) {
  return [...rows].sort((a, b) => compare(metric(a, column, entity), metric(b, column, entity), direction)
    || (entity === 'players' ? playerTie(a, b, category)
      : compare(a.points, b.points) || compare(a.wins, b.wins) || compare(a.goalDifference, b.goalDifference) || compare(a.goalsFor, b.goalsFor))
    || identityOrder(a, b));
}

function groupedSeasons(entries) {
  const groups = new Map();
  for (const entry of entries) {
    const id = `${entry.seasonNumber}:${key(entry.competitionId)}`;
    groups.set(id, [...(groups.get(id) ?? []), entry]);
  }
  return [...groups.values()].map((spells) => {
    const latest = spells.at(-1);
    return { ...latest,
      ...Object.fromEntries(['played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'points'].map((field) => [field, sum(spells, field)])),
      titles: Math.max(0, ...spells.map((spell) => num(spell.titles) ?? 0)),
      rankingPoints: [...spells].reverse().find((spell) => num(spell.rankingPoints) !== null)?.rankingPoints ?? null,
    };
  });
}

function campaign(rows) {
  const stats = Object.fromEntries(['played', 'wins', 'draws', 'losses', 'goalsFor', 'goalsAgainst', 'points'].map((field) => [field, sum(rows, field)]));
  return { ...stats, goalDifference: stats.goalsFor - stats.goalsAgainst,
    performancePercent: stats.played ? stats.points / (stats.played * 3) * 100 : 0 };
}

export function selectManagerPeriod(manager, query, competitionIds, currentSeason) {
  const scope = new Set(competitionIds.map(key));
  const inScope = (entry) => scope.has(key(entry.competitionId));
  const historical = query.season !== 'current';
  const season = historical ? Number(query.season) : currentSeason;
  if (!historical && query.managerPeriod === 'current') return manager;
  if (!historical && query.managerPeriod === 'last5') {
    const unique = new Map();
    for (const match of [...(manager.matchHistory ?? []), ...(manager.recentResults ?? [])]) {
      if (!inScope(match) || match.seasonNumber !== season || !Number.isFinite(match.goalsFor) || !Number.isFinite(match.goalsAgainst)) continue;
      const id = `${match.seasonNumber}:${match.competitionId}:${match.fixtureId ?? match.id}`;
      if (!unique.has(id)) unique.set(id, match);
    }
    const results = [...unique.values()].sort((a, b) => (Date.parse(b.completedAt ?? b.playedAt) || 0) - (Date.parse(a.completedAt ?? a.playedAt) || 0)
      || (b.round ?? 0) - (a.round ?? 0) || compare(a.fixtureId ?? a.id, b.fixtureId ?? b.id, 'asc')).slice(0, 5);
    if (!results.length) return null;
    const rows = results.map((match) => ({ played: 1, wins: Number(match.goalsFor > match.goalsAgainst),
      draws: Number(match.goalsFor === match.goalsAgainst), losses: Number(match.goalsFor < match.goalsAgainst),
      goalsFor: match.goalsFor, goalsAgainst: match.goalsAgainst, points: match.goalsFor > match.goalsAgainst ? 3 : match.goalsFor === match.goalsAgainst ? 1 : 0 }));
    const recentForm = [...results].reverse().map((match) => match.goalsFor > match.goalsAgainst ? 'V' : match.goalsFor === match.goalsAgainst ? 'E' : 'D');
    let streak = 0;
    for (const result of [...recentForm].reverse()) { if (result !== recentForm.at(-1)) break; streak += 1; }
    return { ...manager, ...campaign(rows), recentResults: results, matchHistory: results,
      recentForm, currentStreak: `${recentForm.at(-1)}${streak}`,
      titles: null, rankingPoints: null, rankingBreakdown: null, previousPosition: null, positionChange: null, rankChange: null };
  }
  const sourceEntries = (manager.seasonStats ?? []).filter((entry) => inScope(entry) && (!historical || entry.seasonNumber === season));
  const entries = groupedSeasons(sourceEntries);
  if (!entries.length) return null;
  const scores = entries.map((entry) => num(entry.rankingPoints)).filter((value) => value !== null);
  const clubs = [...new Set(sourceEntries.map((entry) => entry.clubName).filter(Boolean))];
  return { ...manager, ...campaign(entries),
    ...(historical ? { clubId: sourceEntries.at(-1).clubId ?? null, clubName: clubs.join(' → ') || null, clubCode: null,
      reputation: null, preferredFormation: null } : {}),
    titles: sum(entries, 'titles'), rankingPoints: scores.length ? scores.reduce((a, b) => a + b, 0) : null,
    rankingBreakdown: null, previousPosition: null, positionChange: null, rankChange: null,
    recentForm: [], currentStreak: null, recentResults: [], matchHistory: [],
  };
}

export function selectRankings(snapshot, input, currentSeason) {
  const query = parseRankingQuery(input);
  if (query.season !== 'current' && Number(query.season) > currentSeason) {
    throw Object.assign(new Error('Temporada ainda não iniciada.'), { status: 400, code: 'RANKING_SEASON_INVALID' });
  }
  const competitionIds = snapshot.scope.competitionId ? [snapshot.scope.competitionId] : snapshot.scope.leagueIds;
  const managerScope = snapshot.managers.flatMap((manager) => {
    const selected = selectManagerPeriod(manager, query, competitionIds, currentSeason);
    return selected ? [selected] : [];
  });
  const players = query.season !== 'current' ? [] : snapshot.players.filter((player) => {
    if (!search(player, query.search) || !matchesClub(player, query.clubFilter)) return false;
    if (query.nationalityFilter && !same(player.nationality, query.nationalityFilter)) return false;
    if (query.positionFilter && !same(player.position, query.positionFilter)) return false;
    if (query.ageFilter === 'all') return true;
    if (num(player.age) === null) return false;
    return query.ageFilter === 'u21' ? player.age <= 21 : query.ageFilter === '22-25' ? player.age >= 22 && player.age <= 25
      : query.ageFilter === '26-30' ? player.age >= 26 && player.age <= 30 : player.age >= 31;
  });
  const clubs = query.season !== 'current' ? [] : snapshot.clubs.filter((club) => search(club, query.search));
  const managers = managerScope.filter((manager) => search(manager, query.search) && (matchesClub(manager, query.managerClubFilter)
    || (query.season !== 'current' && (manager.seasonStats ?? []).some((entry) => entry.seasonNumber === Number(query.season)
      && competitionIds.some((id) => same(id, entry.competitionId)) && matchesClub(entry, query.managerClubFilter))))
    && (query.managerTypeFilter === 'all' || manager.managerType === query.managerTypeFilter)
    && (!query.managerNationalityFilter || same(manager.nationality, query.managerNationalityFilter))
    && (!query.managerStatusFilter || manager.status === query.managerStatusFilter));
  return { query, playerIds: ordered(players, 'players', query.playerColumn, query.playerDirection, query.playerCategory).map((row) => row.id),
    clubIds: ordered(clubs, 'clubs', query.clubColumn, query.clubDirection, query.clubCategory).map((row) => row.id),
    managerScope,
    managers: ordered(managers, 'managers', query.managerColumn, query.managerDirection, query.managerCategory)
      .map((manager, index) => ({ ...manager, position: index + 1 })),
  };
}
