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

export function createExpressAuthMiddleware({ auth, allowDemoAuth = false, nodeEnv = "development" }) {
  return async function authenticateRequest(request, _response, next) {
    try {
      const token = bearerToken(request.headers.authorization);
      if (token) {
        if (!auth) throw new AuthError("Firebase Auth nao configurado", "AUTH_UNAVAILABLE", 503);
        request.user = normalizedUser(await auth.verifyIdToken(token));
      } else {
        assertDemoAllowed(allowDemoAuth, nodeEnv);
        request.user = demoUser(request.headers["x-demo-user-id"], request.headers["x-demo-user-name"]);
        if (!request.user) throw new AuthError("Informe x-demo-user-id no modo demo");
      }
      next();
    } catch (error) {
      if (error instanceof AuthError) next(error);
      else next(new AuthError("Token de autenticacao invalido", "INVALID_AUTH_TOKEN"));
    }
  };
}

export function createSocketAuthMiddleware({ auth, allowDemoAuth = false, nodeEnv = "development" }) {
  return async function authenticateSocket(socket, next) {
    try {
      const token = String(socket.handshake.auth?.token ?? "").trim();
      if (token) {
        if (!auth) throw new AuthError("Firebase Auth nao configurado", "AUTH_UNAVAILABLE", 503);
        socket.data.user = normalizedUser(await auth.verifyIdToken(token));
      } else {
        assertDemoAllowed(allowDemoAuth, nodeEnv);
        socket.data.user = demoUser(
          socket.handshake.auth?.userId,
          socket.handshake.auth?.name,
        );
        if (!socket.data.user) throw new AuthError("Informe auth.userId no modo demo");
      }
      next();
    } catch (error) {
      const authError = error instanceof AuthError
        ? error
        : new AuthError("Token de autenticacao invalido", "INVALID_AUTH_TOKEN");
      const connectionError = new Error(authError.message);
      connectionError.data = { code: authError.code, status: authError.status };
      next(connectionError);
    }
  };
}

