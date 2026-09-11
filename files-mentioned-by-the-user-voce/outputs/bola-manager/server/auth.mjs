import { installSocketAuthSession } from "./sockets/authSession.mjs";

export class AuthError extends Error {
  constructor(message, code = "AUTH_REQUIRED", status = 401) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

function bearerToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(String(header ?? "").trim());
  return match?.[1]?.trim() || null;
}

function normalizedUser(decoded, authType = "firebase") {
  const uid = decoded?.uid || decoded?.sub;
  if (!uid) throw new AuthError("Token de autenticacao sem UID", "INVALID_AUTH_TOKEN");
  const emailName = decoded.email?.split("@")[0];
  return {
    uid,
    name: decoded.name || emailName || "Manager",
    email: decoded.email || null,
    picture: decoded.picture || null,
    editor: authType === "firebase" && decoded.editor === true,
    authType,
  };
}

function demoUser(uid, name) {
  const normalizedUid = String(uid ?? "").trim();
  if (!normalizedUid) return null;
  return normalizedUser({ uid: normalizedUid, name: String(name ?? "Manager demo").trim() }, "demo");
}

function assertDemoAllowed(allowDemoAuth, nodeEnv) {
  if (!allowDemoAuth || nodeEnv === "production") {
    throw new AuthError("Autenticacao Firebase obrigatoria", "AUTH_REQUIRED");
  }
}

const TRANSIENT_AUTH_CODES = new Set([
  "app/network-error",
  "auth/internal-error",
  "auth/network-request-failed",
  "auth/too-many-requests",
  "auth/unavailable",
]);

function isTransientAuthFailure(error) {
  const code = String(error?.code ?? "").toLowerCase();
  const status = Number(error?.status ?? error?.statusCode ?? error?.httpErrorCode?.status);
  return TRANSIENT_AUTH_CODES.has(code)
    || code.includes("timeout")
    || code.includes("unavailable")
    || code.includes("network")
    || status === 429
    || status >= 500;
}

function authFailure(error) {
  if (error?.name === "TimeoutError" || error?.code === "DEPENDENCY_TIMEOUT" || isTransientAuthFailure(error)) {
    return new AuthError("Servico de autenticacao indisponivel", "AUTH_UNAVAILABLE", 503);
  }
  return error instanceof AuthError
    ? error
    : new AuthError("Token de autenticacao invalido", "INVALID_AUTH_TOKEN");
}

async function verifyToken(auth, token, timeoutMs, checkRevoked = false) {
  return withTimeout(auth.verifyIdToken(token, checkRevoked), timeoutMs, "firebase-auth");
}

export function createExpressAuthMiddleware({
  auth,
  allowDemoAuth = false,
  nodeEnv = "development",
  timeoutMs = 10_000,
}) {
  return async function authenticateRequest(request, _response, next) {
    try {
      const token = bearerToken(request.headers.authorization);
      if (token) {
        if (!auth) throw new AuthError("Firebase Auth nao configurado", "AUTH_UNAVAILABLE", 503);
        request.user = normalizedUser(await verifyToken(auth, token, timeoutMs));
      } else {
        assertDemoAllowed(allowDemoAuth, nodeEnv);
        request.user = demoUser(request.headers["x-demo-user-id"], request.headers["x-demo-user-name"]);
        if (!request.user) throw new AuthError("Informe x-demo-user-id no modo demo");
      }
      next();
    } catch (error) {
      next(authFailure(error));
    }
  };
}

export function createSocketAuthMiddleware({
  auth,
  allowDemoAuth = false,
  nodeEnv = "development",
  timeoutMs = 10_000,
  recheckMs = 60_000,
}) {
  const verify = async (credentials) => {
    try {
      const token = typeof credentials?.token === "string" ? credentials.token.trim() : "";
      if (token) {
        if (token.length > 16_384) throw new AuthError("Token de autenticacao invalido", "INVALID_AUTH_TOKEN");
        if (!auth) throw new AuthError("Firebase Auth nao configurado", "AUTH_UNAVAILABLE", 503);
        const decoded = await verifyToken(auth, token, timeoutMs, true);
        const expiresAt = Number(decoded.exp) * 1000;
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
          throw new AuthError("Token expirado ou sem validade", "AUTH_TOKEN_EXPIRED");
        }
        return { user: normalizedUser(decoded), token, expiresAt };
      }
      assertDemoAllowed(allowDemoAuth, nodeEnv);
      const user = demoUser(credentials?.userId, credentials?.name);
      if (!user) throw new AuthError("Informe auth.userId no modo demo");
      return { user, token: null, expiresAt: null };
    } catch (error) {
      const codes = {
        "auth/id-token-expired": "AUTH_TOKEN_EXPIRED",
        "auth/id-token-revoked": "AUTH_TOKEN_REVOKED",
        "auth/user-disabled": "AUTH_USER_DISABLED",
      };
      if (codes[error?.code]) throw new AuthError("Sessao invalida. Entre novamente.", codes[error.code]);
      throw authFailure(error);
    }
  };
  return async function authenticateSocket(socket, next) {
    try {
      const initial = await verify(socket.handshake.auth);
      installSocketAuthSession(socket, initial, verify, { recheckMs });
      next();
    } catch (error) {
      const authError = authFailure(error);
      const connectionError = new Error(authError.message);
      connectionError.data = { code: authError.code, status: authError.status };
      next(connectionError);
    }
  };
}
import { withTimeout } from "./infrastructure/readiness.mjs";
