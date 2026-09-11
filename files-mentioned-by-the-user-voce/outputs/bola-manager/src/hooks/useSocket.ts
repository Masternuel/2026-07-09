import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { attachSocketSession, socketSessionGeneration } from '../lib/socketSession';
import type { BolaSocket, ManagerIdentity } from '../types';

const TOKEN_TIMEOUT_MS = 10_000;

export type SocketState = 'offline' | 'connecting' | 'connected' | 'error';

interface UseSocketOptions {
  enabled: boolean;
  identity: ManagerIdentity | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

function connectionMessage(error: Error): string {
  const data = (error as Error & { data?: unknown }).data;
  if (data && typeof data === 'object' && 'code' in data) {
    const code = String((data as { code: unknown }).code);
    if (['AUTH_REQUIRED', 'INVALID_AUTH_TOKEN', 'AUTH_TOKEN_EXPIRED', 'AUTH_TOKEN_REVOKED',
      'AUTH_USER_DISABLED', 'AUTH_SESSION_CLOSED', 'AUTH_IDENTITY_CHANGED'].includes(code)) {
      return 'Sua sessão não foi aceita pelo servidor. Entre novamente.';
    }
    if (code === 'AUTH_UNAVAILABLE') return 'A autenticação do servidor está indisponível.';
  }
  return 'Não foi possível conectar ao servidor em tempo real.';
}

async function tokenWithDeadline(
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>,
  forceRefresh = false,
): Promise<string | null> {
  let timer = 0;
  try {
    return await Promise.race([
      getIdToken(forceRefresh),
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('AUTH_TOKEN_TIMEOUT')), TOKEN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

export function useSocket({ enabled, identity, getIdToken }: UseSocketOptions) {
  const [socket, setSocket] = useState<BolaSocket | null>(null);
  const [state, setState] = useState<SocketState>('offline');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !identity) {
      setSocket(null);
      setState('offline');
      return;
    }
    let disposed = false;
    const authGeneration = socketSessionGeneration();
    let connection: BolaSocket | null = null;
    let disposeAuthSession: (() => void) | undefined;
    setState('connecting');
    setError(null);

    const connect = async () => {
      const token = identity.mode === 'firebase' ? await tokenWithDeadline(getIdToken) : null;
      if (disposed || authGeneration !== socketSessionGeneration()) return;
      if (identity.mode === 'firebase' && !token) {
        setState('error');
        setError('Sua sessão Firebase expirou. Entre novamente.');
        return;
      }
      const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
      let firstToken = token;
      connection = io(serverUrl, {
        autoConnect: true,
        timeout: 10_000,
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 10_000,
        randomizationFactor: 0.5,
        transports: ['websocket'],
        auth: identity.mode === 'firebase'
          ? (provideAuth) => {
              if (firstToken) {
                provideAuth({ token: firstToken });
                firstToken = null;
                return;
              }
              void tokenWithDeadline(getIdToken)
                .then((freshToken) => provideAuth({ token: freshToken ?? '' }))
                .catch((nextError) => {
                  console.warn('[SOCKET] AUTH_FAILED', {
                    message: nextError instanceof Error ? nextError.message : String(nextError),
                  });
                  provideAuth({ token: '' });
                });
            }
          : { userId: identity.uid, name: identity.displayName },
      });
      setSocket(connection);
      disposeAuthSession = attachSocketSession(connection, (force) => tokenWithDeadline(getIdToken, force), {
        firebase: identity.mode === 'firebase',
        onError: (_code, message) => { if (!disposed) { setState('error'); setError(message); } },
        onHealthy: () => { if (!disposed) { setState('connected'); setError(null); } },
        reconnect: (freshToken) => {
          if (disposed) return;
          firstToken = freshToken;
          setState('connecting');
          connection?.connect();
        },
      });
      connection.on('connect', () => {
        setState('connected');
        setError(null);
      });
      connection.on('disconnect', (reason) => {
        if (disposed) return;
        console.warn('[SOCKET] DISCONNECT', { reason });
        setState('offline');
      });
      connection.on('connect_error', (nextError) => {
        if (disposed) return;
        setState('error');
        setError(connectionMessage(nextError));
      });
      connection.io.on('reconnect_attempt', (attempt) => {
        if (disposed) return;
        console.debug('[SOCKET] RECONNECT_ATTEMPT', { attempt });
        setState('connecting');
      });
      connection.io.on('reconnect_failed', () => {
        if (disposed) return;
        setState('error');
        setError('Não foi possível restabelecer a conexão em tempo real.');
      });
    };

    void connect().catch(() => {
      if (!disposed) {
        setState('error');
        setError('Não foi possível preparar a conexão em tempo real.');
      }
    });
    return () => {
      disposed = true;
      disposeAuthSession?.();
      connection?.disconnect();
      setSocket(null);
    };
  }, [enabled, identity?.uid, identity?.mode, identity?.displayName, getIdToken]);

  return { socket, state, error };
}
