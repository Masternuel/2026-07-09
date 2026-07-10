import type { Socket } from 'socket.io-client';

export type AppStage = 'entry' | 'lobby' | 'game';

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
  | 'settings';

export type PlayerPosition = 'GOL' | 'ZAG' | 'LD' | 'LE' | 'VOL' | 'MC' | 'MEI' | 'PD' | 'PE' | 'ATA';
export type PlayerStatus = 'Disponível' | 'Lesionado' | 'Suspenso' | 'Cansado';
export type Morale = 'Excelente' | 'Boa' | 'Neutra' | 'Baixa';

export type AttributeKey = 'velocidade' | 'chute' | 'drible' | 'nocao' | 'defesa' | 'passe' | 'peBom' | 'peRuim';

export interface Player {
  id: string;
  name: string;
  shortName: string;
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
  name: string;
  code: string;
  city: string;
  stars: number;
  budget: string;
  color: string;
}

export interface RoomManager {
  id: string;
  name: string;
  clubId: string | null;
  ready: boolean;
  joinedAt: string;
}

export interface Room {
  id: string;
  code: string;
  name: string;
  ownerId: string;
  status: 'waiting' | 'active';
  activeLeagues: string[];
  seasonLength: number;
  maxManagers: number;
  createdAt: string;
  updatedAt?: string;
  startedAt: string | null;
  revision: number;
  version?: number;
  currentFixtureId?: string | null;
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
  id: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  eventCount: number;
  delayMs: number;
}

export type ServerMatchResultEvent = Omit<ServerMatchEvent, 'matchId' | 'fixtureId' | 'skipped'>;

export interface ServerMatchFinished {
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

export interface ServerToClientEvents {
  'server:ready': (payload: { socketId: string }) => void;
  'server:error': (payload: { event: string; error: ServerErrorPayload }) => void;
  'room:state': (room: Room) => void;
  'room:started': (room: Room) => void;
  'match:started': (match: ServerMatchStarted) => void;
  'match:event': (event: ServerMatchEvent) => void;
  'match:finished': (result: ServerMatchFinished) => void;
  'match:skipped': (payload: { code: string }) => void;
}

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:join': (payload: { code: string; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:ready': (payload: { code: string; ready: boolean; clubId?: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:start': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:resume': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'room:sync': (payload: { code: string }, acknowledge: (response: AckResponse<{ room: Room }>) => void) => void;
  'match:start': (payload: { code: string; fixtureId?: string }, acknowledge: (response: AckResponse<{ matchId: string }>) => void) => void;
  'match:skip': (payload: { code: string }, acknowledge: (response: AckResponse<{ skipped: boolean }>) => void) => void;
  'match:sync': (payload: { code: string }, acknowledge: (response: AckResponse<MatchSyncResponse>) => void) => void;
}

export type BolaSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
