import type {
  CompetitionFixture,
  CompetitionFixtureResult,
  CompetitionGroup,
  CompetitionKnockoutStage,
  CompetitionSeason,
  CompetitionStage,
  CompetitionStanding,
  CompetitionState,
  MatchReadiness,
  MatchSideStatistics,
  MatchStatistics,
  Room,
  RoomClubSnapshot,
  RoomFixture,
  RoomLeagueFixture,
  RoomLeagueSnapshot,
  RoomLineup,
  RoomManager,
  RoomScheduleIssue,
  RoomTacticPreview,
  ServerLeagueMatchResult,
  ServerMatchFinished,
  ServerRoundMatchResult,
  ServerRoundSummary,
  TacticPlanV1,
  Tournament,
  TournamentParticipant,
} from '../types';
import { formations } from '../constants/formations';

type UnknownRecord = Record<string, unknown>;

const epoch = new Date(0).toISOString();

function object(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  return text(value) || undefined;
}

function optionalNullableText(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return optionalText(value) ?? null;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function nullableIdentifier(value: unknown): string | null {
  return value === null || value === undefined ? null : identifier(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function integer(value: unknown, fallback: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  return Math.max(minimum, Math.min(maximum, Math.trunc(finiteNumber(value, fallback))));
}

function identifiers(value: unknown): string[] {
  const seen = new Set<string>();
  return list(value).flatMap((item) => {
    const id = identifier(item);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

const tacticFormationIds = new Set(formations.map((formation) => formation.id));

function normalizeTacticPlan(value: unknown, lineupIds: readonly string[]): TacticPlanV1 | undefined {
  if (value === undefined || value === null) return undefined;
  const record = object(value);
  const team = object(record?.teamInstructions);
  const setPieces = object(record?.setPieces);
  const corner = object(setPieces?.corner);
  const freeKick = object(setPieces?.freeKick);
  const goalKick = object(setPieces?.goalKick);
  const starterIds = new Set(lineupIds);
  const taker = (candidate: unknown) => {
    const id = identifier(candidate);
    return id && starterIds.has(id) ? id : null;
  };
  const seenPlayers = new Set<string>();
  const individualInstructions = list(record?.individualInstructions).flatMap((value) => {
    const instruction = object(value);
    const playerId = identifier(instruction?.playerId);
    if (!instruction || !playerId || !starterIds.has(playerId) || seenPlayers.has(playerId)) return [];
    seenPlayers.add(playerId);
    return [{
      playerId,
      withBall: enumValue(instruction.withBall, ['support-inside', 'hold-width', 'attack-space'] as const, 'support-inside'),
      withoutBall: enumValue(instruction.withoutBall, ['press-more', 'hold-position', 'man-mark'] as const, 'press-more'),
    }];
  });
  const formationId = identifier(record?.formationId);
  return {
    version: 1,
    formationId: formationId && tacticFormationIds.has(formationId) ? formationId : '4-3-3',
    mentality: enumValue(record?.mentality, ['cautious', 'balanced', 'positive', 'attacking'] as const, 'positive'),
    teamInstructions: {
      pressureLine: enumValue(team?.pressureLine, ['very-low', 'low', 'medium', 'high', 'very-high'] as const, 'high'),
      width: enumValue(team?.width, ['very-narrow', 'narrow', 'normal', 'wide', 'very-wide'] as const, 'wide'),
      tempo: enumValue(team?.tempo, ['very-slow', 'slow', 'normal', 'fast', 'very-fast'] as const, 'fast'),
      pressing: enumValue(team?.pressing, ['passive', 'moderate', 'intense', 'aggressive'] as const, 'intense'),
      offensiveTransition: enumValue(team?.offensiveTransition, ['build-up', 'direct', 'counter'] as const, 'build-up'),
      defensiveTransition: enumValue(team?.defensiveTransition, ['counter-press', 'regroup', 'drop'] as const, 'counter-press'),
    },
    individualInstructions,
    setPieces: {
      corner: {
        takerId: taker(corner?.takerId),
        routine: enumValue(corner?.routine, ['short', 'near-post', 'far-post'] as const, 'short'),
      },
      freeKick: {
        takerId: taker(freeKick?.takerId),
        routine: enumValue(freeKick?.routine, ['direct', 'cross', 'short'] as const, 'direct'),
      },
      goalKick: {
        takerId: taker(goalKick?.takerId),
        routine: enumValue(goalKick?.routine, ['short', 'mixed', 'long'] as const, 'short'),
      },
    },
    secret: record?.secret !== false,
  };
}

function normalizeCohesion(value: unknown, lineupIds: readonly string[]): RoomLineup['cohesion'] {
  const record = object(value);
  if (!record) return undefined;
  const formationId = identifier(record.formationId) ?? '4-3-3';
  const orderedLineupIds = identifiers(record.orderedLineupIds);
  return {
    score: integer(record.score, 70, 0, 100),
    formationId: tacticFormationIds.has(formationId) ? formationId : '4-3-3',
    orderedLineupIds: orderedLineupIds.length ? orderedLineupIds : [...lineupIds],
    lineupSignature: text(record.lineupSignature, JSON.stringify(lineupIds)),
    tacticFingerprint: text(record.tacticFingerprint, 'legacy'),
    stableMatches: integer(record.stableMatches, 0, 0),
    outOfPositionCount: integer(record.outOfPositionCount, 0, 0, 11),
    exactPositionCount: integer(record.exactPositionCount, 0, 0, 11),
    changeImpact: finiteNumber(record.changeImpact, 0),
    updatedAt: optionalText(record.updatedAt),
  };
}

function score(value: unknown): [number, number] {
  const values = list(value);
  return [
    integer(values[0], 0, 0, 999),
    integer(values[1], 0, 0, 999),
  ];
}

function normalizeManager(value: unknown, fallbackJoinedAt: string): RoomManager | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  return {
    ...record,
    id,
    name: text(record.name, id),
    clubId: nullableIdentifier(record.clubId),
    ready: record.ready === true,
    joinedAt: text(record.joinedAt, fallbackJoinedAt),
  } as RoomManager;
}

function normalizeFixture(value: unknown): RoomFixture | null {
  const record = object(value);
  const fixtureId = identifier(record?.fixtureId);
  if (!record || !fixtureId) return null;
  return {
    ...record,
    fixtureId,
    leagueFixtureId: identifier(record.leagueFixtureId) ?? undefined,
    round: integer(record.round, 1, 1),
    scheduledAt: typeof record.scheduledAt === 'string' ? record.scheduledAt : null,
    competition: text(record.competition, 'Competição'),
    leagueId: nullableIdentifier(record.leagueId),
    homeClubId: identifier(record.homeClubId) ?? '',
    awayClubId: identifier(record.awayClubId) ?? '',
    homeTeam: text(record.homeTeam, identifier(record.homeClubId) ?? 'Mandante'),
    awayTeam: text(record.awayTeam, identifier(record.awayClubId) ?? 'Visitante'),
    homeCode: optionalText(record.homeCode),
    awayCode: optionalText(record.awayCode),
    homeColor: optionalText(record.homeColor),
    awayColor: optionalText(record.awayColor),
    homeDarkThemeColor: optionalNullableText(record.homeDarkThemeColor),
    homeLightThemeColor: optionalNullableText(record.homeLightThemeColor),
    awayDarkThemeColor: optionalNullableText(record.awayDarkThemeColor),
    awayLightThemeColor: optionalNullableText(record.awayLightThemeColor),
    homeCrestImageUrl: optionalNullableText(record.homeCrestImageUrl),
    awayCrestImageUrl: optionalNullableText(record.awayCrestImageUrl),
    homeStadium: optionalText(record.homeStadium),
    homeStadiumCapacity: optionalFiniteNumber(record.homeStadiumCapacity),
    homeManagerId: nullableIdentifier(record.homeManagerId),
    awayManagerId: nullableIdentifier(record.awayManagerId),
    managerIds: identifiers(record.managerIds),
  } as RoomFixture;
}

function normalizeLeagueFixture(value: unknown): RoomLeagueFixture | null {
  const record = object(value);
  const leagueFixtureId = identifier(record?.leagueFixtureId);
  if (!record || !leagueFixtureId) return null;
  return {
    ...record,
    leagueFixtureId,
    leagueId: nullableIdentifier(record.leagueId),
    round: integer(record.round, 1, 1),
    scheduledAt: typeof record.scheduledAt === 'string' ? record.scheduledAt : null,
    homeClubId: identifier(record.homeClubId) ?? '',
    awayClubId: identifier(record.awayClubId) ?? '',
  } as RoomLeagueFixture;
}

function normalizeLineup(value: unknown, fallbackUpdatedAt: string): RoomLineup | null {
  const record = object(value);
  const managerId = identifier(record?.managerId);
  if (!record || !managerId) return null;
  const lineupIds = identifiers(record.lineupIds);
  return {
    ...record,
    managerId,
    clubId: identifier(record.clubId) ?? '',
    lineupIds,
    tactics: normalizeTacticPlan(record.tactics, lineupIds),
    cohesion: normalizeCohesion(record.cohesion, lineupIds),
    updatedAt: text(record.updatedAt, fallbackUpdatedAt),
  } as RoomLineup;
}

function normalizeTacticPreview(value: unknown, fallbackUpdatedAt: string): RoomTacticPreview | null {
  const record = object(value);
  const managerId = identifier(record?.managerId);
  if (!record || !managerId) return null;
  const team = object(record.teamInstructions);
  const formationId = identifier(record.formationId);
  return {
    managerId,
    clubId: identifier(record.clubId) ?? '',
    formationId: formationId && tacticFormationIds.has(formationId) ? formationId : '4-3-3',
    mentality: enumValue(record.mentality, ['cautious', 'balanced', 'positive', 'attacking'] as const, 'positive'),
    teamInstructions: {
      pressureLine: enumValue(team?.pressureLine, ['very-low', 'low', 'medium', 'high', 'very-high'] as const, 'high'),
      width: enumValue(team?.width, ['very-narrow', 'narrow', 'normal', 'wide', 'very-wide'] as const, 'wide'),
      tempo: enumValue(team?.tempo, ['very-slow', 'slow', 'normal', 'fast', 'very-fast'] as const, 'fast'),
      pressing: enumValue(team?.pressing, ['passive', 'moderate', 'intense', 'aggressive'] as const, 'intense'),
      offensiveTransition: enumValue(team?.offensiveTransition, ['build-up', 'direct', 'counter'] as const, 'build-up'),
      defensiveTransition: enumValue(team?.defensiveTransition, ['counter-press', 'regroup', 'drop'] as const, 'counter-press'),
    },
    updatedAt: text(record.updatedAt, fallbackUpdatedAt),
  };
}

function normalizeClubSnapshot(value: unknown, fallbackLeagueId: string): RoomClubSnapshot | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  return {
    ...record,
    id,
    name: text(record.name, id),
    code: text(record.code, id.slice(0, 8).toUpperCase()),
    color: text(record.color, '#c8ff3d'),
    reputation: finiteNumber(record.reputation, 10),
    crestImageUrl: typeof record.crestImageUrl === 'string' ? record.crestImageUrl : null,
    leagueId: identifier(record.leagueId) ?? fallbackLeagueId,
  } as RoomClubSnapshot;
}

function normalizeLeagueSnapshot(value: unknown): RoomLeagueSnapshot | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  return {
    ...record,
    id,
    name: text(record.name, id),
    country: text(record.country, 'País a definir'),
    division: text(record.division, text(record.name, id)),
    legs: enumValue(record.legs, ['single', 'double'] as const, 'double'),
    clubs: list(record.clubs).flatMap((club) => {
      const normalized = normalizeClubSnapshot(club, id);
      return normalized ? [normalized] : [];
    }),
  } as RoomLeagueSnapshot;
}

const tournamentFormats = ['league', 'knockout', 'groups_knockout'] as const;
const tournamentLegs = ['single', 'double'] as const;
const tournamentTiebreakers = [
  'goal_difference', 'goals_scored', 'wins', 'head_to_head', 'fair_play',
  'away_goals', 'extra_time', 'penalties', 'drawing_lots',
] as const;
const competitionTiebreakers = ['points', ...tournamentTiebreakers] as const;

function normalizeTournamentParticipant(value: unknown): TournamentParticipant | null {
  const record = object(value);
  const id = identifier(record?.id ?? record?.clubId);
  if (!record || !id) return null;
  return {
    id,
    name: text(record.name, id),
    abbreviation: text(record.abbreviation ?? record.code, id.slice(0, 3).toUpperCase()),
    colors: list(record.colors).map((color) => text(color)).filter(Boolean),
    darkThemeColor: optionalNullableText(record.darkThemeColor) ?? null,
    lightThemeColor: optionalNullableText(record.lightThemeColor) ?? null,
    country: optionalNullableText(record.country) ?? null,
    division: optionalNullableText(record.division) ?? null,
    crestImageUrl: optionalNullableText(record.crestImageUrl) ?? null,
    crestImagePath: optionalNullableText(record.crestImagePath) ?? null,
  };
}

function normalizeTournament(value: unknown): Tournament | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  const participants = list(record.participants).flatMap((participant) => {
    const normalized = normalizeTournamentParticipant(participant);
    return normalized ? [normalized] : [];
  });
  const teamIds = identifiers(record.teamIds);
  return {
    id,
    name: text(record.name, id),
    format: enumValue(record.format, tournamentFormats, 'league'),
    teamCount: integer(record.teamCount, Math.max(participants.length, teamIds.length), 0),
    legs: enumValue(record.legs, tournamentLegs, 'single'),
    tiebreakers: list(record.tiebreakers).flatMap((criterion) => (
      typeof criterion === 'string' && tournamentTiebreakers.includes(criterion as typeof tournamentTiebreakers[number])
        ? [criterion as typeof tournamentTiebreakers[number]]
        : []
    )),
    teamIds,
    trophyImageUrl: optionalNullableText(record.trophyImageUrl) ?? null,
    trophyImagePath: optionalNullableText(record.trophyImagePath) ?? null,
    active: record.active !== false,
    participants,
  };
}

function nullableScore(value: unknown): [number, number] | null {
  return Array.isArray(value) && value.length === 2 ? score(value) : null;
}

function normalizeCompetitionResult(value: unknown): CompetitionFixtureResult | null {
  const record = object(value);
  const normalizedScore = nullableScore(record?.score);
  if (!record || !normalizedScore) return null;
  return {
    score: normalizedScore,
    extraTime: nullableScore(record.extraTime),
    penalties: nullableScore(record.penalties),
    fairPlay: nullableScore(record.fairPlay) ?? [0, 0],
    winnerClubId: nullableIdentifier(record.winnerClubId),
  };
}

function normalizeCompetitionFixture(value: unknown): CompetitionFixture | null {
  const record = object(value);
  const id = identifier(record?.id ?? record?.competitionFixtureId);
  const competitionId = identifier(record?.competitionId ?? record?.tournamentId);
  const homeClubId = identifier(record?.homeClubId);
  const awayClubId = identifier(record?.awayClubId);
  if (!record || !id || !competitionId || !homeClubId || !awayClubId) return null;
  return {
    id,
    competitionFixtureId: identifier(record.competitionFixtureId) ?? id,
    competitionId,
    tournamentId: identifier(record.tournamentId) ?? competitionId,
    seasonNumber: integer(record.seasonNumber, 1, 1),
    seasonYear: integer(record.seasonYear, new Date().getUTCFullYear(), 1),
    stageId: text(record.stageId ?? record.stage, 'league'),
    stage: text(record.stage ?? record.stageId, 'league'),
    stageType: enumValue(record.stageType, ['league', 'groups', 'knockout'] as const, 'league'),
    groupId: nullableIdentifier(record.groupId),
    tieId: nullableIdentifier(record.tieId),
    round: integer(record.round, 1, 1),
    calendarRound: integer(record.calendarRound, integer(record.round, 1, 1), 1),
    matchNumber: integer(record.matchNumber, 1, 1),
    leg: integer(record.leg, 1, 1, 2),
    homeClubId,
    awayClubId,
    scheduledAt: text(record.scheduledAt, epoch),
    status: record.status === 'completed' ? 'completed' : 'scheduled',
    result: normalizeCompetitionResult(record.result),
    completedAt: optionalNullableText(record.completedAt) ?? null,
  };
}

function normalizeCompetitionStanding(value: unknown): CompetitionStanding | null {
  const record = object(value);
  const clubId = identifier(record?.clubId);
  if (!record || !clubId) return null;
  return {
    position: integer(record.position, 1, 1),
    clubId,
    played: integer(record.played, 0),
    wins: integer(record.wins, 0),
    draws: integer(record.draws, 0),
    losses: integer(record.losses, 0),
    goalsFor: integer(record.goalsFor, 0),
    goalsAgainst: integer(record.goalsAgainst, 0),
    goalDifference: integer(record.goalDifference, 0, -999, 999),
    points: integer(record.points, 0),
    fairPlay: integer(record.fairPlay, 0),
  };
}

function normalizeCompetitionGroup(value: unknown): CompetitionGroup | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  return {
    id,
    name: text(record.name, id),
    participantIds: identifiers(record.participantIds),
    fixtureIds: identifiers(record.fixtureIds),
    standings: list(record.standings).flatMap((standing) => {
      const normalized = normalizeCompetitionStanding(standing);
      return normalized ? [normalized] : [];
    }),
    qualifiers: identifiers(record.qualifiers),
  };
}

function normalizeCompetitionStage(value: unknown): CompetitionStage | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  const type = enumValue(record.type, ['league', 'groups', 'knockout'] as const, 'league');
  const status = record.status === 'completed' ? 'completed' : 'active';
  const fixtureIds = identifiers(record.fixtureIds);
  if (type === 'league') {
    return {
      id,
      type,
      status,
      participantIds: identifiers(record.participantIds),
      fixtureIds,
      standings: list(record.standings).flatMap((standing) => {
        const normalized = normalizeCompetitionStanding(standing);
        return normalized ? [normalized] : [];
      }),
    };
  }
  if (type === 'groups') {
    return {
      id,
      type,
      status,
      qualifiersPerGroup: integer(record.qualifiersPerGroup, 1, 1),
      fixtureIds,
      groups: list(record.groups).flatMap((group) => {
        const normalized = normalizeCompetitionGroup(group);
        return normalized ? [normalized] : [];
      }),
      calendarRoundCount: integer(record.calendarRoundCount, 1, 1),
    };
  }
  const rounds = list(record.rounds).flatMap((round) => {
    const roundRecord = object(round);
    const number = integer(roundRecord?.number, 0);
    if (!roundRecord || !number) return [];
    return [{ number, name: text(roundRecord.name, `Fase ${number}`), tieIds: identifiers(roundRecord.tieIds) }];
  });
  const ties = list(record.ties).flatMap((tie) => {
    const tieRecord = object(tie);
    const tieId = identifier(tieRecord?.id);
    if (!tieRecord || !tieId) return [];
    const normalizeSource = (source: unknown) => {
      const sourceRecord = object(source);
      return {
        type: sourceRecord?.type === 'winner' ? 'winner' as const : 'seed' as const,
        id: nullableIdentifier(sourceRecord?.id),
      };
    };
    return [{
      id: tieId,
      round: integer(tieRecord.round, 1, 1),
      order: integer(tieRecord.order, 1, 1),
      homeSource: normalizeSource(tieRecord.homeSource),
      awaySource: normalizeSource(tieRecord.awaySource),
      homeClubId: nullableIdentifier(tieRecord.homeClubId),
      awayClubId: nullableIdentifier(tieRecord.awayClubId),
      fixtureIds: identifiers(tieRecord.fixtureIds),
      status: enumValue(tieRecord.status, ['pending', 'active', 'completed', 'void'] as const, 'pending'),
      winnerClubId: nullableIdentifier(tieRecord.winnerClubId),
      aggregate: nullableScore(tieRecord.aggregate),
      decidedBy: optionalNullableText(tieRecord.decidedBy) ?? null,
    }];
  });
  return {
    id,
    type,
    status,
    startCalendarRound: integer(record.startCalendarRound, 1, 1),
    fixtureIds,
    rounds,
    ties,
  } as CompetitionKnockoutStage;
}

