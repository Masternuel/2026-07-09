import type { ClubChoice, LeagueTeam, Player, Room, RoomClubSnapshot, RoomLeagueSnapshot, RoomManager } from '../types';
import { buildSeasonTable, findRoomLeagueForClub } from './leagueStandings';
import { playerPositionRating } from './playerRating';

export type RankingFormResult = 'W' | 'D' | 'L';
export type PlayerRankingCategory = 'goals' | 'assists' | 'contributions' | 'rating' | 'minutes' | 'appearances' | 'keyPasses' | 'tackles' | 'saves' | 'cleanSheets' | 'cards';
export type ClubRankingCategory = 'points' | 'squadValue' | 'averagePlayerValue' | 'payroll' | 'reputation' | 'form' | 'possession' | 'attendance';
export type ManagerRankingCategory = 'points' | 'wins' | 'performance' | 'rankingPoints' | 'titles' | 'reputation';
export type RankingManagerType = 'human' | 'ai';
export type RankingManagerStatus = 'employed' | 'unemployed' | 'dismissed';
export type RankingManagerPeriod = 'current' | 'last5' | 'career';

export const playerRankingCategories: ReadonlyArray<{ id: PlayerRankingCategory; label: string }> = [
  { id: 'goals', label: 'Gols' },
  { id: 'assists', label: 'Assistências' },
  { id: 'contributions', label: 'Participações em gols' },
  { id: 'rating', label: 'Nota média' },
  { id: 'minutes', label: 'Minutos' },
  { id: 'appearances', label: 'Jogos' },
  { id: 'keyPasses', label: 'Passes decisivos' },
  { id: 'tackles', label: 'Desarmes' },
  { id: 'saves', label: 'Defesas' },
  { id: 'cleanSheets', label: 'Jogos sem sofrer gols' },
  { id: 'cards', label: 'Cartões' },
];

export interface RankingPlayer {
  id: string;
  name: string;
  clubId: string;
  clubName: string;
  clubCode: string;
  clubCrestImageUrl: string | null;
  shirtNumber: number | null;
  position: string;
  age: number | null;
  nationality: string | null;
  isStar: boolean;
  avatarImageUrl: string | null;
  statisticsAvailable: boolean;
  statisticsComplete: boolean;
  statisticsScope: 'competition' | 'season-legacy' | 'local-season' | 'unavailable';
  goals: number;
  penaltyGoals: number | null;
  nonPenaltyGoals: number | null;
  ownGoals: number | null;
  assists: number;
  goalContributions: number;
  appearances: number;
  starts: number;
  minutes: number;
  yellowCards: number;
  redCards: number;
  keyPasses: number | null;
  bigChancesCreated: number | null;
  tackles: number | null;
  saves: number | null;
  cleanSheets: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  overall: number | null;
  rating: number;
  averageRating: number | null;
  minutesPerGoal: number | null;
  minutesPerAssist: number | null;
  minutesPerContribution: number | null;
  contributionsPerGame: number | null;
  clubGoalParticipationPercent: number | null;
  marketValue: number | null;
  wage: number | null;
  condition: number | null;
  morale: string | null;
  potential: number | null;
  status: string | null;
  negotiability: string | null;
  loanAvailable: boolean | null;
  attributes: Partial<Player['attributes']> | null;
  contract: {
    startSeason: number | null;
    endSeason: number | null;
    wage: number | null;
    status: string | null;
  } | null;
  injuries: number;
  goalsConceded: number | null;
  rank: number | null;
  previousRank: number | null;
  rankChange: number | null;
}

export interface RankingClub {
  id: string;
  name: string;
  code: string;
  color: string;
  darkThemeColor: string | null;
  lightThemeColor: string | null;
  crestImageUrl: string | null;
  leagueId: string | null;
  leagueName: string | null;
  country: string | null;
  division: string | null;
  position: number | null;
  previousPosition: number | null;
  positionChange: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  recentForm: RankingFormResult[];
  squadValue: number;
  averagePlayerValue: number | null;
  payroll: number | null;
  playerCount: number;
  reputation: number | null;
  possessionPercent: number | null;
  averageAttendance: number | null;
  valueChange: number | null;
  rankChange: number | null;
}

