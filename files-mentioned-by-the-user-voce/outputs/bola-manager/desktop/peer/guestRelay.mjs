import express from "express";
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { Server } from "socket.io";
import { createExpressAuthMiddleware, createSocketAuthMiddleware } from "../../server/auth.mjs";
import { createOriginPolicy } from "../../server/infrastructure/networkPolicy.mjs";
import { applySecurityHeaders, createSecurityHeaders, secureEngineTransport } from "../../server/infrastructure/httpSecurity.mjs";
import { PEER_EVENTS } from "./scope.mjs";

export async function createGuestRelay({ rpc, session, staticDirectory }) {
  const app = express();
  const httpServer = createServer(app);
  let origin;
  const auth = { async verifyIdToken(token) {
    const left = Buffer.from(String(token)); const right = Buffer.from(session.token);
    if (rpc.closed || left.length !== right.length || !timingSafeEqual(left, right)) throw Object.assign(new Error("Peer session invalid"), { code: "auth/invalid-id-token" });
    return { uid: session.identity.uid, name: session.identity.displayName, exp: Math.floor(Date.now() / 1000) + 3600 };
  } };
  const originPolicy = {
    allows: (value) => Boolean(origin && createOriginPolicy(origin, "production").allows(value)),
    allowRequest(request, callback) { callback(null, Boolean(origin && request.headers.host === new URL(origin).host && originPolicy.allows(request.headers.origin))); },
  };
  const headersForRequest = createSecurityHeaders({ enableHsts: false });
  app.disable("x-powered-by");
  app.use((request, response, next) => {
    applySecurityHeaders(response, headersForRequest(request));
    if (!origin || request.headers.host !== new URL(origin).host || !originPolicy.allows(request.headers.origin)) return response.status(403).json({ error: { code: "LOCAL_ORIGIN_DENIED", message: "Origem local nao permitida." } });
    next();
  });
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", createExpressAuthMiddleware({ auth, nodeEnv: "production" }), async (request, response, next) => {
    const controller = new AbortController();
    const abort = () => { if (!response.writableEnded) controller.abort(); };
    response.once("close", abort);
    try {
      const result = await rpc.request("http", { path: request.originalUrl, method: request.method, body: request.body }, { signal: controller.signal });
      if (response.destroyed) return;
      response.status(result.status).type(result.contentType || "application/json").send(Buffer.from(result.body, "base64"));
    } catch (error) { if (!response.destroyed) next(error); }
    finally { response.off("close", abort); }
  });
  if (staticDirectory) {
    app.use(express.static(resolve(staticDirectory)));
    app.get("*", (request, response, next) => {
      if (request.path.startsWith("/api/") || request.path.startsWith("/socket.io/")) return next();
      response.sendFile(resolve(staticDirectory, "index.html"));
    });
  }
  app.use((_request, response) => response.sendStatus(404));
  app.use((error, _request, response, _next) => response.status(error.status ?? 503).json({ error: { code: error.code ?? "PEER_UNAVAILABLE", message: "A conexao com o anfitriao esta indisponivel. Nenhuma simulacao local substituiu a carreira remota." } }));
  const upgradeHandlers = new Set(httpServer.listeners("upgrade"));
  const io = new Server(httpServer, { transports: ["websocket"], maxHttpBufferSize: 1_048_576, allowRequest: originPolicy.allowRequest });
  secureEngineTransport({ httpServer, io, originPolicy, headersForRequest, upgradeHandlers });
  io.use(createSocketAuthMiddleware({ auth, nodeEnv: "production" }));
  io.on("connection", (socket) => {
    const outgoing = (event, payload) => {
      if (event === "peer:socket-disconnected") socket.disconnect(true);
      else socket.emit(event, payload);
    };
    rpc.on("event", outgoing);
    let connected = false;
    const ready = rpc.request("socket:connect", {}).then(() => {
      connected = true;
      if (!socket.connected && !rpc.closed) void rpc.request("socket:disconnect", {}).catch(() => undefined);
    });
    void ready.catch(() => socket.disconnect(true));
    for (const event of PEER_EVENTS) socket.on(event, async (payload, acknowledgement) => {
      try {
        await ready;
        const result = await rpc.request("socket:emit", { event, payload });
        acknowledgement?.(result);
      } catch (error) { acknowledgement?.({ ok: false, error: { code: error.code ?? "PEER_UNAVAILABLE", message: "O anfitriao nao respondeu." } }); }
    });
    socket.once("disconnect", () => {
      rpc.off("event", outgoing);
      if (connected && !rpc.closed) void rpc.request("socket:disconnect", {}).catch(() => undefined);
    });
  });
  const lost = () => io.disconnectSockets(true);
  rpc.on("close", lost);
  await new Promise((resolveListen, reject) => { httpServer.once("error", reject); httpServer.listen(0, "127.0.0.1", resolveListen); });
  origin = `http://127.0.0.1:${httpServer.address().port}`;
  return { origin, async close() { rpc.off("close", lost); await new Promise((done) => io.close(done)); httpServer.closeAllConnections(); } };
}
