import type { BolaSocket } from '../types';
import { emitSocketRequest } from './socketRequest';

const logoutHandlers = new Set<() => void>();
let sessionGeneration = 0;

export function socketSessionGeneration() { return sessionGeneration; }

export function endSocketSessions() {
  sessionGeneration++;
  for (const logout of [...logoutHandlers]) logout();
}

export function attachSocketSession(
  socket: BolaSocket,
  getToken: (force?: boolean) => Promise<string | null>,
  { firebase, onError, onHealthy, reconnect, refreshMs = 60_000 }: {
    firebase: boolean;
    onError: (code: string, message: string) => void;
    onHealthy: () => void;
    reconnect: (token: string) => void;
    refreshMs?: number;
  },
) {
  let disposed = false;
  let reconnectExpired = false;
  let connectionGeneration = 0;
  let timer: ReturnType<typeof setTimeout>;
  const report = (error: unknown) => {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'AUTH_UNAVAILABLE';
    onError(code, code === 'AUTH_UNAVAILABLE'
      ? 'Não foi possível validar sua sessão. Aguarde e tente novamente.'
      : 'Sua sessão não é mais válida. Entre novamente.');
  };
  const schedule = () => {
    clearTimeout(timer);
    if (!firebase || disposed || !socket.connected) return;
    timer = setTimeout(async () => {
      const generation = connectionGeneration;
      try {
        const token = await getToken();
        if (disposed || !socket.connected || generation !== connectionGeneration) return;
        if (!token) {
          logout();
          report({ code: 'AUTH_REQUIRED' });
          return;
        }
        await emitSocketRequest(socket, 'auth:refresh', { token });
        if (!disposed && generation === connectionGeneration) onHealthy();
      } catch (error) {
        if (!disposed && generation === connectionGeneration) report(error);
      }
      schedule();
    }, refreshMs);
  };
  const onConnect = () => { connectionGeneration++; reconnectExpired = false; schedule(); };
  const onAuthError = (error: { code: string; message: string }) => {
    if (disposed) return;
    reconnectExpired = firebase && error.code === 'AUTH_TOKEN_EXPIRED';
    if (!reconnectExpired) report(error);
  };
  const onDisconnect = (reason: string) => {
    clearTimeout(timer);
    const generation = ++connectionGeneration;
    if (disposed || !reconnectExpired || reason !== 'io server disconnect') return;
    reconnectExpired = false;
    void getToken(true).then((token) => {
      if (disposed || generation !== connectionGeneration) return;
      if (token) reconnect(token);
      else report({ code: 'AUTH_REQUIRED' });
    }).catch((error) => { if (!disposed) report(error); });
  };
  const dispose = () => {
    disposed = true;
    connectionGeneration++;
    clearTimeout(timer);
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.off('auth:error', onAuthError);
    logoutHandlers.delete(logout);
  };
  const logout = () => {
    dispose();
    if (socket.connected) socket.emit('auth:logout', {}, () => {});
    socket.disconnect();
  };
  logoutHandlers.add(logout);
  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('auth:error', onAuthError);
  schedule();
  return dispose;
}