export interface RankingManager {
  id: string;
  name: string;
  avatarImageUrl: string | null;
  clubId: string | null;
  clubName: string | null;
  clubCode: string | null;
  clubColor: string | null;
  clubDarkThemeColor: string | null;
  clubLightThemeColor: string | null;
  clubCrestImageUrl: string | null;
  isOwner: boolean;
  isViewer: boolean;
  managerType: RankingManagerType;
  isHuman: boolean;
  isAI: boolean;
  nationality: string | null;
  status: RankingManagerStatus | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  performancePercent: number;
  recentForm: RankingFormResult[];
  preferredFormation: string | null;
  reputation: number | null;
  rankingPoints: number | null;
  titles: number | null;
  currentStreak: string | null;
  rankChange: number | null;
  position: number;
  previousPosition: number | null;
  positionChange: number | null;
  style: string | null;
  recentResults: RankingManagerRecentResult[];
  matchHistory: RankingManagerRecentResult[];
  rankingTrajectory: RankingManagerTrajectoryEntry[];
  careerHistory: RankingManagerCareerEntry[];
  seasonStats: RankingManagerSeasonEntry[];
  trophyHistory: RankingManagerAchievement[];
  awards: RankingManagerAchievement[];
}

export interface RankingManagerRecentResult {
  id: string;
  managerId: string | null;
  opponentManagerId: string | null;
  clubId: string | null;
  opponentId: string | null;
  opponentName: string | null;
  competitionId: string | null;
  competitionName: string | null;
  seasonNumber: number | null;
  round: number | null;
  venue: string | null;
  playedAt: string | null;
  result: RankingFormResult | null;
  goalsFor: number;
  goalsAgainst: number;
}

export interface RankingManagerTrajectoryEntry {
  id: string;
  seasonNumber: number | null;
  seasonYear: number | null;
  competitionId: string | null;
  competitionName: string | null;
  round: number | null;
  position: number | null;
  previousPosition: number | null;
  positionChange: number | null;
  rankingPoints: number | null;
}

export interface RankingManagerCareerEntry {
  id: string;
  seasonNumber: number | null;
  seasonYear: number | null;
  clubId: string | null;
  clubName: string | null;
  status: RankingManagerStatus | null;
  role?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  entryReason?: string | null;
  exitReason?: string | null;
  country?: string | null;
  division?: string | null;
  durationDays?: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor?: number;
  goalsAgainst?: number;
  points: number;
  pointsPerGame?: number | null;
  winRate?: number | null;
  longestWinningStreak?: number | null;
  longestWinlessStreak?: number | null;
  titles: number;
  promotions?: number;
  relegations?: number;
  reputationStart?: number | null;
  reputationEnd?: number | null;
}

export interface RankingManagerSeasonEntry extends RankingManagerCareerEntry {
  competitionId: string | null;
  competitionName: string | null;
  position: number | null;
  goalsFor: number;
  goalsAgainst: number;
  performancePercent: number;
  rankingPoints: number | null;
}

export interface RankingManagerAchievement {
  id: string;
  label: string;
  seasonNumber: number | null;
  seasonYear: number | null;
  competitionId: string | null;
  competitionName: string | null;
  awardedAt: string | null;
}

export interface RankingsScope {
  leagueIds: string[];
  leagueId: string | null;
  leagueName: string | null;
  competitionId: string | null;
  competitionName: string | null;
  seasonNumber: number | null;
  seasonYear: number | null;
  round: number | null;
  type: string | null;
}

export interface RankingOption {
  id: string;
  label: string;
  count: number | null;
}

export interface RankingsOptions {
  competitions: RankingOption[];
  seasons: RankingOption[];
  rounds: RankingOption[];
  clubs: RankingOption[];
  nationalities: RankingOption[];
  positions: RankingOption[];
  managerTypes: RankingOption[];
  managerClubs: RankingOption[];
  managerNationalities: RankingOption[];
  managerStatuses: RankingOption[];
  managerPeriods: RankingOption[];
}

export interface RankingsMeta {
  generatedAt: string | null;
  updatedAt: string | null;
  updatedRound: number | null;
  currentRound: number | null;
  completedRounds: number | null;
  totalRounds: number | null;
  seasonState: string | null;
  source: string | null;
  stale: boolean;
  playerStatsScope: 'competition' | 'season-legacy' | 'local-season' | 'unavailable';
  playerStatsComplete: boolean;
  playerStatsTrackedMatches: number;
  playerStatsUntrackedMatches: number;
  playerMetricCoverage: {
    shots: boolean;
    shotsOnTarget: boolean;
    saves: boolean;
    goalsConceded: boolean;
    cleanSheets: boolean;
  };
}

