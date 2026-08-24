import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { apiRequest } from '../lib/apiClient';
import type { OpponentStudy, OpponentStudyDepth } from '../types';

interface OpponentStudyResponse {
  study: OpponentStudy | null;
}

export function useOpponentStudy(code: string | undefined, revision = 0, enabled = true) {
  const auth = useAuth();
  const [depth, setDepth] = useState<OpponentStudyDepth>('standard');
  const [study, setStudy] = useState<OpponentStudy | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled || !code || auth.status !== 'authenticated' || !auth.identity) {
      setStudy(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiRequest<OpponentStudyResponse>(
        `/api/rooms/${encodeURIComponent(code)}/opponent-study?depth=${encodeURIComponent(depth)}`,
        { identity: auth.identity, getIdToken: auth.getIdToken },
        { signal },
      );
      if (!signal?.aborted) setStudy(response.study);
    } catch (nextError) {
      if (!signal?.aborted) {
        setStudy(null);
        setError(nextError instanceof Error ? nextError.message : 'Não foi possível estudar o adversário.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [auth.getIdToken, auth.identity, auth.status, code, depth, enabled]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh, revision]);

  return { study, loading, error, depth, setDepth, refresh };
}
