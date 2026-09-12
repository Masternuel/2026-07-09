import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { loadScouting, saveScouting, type ScoutingAction, type ScoutingSnapshot } from '../services/scoutingService';

const oppositeActions: Partial<Record<ScoutingAction, ScoutingAction>> = {
  watch: 'unwatch', unwatch: 'watch', interest: 'withdraw-interest', 'withdraw-interest': 'interest',
};

export function useScouting(code: string | null, clubId: string | null, playerId: string | null, active: boolean) {
  const { identity, getIdToken } = useAuth();
  const [received, setReceived] = useState<{ scope: string; snapshot: ScoutingSnapshot } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<ScoutingAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scope = `${identity?.uid ?? ''}:${code}:${clubId}:${playerId}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const busy = useRef<string | null>(null);
  const intents = useRef(new Map<string, string>());
  const read = useRef<AbortController | null>(null);
  const available = Boolean(active && code && clubId && playerId && identity);
  const snapshot = received?.scope === scope ? received.snapshot : null;

  const accept = useCallback((result: ScoutingSnapshot) => {
    if (result.clubId.toUpperCase() !== clubId?.toUpperCase()) throw new Error('Seu clube mudou. Reabra o perfil para atualizar a observação.');
    setReceived((previous) => !previous || previous.scope !== scope || result.revision >= previous.snapshot.revision ? { scope, snapshot: result } : previous);
  }, [clubId, scope]);

  const reload = useCallback(async () => {
    read.current?.abort();
    if (!available || !code || !playerId || !identity) return;
    const controller = new AbortController();
    read.current = controller;
    setLoading(true);
    setError(null);
    try {
      const result = await loadScouting(code, playerId, { identity, getIdToken }, controller.signal);
      if (scopeRef.current === scope && !controller.signal.aborted) accept(result);
    } catch (failure) {
      if (scopeRef.current === scope && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Não foi possível carregar a observação.');
    } finally {
      if (scopeRef.current === scope && !controller.signal.aborted) setLoading(false);
    }
  }, [accept, available, code, playerId, identity, getIdToken, scope]);

  useEffect(() => {
    setReceived(null);
    setPending(null);
    setError(null);
    setLoading(false);
    busy.current = null;
    void reload();
    const refresh = () => { if (!busy.current) void reload(); };
    window.addEventListener('focus', refresh);
    return () => { read.current?.abort(); window.removeEventListener('focus', refresh); };
  }, [reload]);

  const act = useCallback(async (action: ScoutingAction) => {
    if (!available || !identity || !code || !clubId || !playerId || busy.current || !snapshot) return;
    busy.current = scope;
    setPending(action);
    setError(null);
    const intent = `${scope}:${action}`;
    const operationId = intents.current.get(intent) ?? crypto.randomUUID();
    intents.current.set(intent, operationId);
    try {
      const result = await saveScouting(code, { playerId, clubId, action, operationId }, { identity, getIdToken });
      intents.current.delete(intent);
      const opposite = oppositeActions[action];
      if (opposite) intents.current.delete(`${scope}:${opposite}`);
      if (scopeRef.current === scope) accept(result);
    } catch (failure) {
      if (scopeRef.current === scope) setError(failure instanceof Error ? failure.message : 'Não foi possível salvar a observação.');
    } finally {
      if (scopeRef.current === scope) { busy.current = null; setPending(null); }
    }
  }, [accept, available, identity, code, clubId, playerId, scope, snapshot, getIdToken]);

  return { snapshot, record: snapshot?.records.find((entry) => entry.playerId.toUpperCase() === playerId?.toUpperCase()) ?? null,
    available, loading, pending, error, ready: Boolean(snapshot), reload, act };
}

export type ScoutingController = ReturnType<typeof useScouting>;
