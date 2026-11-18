import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AuthContext } from '../auth/AuthContext';
import { apiRequest } from '../lib/apiClient';
import type {
  RankingClub,
  RankingFormResult,
  RankingHistoryEntry,
  RankingManager,
  RankingOption,
  RankingPlayer,
  RankingTimelineEntry,
  RankingsMeta,
  RankingsOptions,
  RankingsSnapshot,
} from '../utils/rankings';
import { sortRankingClubs, sortRankingManagers, sortRankingPlayers } from '../utils/rankings';
import { parseRankingQuery, rankingQueryKey, type RankingQuery } from '../../shared/rankingQuery.mjs';

type UnknownRecord = Record<string, unknown>;

interface RankingsResponse {
  rankings?: unknown;
}

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function list(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableText(value: unknown) {
  return text(value) || null;
}

function number(value: unknown, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value: unknown) {
  return Math.max(0, Math.trunc(number(value)));
}

function nullableCount(value: unknown) {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.max(0, Math.trunc(parsed));
}

function statsScope(value: unknown): RankingPlayer['statisticsScope'] {
  const normalized = text(value).toLocaleLowerCase('pt-BR');
  if (normalized === 'competition' || normalized === 'season-legacy' || normalized === 'local-season' || normalized === 'unavailable') {
    return normalized;
  }
  return 'local-season';
}

function first(...values: unknown[]) {
  return values.find((value) => value !== null && value !== undefined && value !== '');
}

function normalizePlayerAttributes(value: unknown): RankingPlayer['attributes'] {
  const source = record(value);
  if (!source) return null;
  const entries = Object.entries(source).flatMap(([name, rawValue]) => {
    const parsed = nullableNumber(rawValue);
    return parsed === null ? [] : [[name, Math.max(0, Math.min(20, parsed))] as const];
  });
  return entries.length ? Object.fromEntries(entries) as RankingPlayer['attributes'] : null;
}

function normalizePlayerContract(value: unknown): RankingPlayer['contract'] {
  const source = record(value);
  if (!source) return null;
  return {
    startSeason: nullableCount(source.startSeason),
    endSeason: nullableCount(source.endSeason),
    wage: nullableNumber(source.wage),
    status: nullableText(source.status),
  };
}

function normalizeForm(value: unknown, portuguese = false): RankingFormResult[] {
  const source = typeof value === 'string' ? value.split(/[\s,;|-]+/) : list(value);
  const tokens = source.map((item) => text(item).toLocaleUpperCase('pt-BR'));
  const portugueseNotation = portuguese || tokens.some((result) => (
    result === 'V' || result === 'E' || result === 'VITÓRIA' || result === 'EMPATE'
  ));
  return tokens.flatMap((result) => {
    if (result === 'W' || result === 'V' || result === 'WIN' || result === 'VITÓRIA') return ['W' as const];
    if (result === 'E' || result === 'DRAW' || result === 'EMPATE' || result === 'D' && !portugueseNotation) return ['D' as const];
    if (result === 'L' || result === 'LOSS' || result === 'DERROTA' || result === 'D' && portugueseNotation) return ['L' as const];
    return [];
  });
}

function deriveRate(explicit: unknown, numerator: number, denominator: number, inverse = false) {
  const normalized = nullableNumber(explicit);
  if (normalized !== null) return Math.max(0, normalized);
  if (numerator <= 0 || denominator <= 0) return null;
  return inverse ? denominator / numerator : numerator / denominator;
}

function normalizePlayer(value: unknown): RankingPlayer | null {
  const source = record(value);
  const stats = record(source?.seasonStats ?? source?.stats ?? source?.campaign);
  const advanced = record(source?.advanced ?? source?.advancedStats ?? stats?.advanced);
  const club = record(source?.club);
  const movement = record(source?.movement ?? source?.ranking);
  const id = text(source?.id);
  const name = text(source?.name);
  if (!source || !id || !name) return null;
  const goals = count(first(source.goals, stats?.goals));
  const assists = count(first(source.assists, stats?.assists));
  const appearances = count(first(source.appearances, stats?.appearances, stats?.matches));
  const minutes = count(first(source.minutes, stats?.minutes));
  const contributions = count(first(source.goalContributions, source.contributions, stats?.goalContributions, goals + assists));
  const rating = Math.max(0, number(first(source.rating, source.averageRating, stats?.rating, stats?.averageRating, source.overall)));
  const averageRating = Object.prototype.hasOwnProperty.call(source, 'averageRating')
    ? nullableNumber(source.averageRating)
    : nullableNumber(stats?.averageRating);
  const previousRank = nullableCount(first(source.previousRank, source.previousPosition, movement?.previousRank, movement?.previousPosition));
  const rank = nullableCount(first(source.rank, source.rankingPosition, movement?.rank, movement?.position));
  return {
    id,
    name,
    clubId: text(first(source.clubId, club?.id)),
    clubName: text(first(source.clubName, club?.name)),
    clubCode: text(first(source.clubCode, club?.code)),
    clubCrestImageUrl: nullableText(first(source.clubCrestImageUrl, club?.crestImageUrl, club?.crest)),
    shirtNumber: nullableCount(first(source.shirtNumber, source.number)),
    position: text(source.position),
    age: nullableCount(source.age),
    nationality: nullableText(first(source.nationality, source.country)),
    isStar: source.isStar === true,
    avatarImageUrl: nullableText(first(source.avatarImageUrl, source.photoUrl, source.imageUrl)),
    statisticsAvailable: source.statisticsAvailable !== false,
    statisticsComplete: source.statisticsComplete !== false,
    statisticsScope: statsScope(source.statisticsScope),
    goals,
    penaltyGoals: nullableCount(first(source.penaltyGoals, stats?.penaltyGoals, advanced?.penaltyGoals)),
    nonPenaltyGoals: nullableCount(first(source.nonPenaltyGoals, stats?.nonPenaltyGoals, advanced?.nonPenaltyGoals)),
    ownGoals: nullableCount(first(source.ownGoals, stats?.ownGoals, advanced?.ownGoals)),
    assists,
    goalContributions: contributions,
    appearances,
    starts: count(first(source.starts, stats?.starts)),
    minutes,
    yellowCards: count(first(source.yellowCards, stats?.yellowCards)),
    redCards: count(first(source.redCards, stats?.redCards)),
    keyPasses: nullableCount(first(source.keyPasses, stats?.keyPasses, advanced?.keyPasses)),
    bigChancesCreated: nullableCount(first(source.bigChancesCreated, stats?.bigChancesCreated, advanced?.bigChancesCreated)),
    tackles: nullableCount(first(source.tackles, stats?.tackles, advanced?.tackles)),
    saves: nullableCount(first(source.saves, stats?.saves, advanced?.saves)),
    cleanSheets: nullableCount(first(source.cleanSheets, stats?.cleanSheets, advanced?.cleanSheets)),
    shots: nullableCount(first(source.shots, stats?.shots, advanced?.shots)),
    shotsOnTarget: nullableCount(first(source.shotsOnTarget, stats?.shotsOnTarget, advanced?.shotsOnTarget)),
    overall: nullableNumber(source.overall),
    rating,
    averageRating,
    minutesPerGoal: deriveRate(first(source.minutesPerGoal, stats?.minutesPerGoal), goals, minutes, true),
    minutesPerAssist: deriveRate(first(source.minutesPerAssist, stats?.minutesPerAssist), assists, minutes, true),
    minutesPerContribution: deriveRate(first(source.minutesPerContribution, stats?.minutesPerContribution), contributions, minutes, true),
    contributionsPerGame: deriveRate(first(source.contributionsPerGame, stats?.contributionsPerGame), contributions, appearances),
    clubGoalParticipationPercent: nullableNumber(first(source.clubGoalParticipationPercent, source.goalParticipationPercent, stats?.clubGoalParticipationPercent)),
    marketValue: nullableNumber(first(source.marketValue, source.value)),
    wage: nullableNumber(first(source.wage, source.salary)),
    condition: nullableNumber(source.condition),
    morale: nullableText(source.morale),
    potential: nullableNumber(source.potential),
    status: nullableText(source.status),
    negotiability: nullableText(source.negotiability),
    loanAvailable: typeof source.loanAvailable === 'boolean' ? source.loanAvailable : null,
    attributes: normalizePlayerAttributes(source.attributes),
    contract: normalizePlayerContract(source.contract),
    injuries: count(first(source.injuries, stats?.injuries)),
    goalsConceded: nullableCount(first(source.goalsConceded, stats?.goalsConceded, advanced?.goalsConceded)),
    rank,
    previousRank,
    rankChange: nullableNumber(first(source.rankChange, source.positionChange, movement?.change, rank !== null && previousRank !== null ? previousRank - rank : null)),
  };
}

function normalizeClub(value: unknown): RankingClub | null {
  const source = record(value);
  const campaign = record(source?.campaign ?? source?.stats ?? source?.standing);
  const finance = record(source?.finance ?? source?.financial);
  const league = record(source?.league ?? source?.competition);
  const movement = record(source?.movement ?? source?.ranking);
  const id = text(source?.id);
  const name = text(source?.name);
  if (!source || !id || !name) return null;
  const position = nullableCount(first(source.position, campaign?.position, movement?.position));
  const previousPosition = nullableCount(first(source.previousPosition, campaign?.previousPosition, movement?.previousPosition));
  const squadValue = Math.max(0, number(first(source.squadValue, finance?.squadValue)));
  const playerCount = count(first(source.playerCount, source.squadSize));
  return {
    id,
    name,
    code: text(source.code, id.slice(0, 3).toUpperCase()),
    color: text(source.color, '#777777'),
    darkThemeColor: nullableText(source.darkThemeColor),
    lightThemeColor: nullableText(source.lightThemeColor),
    crestImageUrl: nullableText(first(source.crestImageUrl, source.crest, source.logoUrl)),
    leagueId: nullableText(first(source.leagueId, source.competitionId, league?.id)),
    leagueName: nullableText(first(source.leagueName, source.competitionName, league?.name)),
    country: nullableText(first(source.country, league?.country)),
    division: nullableText(first(source.division, league?.division)),
    position,
    previousPosition,
    positionChange: nullableNumber(first(source.positionChange, movement?.change, position !== null && previousPosition !== null ? previousPosition - position : null)),
    played: count(first(source.played, campaign?.played, campaign?.matches)),
    wins: count(first(source.wins, campaign?.wins)),
    draws: count(first(source.draws, campaign?.draws)),
    losses: count(first(source.losses, campaign?.losses)),
    goalsFor: count(first(source.goalsFor, campaign?.goalsFor)),
    goalsAgainst: count(first(source.goalsAgainst, campaign?.goalsAgainst)),
    goalDifference: Math.trunc(number(first(source.goalDifference, campaign?.goalDifference))),
    points: count(first(source.points, campaign?.points)),
    recentForm: normalizeForm(first(source.recentForm, source.form, campaign?.recentForm, campaign?.form)),
    squadValue,
    averagePlayerValue: nullableNumber(first(source.averagePlayerValue, finance?.averagePlayerValue, playerCount > 0 ? squadValue / playerCount : null)),
    payroll: nullableNumber(first(source.payroll, source.wageBill, finance?.payroll, finance?.wageBill)),
    playerCount,
    reputation: nullableNumber(source.reputation),
    possessionPercent: nullableNumber(first(source.possessionPercent, campaign?.possessionPercent)),
    averageAttendance: nullableNumber(first(source.averageAttendance, campaign?.averageAttendance)),
    valueChange: nullableNumber(first(source.valueChange, finance?.valueChange)),
    rankChange: nullableNumber(first(source.rankChange, movement?.change)),
  };
}

function normalizeManagerType(value: unknown, isAI: boolean) {
  const normalized = text(value).toLocaleLowerCase('pt-BR');
  return normalized === 'ai' || normalized === 'ia' || isAI ? 'ai' as const : 'human' as const;
}

function normalizeManagerStatus(value: unknown): RankingManager['status'] {
  const normalized = text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  if (['employed', 'empregado', 'active', 'ativo'].includes(normalized)) return 'employed';
  if (['unemployed', 'sem clube', 'free', 'livre'].includes(normalized)) return 'unemployed';
  if (['dismissed', 'demitido', 'fired'].includes(normalized)) return 'dismissed';
  return null;
}

function normalizeManagerResult(value: unknown, goalsFor: number, goalsAgainst: number): RankingFormResult {
  const normalized = text(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleUpperCase('pt-BR');
  if (['W', 'V', 'WIN', 'VITORIA'].includes(normalized)) return 'W';
  if (['E', 'DRAW', 'EMPATE'].includes(normalized)) return 'D';
  if (['D', 'L', 'LOSS', 'DERROTA'].includes(normalized)) return 'L';
  return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
}

function normalizeManagerMatchResult(value: unknown, index: number) {
  const result = record(value);
  if (!result) return null;
  const score = Array.isArray(result.score) ? result.score : [];
  const goalsFor = count(first(result.goalsFor, score[0]));
  const goalsAgainst = count(first(result.goalsAgainst, score[1]));
  return {
    id: text(first(result.id, result.fixtureId), `manager-match-${index}`),
    managerId: nullableText(first(result.managerId, result.coachId)),
    opponentManagerId: nullableText(first(result.opponentManagerId, result.opponentCoachId)),
    clubId: nullableText(result.clubId),
    opponentId: nullableText(first(result.opponentId, result.opponentClubId)),
    opponentName: nullableText(first(result.opponentName, result.opponent)),
    competitionId: nullableText(first(result.competitionId, result.leagueId)),
    competitionName: nullableText(first(result.competitionName, result.leagueName)),
    seasonNumber: nullableCount(first(result.seasonNumber, result.season)),
    round: nullableCount(result.round),
    venue: nullableText(result.venue),
    playedAt: nullableText(first(result.playedAt, result.date, result.completedAt)),
    result: normalizeManagerResult(first(result.result, result.outcome), goalsFor, goalsAgainst),
    goalsFor,
    goalsAgainst,
  };
}

function normalizeManagerAchievement(value: unknown, index: number) {
  const source = record(value);
  if (!source) {
    const label = text(value);
    return label ? { id: `achievement-${index}`, label, seasonNumber: null, seasonYear: null, competitionId: null, competitionName: null, awardedAt: null } : null;
  }
  const label = text(first(source.label, source.name, source.title, source.type));
  if (!label) return null;
  return {
    id: text(source.id, `achievement-${index}`),
    label,
    seasonNumber: nullableCount(first(source.seasonNumber, source.season, source.startedSeason)),
    seasonYear: nullableCount(source.seasonYear),
    competitionId: nullableText(first(source.competitionId, source.leagueId)),
    competitionName: nullableText(first(source.competitionName, source.leagueName)),
    awardedAt: nullableText(first(source.awardedAt, source.wonAt, source.date)),
  };
}

function normalizeManagerCareer(value: unknown, index: number) {
  const source = record(value);
  if (!source) return null;
  const stats = record(source.stats ?? source.campaign) ?? source;
  return {
    id: text(source.id, `career-${index}`),
    seasonNumber: nullableCount(first(source.seasonNumber, source.season, source.startedSeason)),
    seasonYear: nullableCount(source.seasonYear),
    clubId: nullableText(first(source.clubId, record(source.club)?.id)),
    clubName: nullableText(first(source.clubName, record(source.club)?.name)),
    status: normalizeManagerStatus(source.status),
    role: nullableText(source.role),
    startedAt: nullableText(first(source.startedAt, source.startDate)),
    endedAt: nullableText(first(source.endedAt, source.endDate)),
    entryReason: nullableText(first(source.entryReason, source.hireReason)),
    exitReason: nullableText(first(source.exitReason, source.endReason)),
    country: nullableText(first(source.country, source.countryName)),
    division: nullableText(first(source.division, source.competition, source.league)),
    durationDays: nullableCount(first(source.durationDays, source.exactDurationDays)),
    played: count(first(source.played, stats.played, stats.matches)),
    wins: count(first(source.wins, stats.wins)),
    draws: count(first(source.draws, stats.draws)),
    losses: count(first(source.losses, stats.losses)),
    goalsFor: count(first(source.goalsFor, stats.goalsFor)),
    goalsAgainst: count(first(source.goalsAgainst, stats.goalsAgainst)),
    points: count(first(source.points, stats.points)),
    pointsPerGame: nullableNumber(first(source.pointsPerGame, stats.pointsPerGame)),
    winRate: nullableNumber(first(source.winRate, stats.winRate)),
    longestWinningStreak: nullableCount(first(source.longestWinningStreak, stats.longestWinningStreak)),
    longestWinlessStreak: nullableCount(first(source.longestWinlessStreak, stats.longestWinlessStreak)),
    titles: count(first(source.titles, stats.titles)),
    promotions: count(first(source.promotions, stats.promotions)),
    relegations: count(first(source.relegations, stats.relegations)),
    reputationStart: nullableNumber(first(source.reputationStart, source.startReputation)),
    reputationEnd: nullableNumber(first(source.reputationEnd, source.endReputation)),
  };
}

function normalizeManagerSeason(value: unknown, index: number) {
  const career = normalizeManagerCareer(value, index);
  const source = record(value);
  if (!career || !source) return null;
  const stats = record(source.stats ?? source.campaign) ?? source;
  const played = career.played;
  const points = career.points;
  return {
    ...career,
    competitionId: nullableText(first(source.competitionId, source.leagueId)),
    competitionName: nullableText(first(source.competitionName, source.leagueName)),
    position: nullableCount(first(source.position, source.rank)),
    goalsFor: count(first(source.goalsFor, stats.goalsFor)),
    goalsAgainst: count(first(source.goalsAgainst, stats.goalsAgainst)),
    performancePercent: Math.max(0, number(first(source.performancePercent, stats.performancePercent, played > 0 ? points / (played * 3) * 100 : 0))),
    rankingPoints: nullableNumber(first(source.rankingPoints, source.score, stats.rankingPoints)),
  };
}

function normalizeManager(value: unknown): RankingManager | null {
  const source = record(value);
  const campaign = record(source?.campaign ?? source?.stats);
  const club = record(source?.club);
  const movement = record(source?.movement ?? source?.ranking);
  const id = text(source?.id);
  const name = text(source?.name);
  if (!source || !id || !name) return null;
  const played = count(first(source.played, campaign?.played, campaign?.matches));
  const points = count(first(source.points, campaign?.points));
  const goalsFor = count(first(source.goalsFor, campaign?.goalsFor));
  const goalsAgainst = count(first(source.goalsAgainst, campaign?.goalsAgainst));
  const position = count(first(source.position, movement?.position));
  const previousPosition = nullableCount(first(source.previousPosition, movement?.previousPosition));
  const rawIsAI = source.isAI === true || source.ai === true;
  const managerType = normalizeManagerType(source.managerType, rawIsAI);
  const managerClubId = nullableText(first(source.clubId, club?.id));
  const managerClubName = nullableText(first(source.clubName, club?.name));
  const careerHistory = list(source.careerHistory).flatMap((entry, index) => {
    const normalized = normalizeManagerCareer(entry, index);
    return normalized ? [normalized] : [];
  });
  const seasonStats = list(source.seasonStats).flatMap((entry, index) => {
    const normalized = normalizeManagerSeason(entry, index);
    if (!normalized) return [];
    const matchingCareer = careerHistory.find((career) => (
      normalized.clubId !== null
      && career.clubId !== null
      && normalized.clubId === career.clubId
      && (normalized.seasonNumber === null || career.seasonNumber === null || normalized.seasonNumber === career.seasonNumber)
    ));
    const fallbackClubName = matchingCareer?.clubName
      ?? (normalized.clubId !== null && normalized.clubId === managerClubId ? managerClubName : null);
    return [{ ...normalized, clubName: normalized.clubName ?? fallbackClubName }];
  });
  return {
    id,
    name,
    avatarImageUrl: nullableText(first(source.avatarImageUrl, source.photoUrl)),
    clubId: managerClubId,
    clubName: managerClubName,
    clubCode: nullableText(first(source.clubCode, club?.code)),
    clubColor: nullableText(first(source.clubColor, source.color, club?.color)),
    clubDarkThemeColor: nullableText(first(source.clubDarkThemeColor, source.darkThemeColor, club?.darkThemeColor)),
    clubLightThemeColor: nullableText(first(source.clubLightThemeColor, source.lightThemeColor, club?.lightThemeColor)),
    clubCrestImageUrl: nullableText(first(source.clubCrestImageUrl, source.crestImageUrl, club?.crestImageUrl)),
    isOwner: source.isOwner === true,
    isViewer: source.isViewer === true || source.viewer === true,
    managerType,
    isHuman: managerType === 'human',
    isAI: managerType === 'ai',
    nationality: nullableText(first(source.nationality, source.country)),
    status: normalizeManagerStatus(first(source.status, source.employmentStatus, (source.clubId || club?.id) ? 'employed' : 'unemployed')),
    played,
    wins: count(first(source.wins, campaign?.wins)),
    draws: count(first(source.draws, campaign?.draws)),
    losses: count(first(source.losses, campaign?.losses)),
    goalsFor,
    goalsAgainst,
    goalDifference: Math.trunc(number(first(source.goalDifference, campaign?.goalDifference, goalsFor - goalsAgainst))),
    points,
    performancePercent: Math.max(0, number(first(source.performancePercent, source.winRate, campaign?.performancePercent, played > 0 ? (points / (played * 3)) * 100 : 0))),
    recentForm: normalizeForm(first(source.recentForm, source.form, campaign?.recentForm, campaign?.form)),
    preferredFormation: nullableText(first(source.preferredFormation, source.formation, campaign?.preferredFormation)),
    reputation: nullableNumber(source.reputation),
    rankingPoints: Object.prototype.hasOwnProperty.call(source, 'rankingPoints')
      ? nullableNumber(source.rankingPoints)
      : nullableNumber(first(source.score, campaign?.rankingPoints)),
    titles: Object.prototype.hasOwnProperty.call(source, 'titles')
      ? nullableCount(source.titles)
      : nullableCount(first(source.trophies, campaign?.titles)),
    currentStreak: nullableText(first(source.currentStreak, campaign?.currentStreak)),
    rankChange: nullableNumber(first(source.rankChange, movement?.change)),
    position,
    previousPosition,
    positionChange: nullableNumber(first(source.positionChange, movement?.change, position > 0 && previousPosition !== null ? previousPosition - position : null)),
    style: nullableText(first(source.style, source.playStyle, source.tacticalStyle)),
    recentResults: list(source.recentResults).flatMap((entry, index) => {
      const normalized = normalizeManagerMatchResult(entry, index);
      return normalized ? [normalized] : [];
    }),
    matchHistory: list(source.matchHistory).flatMap((entry, index) => {
      const normalized = normalizeManagerMatchResult(entry, index);
      return normalized ? [normalized] : [];
    }),
    rankingTrajectory: list(source.rankingTrajectory).flatMap((entry, index) => {
      const trajectory = record(entry);
      if (!trajectory) return [];
      const currentPosition = nullableCount(first(trajectory.position, trajectory.rank));
      const priorPosition = nullableCount(trajectory.previousPosition);
      return [{
        id: text(trajectory.id, `trajectory-${index}`),
        seasonNumber: nullableCount(first(trajectory.seasonNumber, trajectory.season)),
        seasonYear: nullableCount(trajectory.seasonYear),
        competitionId: nullableText(first(trajectory.competitionId, trajectory.leagueId)),
        competitionName: nullableText(first(trajectory.competitionName, trajectory.leagueName)),
        round: nullableCount(trajectory.round),
        position: currentPosition,
        previousPosition: priorPosition,
        positionChange: nullableNumber(first(trajectory.positionChange, trajectory.rankChange, currentPosition !== null && priorPosition !== null ? priorPosition - currentPosition : null)),
        rankingPoints: nullableNumber(first(trajectory.rankingPoints, trajectory.points, trajectory.score)),
      }];
    }),
    careerHistory,
    seasonStats,
    trophyHistory: list(source.trophyHistory).flatMap((entry, index) => {
      const normalized = normalizeManagerAchievement(entry, index);
      return normalized ? [normalized] : [];
    }),
    awards: list(source.awards).flatMap((entry, index) => {
      const normalized = normalizeManagerAchievement(entry, index);
      return normalized ? [normalized] : [];
    }),
  };
}

function normalizeOption(value: unknown, index: number): RankingOption | null {
  const source = record(value);
  if (!source) {
    const label = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    return label ? { id: label, label, count: null } : null;
  }
  const id = text(first(source.id, source.value, source.code, source.key));
  const label = text(first(source.label, source.name, source.title, id));
  if (!id && !label) return null;
  return { id: id || `option-${index}`, label: label || id, count: nullableCount(source.count) };
}

function normalizeOptions(value: unknown): RankingsOptions {
  const source = record(value);
  const normalize = (items: unknown) => list(items).flatMap((item, index) => {
    const option = normalizeOption(item, index);
    return option ? [option] : [];
  });
  return {
    competitions: normalize(Array.isArray(value) ? value : first(source?.competitions, source?.leagues)),
    seasons: normalize(source?.seasons),
    rounds: normalize(source?.rounds),
    clubs: normalize(source?.clubs),
    nationalities: normalize(source?.nationalities),
    positions: normalize(source?.positions),
    managerTypes: normalize(source?.managerTypes),
    managerClubs: normalize(first(source?.managerClubs, source?.clubs)),
    managerNationalities: normalize(first(source?.managerNationalities, source?.nationalities)),
    managerStatuses: normalize(source?.managerStatuses),
    managerPeriods: normalize(source?.managerPeriods),
  };
}

function normalizeMeta(value: unknown): RankingsMeta {
  const source = record(value);
  const coverage = record(source?.playerMetricCoverage);
  return {
    generatedAt: nullableText(source?.generatedAt),
    updatedAt: nullableText(first(source?.updatedAt, source?.lastUpdatedAt)),
    updatedRound: nullableCount(source?.updatedRound),
    currentRound: nullableCount(source?.currentRound),
    completedRounds: nullableCount(source?.completedRounds),
    totalRounds: nullableCount(source?.totalRounds),
    seasonState: nullableText(first(source?.seasonState, source?.status)),
    source: nullableText(source?.source),
    stale: source?.stale === true,
    playerStatsScope: statsScope(source?.playerStatsScope),
    playerStatsComplete: source?.playerStatsComplete !== false,
    playerStatsTrackedMatches: count(source?.playerStatsTrackedMatches),
    playerStatsUntrackedMatches: count(source?.playerStatsUntrackedMatches),
    playerMetricCoverage: {
      shots: coverage?.shots === true,
      shotsOnTarget: coverage?.shotsOnTarget === true,
      saves: coverage?.saves === true,
      goalsConceded: coverage?.goalsConceded === true,
      cleanSheets: coverage?.cleanSheets === true,
    },
  };
}

function normalizeHistory(value: unknown, index: number): RankingHistoryEntry | null {
  const source = record(value);
  if (!source) return null;
  return {
    id: text(source.id, `history-${index}`),
    type: nullableText(source.type),
    label: nullableText(first(source.label, source.title, source.name)),
    seasonNumber: nullableCount(first(source.seasonNumber, source.season)),
    round: nullableCount(source.round),
    competitionId: nullableText(first(source.competitionId, source.leagueId)),
    playerId: nullableText(source.playerId),
    clubId: nullableText(source.clubId),
    managerId: nullableText(source.managerId),
    position: nullableCount(first(source.position, source.rank)),
    value: nullableNumber(first(source.value, source.points, source.score)),
    createdAt: nullableText(first(source.createdAt, source.recordedAt, source.date)),
    seasonYear: nullableCount(source.seasonYear),
    completedFixtureCount: nullableCount(source.completedFixtureCount),
    matchCount: nullableCount(source.matchCount),
  };
}

function normalizeTimeline(value: unknown, index: number): RankingTimelineEntry | null {
  const source = record(value);
  if (!source) return null;
  const rawType = text(source.type).toLocaleLowerCase('pt-BR');
  const type = rawType === 'club' || rawType === 'manager' ? rawType : null;
  const entityId = text(first(source.entityId, source.clubId, source.managerId));
  const competitionId = text(first(source.competitionId, source.leagueId));
  const position = nullableCount(first(source.position, source.rank));
  const round = nullableCount(source.round);
  if (!type || !entityId || !competitionId || position === null || position < 1 || round === null || round < 1) return null;
  return {
    id: text(source.id, `timeline-${index}`),
    type,
    seasonNumber: Math.max(1, count(first(source.seasonNumber, source.season, 1))),
    seasonYear: nullableCount(source.seasonYear),
    competitionId,
    competitionName: text(first(source.competitionName, source.leagueName, competitionId)),
    round,
    entityId,
    clubId: nullableText(source.clubId),
    clubCode: nullableText(source.clubCode),
    managerId: nullableText(source.managerId),
    label: text(first(source.label, source.name, entityId)),
    position,
    previousPosition: nullableCount(source.previousPosition),
    positionChange: nullableNumber(first(source.positionChange, source.rankChange)),
    played: count(source.played),
    wins: count(source.wins),
    draws: count(source.draws),
    losses: count(source.losses),
    goalsFor: count(source.goalsFor),
    goalsAgainst: count(source.goalsAgainst),
    goalDifference: number(source.goalDifference, count(source.goalsFor) - count(source.goalsAgainst)),
    points: count(source.points),
    rankingPoints: nullableNumber(first(source.rankingPoints, source.score)),
  };
}

export function normalizeRankings(value: unknown): RankingsSnapshot | null {
  const source = record(value);
  const scope = record(source?.scope);
  if (!source) return null;
  const players = sortRankingPlayers(list(first(source.players, source.playerRankings)).flatMap((player) => {
    const normalized = normalizePlayer(player);
    return normalized ? [normalized] : [];
  }));
  const clubs = list(first(source.clubs, source.clubRankings)).flatMap((club) => {
    const normalized = normalizeClub(club);
    return normalized ? [normalized] : [];
  });
  const managers = sortRankingManagers(list(first(source.managers, source.managerRankings)).flatMap((manager) => {
    const normalized = normalizeManager(manager);
    return normalized ? [normalized] : [];
  }));
  return {
    scope: {
      leagueIds: list(first(scope?.leagueIds, scope?.competitionIds)).map((id) => text(id)).filter(Boolean),
      leagueId: nullableText(first(scope?.leagueId, scope?.competitionId)),
      leagueName: nullableText(first(scope?.leagueName, scope?.competitionName)),
      competitionId: nullableText(first(scope?.competitionId, scope?.leagueId)),
      competitionName: nullableText(first(scope?.competitionName, scope?.leagueName)),
      seasonNumber: nullableCount(first(scope?.seasonNumber, scope?.season)),
      seasonYear: nullableCount(first(scope?.seasonYear, scope?.year)),
      round: nullableCount(first(scope?.round, scope?.currentRound)),
      type: nullableText(first(scope?.type, scope?.scopeType)),
    },
    options: normalizeOptions(first(source.options, scope?.options, source.filters)),
    meta: normalizeMeta(first(source.meta, source.metadata)),
    history: list(first(source.history, source.rankingHistory)).flatMap((entry, index) => {
      const normalized = normalizeHistory(entry, index);
      return normalized ? [normalized] : [];
    }),
    timeline: list(source.timeline).flatMap((entry, index) => {
      const normalized = normalizeTimeline(entry, index);
      return normalized ? [normalized] : [];
    }),
    players,
    clubs: clubs.some((club) => club.played > 0 || club.points > 0)
      ? sortRankingClubs(clubs, 'points')
      : sortRankingClubs(clubs, 'squadValue'),
    managers,
  };
}

export function normalizeRankingsResponse(value: unknown, query: RankingQuery): RankingsSnapshot | null {
  const source = record(value);
  const selection = record(source?.selection);
  if (!source || !record(source.meta) || !record(source.scope) || !selection
    || !['players', 'clubs', 'managers'].every((field) => Array.isArray(source[field]))) return null;
  try {
    if (!selection.query || rankingQueryKey(selection.query) !== rankingQueryKey(query)) return null;
    const backendRow = (value: unknown) => {
      const row = record(value);
      return row ? { ...row, recentForm: normalizeForm(row.recentForm, true) } : value;
    };
    const snapshot = normalizeRankings({ ...source, clubs: list(source.clubs).map(backendRow), managers: list(source.managers).map(backendRow) });
    if (!snapshot) return null;
    const ids = (value: unknown, rows: { id: string }[]) => {
      const available = new Set(rows.map((row) => row.id));
      if (!Array.isArray(value) || new Set(value).size !== value.length
        || !value.every((id) => typeof id === 'string' && available.has(id))) throw new Error('Seleção inválida');
      return value as string[];
    };
    const managers = (value: unknown) => {
      if (!Array.isArray(value)) throw new Error('Treinadores inválidos');
      const normalized = value.map((row) => normalizeManager(backendRow(row)));
      if (normalized.some((manager) => !manager)) throw new Error('Treinador inválido');
      const rows = normalized as RankingManager[];
      ids(rows.map((manager) => manager.id), snapshot.managers);
      return rows;
    };
    snapshot.selection = { query: parseRankingQuery(selection.query),
      playerIds: ids(selection.playerIds, snapshot.players), clubIds: ids(selection.clubIds, snapshot.clubs),
      managers: managers(selection.managers), managerScope: managers(selection.managerScope) };
    return snapshot;
  } catch { return null; }
}

export function useRankings(
  roomCode: string | null | undefined,
  clubId: string,
  revision = 0,
  competitionId?: string | null,
  selectionQuery?: RankingQuery,
) {
  const auth = useContext(AuthContext);
  const [rankings, setRankings] = useState<RankingsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const rankingsRef = useRef<RankingsSnapshot | null>(null);
  const scopeRef = useRef('');
  const code = roomCode?.trim() ?? '';
  const competition = competitionId?.trim() ?? '';
  const queryKey = rankingQueryKey(selectionQuery);
  const requestScope = `${auth?.identity?.uid ?? ''}\u0000${code}\u0000${clubId}\u0000${competition}\u0000${revision}\u0000${queryKey}`;
  const refresh = useCallback(() => setRefreshRevision((current) => current + 1), []);

  useEffect(() => {
    if (!code || !clubId || auth?.status !== 'authenticated' || !auth.identity) {
      rankingsRef.current = null;
      scopeRef.current = '';
      setRankings(null);
      setLoading(false);
      setRefreshing(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const identity = auth.identity;
    const getIdToken = auth.getIdToken;
    const sameScope = scopeRef.current === requestScope;
    if (!sameScope) {
      scopeRef.current = requestScope;
      rankingsRef.current = null;
      setRankings(null);
    }
    const hasSnapshot = sameScope && rankingsRef.current !== null;
    setLoading(!hasSnapshot);
    setRefreshing(hasSnapshot);
    setError(null);
    const selection = parseRankingQuery(JSON.parse(queryKey));
    const query = new URLSearchParams({ clubId, ...selection });
    if (competition) query.set('competitionId', competition);
    const path = `/api/rooms/${encodeURIComponent(code)}/rankings?${query.toString()}`;
    void apiRequest<RankingsResponse>(
      path,
      { identity, getIdToken },
      { signal: controller.signal },
    ).then((response) => {
      if (controller.signal.aborted) return;
      const normalized = normalizeRankingsResponse(response.rankings, selection);
      if (!normalized) throw new Error('O servidor retornou rankings inválidos.');
      rankingsRef.current = normalized;
      setRankings(normalized);
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        setError(requestError instanceof Error ? requestError.message : 'Rankings completos indisponíveis.');
      }
    }).finally(() => {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [auth?.getIdToken, auth?.identity, auth?.status, clubId, code, competition, refreshRevision, requestScope, revision, queryKey]);

  const scopeMatches = scopeRef.current === requestScope;
  const authenticated = auth?.status === 'authenticated' && Boolean(auth.identity);
  return { rankings: scopeMatches && authenticated ? rankings : null,
    loading: loading || Boolean(code && authenticated && !scopeMatches), refreshing,
    error: code && !authenticated ? 'Entre na sua conta para consultar os rankings.' : error, refresh };
}