export interface RankingHistoryEntry {
  id: string;
  type: string | null;
  label: string | null;
  seasonNumber: number | null;
  round: number | null;
  competitionId: string | null;
  playerId: string | null;
  clubId: string | null;
  managerId: string | null;
  position: number | null;
  value: number | null;
  createdAt: string | null;
  seasonYear: number | null;
  completedFixtureCount: number | null;
  matchCount: number | null;
}

export interface RankingTimelineEntry {
  id: string;
  type: 'club' | 'manager';
  seasonNumber: number;
  seasonYear: number | null;
  competitionId: string;
  competitionName: string;
  round: number;
  entityId: string;
  clubId: string | null;
  clubCode: string | null;
  managerId: string | null;
  label: string;
  position: number;
  previousPosition: number | null;
  positionChange: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  rankingPoints: number | null;
}

export interface RankingsSnapshot {
  scope: RankingsScope;
  options: RankingsOptions;
  meta: RankingsMeta;
  history: RankingHistoryEntry[];
  timeline: RankingTimelineEntry[];
  players: RankingPlayer[];
  clubs: RankingClub[];
  managers: RankingManager[];
}

export interface PlayerRankingFilters {
  search?: string;
  clubId?: string | null;
  nationality?: string | null;
  position?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
  u21?: boolean;
  under21?: boolean;
}

export interface LocalClubStanding extends LeagueTeam {
  id: string;
}

function key(value: unknown) {
  return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}

function safeCount(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function safeRating(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function nullableMetric(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function ratio(numerator: number, denominator: number, multiplier = 1) {
  return numerator > 0 && denominator > 0 ? (denominator / numerator) * multiplier : null;
}

function rankPlayers(players: RankingPlayer[]) {
  return players.map((player, index) => ({ ...player, rank: index + 1 }));
}

function metricDescending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return right - left;
}

function metricAscending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function playerRating(player: RankingPlayer) {
  return player.averageRating ?? player.rating;
}

function compareAverageRating(left: RankingPlayer, right: RankingPlayer) {
  return metricDescending(left.averageRating, right.averageRating);
}

function compareGoals(left: RankingPlayer, right: RankingPlayer) {
  return right.goals - left.goals
    || metricAscending(left.minutesPerGoal, right.minutesPerGoal)
    || metricAscending(left.penaltyGoals, right.penaltyGoals)
    || right.assists - left.assists
    || compareAverageRating(left, right)
    || right.appearances - left.appearances
    || left.name.localeCompare(right.name, 'pt-BR');
}

export function rankingHasProduction(players: Array<Pick<RankingPlayer, 'goals' | 'assists' | 'appearances'>>) {
  return players.some((player) => (
    (!('statisticsAvailable' in player) || player.statisticsAvailable !== false)
      && (player.goals > 0 || player.assists > 0 || player.appearances > 0)
  ));
}

export function sortRankingPlayersByCategory(players: RankingPlayer[], category: PlayerRankingCategory = 'goals') {
  if (category === 'goals' && !rankingHasProduction(players)) {
    return rankPlayers([...players].sort((left, right) => playerRating(right) - playerRating(left)
      || left.name.localeCompare(right.name, 'pt-BR')));
  }
  const sorted = [...players].sort((left, right) => {
    if (left.statisticsAvailable !== right.statisticsAvailable) {
      return left.statisticsAvailable ? -1 : 1;
    }
    if (category === 'goals') return compareGoals(left, right);
    if (category === 'assists') return right.assists - left.assists || right.goals - left.goals || compareAverageRating(left, right) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'contributions') return right.goalContributions - left.goalContributions || metricDescending(left.contributionsPerGame, right.contributionsPerGame) || compareAverageRating(left, right) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'rating') {
      const hasMatchRatings = players.some((player) => player.averageRating !== null);
      return hasMatchRatings
        ? compareAverageRating(left, right) || right.appearances - left.appearances || left.name.localeCompare(right.name, 'pt-BR')
        : playerRating(right) - playerRating(left) || right.appearances - left.appearances || left.name.localeCompare(right.name, 'pt-BR');
    }
    if (category === 'minutes') return right.minutes - left.minutes || right.appearances - left.appearances || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'appearances') return right.appearances - left.appearances || right.starts - left.starts || right.minutes - left.minutes || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'keyPasses') return metricDescending(left.keyPasses, right.keyPasses) || right.assists - left.assists || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'tackles') return metricDescending(left.tackles, right.tackles) || compareAverageRating(left, right) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'saves') return metricDescending(left.saves, right.saves) || metricDescending(left.cleanSheets, right.cleanSheets) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'cleanSheets') return metricDescending(left.cleanSheets, right.cleanSheets) || metricDescending(left.saves, right.saves) || left.name.localeCompare(right.name, 'pt-BR');
    return right.redCards - left.redCards || right.yellowCards - left.yellowCards || left.name.localeCompare(right.name, 'pt-BR');
  });
  return rankPlayers(sorted);
}