function normalizeCompetitionState(value: unknown): CompetitionState | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  const schedule = object(record.schedule);
  return {
    engineVersion: integer(record.engineVersion, 1, 1),
    id,
    name: text(record.name, id),
    format: enumValue(record.format, tournamentFormats, 'league'),
    legs: enumValue(record.legs, tournamentLegs, 'single'),
    tiebreakers: list(record.tiebreakers).flatMap((criterion) => (
      typeof criterion === 'string' && competitionTiebreakers.includes(criterion as typeof competitionTiebreakers[number])
        ? [criterion as typeof competitionTiebreakers[number]]
        : []
    )),
    seasonNumber: integer(record.seasonNumber, 1, 1),
    seasonYear: integer(record.seasonYear, new Date().getUTCFullYear(), 1),
    status: enumValue(record.status, ['scheduled', 'active', 'completed'] as const, 'scheduled'),
    participants: list(record.participants).flatMap((participant, index) => {
      const participantRecord = object(participant);
      const participantId = identifier(participantRecord?.id ?? participantRecord?.clubId);
      return participantRecord && participantId ? [{
        id: participantId,
        name: text(participantRecord.name, participantId),
        seed: integer(participantRecord.seed, index + 1, 1),
      }] : [];
    }),
    schedule: {
      startDate: text(schedule?.startDate, epoch),
      roundIntervalDays: integer(schedule?.roundIntervalDays, 4, 1),
      knockoutLegIntervalDays: integer(schedule?.knockoutLegIntervalDays, 7, 1),
      knockoutRoundIntervalDays: integer(schedule?.knockoutRoundIntervalDays, 14, 1),
      kickoffTimes: list(schedule?.kickoffTimes).map((time) => text(time)).filter(Boolean),
    },
    stages: list(record.stages).flatMap((stage) => {
      const normalized = normalizeCompetitionStage(stage);
      return normalized ? [normalized] : [];
    }),
    fixtures: list(record.fixtures).flatMap((fixture) => {
      const normalized = normalizeCompetitionFixture(fixture);
      return normalized ? [normalized] : [];
    }),
    calendar: identifiers(record.calendar),
    completedFixtureIds: identifiers(record.completedFixtureIds),
    winnerClubId: nullableIdentifier(record.winnerClubId),
  };
}

