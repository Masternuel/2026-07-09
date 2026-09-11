import type { BolaSocket } from '../types';

const DEFAULT_ACK_TIMEOUT_MS = 30_000;
const SLOW_ACK_MS = 5_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export class SocketRequestError extends Error {
  code: string;
  event: string;
  requestId: string;
  details?: unknown;

  constructor(message: string, code: string, event: string, requestId: string, details?: unknown) {
    super(message);
    this.name = 'SocketRequestError';
    this.code = code;
    this.event = event;
    this.requestId = requestId;
    this.details = details;
  }
}

export function emitSocketRequest<T extends object>(
  socket: BolaSocket,
  event: string,
  payload: Record<string, unknown>,
  { timeoutMs = DEFAULT_ACK_TIMEOUT_MS }: { timeoutMs?: number } = {},
): Promise<T> {
  const existingId = typeof payload.requestId === 'string' ? payload.requestId.trim() : '';
  const requestId = existingId || crypto.randomUUID();
  if (!socket.connected) {
    return Promise.reject(new SocketRequestError(
      'A conexão em tempo real foi interrompida.',
      'SOCKET_DISCONNECTED',
      event,
      requestId,
    ));
  }

  return new Promise<T>((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      socket.off('disconnect', onDisconnect);
      action();
    };
    const onDisconnect = () => finish(() => reject(new SocketRequestError(
      'A conexão em tempo real foi interrompida. Aguarde a reconexão.',
      'SOCKET_DISCONNECTED',
      event,
      requestId,
    )));
    const timer = window.setTimeout(() => finish(() => {
      console.warn('[SOCKET] TIMEOUT', { requestId, event, timeoutMs });
      reject(new SocketRequestError(
        'O servidor excedeu o tempo de resposta.',
        'SOCKET_ACK_TIMEOUT',
        event,
        requestId,
        { timeoutMs },
      ));
    }), timeoutMs);

    socket.once('disconnect', onDisconnect);
    console.debug('[SOCKET] SEND', { requestId, event });
    const emit = socket.emit as unknown as (
      eventName: string,
      requestPayload: Record<string, unknown>,
      acknowledgement: (response: unknown) => void,
    ) => void;
    try {
      emit.call(socket, event, { ...payload, _requestId: requestId }, (response) => finish(() => {
        const durationMs = Math.round(performance.now() - startedAt);
        const responseRecord = record(response);
        if (responseRecord?.ok === true) {
          const log = durationMs >= SLOW_ACK_MS ? console.warn : console.debug;
          log('[SOCKET] ACK', { requestId, event, durationMs });
          resolve(responseRecord as unknown as T);
          return;
        }
        const serverError = record(responseRecord?.error);
        reject(new SocketRequestError(
          typeof serverError?.message === 'string' && serverError.message.trim()
            ? serverError.message
            : 'O servidor enviou uma resposta inválida.',
          typeof serverError?.code === 'string' ? serverError.code : 'SOCKET_ACK_INVALID',
          event,
          requestId,
          serverError?.details,
        ));
      }));
    } catch {
      finish(() => reject(new SocketRequestError(
        'Não foi possível enviar a solicitação em tempo real.',
        'SOCKET_SEND_FAILED', event, requestId,
      )));
    }
  });
}