export function sortRankingPlayers(players: RankingPlayer[]) {
  return sortRankingPlayersByCategory(players, 'goals');
}

export function filterRankingPlayers(players: RankingPlayer[], filters: PlayerRankingFilters = {}) {
  const query = key(filters.search);
  const clubId = key(filters.clubId);
  const nationality = key(filters.nationality);
  const position = key(filters.position);
  const minAge = filters.ageMin ?? null;
  const maxAge = (filters.u21 || filters.under21) ? Math.min(filters.ageMax ?? 21, 21) : filters.ageMax ?? null;
  return players.filter((player) => {
    const haystack = key([player.name, player.clubName, player.clubCode, player.position, player.nationality].join(' '));
    if (query && !haystack.includes(query)) return false;
    if (clubId && ![key(player.clubId), key(player.clubCode), key(player.clubName)].includes(clubId)) return false;
    if (nationality && key(player.nationality) !== nationality) return false;
    if (position && key(player.position) !== position) return false;
    if (minAge !== null && (player.age === null || player.age < minAge)) return false;
    if (maxAge !== null && (player.age === null || player.age > maxAge)) return false;
    return true;
  });
}

export const applyPlayerRankingFilters = filterRankingPlayers;

export function sortRankingClubs(clubs: RankingClub[], category: ClubRankingCategory = 'points') {
  return [...clubs].sort((left, right) => {
    if (category === 'squadValue') return right.squadValue - left.squadValue || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'averagePlayerValue') return metricDescending(left.averagePlayerValue, right.averagePlayerValue) || right.squadValue - left.squadValue || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'payroll') return metricDescending(left.payroll, right.payroll) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'reputation') return metricDescending(left.reputation, right.reputation) || right.squadValue - left.squadValue || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'possession') return metricDescending(left.possessionPercent, right.possessionPercent) || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'attendance') return metricDescending(left.averageAttendance, right.averageAttendance) || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'form') {
      const formPoints = (club: RankingClub) => club.recentForm.reduce((total, result) => total + (result === 'W' ? 3 : result === 'D' ? 1 : 0), 0);
      return formPoints(right) - formPoints(left) || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    }
    return right.points - left.points || right.wins - left.wins || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor || left.name.localeCompare(right.name, 'pt-BR');
  }).map((club, index) => ({ ...club, position: index + 1 }));
}

export function localPlayerRanking(players: Player[], club: ClubChoice): RankingPlayer[] {
  return sortRankingPlayers(players.map((player) => {
    const statisticsAvailable = Boolean(player.seasonStats);
    const goals = safeCount(player.seasonStats?.goals);
    const assists = safeCount(player.seasonStats?.assists);
    const appearances = safeCount(player.seasonStats?.appearances);
    const minutes = safeCount(player.seasonStats?.minutes);
    const rating = safeRating(playerPositionRating(player));
    const ratedMatches = safeCount(player.seasonStats?.ratedMatches);
    const ratingTotal = Number(player.seasonStats?.ratingTotal);
    const averageRating = ratedMatches > 0 && Number.isFinite(ratingTotal)
      ? Number((ratingTotal / ratedMatches).toFixed(2))
      : null;
    return {
      id: player.id,
      name: player.name,
      clubId: player.clubId ?? club.id,
      clubName: club.name,
      clubCode: club.code,
      clubCrestImageUrl: club.crestImageUrl ?? null,
      shirtNumber: player.catalogUnknownFields?.includes('shirtNumber') ? null : safeCount(player.number),
      position: player.position,
      age: safeCount(player.age),
      nationality: player.nationality || null,
      isStar: player.isStar,
      avatarImageUrl: player.avatarImageUrl ?? null,
      statisticsAvailable,
      statisticsComplete: statisticsAvailable,
      statisticsScope: statisticsAvailable ? 'local-season' : 'unavailable',
      goals,
      penaltyGoals: null,
      nonPenaltyGoals: null,
      ownGoals: null,
      assists,
      goalContributions: goals + assists,
      appearances,
      starts: safeCount(player.seasonStats?.starts),
      minutes,
      yellowCards: safeCount(player.seasonStats?.yellowCards),
      redCards: safeCount(player.seasonStats?.redCards),
      keyPasses: null,
      bigChancesCreated: null,
      tackles: null,
      saves: null,
      cleanSheets: null,
      shots: null,
      shotsOnTarget: null,
      overall: Number.isFinite(player.overall) ? Number(player.overall) : null,
      rating,
      averageRating,
      minutesPerGoal: ratio(goals, minutes),
      minutesPerAssist: ratio(assists, minutes),
      minutesPerContribution: ratio(goals + assists, minutes),
      contributionsPerGame: appearances > 0 ? (goals + assists) / appearances : null,
      clubGoalParticipationPercent: null,
      marketValue: nullableMetric(player.value),
      wage: nullableMetric(player.wage),
      condition: nullableMetric(player.condition),
      morale: player.morale || null,
      potential: nullableMetric(player.potential),
      status: player.status ?? null,
      negotiability: null,
      loanAvailable: null,
      attributes: player.attributes ?? null,
      contract: player.contract ? {
        startSeason: player.contract.startSeason ?? null,
        endSeason: player.contract.endSeason ?? null,
        wage: player.contract.wage ?? null,
        status: player.contract.status ?? null,
      } : null,
      injuries: safeCount(player.seasonStats?.injuries),
      goalsConceded: null,
      rank: null,
      previousRank: null,
      rankChange: null,
    };
  }));
}

