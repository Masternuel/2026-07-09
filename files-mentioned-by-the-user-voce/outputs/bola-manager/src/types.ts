import type { Socket } from 'socket.io-client';

export type AppStage = 'entry' | 'lobby' | 'editor' | 'game';

export type EditorEntity = 'leagues' | 'clubs' | 'players' | 'tournaments';

export type TournamentFormat = 'league' | 'knockout' | 'groups_knockout';
export type TournamentLegs = 'single' | 'double';
export type TournamentTiebreaker =
  | 'goal_difference'
  | 'goals_scored'
  | 'wins'
  | 'head_to_head'
  | 'fair_play'
  | 'away_goals'
  | 'extra_time'
  | 'penalties'
  | 'drawing_lots';

export interface EditorLeague {
  id: string;
  name: string;
  country: string;
  level: number;
  division: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorClub {
  id: string;
  name: string;
  abbreviation: string;
  colors: string[];
  stadium: string;
  reputation: number;
  division: string;
  country: string;
  state: string | null;
  city: string | null;
  leagueId: string | null;
  budget: number;
  crestImageUrl: string | null;
  crestImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorPlayerAttributes {
  velocidade: number;
  chute: number;
  drible: number;
  nocao: number;
  defesa: number;
  passe: number;
  peBom: number;
  peRuim: number;
}

export interface EditorPlayer {
  id: string;
  clubId: string;
  name: string;
  isStar: boolean;
  position: PlayerPosition;
  age: number;
  nationality: string;
  shirtNumber: number;
  overall: number;
  attributes: EditorPlayerAttributes;
  avatarImageUrl: string | null;
  avatarImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface EditorTournament {
  id: string;
  name: string;
  format: TournamentFormat;
  teamCount: number;
  legs: TournamentLegs;
  tiebreakers: TournamentTiebreaker[];
  teamIds: string[];
  trophyImageUrl: string | null;
  trophyImagePath: string | null;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type EditorRecord = EditorLeague | EditorClub | EditorPlayer | EditorTournament;

export interface EditorCatalog {
  leagues: EditorLeague[];
  clubs: EditorClub[];
  players: EditorPlayer[];
  tournaments: EditorTournament[];
}

export interface EditorCatalogCounts {
  leagues: number;
  clubs: number;
  players: number;
  tournaments: number;
}

export type RouteKey =
  | 'home'
  | 'squad'
  | 'tactics'
  | 'calendar'
  | 'competitions'
  | 'market'
  | 'finance'
  | 'stadium'
  | 'rankings'
  | 'news'
  | 'staff'
  | 'reports'
  | 'match'
  | 'press-conference'
  | 'settings';

export type PlayerPosition = 'GOL' | 'ZAG' | 'LD' | 'LE' | 'VOL' | 'MC' | 'MEI' | 'PD' | 'PE' | 'ATA';
export type PlayerStatus = 'Disponível' | 'Lesionado' | 'Suspenso' | 'Cansado';
export type Morale = 'Excelente' | 'Boa' | 'Neutra' | 'Baixa';

export type AttributeKey = 'velocidade' | 'chute' | 'drible' | 'nocao' | 'defesa' | 'passe' | 'peBom' | 'peRuim';

export interface Player {
  id: string;
  name: string;
  shortName: string;
  isStar: boolean;
  number: number;
  position: PlayerPosition;
  role: string;
  age: number;
  nationality: string;
  value: number;
  wage: number;
  condition: number;
  morale: Morale;
  status: PlayerStatus;
  foot: 'Direito' | 'Esquerdo';
  personality: string;
  worldStar: number;
  attributes: Record<AttributeKey, number>;
  avatarImageUrl?: string | null;
}

export interface StarImpactPlayer {
  id: string;
  name: string;
}

export interface StarImpactProfile {
  clubId: string;
  catalogPlayerCount: number;
  starCount: number;
  starPlayers: StarImpactPlayer[];
  matchStrengthBonus: number;
  sponsorBoostPercent: number;
  sponsorAnnualBonus: number;
  source?: string;
}

export interface LeagueTeam {
  position: number;
  name: string;
  code: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalDifference: number;
  points: number;
  form: Array<'V' | 'E' | 'D'>;
  accent: string;
}

export type MatchEventKind = 'info' | 'chance' | 'goal-home' | 'goal-away' | 'card' | 'sub' | 'whistle' | 'injury';

export interface MatchEvent {
  minute: number;
  kind: MatchEventKind;
  text: string;
  score?: [number, number];
}

export interface FormationSlot {
  id: string;
  role: PlayerPosition;
  x: number;
  y: number;
}

export interface Formation {
  id: string;
  name: string;
  description: string;
  slots: FormationSlot[];
}

export interface NewsItem {
  id: string;
  source: string;
  sourceType: 'imprensa' | 'clube' | 'jogador' | 'torcida';
  time: string;
  headline: string;
  body: string;
  reactions: number;
  tag: string;
}

export type NewsEditorialSourceType = NewsItem['sourceType'];
export type NewsSourceType = NewsEditorialSourceType | 'manager';
export type NewsAiRole = 'torcida' | 'imprensa' | 'jogador' | 'clube' | 'manager';
export type NewsAiSentiment = 'positivo' | 'neutro' | 'critico';

export interface NewsAiCommentDto {
  id?: string;
  author?: string;
  role?: string;
  text?: string;
  sentiment?: string;
  parentCommentId?: string | null;
  createdAt?: string | null;
}

export interface NewsAiComment {
  id: string;
  author: string;
  role: NewsAiRole;
  text: string;
  sentiment: NewsAiSentiment;
  parentCommentId: string | null;
  createdAt: string | null;
}

export interface NewsPostDto {
  id?: string;
  roomCode?: string;
  editorialKey?: string | null;
  authorId?: string;
  authorName?: string;
  clubId?: string | null;
  source?: string;
  sourceType?: string;
  time?: string;
  createdAt?: string;
  headline?: string;
  body?: string;
  reactions?: number;
  tag?: string;
  comments?: NewsAiCommentDto[];
}

export interface NewsPost {
  id: string;
  roomCode: string | null;
  editorialKey: string | null;
  authorId: string | null;
  authorName: string | null;
  clubId: string | null;
  source: string;
  sourceType: NewsSourceType;
  time: string;
  createdAt: string | null;
  headline: string;
  body: string;
  reactions: number;
  tag: string;
  comments: NewsAiComment[];
}

export interface NewsAiReplyDto {
  postId?: string;
  comments?: NewsAiCommentDto[];
}

export interface NewsAiRequestPost {
  id: string;
  source: string;
  sourceType: NewsEditorialSourceType;
  headline: string;
  body: string;
  tag?: string;
  reactions?: number;
}

export interface NewsFeedApiResponse {
  posts?: NewsPostDto[];
  source?: string;
}

export interface NewsAiApiResponse {
  teamComment?: NewsAiCommentDto | null;
  replies?: NewsAiReplyDto[];
  posts?: NewsPostDto[];
}

export interface NewsPublishApiResponse {
  post?: NewsPostDto;
  generatedPost?: NewsPostDto | null;
  teamComment?: NewsAiCommentDto | null;
}

export interface NewsCommentReplyApiResponse {
  post?: NewsPostDto;
  comments?: NewsAiCommentDto[];
  generatedPost?: NewsPostDto | null;
}

export type AuthMode = 'firebase' | 'demo';
export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

export interface ManagerIdentity {
  uid: string;
  displayName: string;
  email: string | null;
  photoURL: string | null;
  mode: AuthMode;
}

export interface ClubChoice {
  id: string;
  name: string;
  code: string;
  city: string;
  stars: number;
  budget: string;
  color: string;
  crestImageUrl?: string | null;
}

export interface TournamentParticipant {
  id: string;
  name: string;
  abbreviation: string;
  colors: string[];
  country: string | null;
  division: string | null;
  crestImageUrl: string | null;
  crestImagePath: string | null;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  teamCount: number;
  legs: TournamentLegs;
  tiebreakers: TournamentTiebreaker[];
  teamIds: string[];
  trophyImageUrl: string | null;
  trophyImagePath: string | null;
  active: boolean;
  participants: TournamentParticipant[];
}

export interface RoomManager {
  id: string;
  name: string;
  clubId: string | null;
  ready: boolean;
  joinedAt: string;
}

export interface RoomFixture {
  fixtureId: string;
  round: number;
  competition: string;
  homeClubId: string;
  awayClubId: string;
  homeTeam: string;
  awayTeam: string;
  homeManagerId: string | null;
  awayManagerId: string | null;
  managerIds: string[];
}

export interface MatchReadiness {
  fixtureId: string | null;
  managerIds: string[];
}

export interface RoomLineup {
  managerId: string;
  clubId: string;
  lineupIds: string[];
  updatedAt: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'waiting' | 'active';
  activeLeagues: string[];
  seasonLength: number;
  unlimitedSeasons: boolean;
  currentSeason: number;
  seasonYear: number;
  seasonStartedAt: string | null;
  seasonHistory: unknown[];
  careerCompleted: boolean;
  maxManagers: number;
  createdAt: string;
  updatedAt?: string;
  startedAt: string | null;
  revision: number;
  version?: number;
  currentFixtureId?: string | null;
  scheduleVersion?: number;
  fixtureSchedule?: RoomFixture[];
  matchReadiness?: MatchReadiness;
  lineups?: RoomLineup[];
  completedFixtureIds?: string[];
  completedMatches?: ServerMatchFinished[];
  lastCompletedMatch?: ServerMatchFinished | null;
  managers: RoomManager[];
}

export interface ServerErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type AckResponse<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; error: ServerErrorPayload };

export interface RoomCreatePayload {
  name: string;
  clubId?: string;
  activeLeagues?: string[];
  seasonLength?: number;
  unlimitedSeasons?: boolean;
  maxManagers?: number;
}

export interface MatchSideStatistics {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  corners: number;
}

export interface MatchStatistics {
  home: MatchSideStatistics;
  away: MatchSideStatistics;
}

export type ServerMatchEventType =
  | 'kickoff'
  | 'attack'
  | 'goal'
  | 'save'
  | 'foul'
  | 'corner'
  | 'yellow-card'
  | 'red-card'
  | 'halftime'
  | 'post'
  | 'injury'
  | 'substitution'
  | 'penalty'
  | 'var'
  | 'fulltime';

export interface ServerMatchEvent {
  code: string;
  matchId: string;
  fixtureId: string;
  id: string;
  minute: number;
  type: ServerMatchEventType;
  text: string;
  score: [number, number];
  statistics: MatchStatistics;
  team?: string;
  scorer?: string;
  assist?: string | null;
  skipped: boolean;
}

export interface ServerMatchStarted {
  code: string;
  id: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  eventCount: number;
  delayMs: number;
}

export type ServerMatchResultEvent = Omit<ServerMatchEvent, 'code' | 'matchId' | 'fixtureId' | 'skipped'>;

export interface ServerMatchFinished {
  code: string;
  id: string;
  fixtureId?: string;
  homeTeam: string;
  awayTeam: string;
  score: [number, number];
  statistics: MatchStatistics;
  events?: ServerMatchResultEvent[];
  skipped: boolean;
  cancelled?: boolean;
  emittedEvents?: number;
  completedAt?: string;
  roomRevision?: number;
  nextFixtureId?: string | null;
}

export interface MatchSyncResponse {
  source: 'live' | 'persisted' | 'idle';
  started: ServerMatchStarted | null;
  events: ServerMatchEvent[];
  result: ServerMatchFinished | null;
}

export interface MatchReadyResponse {
  room: Room;
  started: boolean;
  matchId?: string;
  readyCount: number;
  requiredCount: number;
  allReady: boolean;
}

export interface LineupSaveResponse {
  room: Room;
  lineup: RoomLineup;
  source: string;
}

export interface ServerToClientEvents {
  'server:ready': (payload: { socketId: string }) => void;
  'server:error': (payload: { event: string; error: ServerErrorPayload }) => void;
  'room:state': (room: Room) => void;
  'room:started': (room: Room) => void;
  'room:deleted': (payload: { code: string }) => void;
  'match:started': (match: ServerMatchStarted) => void;
  'match:event': (event: ServerMatchEvent) => void;
  'match:finished': (result: ServerMatchFinished) => void;
  'match:skipped': (payload: { code: string }) => void;
  'news:post': (post: NewsPostDto) => void;
}

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:join': (payload: { code: string; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:ready': (payload: { code: string; ready: boolean; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:start': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:delete': (payload: { code: string }, acknowledge: (response: AckResponse<{ code: string }>) => void) => void;
  'room:resume': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:sync': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'match:ready': (payload: { code: string; fixtureId?: string; ready: boolean }, acknowledge: (response: AckResponse<MatchReadyResponse>) => void) => void;
  'match:start': (payload: { code: string; fixtureId?: string }, acknowledge: (response: AckResponse<{ matchId: string }>) => void) => void;
  'match:skip': (payload: { code: string }, acknowledge: (response: AckResponse<{ skipped: boolean }>) => void) => void;
  'match:sync': (payload: { code: string }, acknowledge: (response: AckResponse<MatchSyncResponse>) => void) => void;
  'lineup:save': (payload: { code: string; lineupIds: string[] }, acknowledge: (response: AckResponse<LineupSaveResponse>) => void) => void;
}

export type BolaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
