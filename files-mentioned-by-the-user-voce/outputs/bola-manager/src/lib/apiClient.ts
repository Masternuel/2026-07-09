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

export async function apiUpload<T>(
  path: string,
  credentials: ApiCredentials,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<T> {
  return apiBinaryUpload<T>(path, credentials, file, {
    method: 'POST',
    contentType: file.type,
    onProgress,
    networkErrorCode: 'EDITOR_MEDIA_NETWORK_ERROR',
  });
}

interface ApiBinaryUploadOptions {
  method?: 'POST' | 'PUT';
  contentType?: string;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  networkErrorCode?: string;
}

export async function apiBinaryUpload<T>(
  path: string,
  credentials: ApiCredentials,
  body: Blob,
  options: ApiBinaryUploadOptions = {},
): Promise<T> {
  const authorization = credentials.identity.mode === 'firebase'
    ? await credentials.getIdToken()
    : null;
  if (credentials.identity.mode === 'firebase' && !authorization) {
    throw new ApiError('Sua sessão expirou. Entre novamente.', 'AUTH_TOKEN_MISSING', 401);
  }

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(options.method ?? 'PUT', `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`);
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('Content-Type', options.contentType || body.type || 'application/octet-stream');
    if (authorization) request.setRequestHeader('Authorization', `Bearer ${authorization}`);
    else {
      request.setRequestHeader('x-demo-user-id', credentials.identity.uid);
      request.setRequestHeader('x-demo-user-name', credentials.identity.displayName);
    }
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener('error', () => reject(new ApiError('Falha de conexão durante o upload.', options.networkErrorCode ?? 'API_UPLOAD_NETWORK_ERROR', 0)));
    request.addEventListener('abort', () => reject(new DOMException('Upload cancelado.', 'AbortError')));
    request.addEventListener('load', () => {
      let payload: unknown = null;
      try { payload = request.responseText ? JSON.parse(request.responseText) : null; } catch { /* resposta sem JSON */ }
      if (request.status >= 200 && request.status < 300) {
        options.onProgress?.(100);
        resolve(payload as T);
        return;
      }
      if (isErrorEnvelope(payload)) {
        reject(new ApiError(payload.error.message, payload.error.code, request.status, payload.error.details));
        return;
      }
      reject(new ApiError('O servidor não conseguiu concluir o upload.', 'HTTP_ERROR', request.status));
    });
    const abort = () => request.abort();
    if (options.signal?.aborted) {
      reject(new DOMException('Upload cancelado.', 'AbortError'));
      return;
    }
    options.signal?.addEventListener('abort', abort, { once: true });
    request.addEventListener('loadend', () => options.signal?.removeEventListener('abort', abort));
    request.send(body);
  });
}