function normalizeCompetitionSeason(value: unknown): CompetitionSeason | null {
  const record = object(value);
  if (!record) return null;
  const competitions = list(record.competitions).flatMap((competition) => {
    const normalized = normalizeCompetitionState(competition);
    return normalized ? [normalized] : [];
  });
  if (!competitions.length && !Array.isArray(record.competitions)) return null;
  return {
    engineVersion: integer(record.engineVersion, 1, 1),
    seasonNumber: integer(record.seasonNumber, 1, 1),
    seasonYear: integer(record.seasonYear, new Date().getUTCFullYear(), 1),
    status: enumValue(record.status, ['scheduled', 'active', 'completed'] as const, 'scheduled'),
    tournamentIds: identifiers(record.tournamentIds),
    competitions,
    fixtures: list(record.fixtures).flatMap((fixture) => {
      const normalized = normalizeCompetitionFixture(fixture);
      return normalized ? [normalized] : [];
    }),
    calendar: identifiers(record.calendar),
    completedFixtureIds: identifiers(record.completedFixtureIds),
    winners: list(record.winners).flatMap((winner) => {
      const winnerRecord = object(winner);
      const tournamentId = identifier(winnerRecord?.tournamentId);
      const clubId = identifier(winnerRecord?.clubId);
      return tournamentId && clubId ? [{ tournamentId, clubId }] : [];
    }),
  };
}

