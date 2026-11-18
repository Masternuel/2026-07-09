import { apiRequest, type ApiCredentials } from '../lib/apiClient';

export type ScoutingAction = 'watch' | 'unwatch' | 'interest' | 'withdraw-interest' | 'contact-agent';
export interface AgentContact {
  status: 'open' | 'conditional' | 'unavailable';
  message: string;
  playerClubId: string | null;
  requestingClubId: string;
  currentWage: number | null;
  marketValue: number | null;
  contractEndsAt: string | null;
  contactedAt: string;
  nextContactAt: string;
}
export interface ScoutingRecord {
  clubId: string;
  playerId: string;
  playerName: string;
  watching: boolean;
  interested: boolean;
  agentContact: AgentContact | null;
  updatedAt?: string;
}
export interface ScoutingSnapshot {
  clubId: string;
  revision: number;
  records: ScoutingRecord[];
  history: Array<{ operationId: string; playerId: string; action: ScoutingAction; changed: boolean; occurredAt: string }>;
}

export function parseScoutingSnapshot(response: { snapshot?: ScoutingSnapshot }): ScoutingSnapshot {
  const snapshot = response?.snapshot;
  if (!snapshot || typeof snapshot.clubId !== 'string' || !Number.isFinite(snapshot.revision)
    || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.history)
    || snapshot.records.some((entry) => !entry || entry.clubId !== snapshot.clubId || typeof entry.playerId !== 'string'
      || typeof entry.playerName !== 'string' || typeof entry.watching !== 'boolean' || typeof entry.interested !== 'boolean'
      || entry.agentContact != null && (typeof entry.agentContact.message !== 'string'
        || !['open', 'conditional', 'unavailable'].includes(entry.agentContact.status)
        || !Number.isFinite(Date.parse(entry.agentContact.contactedAt)) || !Number.isFinite(Date.parse(entry.agentContact.nextContactAt))
        || [entry.agentContact.currentWage, entry.agentContact.marketValue].some((value) => value !== null && (!Number.isFinite(value) || value < 0))))) {
    throw new Error('Resposta de observação inválida. Tente atualizar os dados.');
  }
  return snapshot;
}

export async function loadScouting(code: string, playerId: string, credentials: ApiCredentials, signal?: AbortSignal) {
  return parseScoutingSnapshot(await apiRequest<{ snapshot: ScoutingSnapshot }>(
    `/api/scouting/${encodeURIComponent(code)}?playerId=${encodeURIComponent(playerId)}`, credentials, { signal },
  ));
}

export async function saveScouting(code: string, input: { playerId: string; clubId: string; action: ScoutingAction; operationId: string }, credentials: ApiCredentials) {
  return parseScoutingSnapshot(await apiRequest<{ snapshot: ScoutingSnapshot }>(
    `/api/scouting/${encodeURIComponent(code)}`, credentials, { method: 'POST', body: input },
  ));
}
