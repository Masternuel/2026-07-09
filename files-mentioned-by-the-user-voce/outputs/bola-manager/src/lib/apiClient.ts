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

export interface ApiBlobDownload {
  blob: Blob;
  filename: string | null;
}

interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: object;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const serverUrl = (import.meta.env.VITE_SERVER_URL
  || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const BINARY_REQUEST_TIMEOUT_MS = 120_000;
const AUTH_TIMEOUT_MS = 15_000;

function abortError() {
  return new DOMException('Solicitação cancelada.', 'AbortError');
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

function requestTimeout(value: unknown, fallback = DEFAULT_REQUEST_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isErrorEnvelope(value: unknown): value is { error: ServerErrorPayload } {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(error && typeof error === 'object' && 'message' in error && 'code' in error);
}

function downloadFilename(contentDisposition: string | null) {
  if (!contentDisposition) return null;
  const encoded = contentDisposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''));
    } catch {
      // Continua para o formato filename quando o servidor enviar encoding inválido.
    }
  }
  return contentDisposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    ?? contentDisposition.match(/filename\s*=\s*([^;\s]+)/i)?.[1]
    ?? null;
}

async function firebaseAuthorization(credentials: ApiCredentials, signal?: AbortSignal) {
  if (credentials.identity.mode !== 'firebase') return null;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, AUTH_TIMEOUT_MS);
  try {
    const token = await abortable(credentials.getIdToken(), controller.signal);
    if (!token) throw new ApiError('Sua sessão expirou. Entre novamente.', 'AUTH_TOKEN_MISSING', 401);
    return token;
  } catch (error) {
    if (timedOut) {
      throw new ApiError(
        'A autenticação excedeu o tempo limite.',
        'AUTH_TOKEN_TIMEOUT',
        503,
        { timeoutMs: AUTH_TIMEOUT_MS },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

async function authorizationHeaders(credentials: ApiCredentials, accept: string, signal?: AbortSignal) {
  const headers = new Headers({ Accept: accept });
  const authorization = await firebaseAuthorization(credentials, signal);
  if (authorization) {
    headers.set('Authorization', `Bearer ${authorization}`);
  } else {
    headers.set('x-demo-user-id', credentials.identity.uid);
    headers.set('x-demo-user-name', credentials.identity.displayName);
  }
  return headers;
}

export async function apiRequest<T>(
  path: string,
  credentials: ApiCredentials,
  options: ApiRequestOptions = {},
): Promise<T> {
  const timeoutMs = requestTimeout(options.timeoutMs);
  const requestController = new AbortController();
  const requestId = crypto.randomUUID();
  const startedAt = performance.now();
  let timedOut = false;
  const abortFromCaller = () => requestController.abort();
  if (options.signal) {
    if (options.signal.aborted) requestController.abort();
    else options.signal.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeoutId = setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, timeoutMs);
  console.debug('[HTTP] START', { requestId, method: options.method ?? 'GET', path });

  try {
    const headers = await authorizationHeaders(credentials, 'application/json', requestController.signal);
    headers.set('X-Request-Id', requestId);
    if (options.body) headers.set('Content-Type', 'application/json');
    const response = await fetch(`${serverUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: requestController.signal,
    });
    const responseRequestId = response.headers.get('X-Request-Id') || requestId;
    const payload: unknown = await response.json().catch(() => null);
    if (timedOut) throw new Error('request timed out');
    if (!response.ok) {
      if (isErrorEnvelope(payload)) {
        throw new ApiError(payload.error.message, payload.error.code, response.status, {
          requestId: responseRequestId,
          serverDetails: payload.error.details,
        });
      }
      throw new ApiError('O servidor não conseguiu concluir a solicitação.', 'HTTP_ERROR', response.status, {
        requestId: responseRequestId,
      });
    }
    console.debug('[HTTP] END', {
      requestId: responseRequestId,
      method: options.method ?? 'GET',
      path,
      status: response.status,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return payload as T;
  } catch (error) {
    if (timedOut) {
      console.warn('[HTTP] TIMEOUT', { requestId, path, timeoutMs });
      throw new ApiError(
        'O servidor excedeu o tempo de resposta. Tente novamente.',
        'API_REQUEST_TIMEOUT',
        408,
        { requestId, path, timeoutMs },
      );
    }
    if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    if (error instanceof TypeError) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      throw new ApiError(
        offline ? 'Seu dispositivo está sem conexão.' : 'Não foi possível alcançar o servidor.',
        offline ? 'CLIENT_OFFLINE' : 'API_NETWORK_ERROR',
        0,
        { requestId, path },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export async function apiBlobDownload(
  path: string,
  credentials: ApiCredentials,
  signal?: AbortSignal,
): Promise<ApiBlobDownload> {
  const controller = new AbortController();
  const requestId = crypto.randomUUID();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BINARY_REQUEST_TIMEOUT_MS);
  try {
    const headers = await authorizationHeaders(credentials, 'application/json, application/octet-stream', controller.signal);
    headers.set('X-Request-Id', requestId);
    const response = await fetch(`${serverUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      if (isErrorEnvelope(payload)) {
        throw new ApiError(payload.error.message, payload.error.code, response.status, payload.error.details);
      }
      throw new ApiError('O servidor não conseguiu exportar a base de dados.', 'HTTP_ERROR', response.status);
    }
    return {
      blob: await response.blob(),
      filename: downloadFilename(response.headers.get('Content-Disposition')),
    };
  } catch (error) {
    if (timedOut) {
      throw new ApiError('A exportação excedeu o tempo limite.', 'API_DOWNLOAD_TIMEOUT', 408, { requestId });
    }
    if (error instanceof TypeError) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      throw new ApiError(
        offline ? 'Seu dispositivo está sem conexão.' : 'Não foi possível alcançar o servidor.',
        offline ? 'CLIENT_OFFLINE' : 'API_NETWORK_ERROR',
        0,
        { requestId, path },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
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
  timeoutMs?: number;
}

export async function apiBinaryUpload<T>(
  path: string,
  credentials: ApiCredentials,
  body: Blob,
  options: ApiBinaryUploadOptions = {},
): Promise<T> {
  const authorization = await firebaseAuthorization(credentials, options.signal);

  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const requestId = crypto.randomUUID();
    request.open(options.method ?? 'PUT', `${serverUrl}${path.startsWith('/') ? path : `/${path}`}`);
    request.timeout = requestTimeout(options.timeoutMs, BINARY_REQUEST_TIMEOUT_MS);
    request.setRequestHeader('Accept', 'application/json');
    request.setRequestHeader('X-Request-Id', requestId);
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
    request.addEventListener('timeout', () => reject(new ApiError(
      'O upload excedeu o tempo limite.',
      'API_UPLOAD_TIMEOUT',
      408,
      { requestId, timeoutMs: request.timeout },
    )));
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
