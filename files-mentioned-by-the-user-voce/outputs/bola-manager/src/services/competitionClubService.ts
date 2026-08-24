import type {
  Player,
  PlayerPosition,
  PressingInstruction,
  Room,
  TacticMentality,
} from '../types';

export interface CompetitionClubIdentity {
  id: string;
  name: string;
  code: string;
  color: string;
  darkThemeColor: string | null;
  lightThemeColor: string | null;
  crestImageUrl: string | null;
  country: string;
  division: string;
  reputation: number;
  stadium: string;
  capacity: number;
  city: string;
  budget: number;
}

export interface CompetitionClubMatch {
  id: string;
  round: number;
  scheduledAt: string | null;
  homeClubId: string;
  awayClubId: string;
  homeName: string;
  awayName: string;
  homeCode: string;
  awayCode: string;
  homeCrestImageUrl: string | null;
  awayCrestImageUrl: string | null;
  score: [number, number] | null;
  completed: boolean;
  competitionName: string;
}

export type CompetitionSquadStatus = 'starter' | 'rotation' | 'reserve' | 'prospect' | 'unknown';
export type CompetitionNegotiability = 'not_for_sale' | 'open_to_offers' | 'listed' | 'unknown';

export interface CompetitionClubSquadMember {
  player: Player;
  squadStatus: CompetitionSquadStatus;
  negotiability: CompetitionNegotiability;
  loanAvailable: boolean | null;
  contractSeasonsRemaining: number | null;
}

export interface CompetitionTacticalSectors {
  goalkeeping: number;
  defense: number;
  midfield: number;
  attack: number;
  physical: number;
}

export interface CompetitionDangerousPlayer {
  playerId: string;
  name: string;
  position: PlayerPosition;
  overall: number;
}

