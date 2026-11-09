import type { AuthMode, ManagerIdentity, Room } from '../../types';

export type MainMenuPageId = 'career' | 'new-game' | 'continue' | 'multiplayer' | 'editor' | 'settings' | 'profile' | 'history' | 'credits';

export const mainMenuPages: ReadonlyArray<{ id: MainMenuPageId; label: string; group: 'play' | 'personal' | 'about' }> = [
  { id: 'career', label: 'Carreira', group: 'play' },
  { id: 'new-game', label: 'Novo Jogo', group: 'play' },
  { id: 'continue', label: 'Continuar', group: 'play' },
  { id: 'multiplayer', label: 'Multiplayer', group: 'play' },
  { id: 'editor', label: 'Editor', group: 'play' },
  { id: 'settings', label: 'Configurações', group: 'personal' },
  { id: 'profile', label: 'Perfil', group: 'personal' },
  { id: 'history', label: 'Estatísticas / histórico', group: 'personal' },
  { id: 'credits', label: 'Créditos', group: 'about' },
];

export function getMenuCapabilities(mode: AuthMode) {
  return {
    canCreate: mode !== 'peer',
    canResume: mode !== 'peer',
    canEdit: mode === 'firebase' || mode === 'local',
    webRooms: mode === 'firebase',
    desktopPeer: mode === 'local' || mode === 'peer',
    desktop: mode === 'local' || mode === 'peer',
    modeLabel: mode === 'firebase' ? 'Conta Firebase' : mode === 'local' ? 'Perfil local' : mode === 'peer' ? 'Convidado P2P' : 'Demonstração',
    storageLabel: mode === 'firebase' ? 'Saves na sua conta' : mode === 'local' ? 'Saves neste computador' : mode === 'peer' ? 'Save no anfitrião' : 'Sessão de demonstração',
  };
}

/** A malformed update date must not mask a valid creation date. */
export function roomTimestamp(room: Pick<Room, 'updatedAt' | 'createdAt'>): number | null {
  for (const candidate of [room.updatedAt, room.createdAt]) {
    if (!candidate) continue;
    const value = Date.parse(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function formatSaveDate(room: Pick<Room, 'updatedAt' | 'createdAt'>): string {
  const timestamp = roomTimestamp(room);
  return timestamp === null ? 'Data não informada' : dateFormatter.format(timestamp);
}

export function canResumeSave(room: Room, identity: ManagerIdentity): boolean {
  return getMenuCapabilities(identity.mode).canResume && (
    room.ownerId === identity.uid || room.managers.some((manager) => manager.id === identity.uid)
  );
}

export function sortAuthorizedSaves(saves: ReadonlyArray<Room>, identity: ManagerIdentity): Room[] {
  return saves.filter((room) => canResumeSave(room, identity)).sort((left, right) => (
    (roomTimestamp(right) ?? Number.NEGATIVE_INFINITY) - (roomTimestamp(left) ?? Number.NEGATIVE_INFINITY)
  ));
}

export function latestAuthorizedSave(saves: ReadonlyArray<Room>, identity: ManagerIdentity): Room | null {
  return sortAuthorizedSaves(saves, identity)[0] ?? null;
}

function metadataCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Saved-room lists contain metadata, not complete results or achievement history. */
export function saveMetadata(room: Room) {
  return {
    status: room.careerCompleted ? 'completed' as const : room.status === 'active' ? 'active' as const : 'waiting' as const,
    statusLabel: room.careerCompleted ? 'Concluída' : room.status === 'active' ? 'Em andamento' : 'Em preparação',
    season: typeof room.currentSeason === 'number' && room.currentSeason > 0 ? room.currentSeason : null,
    year: typeof room.seasonYear === 'number' && room.seasonYear > 0 ? room.seasonYear : null,
    completedFixtures: metadataCount(room.completedFixtureCount),
    completedMatches: metadataCount(room.completedMatchCount),
    seasonHistory: metadataCount(room.seasonHistoryCount),
  };
}

export interface SaveCountSummary { total: number; knownSaves: number; missingSaves: number }

export function summarizeSaves(saves: ReadonlyArray<Room>) {
  const metadata = saves.map(saveMetadata);
  const aggregate = (key: 'completedFixtures' | 'completedMatches' | 'seasonHistory'): SaveCountSummary => {
    const values = metadata.map((save) => save[key]).filter((value): value is number => value !== null);
    return { total: values.reduce((total, value) => total + value, 0), knownSaves: values.length, missingSaves: saves.length - values.length };
  };
  return {
    saves: saves.length,
    active: metadata.filter((save) => save.status === 'active').length,
    waiting: metadata.filter((save) => save.status === 'waiting').length,
    completed: metadata.filter((save) => save.status === 'completed').length,
    completedFixtures: aggregate('completedFixtures'),
    completedMatches: aggregate('completedMatches'),
    seasonHistory: aggregate('seasonHistory'),
  };
}

export function formatMetadataCount(value: number | null): string {
  return value === null ? 'Não informado' : value.toLocaleString('pt-BR');
}