function normalizeReadiness(value: unknown): MatchReadiness {
  const record = object(value);
  return {
    fixtureId: nullableIdentifier(record?.fixtureId),
    managerIds: identifiers(record?.managerIds),
  };
}

function normalizeSideStatistics(value: unknown): MatchSideStatistics {
  const record = object(value);
  return {
    possession: finiteNumber(record?.possession, 50),
    shots: integer(record?.shots, 0),
    shotsOnTarget: integer(record?.shotsOnTarget, 0),
    fouls: integer(record?.fouls, 0),
    yellowCards: integer(record?.yellowCards, 0),
    redCards: integer(record?.redCards, 0),
    corners: integer(record?.corners, 0),
  };
}

function normalizeStatistics(value: unknown): MatchStatistics {
  const record = object(value);
  return {
    home: normalizeSideStatistics(record?.home),
    away: normalizeSideStatistics(record?.away),
  };
}

function normalizeRoundMatch(value: unknown): ServerRoundMatchResult | null {
  const record = object(value);
  const id = identifier(record?.id);
  const fixtureId = identifier(record?.fixtureId);
  if (!record || !id || !fixtureId) return null;
  return {
    ...record,
    id,
    fixtureId,
    source: record.source === 'manager' ? 'manager' : 'ai',
    score: record.score === null ? null : score(record.score),
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
  } as ServerRoundMatchResult;
}

