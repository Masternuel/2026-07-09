import { registerSafe } from "./helpers.mjs";

const sessionError = (code, message, status = 401) => Object.assign(new Error(message), { code, status });

export function installSocketAuthSession(socket, initial, verify, {
  now = Date.now, recheckMs = 60_000,
} = {}) {
  let credentials = initial;
  let closed = false;
  let started = false;
  let revision = 0;
  let refreshSequence = 0;
  let pending = null;
  let expiryTimer;
  let recheckTimer;
  socket.data.user = { ...initial.user };

  function stop() {
    closed = true;
    revision++;
    clearTimeout(expiryTimer);
    clearTimeout(recheckTimer);
    credentials = { ...credentials, token: null };
  }

  function invalidate(error) {
    if (closed) return;
    stop();
    socket.emit("auth:error", { code: error.code, message: error.message });
    // Let the request ACK leave before closing the transport.
    setImmediate(() => socket.disconnect(true));
  }

  function assertActive() {
    if (closed) throw sessionError("AUTH_SESSION_CLOSED", "Sessao encerrada. Entre novamente.");
    if (credentials.expiresAt != null && credentials.expiresAt <= now()) {
      const error = sessionError("AUTH_TOKEN_EXPIRED", "Token expirado. Renove sua sessao.");
      invalidate(error);
      throw error;
    }
  }

  function armExpiry() {
    clearTimeout(expiryTimer);
    if (!started || closed || credentials.expiresAt == null) return;
    expiryTimer = setTimeout(() => {
      try { assertActive(); armExpiry(); } catch { /* invalidation closes the socket */ }
    }, Math.min(2_147_483_647, Math.max(1, credentials.expiresAt - now())));
    expiryTimer.unref?.();
  }

  function accept(next) {
    if (next.user.uid !== initial.user.uid || next.user.authType !== initial.user.authType) {
      throw sessionError("AUTH_IDENTITY_CHANGED", "A conexao pertence a outra identidade. Entre novamente.");
    }
    Object.assign(socket.data.user, next.user);
    credentials = next;
    armExpiry();
  }

  async function authorize(eventName) {
    if (eventName === "auth:logout") return;
    assertActive();
    if (eventName === "auth:refresh" || credentials.user.authType === "demo") return;
    for (let attempt = 0; attempt < 3; attempt++) {
      assertActive();
      const currentRevision = revision;
      if (!pending || pending.revision !== currentRevision) {
        const entry = { revision: currentRevision, promise: verify({ token: credentials.token }) };
        pending = entry;
        void entry.promise.finally(() => { if (pending === entry) pending = null; }).catch(() => {});
      }
      try {
        const checked = await pending.promise;
        assertActive();
        if (revision !== currentRevision) continue;
        accept(checked);
        return;
      } catch (error) {
        if (!closed && revision !== currentRevision) continue;
        if (error.status !== 503) invalidate(error);
        throw error;
      }
    }
    throw sessionError("AUTH_UNAVAILABLE", "Renovacao em andamento. Tente novamente.", 503);
  }

  async function refresh(payload) {
    assertActive();
    const sequence = ++refreshSequence;
    try {
      if (initial.user.authType !== "firebase" || typeof payload?.token !== "string"
        || !payload.token.trim() || payload.token.length > 16_384) {
        throw sessionError("INVALID_AUTH_TOKEN", "Token de renovacao invalido");
      }
      const checked = await verify({ token: payload.token.trim() });
      assertActive();
      if (sequence === refreshSequence) {
        if (checked.user.uid !== initial.user.uid) throw sessionError("AUTH_IDENTITY_CHANGED", "Identidade da sessao alterada");
        if (checked.expiresAt >= credentials.expiresAt) {
          revision++;
          accept(checked);
        }
      }
      return { expiresAt: credentials.expiresAt };
    } catch (error) {
      if (sequence === refreshSequence && error.status !== 503) invalidate(error);
      throw error;
    }
  }

  function recheck() {
    if (closed) return;
    recheckTimer = setTimeout(async () => {
      try { await authorize(); } catch (error) {
        if (!closed) socket.emit("auth:error", { code: error.code, message: error.message });
      }
      recheck();
    }, recheckMs);
    recheckTimer.unref?.();
  }

  socket.data.authorize = authorize;
  socket.data.assertAuthActive = (eventName) => { if (eventName !== "auth:logout") assertActive(); };
  socket.data.authCredentials = () => {
    assertActive();
    return credentials.user.authType === "demo"
      ? { userId: credentials.user.uid, name: credentials.user.name }
      : { token: credentials.token };
  };
  socket.data.disposeAuthSession = stop;
  socket.data.startAuthSession = () => {
    if (started) return;
    started = true;
    socket.once("disconnect", stop);
    registerSafe(socket, "auth:refresh", refresh);
    registerSafe(socket, "auth:logout", async () => {
      invalidate(sessionError("AUTH_SESSION_CLOSED", "Sessao encerrada."));
      return {};
    });
    armExpiry();
    if (initial.user.authType === "firebase") recheck();
  };
}
