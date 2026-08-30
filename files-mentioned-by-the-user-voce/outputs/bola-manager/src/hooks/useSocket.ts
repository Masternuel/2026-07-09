import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import type { BolaSocket, ManagerIdentity } from '../types';

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
    if (code === 'AUTH_REQUIRED' || code === 'INVALID_AUTH_TOKEN') return 'Sua sessão não foi aceita pelo servidor.';
    if (code === 'AUTH_UNAVAILABLE') return 'A autenticação do servidor está indisponível.';
  }
  return 'Não foi possível conectar ao servidor em tempo real.';
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
    let connection: BolaSocket | null = null;
    setState('connecting');
    setError(null);

    const connect = async () => {
      const token = identity.mode === 'firebase' ? await getIdToken() : null;
      if (disposed) return;
      if (identity.mode === 'firebase' && !token) {
        setState('error');
        setError('Sua sessão Firebase expirou. Entre novamente.');
        return;
      }
      const serverUrl = import.meta.env.VITE_SERVER_URL || window.location.origin;
      let firstToken = token;
      connection = io(serverUrl, {
        autoConnect: true,
        timeout: 5000,
        transports: ['websocket'],
        auth: identity.mode === 'firebase'
          ? (provideAuth) => {
              if (firstToken) {
                provideAuth({ token: firstToken });
                firstToken = null;
                return;
              }
              void getIdToken().then((freshToken) => provideAuth({ token: freshToken }));
            }
          : { userId: identity.uid, name: identity.displayName },
      });
      setSocket(connection);
      connection.on('connect', () => {
        setState('connected');
        setError(null);
      });
      connection.on('disconnect', () => setState('offline'));
      connection.on('connect_error', (nextError) => {
        setState('error');
        setError(connectionMessage(nextError));
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
      connection?.disconnect();
      setSocket(null);
    };
  }, [enabled, identity?.uid, identity?.mode, identity?.displayName, getIdToken]);

  return { socket, state, error };
}