function normalizeRoundSummary(value: unknown): ServerRoundSummary | null {
  const record = object(value);
  if (!record) return null;
  return {
    ...record,
    leagueId: nullableIdentifier(record.leagueId),
    competition: text(record.competition, 'Competição'),
    round: integer(record.round, 1, 1),
    seasonNumber: integer(record.seasonNumber, 1, 1),
    seasonYear: integer(record.seasonYear, new Date().getUTCFullYear(), 1),
    complete: record.complete === true,
    matches: list(record.matches).flatMap((match) => {
      const normalized = normalizeRoundMatch(match);
      return normalized ? [normalized] : [];
    }),
  } as ServerRoundSummary;
}

function normalizeCompletedMatch(value: unknown, fallbackCode: string): ServerMatchFinished | null {
  const record = object(value);
  const id = identifier(record?.id);
  if (!record || !id) return null;
  const roundSummary = normalizeRoundSummary(record.roundSummary);
  return {
    ...record,
    code: identifier(record.code) ?? fallbackCode,
    id,
    fixtureId: identifier(record.fixtureId) ?? undefined,
    homeTeam: text(record.homeTeam, 'Mandante'),
    awayTeam: text(record.awayTeam, 'Visitante'),
    score: score(record.score),
    statistics: normalizeStatistics(record.statistics),
    events: list(record.events).filter((event) => object(event)) as ServerMatchFinished['events'],
    skipped: record.skipped === true,
    nextFixtureId: nullableIdentifier(record.nextFixtureId),
    roundSummary: roundSummary ?? undefined,
    pressConferenceSubmissions: list(record.pressConferenceSubmissions)
      .filter((submission) => object(submission)) as NonNullable<ServerMatchFinished['pressConferenceSubmissions']>,
  } as ServerMatchFinished;
}

