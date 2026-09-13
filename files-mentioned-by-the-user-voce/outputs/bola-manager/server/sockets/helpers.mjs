import { randomUUID } from "node:crypto";

export function channelForRoom(code) {
  return `room:${code}`;
}

export function channelForManager(managerId) {
  return `manager:${managerId}`;
}

export function clientError(error) {
  return {
    code: error.code || (error.name === "ValidationError" ? "VALIDATION_ERROR" : "SERVER_ERROR"),
    message: error.message || "Erro interno do servidor",
    details: error.details,
  };
}

export function registerSafe(socket, eventName, handler) {
  socket.on(eventName, async (payload = {}, acknowledgement) => {
    const requestId = String(payload?._requestId || payload?.requestId || randomUUID()).slice(0, 128);
    const handlerPayload = payload && typeof payload === "object" && !Array.isArray(payload)
      ? { ...payload }
      : payload;
    if (handlerPayload && typeof handlerPayload === "object") delete handlerPayload._requestId;
    const logger = socket.data.logger;
    const metrics = socket.data.metrics;
    const startedAt = Date.now();
    const slowMs = Math.max(250, Number(socket.data.slowOperationMs) || 5_000);
    let slowLogged = false;
    const slowTimer = setTimeout(() => {
      slowLogged = true;
      logger?.warn?.("socket.event_slow", {
        requestId,
        eventName,
        socketId: socket.id,
        durationMs: Date.now() - startedAt,
      });
    }, slowMs);
    slowTimer.unref?.();
    logger?.info?.("socket.event_start", { requestId, eventName, socketId: socket.id });

    const finish = (status, error = null) => {
      clearTimeout(slowTimer);
      const durationMs = Date.now() - startedAt;
      metrics?.increment?.("socket_events_total", 1, { event: eventName, status });
      metrics?.observe?.("socket_event_duration_ms", durationMs, { event: eventName, status });
      logger?.[status === "ok" ? "info" : "warn"]?.("socket.event_end", {
        requestId,
        eventName,
        socketId: socket.id,
        status,
        durationMs,
        slow: slowLogged || durationMs >= slowMs,
        ...(error ? { error } : {}),
      });
    };

    const scheduleAfterAcknowledgement = (operation) => {
      if (typeof operation !== "function") return;
      setTimeout(() => {
        Promise.resolve().then(operation).catch((error) => {
          metrics?.increment?.("socket_background_errors_total", 1, { event: eventName });
          logger?.error?.("socket.after_ack_failed", { requestId, eventName, socketId: socket.id, error });
        });
      }, 10).unref?.();
    };

    try {
      if (eventName !== "auth:logout") socket.data.assertCoordinationAvailable?.();
      const rate = eventName === "auth:logout" ? null : await socket.data.consumeRateLimit?.(eventName);
      if (rate && !rate.allowed) {
        const error = new Error("Muitos eventos em tempo real. Tente novamente em instantes.");
        error.code = "RATE_LIMITED";
        error.status = 429;
        error.details = { retryAfterMs: rate.retryAfterMs };
        throw error;
      }
      await socket.data.authorize?.(eventName);
      socket.data.assertAuthActive?.(eventName);
      if (eventName !== "auth:logout") socket.data.assertCoordinationAvailable?.();
      const result = await handler(handlerPayload);
      const { afterAcknowledgement, ...data } = result ?? {};
      if (typeof acknowledgement === "function") acknowledgement({ ok: true, ...data });
      finish("ok");
      scheduleAfterAcknowledgement(afterAcknowledgement);
    } catch (error) {
      if (["MATCH_IN_PROGRESS", "MATCH_OWNERSHIP_LOST", "DISTRIBUTED_LOCK_TIMEOUT"].includes(error?.code)) {
        try {
          const forwarded = await socket.data.forwardEvent?.(eventName, {
            ...(handlerPayload && typeof handlerPayload === "object" ? handlerPayload : {}),
            _requestId: requestId,
          });
          if (forwarded) {
            if (typeof acknowledgement === "function") acknowledgement(forwarded);
            else if (forwarded.ok === false) socket.emit("server:error", { event: eventName, error: forwarded.error });
            finish(forwarded.ok === false ? "error" : "ok", forwarded.ok === false ? forwarded.error : null);
            return;
          }
        } catch (forwardError) {
          logger?.warn?.("socket.forward_failed", { requestId, eventName, socketId: socket.id, error: forwardError });
        }
      }
      const serialized = clientError(error);
      if (typeof acknowledgement === "function") acknowledgement({ ok: false, error: serialized });
      else socket.emit("server:error", { event: eventName, error: serialized });
      finish("error", serialized);
    }
  });
}

export function rememberMembership(socket, code) {
  for (const previousCode of socket.data.roomCodes ?? []) {
    if (previousCode !== code) socket.leave(channelForRoom(previousCode));
  }
  socket.data.roomCodes = [code];
  socket.join(channelForRoom(code));
}