export function rankingPlayersForClub(players: RankingPlayer[], club: Pick<ClubChoice, 'id' | 'code'>) {
  const clubKeys = new Set([club.id, club.code].map(key).filter(Boolean));
  return sortRankingPlayers(players.filter((player) => clubKeys.has(key(player.clubId)) || clubKeys.has(key(player.clubCode))));
}

export function localClubStandings(room: Room | null, club: ClubChoice): {
  league: RoomLeagueSnapshot | null;
  standings: LocalClubStanding[];
} {
  const league = findRoomLeagueForClub(room, club);
  const standings = room
    ? buildSeasonTable(room, league?.id ?? club.leagueId).map((team) => ({ ...team, id: team.clubId ?? team.code }))
    : [];
  return { league, standings };
}

export function localClubRanking(room: Room | null, club: ClubChoice, players: Player[] = []): RankingClub[] {
  const { league, standings } = localClubStandings(room, club);
  return sortRankingClubs(standings.map((standing) => {
    const catalog = league?.clubs.find((candidate) => key(candidate.id) === key(standing.id) || key(candidate.code) === key(standing.code));
    const clubPlayers = players.filter((player) => key(player.clubId) === key(standing.id) || key(player.clubId) === key(standing.code));
    const squadValue = clubPlayers.reduce((total, player) => total + Math.max(0, player.value ?? 0), 0);
    const form = Array.isArray(standing.form) ? standing.form : [];
    return {
      id: standing.id,
      name: standing.name,
      code: standing.code,
      color: catalog?.color ?? standing.accent ?? '#777777',
      darkThemeColor: catalog?.darkThemeColor ?? null,
      lightThemeColor: catalog?.lightThemeColor ?? null,
      crestImageUrl: catalog?.crestImageUrl ?? standing.crestImageUrl ?? null,
      leagueId: league?.id ?? club.leagueId ?? null,
      leagueName: league?.name ?? null,
      country: league?.country ?? null,
      division: league?.division ?? null,
      position: null,
      previousPosition: null,
      positionChange: null,
      played: safeCount(standing.played),
      wins: safeCount(standing.wins),
      draws: safeCount(standing.draws),
      losses: safeCount(standing.losses),
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: Number.isFinite(standing.goalDifference) ? Number(standing.goalDifference) : 0,
      points: safeCount(standing.points),
      recentForm: form.map((result) => String(result).toUpperCase()).flatMap((result) => result === 'V' || result === 'W' ? ['W' as const] : result === 'E' ? ['D' as const] : result === 'D' || result === 'L' ? ['L' as const] : []),
      squadValue,
      averagePlayerValue: clubPlayers.length ? squadValue / clubPlayers.length : null,
      payroll: clubPlayers.length ? clubPlayers.reduce((total, player) => total + Math.max(0, player.wage ?? 0), 0) : null,
      playerCount: clubPlayers.length,
      reputation: nullableMetric(catalog?.reputation),
      possessionPercent: null,
      averageAttendance: null,
      valueChange: null,
      rankChange: null,
    };
  }));
}

