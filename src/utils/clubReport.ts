import type {
  ClubChoice,
  Room,
  RoomFixture,
  RoomLeagueFixture,
  ServerLeagueMatchResult,
  ServerMatchFinished,
} from '../types';

type MatchWithSeason = ServerMatchFinished & {
  homeClubId?: unknown;
  awayClubId?: unknown;
  seasonNumber?: unknown;
  seasonYear?: unknown;
};

export interface ClubReportMatch {
  fixtureId: string;
  round: number;
  goalsFor: number;
  goalsAgainst: number;
  wasHome: boolean;
}

export interface ClubReport {
  matches: ClubReportMatch[];
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  cleanSheets: number;
}

const EMPTY_REPORT: ClubReport = {
  matches: [],
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  goalsFor: 0,
  goalsAgainst: 0,
  goalDifference: 0,
  points: 0,
  cleanSheets: 0,
};

function normalized(value: unknown) {
  return typeof value === 'string'
    ? value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLocaleLowerCase('pt-BR')
    : '';
}

function safeInteger(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function safeScore(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return [safeInteger(value[0]), safeInteger(value[1])];
}

function clubReferences(club: ClubChoice) {
  return new Set([club.id, club.code, club.name].map(normalized).filter(Boolean));
}

function isClubReference(value: unknown, references: Set<string>) {
  const key = normalized(value);
  return Boolean(key && references.has(key));
}

function leagueFixtureSide(fixture: RoomLeagueFixture, references: Set<string>): 'home' | 'away' | null {
  if (isClubReference(fixture.homeClubId, references)) return 'home';
  if (isClubReference(fixture.awayClubId, references)) return 'away';
  return null;
}

function managedFixtureSide(fixture: RoomFixture, references: Set<string>): 'home' | 'away' | null {
  const homeReferences = [fixture.homeClubId, fixture.homeCode, fixture.homeTeam];
  const awayReferences = [fixture.awayClubId, fixture.awayCode, fixture.awayTeam];
  if (homeReferences.some((value) => isClubReference(value, references))) return 'home';
  if (awayReferences.some((value) => isClubReference(value, references))) return 'away';
  return null;
}

function reportMatch(
  fixtureId: string,
  round: unknown,
  score: [number, number],
  side: 'home' | 'away',
): ClubReportMatch {
  return {
    fixtureId,
    round: Math.max(1, safeInteger(round, 1)),
    goalsFor: side === 'home' ? score[0] : score[1],
    goalsAgainst: side === 'home' ? score[1] : score[0],
    wasHome: side === 'home',
  };
}

function leagueReportMatches(room: Room, references: Set<string>) {
  const fixtures = Array.isArray(room.leagueFixtureSchedule) ? room.leagueFixtureSchedule : [];
  const results = Array.isArray(room.leagueMatchResults) ? room.leagueMatchResults : [];
  const resultByFixture = new Map<string, ServerLeagueMatchResult>();

  for (const result of results) {
    const key = normalized(result?.leagueFixtureId);
    if (key && safeScore(result?.score)) resultByFixture.set(key, result);
  }

  const clubFixtures = fixtures.flatMap((fixture) => {
    const side = leagueFixtureSide(fixture, references);
    return side ? [{ fixture, side }] : [];
  });

  return {
    matches: clubFixtures.flatMap(({ fixture, side }) => {
      const result = resultByFixture.get(normalized(fixture.leagueFixtureId));
      const score = safeScore(result?.score);
      return result && score
        ? [reportMatch(fixture.leagueFixtureId, fixture.round, score, side)]
        : [];
    }),
  };
}

function matchIsFromCurrentSeason(match: MatchWithSeason, room: Room, completedIds: Set<string>) {
  const seasonNumber = Number(match.seasonNumber);
  const seasonYear = Number(match.seasonYear);
  if (Number.isFinite(seasonNumber) && seasonNumber !== room.currentSeason) return false;
  if (Number.isFinite(seasonYear) && seasonYear !== room.seasonYear) return false;
  if (Number.isFinite(seasonNumber) || Number.isFinite(seasonYear)) return true;
  if (completedIds.has(normalized(match.fixtureId))) return true;
  return room.currentSeason <= 1 && completedIds.size === 0;
}

function fallbackReportMatches(room: Room, references: Set<string>) {
  const fixtures = Array.isArray(room.fixtureSchedule) ? room.fixtureSchedule : [];
  const completedMatches = (Array.isArray(room.completedMatches) ? room.completedMatches : []) as MatchWithSeason[];
  const completedIds = new Set(
    (Array.isArray(room.completedFixtureIds) ? room.completedFixtureIds : []).map(normalized).filter(Boolean),
  );

  return fixtures.flatMap((fixture) => {
    const side = managedFixtureSide(fixture, references);
    if (!side) return [];
    const fixtureKey = normalized(fixture.fixtureId);
    const match = [...completedMatches].reverse().find((candidate) => (
      !candidate.cancelled
      && normalized(candidate.fixtureId ?? candidate.id) === fixtureKey
      && matchIsFromCurrentSeason(candidate, room, completedIds)
    ));
    const score = safeScore(match?.score);
    return match && score ? [reportMatch(fixture.fixtureId, fixture.round, score, side)] : [];
  });
}

export function buildClubReport(room: Room | null | undefined, club: ClubChoice): ClubReport {
  if (!room) return { ...EMPTY_REPORT, matches: [] };
  const references = clubReferences(club);
  const league = leagueReportMatches(room, references);
  const matches = (league.matches.length ? league.matches : fallbackReportMatches(room, references))
    .sort((left, right) => left.round - right.round || left.fixtureId.localeCompare(right.fixtureId, 'pt-BR'));
  const totals = matches.reduce((report, match) => {
    report.played += 1;
    report.goalsFor += match.goalsFor;
    report.goalsAgainst += match.goalsAgainst;
    if (match.goalsFor > match.goalsAgainst) report.wins += 1;
    else if (match.goalsFor < match.goalsAgainst) report.losses += 1;
    else report.draws += 1;
    if (match.goalsAgainst === 0) report.cleanSheets += 1;
    return report;
  }, { ...EMPTY_REPORT, matches });

  totals.goalDifference = totals.goalsFor - totals.goalsAgainst;
  totals.points = totals.wins * 3 + totals.draws;
  return totals;
}
