import type { ManagerIdentity } from '../types';

export interface DesktopPeerStatus {
  mode: 'offline' | 'host' | 'guest';
  connected: boolean;
  roomCode: string | null;
  peers: number;
  pendingInvites: number;
  transport: 'direct-webrtc';
}

export type DesktopCatalogCounts = Record<'leagues' | 'clubs' | 'players' | 'tournaments', number>;

export interface DesktopCatalogStatus {
  counts: DesktopCatalogCounts;
  source: 'local-starter' | 'local-import';
  importedAt: string | null;
  preservedCareers: number;
}

export interface DesktopCatalogPreview {
  id: string;
  counts: DesktopCatalogCounts;
  bytes: number;
  existingCareers: number;
  expiresAt: string;
}

export interface DesktopBridge {
  readAiSettings: () => Promise<DesktopAiSettings>;
  writeAiSettings: (value: { apiKey?: string; enabled: boolean; removeKey?: boolean }) => Promise<DesktopAiSettings>;
  testAiConnection: () => Promise<DesktopAiSettings>;
  session: () => Promise<{ identity: ManagerIdentity; token: string }>;
  updateProfile: (name: string) => Promise<void>;
  readPreferences: () => Promise<unknown>;
  writePreferences: (value: unknown) => Promise<void>;
  peerStatus: () => Promise<DesktopPeerStatus>;
  peerCreateOffer: (roomCode: string) => Promise<string>;
  peerAcceptAnswer: (answer: string) => Promise<void>;
  peerCreateAnswer: (offer: string) => Promise<string>;
  peerEnterGuest: () => Promise<void>;
  peerDisconnect: () => Promise<void>;
  catalogStatus: () => Promise<DesktopCatalogStatus>;
  catalogOpenBrowser: (origin: string) => Promise<void>;
  catalogPreview: () => Promise<DesktopCatalogPreview | null>;
  catalogCancel: (id: string) => Promise<void>;
  catalogCommit: (id: string) => Promise<void>;
}

export interface DesktopAiSettings {
  configured: boolean;
  enabled: boolean;
  storageAvailable: boolean;
  model: string;
  lastResult: 'none' | 'gemini' | 'fallback';
  lastError: string | null;
}

declare global { interface Window { readonly bolaDesktop?: DesktopBridge } }

export const desktopBridge = typeof window !== 'undefined' ? window.bolaDesktop ?? null : null;