function findCatalogClub(room: Room, clubId: string | null): { club: RoomClubSnapshot; league: RoomLeagueSnapshot } | null {
  const wanted = key(clubId);
  if (!wanted) return null;
  for (const league of room.competitionCatalog ?? []) {
    const club = league.clubs.find((candidate) => key(candidate.id) === wanted || key(candidate.code) === wanted);
    if (club) return { club, league };
  }
  return null;
}

function localManagerCampaign(room: Room, manager: RoomManager, viewerId?: string | null): RankingManager {
  const catalog = findCatalogClub(room, manager.clubId);
  const standing = catalog
    ? buildSeasonTable(room, catalog.league.id).find((team) => key(team.clubId) === key(catalog.club.id) || key(team.code) === key(catalog.club.code))
    : null;
  const played = safeCount(standing?.played);
  const wins = safeCount(standing?.wins);
  const draws = safeCount(standing?.draws);
  const points = safeCount(standing?.points);
  return {
    id: manager.id,
    name: manager.name,
    avatarImageUrl: null,
    clubId: catalog?.club.id ?? manager.clubId,
    clubName: catalog?.club.name ?? null,
    clubCode: catalog?.club.code ?? null,
    clubColor: catalog?.club.color ?? null,
    clubDarkThemeColor: catalog?.club.darkThemeColor ?? null,
    clubLightThemeColor: catalog?.club.lightThemeColor ?? null,
    clubCrestImageUrl: catalog?.club.crestImageUrl ?? null,
    isOwner: manager.id === room.ownerId,
    isViewer: Boolean(viewerId && manager.id === viewerId),
    managerType: 'human',
    isHuman: true,
    isAI: false,
    nationality: null,
    status: 'employed',
    played,
    wins,
    draws,
    losses: safeCount(standing?.losses),
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: Number.isFinite(standing?.goalDifference) ? Number(standing?.goalDifference) : 0,
    points,
    performancePercent: played > 0 ? (points / (played * 3)) * 100 : 0,
    recentForm: [],
    preferredFormation: null,
    reputation: null,
    rankingPoints: null,
    titles: null,
    currentStreak: null,
    rankChange: null,
    position: 0,
    previousPosition: null,
    positionChange: null,
    style: null,
    recentResults: [],
    matchHistory: [],
    rankingTrajectory: [],
    careerHistory: [],
    seasonStats: [],
    trophyHistory: [],
    awards: [],
  };
}

export function sortRankingManagers(managers: RankingManager[], category: ManagerRankingCategory = 'points') {
  return [...managers].sort((left, right) => {
    if (category === 'wins') return right.wins - left.wins || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'performance') return right.performancePercent - left.performancePercent || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'rankingPoints') return metricDescending(left.rankingPoints, right.rankingPoints) || right.points - left.points || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'titles') return metricDescending(left.titles, right.titles) || metricDescending(left.rankingPoints, right.rankingPoints) || left.name.localeCompare(right.name, 'pt-BR');
    if (category === 'reputation') return metricDescending(left.reputation, right.reputation) || metricDescending(left.rankingPoints, right.rankingPoints) || left.name.localeCompare(right.name, 'pt-BR');
    return right.points - left.points || right.wins - left.wins || right.goalDifference - left.goalDifference || right.goalsFor - left.goalsFor || left.name.localeCompare(right.name, 'pt-BR');
  }).map((manager, index) => ({
    ...manager,
    // Sorting/filtering changes the table order, not the official ranking
    // calculated by the server. Local fallback rows start at zero and still
    // receive a deterministic position here.
    position: Number.isInteger(manager.position) && manager.position > 0
      ? manager.position
      : index + 1,
  }));
}

/**
 * Collapses separate coaching spells from the same season and competition.
 * Campaign totals are additive, while ranking score and position use the last
 * preserved spell because both values already represent a snapshot.
 */
