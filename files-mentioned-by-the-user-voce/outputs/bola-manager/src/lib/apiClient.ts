import type { ManagerIdentity, ServerErrorPayload } from '../types';

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code = 'API_ERROR', status = 500, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ApiCredentials {
  identity: ManagerIdentity;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: object;
  signal?: AbortSignal;
}

const serverUrl = (import.meta.env.VITE_SERVER_URL || window.location.origin).replace(/\/$/, '');

function isErrorEnvelope(value: unknown): value is { error: ServerErrorPayload } {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === 'object' && 'message' in error && 'code' in error);
}

export async function apiRequest<T>(
  path: string,
  credentials: ApiCredentials,
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (credentials.identity.mode === 'firebase') {
    const token = await credentials.getIdToken();
    if (!token) throw new ApiError('Sua sessão expirou. Entre novamente.', 'AUTH_TOKEN_MISSING', 401);
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.set('x-demo-user-id', credentials.identity.uid);
    headers.set('x-demo-user-name', credentials.identity.displayName);
  }
  if (options.body) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${serverUrl}${path.startsWith('/') ? path : `/${path}`}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (isErrorEnvelope(payload)) {
      throw new ApiError(payload.error.message, payload.error.code, response.status, payload.error.details);
    }
    throw new ApiError('O servidor não conseguiu concluir a solicitação.', 'HTTP_ERROR', response.status);
  }
  return payload as T;
}