export interface CompetitionTacticalIntel {
  formation: string;
  style: 'possession' | 'direct' | 'counterattack' | 'wing-play' | 'high-press';
  mentality: TacticMentality;
  marking: 'zonal' | 'mixed' | 'man-to-man';
  pressing: PressingInstruction;
  confidence: number;
  sectors: CompetitionTacticalSectors;
  dangerousPlayers: CompetitionDangerousPlayer[];
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export interface CompetitionClubFinances {
  balance: number;
  transferBudget: number | null;
  wageBudget: number | null;
  weeklyPayroll: number;
  squadValue: number;
  annualRevenue: number | null;
}

export interface CompetitionClubVisibility {
  squad: boolean;
  contracts: boolean;
  finances: boolean;
  tactics: boolean;
  weaknesses: boolean;
}

export interface CompetitionClubDetail {
  identity: CompetitionClubIdentity;
  isManagerClub: boolean;
  currentSeason: number;
  competitionName: string;
  position: number | null;
  baseKnowledge: boolean;
  scoutLevel: number;
  visibility: CompetitionClubVisibility;
  finances: CompetitionClubFinances;
  squad: CompetitionClubSquadMember[];
  recentMatches: CompetitionClubMatch[];
  upcomingMatches: CompetitionClubMatch[];
  tacticalIntel: CompetitionTacticalIntel | null;
}

export interface CompetitionClubSource {
  id: string;
  name: string;
  code?: string | null;
  abbreviation?: string | null;
  color?: string | null;
  colors?: string[] | null;
  darkThemeColor?: string | null;
  lightThemeColor?: string | null;
  crestImageUrl?: string | null;
  country?: string | null;
  division?: string | null;
  reputation?: number | null;
  stars?: number | null;
  stadium?: string | null;
  stadiumCapacity?: number | null;
  capacity?: number | null;
  city?: string | null;
  budget?: number | string | null;
}

export interface LoadCompetitionClubDetailInput {
  club: CompetitionClubSource;
  managerClubId: string | null;
  currentSeason: number;
  competitionName: string;
  position: number | null;
  fixtures: CompetitionClubMatch[];
  players: Player[];
  tacticalIntel?: CompetitionTacticalIntel | null;
}

interface ClubPresentation {
  id: string;
  name: string;
  code: string;
  crestImageUrl: string | null;
}

interface MatchRecord {
  match: CompetitionClubMatch;
  aliases: Set<string>;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizedText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizedKey(value: unknown) {
  return normalizedText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function compactCode(name: string) {
  const words = normalizedText(name).split(/\s+/).filter(Boolean);
  const initials = words.map((word) => word[0]).join('');
  return (initials.length >= 2 ? initials : name.slice(0, 3)).toUpperCase().slice(0, 3);
}

function numericBudget(value: number | string | null | undefined, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  const unit = normalized.includes('bi') ? 1_000_000_000
    : normalized.includes('mi') ? 1_000_000
      : normalized.includes('mil') ? 1_000
        : 1;
  const parsed = Number(normalized
    .replace(/r\$/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * unit)) : fallback;
}

function normalizeIdentity(club: CompetitionClubSource): CompetitionClubIdentity {
  const id = normalizedText(club?.id);
  const name = normalizedText(club?.name);
  if (!id || !name) throw new TypeError('Clube inválido: id e nome são obrigatórios.');

  const stars = Number.isFinite(club.stars) ? Number(club.stars) : null;
  const fallbackReputation = stars === null ? 0 : Math.round(stars * 20);
  const suppliedReputation = typeof club.reputation === 'number' ? club.reputation : Number.NaN;
  const reputation = clamp(
    Math.round(Number.isFinite(suppliedReputation) ? suppliedReputation : fallbackReputation),
    0,
    100,
  );
  const capacitySource = club.capacity ?? club.stadiumCapacity;
  const suppliedCapacity = typeof capacitySource === 'number' ? capacitySource : Number.NaN;

  return {
    id,
    name,
    code: normalizedText(club.code ?? club.abbreviation) || compactCode(name),
    color: normalizedText(club.color ?? club.colors?.[0]) || '#7fb800',
    darkThemeColor: normalizedText(club.darkThemeColor) || null,
    lightThemeColor: normalizedText(club.lightThemeColor) || null,
    crestImageUrl: normalizedText(club.crestImageUrl) || null,
    country: normalizedText(club.country) || 'País não informado',
    division: normalizedText(club.division) || 'Divisão não informada',
    reputation,
    stadium: normalizedText(club.stadium) || 'Estádio não informado',
    capacity: Number.isFinite(suppliedCapacity)
      ? clamp(Math.round(suppliedCapacity), 0, 150_000)
      : 0,
    city: normalizedText(club.city) || 'Cidade não informada',
    budget: numericBudget(club.budget, 0),
  };
}

function aliasesFor(kind: string, value: unknown) {
  const normalized = normalizedKey(value);
  return normalized ? `${kind}:${normalized}` : null;
}

function scoreTuple(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const home = Number(value[0]);
  const away = Number(value[1]);
  return Number.isFinite(home) && Number.isFinite(away)
    ? [Math.max(0, Math.round(home)), Math.max(0, Math.round(away))]
    : null;
}

function buildClubDirectory(room: Room) {
  const directory = new Map<string, ClubPresentation>();
  const put = (club: ClubPresentation) => {
    const aliases = [club.id, club.code, club.name].map(normalizedKey).filter(Boolean);
    const previous = aliases.map((alias) => directory.get(alias)).find(Boolean);
    const presentation = {
      id: previous?.id || club.id,
      name: previous?.name || club.name || club.id,
      code: previous?.code || club.code || compactCode(club.name || club.id),
      crestImageUrl: previous?.crestImageUrl || club.crestImageUrl || null,
    };
    [...aliases, presentation.id, presentation.code, presentation.name]
      .map(normalizedKey)
      .filter(Boolean)
      .forEach((alias) => directory.set(alias, presentation));
  };

  room.competitionCatalog?.forEach((league) => league.clubs.forEach((club) => put({
    id: club.id,
    name: club.name,
    code: club.code,
    crestImageUrl: club.crestImageUrl,
  })));
  room.tournamentCatalog?.forEach((tournament) => tournament.participants.forEach((club) => put({
    id: club.id,
    name: club.name,
    code: club.abbreviation,
    crestImageUrl: club.crestImageUrl,
  })));
  room.fixtureSchedule?.forEach((fixture) => {
    put({
      id: fixture.homeClubId,
      name: fixture.homeTeam,
      code: fixture.homeCode || compactCode(fixture.homeTeam),
      crestImageUrl: fixture.homeCrestImageUrl || null,
    });
    put({
      id: fixture.awayClubId,
      name: fixture.awayTeam,
      code: fixture.awayCode || compactCode(fixture.awayTeam),
      crestImageUrl: fixture.awayCrestImageUrl || null,
    });
  });
  return directory;
}

function presentationFor(directory: Map<string, ClubPresentation>, clubId: string) {
  return directory.get(normalizedKey(clubId)) ?? {
    id: clubId,
    name: clubId,
    code: compactCode(clubId),
    crestImageUrl: null,
  };
}

function dateValue(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildCompetitionClubMatches(
  room: Room | null,
  clubId: string,
  competitionId?: string | null,
): CompetitionClubMatch[] {
  if (!room || !normalizedText(clubId)) return [];

  const directory = buildClubDirectory(room);
  const selectedPresentation = presentationFor(directory, clubId);
  const selectedClubAliases = new Set([
    clubId,
    selectedPresentation.id,
    selectedPresentation.code,
    selectedPresentation.name,
  ].map(normalizedKey).filter(Boolean));
  const normalizedCompetitionId = normalizedKey(competitionId);
  const records = new Set<MatchRecord>();
  const recordsByAlias = new Map<string, MatchRecord>();
  const competitionNames = new Map<string, string>();

  room.competitionSeason?.competitions.forEach((competition) => {
    competitionNames.set(competition.id, competition.name);
    if (competition.fixtures[0]?.tournamentId) {
      competitionNames.set(competition.fixtures[0].tournamentId, competition.name);
    }
  });

  const includesCompetition = (...values: unknown[]) => (
    !normalizedCompetitionId || values.some((value) => normalizedKey(value) === normalizedCompetitionId)
  );

  const mergeMatch = (current: CompetitionClubMatch, incoming: CompetitionClubMatch): CompetitionClubMatch => ({
    ...current,
    round: current.round || incoming.round,
    scheduledAt: current.scheduledAt || incoming.scheduledAt,
    homeName: current.homeName === current.homeClubId ? incoming.homeName : current.homeName,
    awayName: current.awayName === current.awayClubId ? incoming.awayName : current.awayName,
    homeCode: current.homeCode || incoming.homeCode,
    awayCode: current.awayCode || incoming.awayCode,
    homeCrestImageUrl: current.homeCrestImageUrl || incoming.homeCrestImageUrl,
    awayCrestImageUrl: current.awayCrestImageUrl || incoming.awayCrestImageUrl,
    score: incoming.score || current.score,
    completed: current.completed || incoming.completed,
    competitionName: current.competitionName || incoming.competitionName,
  });

  const upsert = (match: CompetitionClubMatch, aliases: Array<string | null>) => {
    const concreteAliases = aliases.filter((alias): alias is string => Boolean(alias));
    const existing = concreteAliases.map((alias) => recordsByAlias.get(alias)).find(Boolean);
    const record = existing ?? { match, aliases: new Set<string>() };
    record.match = existing ? mergeMatch(record.match, match) : match;
    records.add(record);
    concreteAliases.forEach((alias) => {
      record.aliases.add(alias);
      recordsByAlias.set(alias, record);
    });
    return record;
  };

  room.fixtureSchedule?.forEach((fixture) => {
    if (!includesCompetition(fixture.leagueId, fixture.tournamentId, fixture.competition)) return;
    const home = presentationFor(directory, fixture.homeClubId);
    const away = presentationFor(directory, fixture.awayClubId);
    upsert({
      id: fixture.fixtureId,
      round: fixture.round,
      scheduledAt: normalizedText(fixture.scheduledAt) || null,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      homeName: fixture.homeTeam || home.name,
      awayName: fixture.awayTeam || away.name,
      homeCode: fixture.homeCode || home.code,
      awayCode: fixture.awayCode || away.code,
      homeCrestImageUrl: fixture.homeCrestImageUrl || home.crestImageUrl,
      awayCrestImageUrl: fixture.awayCrestImageUrl || away.crestImageUrl,
      score: null,
      completed: false,
      competitionName: fixture.competition,
    }, [
      aliasesFor('fixture', fixture.fixtureId),
      aliasesFor('league', fixture.leagueFixtureId),
      aliasesFor('competition', fixture.competitionFixtureId),
    ]);
  });

  room.leagueFixtureSchedule?.forEach((fixture) => {
    if (!includesCompetition(fixture.leagueId)) return;
    const home = presentationFor(directory, fixture.homeClubId);
    const away = presentationFor(directory, fixture.awayClubId);
    const leagueName = room.competitionCatalog?.find((league) => league.id === fixture.leagueId)?.name;
    upsert({
      id: fixture.leagueFixtureId,
      round: fixture.round,
      scheduledAt: normalizedText(fixture.scheduledAt) || null,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      homeName: home.name,
      awayName: away.name,
      homeCode: home.code,
      awayCode: away.code,
      homeCrestImageUrl: home.crestImageUrl,
      awayCrestImageUrl: away.crestImageUrl,
      score: null,
      completed: false,
      competitionName: leagueName || 'Liga',
    }, [aliasesFor('league', fixture.leagueFixtureId)]);
  });

  const competitionFixtures = [
    ...(room.competitionSeason?.fixtures ?? []),
    ...(room.competitionSeason?.competitions.flatMap((competition) => competition.fixtures) ?? []),
  ];
  competitionFixtures.forEach((fixture) => {
    if (!includesCompetition(fixture.competitionId, fixture.tournamentId)) return;
    const home = presentationFor(directory, fixture.homeClubId);
    const away = presentationFor(directory, fixture.awayClubId);
    const competitionName = competitionNames.get(fixture.competitionId)
      || competitionNames.get(fixture.tournamentId)
      || room.tournamentCatalog?.find((tournament) => tournament.id === fixture.tournamentId)?.name
      || 'Competição';
    upsert({
      id: fixture.id,
      round: fixture.calendarRound || fixture.round,
      scheduledAt: normalizedText(fixture.scheduledAt) || null,
      homeClubId: fixture.homeClubId,
      awayClubId: fixture.awayClubId,
      homeName: home.name,
      awayName: away.name,
      homeCode: home.code,
      awayCode: away.code,
      homeCrestImageUrl: home.crestImageUrl,
      awayCrestImageUrl: away.crestImageUrl,
      score: scoreTuple(fixture.result?.score),
      completed: fixture.status === 'completed',
      competitionName,
    }, [
      aliasesFor('fixture', fixture.id),
      aliasesFor('competition', fixture.competitionFixtureId),
    ]);
  });

  room.leagueMatchResults?.forEach((result) => {
    const alias = aliasesFor('league', result.leagueFixtureId);
    const existing = alias ? recordsByAlias.get(alias) : undefined;
    if (!existing) return;
    upsert({
      ...existing.match,
      score: scoreTuple(result.score),
      completed: true,
    }, [alias]);
  });

  const idsByName = new Map<string, string>();
  directory.forEach((club) => idsByName.set(normalizedKey(club.name), club.id));
  room.completedMatches?.forEach((completedMatch) => {
    if (completedMatch.cancelled) return;
    const aliases = [
      aliasesFor('fixture', completedMatch.fixtureId),
      aliasesFor('fixture', completedMatch.id),
    ];
    const existing = aliases.map((alias) => alias ? recordsByAlias.get(alias) : undefined).find(Boolean);
    if (existing) {
      upsert({
        ...existing.match,
        scheduledAt: existing.match.scheduledAt || normalizedText(completedMatch.completedAt) || null,
        score: scoreTuple(completedMatch.score),
        completed: true,
      }, aliases);
      return;
    }
    if (normalizedCompetitionId) return;

    const homeClubId = idsByName.get(normalizedKey(completedMatch.homeTeam));
    const awayClubId = idsByName.get(normalizedKey(completedMatch.awayTeam));
    if (!homeClubId || !awayClubId) return;
    const home = presentationFor(directory, homeClubId);
    const away = presentationFor(directory, awayClubId);
    upsert({
      id: completedMatch.fixtureId || completedMatch.id,
      round: completedMatch.roundSummary?.round ?? 0,
      scheduledAt: normalizedText(completedMatch.completedAt) || null,
      homeClubId,
      awayClubId,
      homeName: completedMatch.homeTeam,
      awayName: completedMatch.awayTeam,
      homeCode: home.code,
      awayCode: away.code,
      homeCrestImageUrl: home.crestImageUrl,
      awayCrestImageUrl: away.crestImageUrl,
      score: scoreTuple(completedMatch.score),
      completed: true,
      competitionName: 'Competição',
    }, aliases);
  });

  return [...records]
    .map((record) => record.match)
    .filter((match) => [
      match.homeClubId,
      match.awayClubId,
      match.homeCode,
      match.awayCode,
      match.homeName,
      match.awayName,
    ].some((value) => selectedClubAliases.has(normalizedKey(value))))
    .sort((left, right) => {
      const byDate = dateValue(left.scheduledAt, Number.MAX_SAFE_INTEGER)
        - dateValue(right.scheduledAt, Number.MAX_SAFE_INTEGER);
      if (byDate !== 0) return byDate;
      if (left.round !== right.round) return left.round - right.round;
      return left.id.localeCompare(right.id);
    });
}

function squadMembersFromPlayers(players: Player[], currentSeason: number) {
  return players.map((player): CompetitionClubSquadMember => ({
    player,
    squadStatus: 'unknown',
    negotiability: 'unknown',
    loanAvailable: null,
    contractSeasonsRemaining: player.contract?.endSeason !== null
      && player.contract?.endSeason !== undefined
      ? Math.max(0, Number(player.contract.endSeason) - currentSeason)
      : null,
  }));
}

export async function loadCompetitionClubDetail(
  input: LoadCompetitionClubDetailInput,
): Promise<CompetitionClubDetail> {
  const identity = normalizeIdentity(input.club);
  const currentSeason = clamp(Math.round(Number(input.currentSeason) || 1), 1, 10_000);
  const providedPlayers = Array.isArray(input.players)
    ? input.players.filter((player) => player && typeof player.id === 'string')
    : [];
  const squad = squadMembersFromPlayers(providedPlayers, currentSeason);
  const tacticalIntel = input.tacticalIntel ?? null;
  const isManagerClub = normalizedKey(input.managerClubId) === normalizedKey(identity.id);
  const fixtures = Array.isArray(input.fixtures)
    ? input.fixtures.filter((fixture) => fixture.homeClubId === identity.id || fixture.awayClubId === identity.id)
    : [];
  const baseKnowledge = isManagerClub || fixtures.some((fixture) => (
    fixture.homeClubId === input.managerClubId || fixture.awayClubId === input.managerClubId
  ));
  const scoutLevel = tacticalIntel
    ? clamp(Math.ceil(tacticalIntel.confidence / 20), 1, 5)
    : 0;
  const squadValue = squad.reduce((total, member) => total + member.player.value, 0);
  const weeklyPayroll = squad.reduce((total, member) => total + member.player.wage, 0);
  const balance = identity.budget;
  const finances: CompetitionClubFinances = {
    balance,
    transferBudget: null,
    wageBudget: null,
    weeklyPayroll,
    squadValue,
    annualRevenue: null,
  };
  const recentMatches = fixtures
    .filter((fixture) => fixture.completed)
    .sort((left, right) => (
      dateValue(right.scheduledAt, 0) - dateValue(left.scheduledAt, 0)
      || right.round - left.round
    ))
    .slice(0, 5);
  const upcomingMatches = fixtures
    .filter((fixture) => !fixture.completed)
    .sort((left, right) => (
      dateValue(left.scheduledAt, Number.MAX_SAFE_INTEGER) - dateValue(right.scheduledAt, Number.MAX_SAFE_INTEGER)
      || left.round - right.round
    ))
    .slice(0, 5);

  return {
    identity,
    isManagerClub,
    currentSeason,
    competitionName: normalizedText(input.competitionName) || 'Competição',
    position: Number.isFinite(input.position) && Number(input.position) > 0
      ? Math.round(Number(input.position))
      : null,
    baseKnowledge,
    scoutLevel,
    visibility: {
      squad: squad.length > 0,
      contracts: squad.some((member) => member.player.contract != null),
      finances: isManagerClub,
      tactics: tacticalIntel != null,
      weaknesses: Boolean(tacticalIntel?.weaknesses.length),
    },
    finances,
    squad,
    recentMatches,
    upcomingMatches,
    tacticalIntel,
  };
}
