import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './useAuth';
import { ApiError, apiRequest } from '../lib/apiClient';
import { parseOpponentStudy } from '../services/opponentStudyService';
import type { OpponentStudy, OpponentStudyDepth } from '../types';

export function useOpponentStudy(code: string | undefined, revision = 0, enabled = true, clubId?: string, viewerClubId?: string) {
  const { status, identity, getIdToken } = useAuth();
  const [depth, setDepth] = useState<OpponentStudyDepth>('standard');
  const [result, setResult] = useState<{ scope: string; study: OpponentStudy | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = [identity?.uid, code, viewerClubId, clubId, depth, revision].join(':');
  const current = useRef(scope);
  current.current = scope;
  const sequence = useRef(0);
  const busy = useRef(false);
  const request = useRef<AbortController | null>(null);
  const study = result?.scope === scope && enabled ? result.study : null;
  const available = enabled && code && status === 'authenticated' && identity;
  const refresh = useCallback(async () => {
    request.current?.abort();
    if (!available || !code || !identity) return;
    const controller = new AbortController();
    request.current = controller;
    const id = ++sequence.current;
    setLoading(true); setError(null);
    try {
      const query = new URLSearchParams({ depth });
      if (clubId) query.set('clubId', clubId);
      const response = await apiRequest<{ study: OpponentStudy | null }>(
        '/api/rooms/' + encodeURIComponent(code) + '/opponent-study?' + query,
        { identity, getIdToken }, { signal: controller.signal });
      if (!controller.signal.aborted && current.current === scope && id === sequence.current) {
        setResult({ scope, study: parseOpponentStudy(response, clubId, viewerClubId) });
      }
    } catch (failure) {
      if (!controller.signal.aborted && current.current === scope && id === sequence.current) {
        setResult(null);
        setError(failure instanceof ApiError && failure.status >= 500
          ? 'Serviço de estudo indisponível. Tente atualizar novamente.'
          : failure instanceof Error ? failure.message : 'Não foi possível estudar o adversário.');
      }
    } finally {
      if (!controller.signal.aborted && current.current === scope && id === sequence.current) setLoading(false);
    }
  }, [available, code, identity, getIdToken, clubId, viewerClubId, depth, scope]);

  useEffect(() => {
    setResult(null); setError(null); setLoading(false); setPending(false); busy.current = false;
    void refresh();
    const focus = () => { if (!busy.current) void refresh(); };
    window.addEventListener('focus', focus);
    return () => { request.current?.abort(); window.removeEventListener('focus', focus); };
  }, [refresh]);

  const start = useCallback(async () => {
    if (!available || !code || !identity || !study || busy.current) return;
    busy.current = true; setPending(true); setError(null); request.current?.abort();
    const id = ++sequence.current;
    try {
      const response = await apiRequest<{ study: OpponentStudy }>(
        '/api/rooms/' + encodeURIComponent(code) + '/opponent-study',
        { identity, getIdToken }, { method: 'POST', body: { clubId: study.opponentClubId, viewerClubId: study.viewerClubId, depth } });
      if (current.current === scope && id === sequence.current) setResult({ scope, study: parseOpponentStudy(response, clubId, viewerClubId) });
    } catch (failure) {
      if (current.current === scope && id === sequence.current) setError(failure instanceof ApiError && failure.status >= 500
        ? 'Não foi possível confirmar o estudo. Atualize para verificar se a solicitação foi salva.'
        : failure instanceof Error ? failure.message : 'Não foi possível iniciar o estudo.');
    } finally {
      if (current.current === scope && id === sequence.current) { busy.current = false; setPending(false); setLoading(false); }
    }
  }, [available, code, identity, getIdToken, study, depth, scope, clubId, viewerClubId]);
  return { study, loading, pending, error, depth, setDepth, refresh, start };
}

export type OpponentStudyController = ReturnType<typeof useOpponentStudy>;