export function aggregateRankingManagerSeasonStats(entries: RankingManagerSeasonEntry[]) {
  const groups = new Map<string, RankingManagerSeasonEntry[]>();
  entries.forEach((entry, index) => {
    const seasonKey = entry.seasonNumber ?? entry.seasonYear ?? `unknown-${index}`;
    const competitionKey = key(entry.competitionId ?? entry.competitionName) || `unknown-${index}`;
    const groupKey = `${seasonKey}\u0000${competitionKey}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), entry]);
  });

  return [...groups.values()].map((spells) => {
    const latest = spells.at(-1)!;
    const played = spells.reduce((total, entry) => total + entry.played, 0);
    const wins = spells.reduce((total, entry) => total + entry.wins, 0);
    const draws = spells.reduce((total, entry) => total + entry.draws, 0);
    const losses = spells.reduce((total, entry) => total + entry.losses, 0);
    const goalsFor = spells.reduce((total, entry) => total + entry.goalsFor, 0);
    const goalsAgainst = spells.reduce((total, entry) => total + entry.goalsAgainst, 0);
    const points = spells.reduce((total, entry) => total + entry.points, 0);
    const clubNames = [...new Set(spells.map((entry) => entry.clubName).filter((value): value is string => Boolean(value)))];
    const rankingPoints = [...spells].reverse().find((entry) => entry.rankingPoints !== null)?.rankingPoints ?? null;
    const position = [...spells].reverse().find((entry) => entry.position !== null)?.position ?? null;

    return {
      ...latest,
      id: spells.map((entry) => entry.id).join(':'),
      clubName: clubNames.length ? clubNames.join(' → ') : latest.clubName,
      played,
      wins,
      draws,
      losses,
      goalsFor,
      goalsAgainst,
      points,
      performancePercent: played > 0 ? points / (played * 3) * 100 : 0,
      titles: Math.max(0, ...spells.map((entry) => entry.titles)),
      rankingPoints,
      position,
    } satisfies RankingManagerSeasonEntry;
  }).sort((left, right) => (
    (right.seasonNumber ?? -1) - (left.seasonNumber ?? -1)
    || (right.seasonYear ?? -1) - (left.seasonYear ?? -1)
    || (left.competitionName ?? '').localeCompare(right.competitionName ?? '', 'pt-BR')
  ));
}

export function localManagerRanking(room: Room | null, viewerId?: string | null): RankingManager[] {
  if (!room) return [];
  type LocalCoachRecord = {
    id?: unknown;
    name?: unknown;
    managerType?: unknown;
    nationality?: unknown;
    avatarImageUrl?: unknown;
    preferredFormation?: unknown;
    style?: unknown;
    reputation?: unknown;
    status?: unknown;
    currentClubId?: unknown;
    assignments?: unknown;
  };
  const careerState = (room as Room & { coachCareerState?: { coaches?: LocalCoachRecord[] } }).coachCareerState;
  const persisted = Array.isArray(careerState?.coaches) ? careerState.coaches : [];
  const localCareer = (coach: LocalCoachRecord | undefined): RankingManagerCareerEntry[] => (Array.isArray(coach?.assignments) ? coach.assignments : []).flatMap((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const assignment = value as Record<string, unknown>;
    const clubId = typeof assignment.clubId === 'string' ? assignment.clubId : null;
    if (!clubId) return [];
    const catalog = (room.competitionCatalog ?? []).flatMap((league) => league.clubs).find((candidate) => key(candidate.id) === key(clubId) || key(candidate.code) === key(clubId));
    return [{
      id: `${String(coach?.id ?? 'coach')}:assignment:${index}`,
      seasonNumber: nullableMetric(assignment.startedSeason),
      seasonYear: null,
      clubId,
      clubName: catalog?.name ?? null,
      status: null,
      startedAt: typeof assignment.startedAt === 'string' ? assignment.startedAt : null,
      endedAt: typeof assignment.endedAt === 'string' ? assignment.endedAt : null,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      titles: 0,
    }];
  });
  const humans = (room.managers ?? []).slice(0, Math.max(0, room.maxManagers));
  const humanIds = new Set(humans.map((manager) => key(manager.id)));
  const claimedClubIds = new Set(humans.map((manager) => key(manager.clubId)).filter(Boolean));
  const byPersistedId = new Map(persisted.map((coach) => [key(coach.id), coach]));
  const humanRankings = humans.map((manager) => {
    const base = localManagerCampaign(room, manager, viewerId);
    const coach = byPersistedId.get(key(manager.id));
    return {
      ...base,
      avatarImageUrl: typeof coach?.avatarImageUrl === 'string' ? coach.avatarImageUrl : base.avatarImageUrl,
      nationality: typeof coach?.nationality === 'string' ? coach.nationality : null,
      preferredFormation: typeof coach?.preferredFormation === 'string' ? coach.preferredFormation : null,
      style: typeof coach?.style === 'string' ? coach.style : null,
      reputation: nullableMetric(coach?.reputation),
      status: (coach?.status === 'dismissed' || coach?.status === 'unemployed' ? coach.status : manager.clubId ? 'employed' : 'unemployed') as RankingManagerStatus,
      careerHistory: localCareer(coach),
    };
  });
  const catalogClubs = (room.competitionCatalog ?? []).flatMap((league) => league.clubs);
  const seenCatalogClubIds = new Set<string>();
  const seenCatalogClubCodesWithoutId = new Set<string>();
  const allCatalogClubs = catalogClubs.filter((candidate) => {
    const clubId = key(candidate.id);
    const clubCode = key(candidate.code);
    if (clubId) {
      if (seenCatalogClubIds.has(clubId)) return false;
      seenCatalogClubIds.add(clubId);
      return true;
    }
    if (!clubCode || seenCatalogClubCodesWithoutId.has(clubCode)) return false;
    seenCatalogClubCodesWithoutId.add(clubCode);
    return true;
  });
  const catalogById = new Map(allCatalogClubs.flatMap((candidate) => [[key(candidate.id), candidate], [key(candidate.code), candidate]]));
  const persistedAI = persisted.filter((coach) => coach.managerType === 'ai' && !humanIds.has(key(coach.id)));
  const aiByClub = new Map(persistedAI.flatMap((coach) => {
    const clubId = key(coach.currentClubId);
    return clubId ? [[clubId, coach] as const] : [];
  }));
  const aiRankings = allCatalogClubs.flatMap((candidate) => {
    const clubId = key(candidate.id);
    if (!clubId || claimedClubIds.has(clubId)) return [];
    const coach = aiByClub.get(clubId) ?? aiByClub.get(key(candidate.code));
    const metadata = (candidate as RoomClubSnapshot & { headCoach?: LocalCoachRecord; coach?: LocalCoachRecord; manager?: LocalCoachRecord }).headCoach
      ?? (candidate as RoomClubSnapshot & { coach?: LocalCoachRecord }).coach
      ?? (candidate as RoomClubSnapshot & { manager?: LocalCoachRecord }).manager;
    const source = coach ?? metadata ?? {};
    const id = typeof source.id === 'string' && source.id.trim() ? source.id : `ai-coach:${candidate.id}`;
    const name = typeof source.name === 'string' && source.name.trim() ? source.name : `Treinador de ${candidate.name}`;
    const base = localManagerCampaign(room, { id, name, clubId: candidate.id, ready: false, joinedAt: '' }, viewerId);
    return [{
      ...base,
      managerType: 'ai' as const,
      isHuman: false,
      isAI: true,
      isOwner: false,
      isViewer: false,
      avatarImageUrl: typeof source.avatarImageUrl === 'string' ? source.avatarImageUrl : null,
      nationality: typeof source.nationality === 'string' ? source.nationality : null,
      preferredFormation: typeof source.preferredFormation === 'string' ? source.preferredFormation : null,
      style: typeof source.style === 'string' ? source.style : null,
      reputation: nullableMetric(source.reputation),
      status: 'employed' as const,
      careerHistory: localCareer(coach),
    }];
  });
  const inactiveAI = persistedAI.flatMap((coach) => {
    const currentClubId = typeof coach.currentClubId === 'string' ? coach.currentClubId : null;
    if (currentClubId && catalogById.has(key(currentClubId))) return [];
    const id = typeof coach.id === 'string' ? coach.id : '';
    const name = typeof coach.name === 'string' ? coach.name : '';
    if (!id || !name) return [];
    const base = localManagerCampaign(room, { id, name, clubId: null, ready: false, joinedAt: '' }, viewerId);
    return [{
      ...base,
      managerType: 'ai' as const,
      isHuman: false,
      isAI: true,
      nationality: typeof coach.nationality === 'string' ? coach.nationality : null,
      preferredFormation: typeof coach.preferredFormation === 'string' ? coach.preferredFormation : null,
      style: typeof coach.style === 'string' ? coach.style : null,
      reputation: nullableMetric(coach.reputation),
      status: coach.status === 'dismissed' ? 'dismissed' as const : 'unemployed' as const,
      careerHistory: localCareer(coach),
    }];
  });
  return sortRankingManagers([...humanRankings, ...aiRankings, ...inactiveAI], 'rankingPoints');
}

export function managerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '--';
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : parts[0]?.[1] ?? ''}`.toLocaleUpperCase('pt-BR');
}