function normalizeLeagueMatchResult(value: unknown): ServerLeagueMatchResult | null {
  const record = object(value);
  const leagueFixtureId = identifier(record?.leagueFixtureId);
  if (!record || !leagueFixtureId) return null;
  return {
    ...record,
    leagueFixtureId,
    score: score(record.score),
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : null,
  } as ServerLeagueMatchResult;
}

function normalizeScheduleIssue(value: unknown): RoomScheduleIssue | null {
  const record = object(value);
  if (!record || record.code !== 'LEAGUE_NEEDS_CLUBS') return null;
  return { code: 'LEAGUE_NEEDS_CLUBS', message: text(record.message, 'A liga precisa de mais clubes') };
}

export function normalizeRoomSnapshot(value: unknown): Room | null {
  const record = object(value);
  if (!record) return null;
  const code = (identifier(record.code) ?? identifier(record.id))?.toLocaleUpperCase('pt-BR');
  if (!code) return null;
  const id = identifier(record.id) ?? code;
  const createdAt = text(record.createdAt, epoch);
  const managers = list(record.managers).flatMap((manager) => {
    const normalized = normalizeManager(manager, createdAt);
    return normalized ? [normalized] : [];
  });
  const completedMatches = list(record.completedMatches).flatMap((match) => {
    const normalized = normalizeCompletedMatch(match, code);
    return normalized ? [normalized] : [];
  });
  const lastCompletedMatch = normalizeCompletedMatch(record.lastCompletedMatch, code);
  const maxManagers = Math.max(managers.length, integer(record.maxManagers, Math.max(1, managers.length), 1, 64));
  return {
    ...record,
    id,
    code,
    name: text(record.name, `Save ${code}`),
    ownerId: identifier(record.ownerId) ?? managers[0]?.id ?? '',
    status: record.status === 'active' ? 'active' : 'waiting',
    activeLeagues: identifiers(record.activeLeagues),
    competitionCatalog: list(record.competitionCatalog).flatMap((league) => {
      const normalized = normalizeLeagueSnapshot(league);
      return normalized ? [normalized] : [];
    }),
    tournamentCatalog: list(record.tournamentCatalog).flatMap((tournament) => {
      const normalized = normalizeTournament(tournament);
      return normalized ? [normalized] : [];
    }),
    competitionSeason: normalizeCompetitionSeason(record.competitionSeason),
    seasonLength: integer(record.seasonLength, 1, 1),
    unlimitedSeasons: record.unlimitedSeasons === true,
    currentSeason: integer(record.currentSeason, 1, 1),
    seasonYear: integer(record.seasonYear, new Date().getUTCFullYear(), 1),
    seasonStartedAt: typeof record.seasonStartedAt === 'string' ? record.seasonStartedAt : null,
    seasonHistory: list(record.seasonHistory).filter((entry) => entry !== undefined),
    careerCompleted: record.careerCompleted === true,
    maxManagers,
    createdAt,
    updatedAt: text(record.updatedAt) || undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : null,
    revision: integer(record.revision, 0),
    version: record.version === undefined ? undefined : integer(record.version, 1, 1),
    currentFixtureId: nullableIdentifier(record.currentFixtureId),
    scheduleVersion: record.scheduleVersion === undefined ? undefined : integer(record.scheduleVersion, 1, 1),
    scheduleIssue: normalizeScheduleIssue(record.scheduleIssue),
    fixtureSchedule: list(record.fixtureSchedule).flatMap((fixture) => {
      const normalized = normalizeFixture(fixture);
      return normalized ? [normalized] : [];
    }),
    leagueFixtureSchedule: list(record.leagueFixtureSchedule).flatMap((fixture) => {
      const normalized = normalizeLeagueFixture(fixture);
      return normalized ? [normalized] : [];
    }),
    matchReadiness: normalizeReadiness(record.matchReadiness),
    lineups: list(record.lineups).flatMap((lineup) => {
      const normalized = normalizeLineup(lineup, text(record.updatedAt, createdAt));
      return normalized ? [normalized] : [];
    }),
    tacticPreviews: list(record.tacticPreviews).flatMap((preview) => {
      const normalized = normalizeTacticPreview(preview, text(record.updatedAt, createdAt));
      return normalized ? [normalized] : [];
    }),
    completedFixtureIds: identifiers(record.completedFixtureIds),
    completedMatches,
    completedFixtureCount: record.completedFixtureCount === undefined
      ? undefined
      : integer(record.completedFixtureCount, 0, 0),
    completedMatchCount: record.completedMatchCount === undefined
      ? undefined
      : integer(record.completedMatchCount, 0, 0),
    seasonHistoryCount: record.seasonHistoryCount === undefined
      ? undefined
      : integer(record.seasonHistoryCount, 0, 0),
    lastCompletedMatch,
    leagueMatchResults: list(record.leagueMatchResults).flatMap((result) => {
      const normalized = normalizeLeagueMatchResult(result);
      return normalized ? [normalized] : [];
    }),
    lastCompletedRound: normalizeRoundSummary(record.lastCompletedRound),
    managers,
  } as Room;
}

export function normalizeRoomSnapshots(value: unknown): Room[] {
  const seen = new Set<string>();
  return list(value).flatMap((room) => {
    const normalized = normalizeRoomSnapshot(room);
    if (!normalized || seen.has(normalized.code)) return [];
    seen.add(normalized.code);
    return [normalized];
  });
}
