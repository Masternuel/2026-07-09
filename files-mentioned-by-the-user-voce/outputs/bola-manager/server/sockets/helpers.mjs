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
    try {
      const rate = await socket.data.consumeRateLimit?.(eventName);
      if (rate && !rate.allowed) {
        const error = new Error("Muitos eventos em tempo real. Tente novamente em instantes.");
        error.code = "RATE_LIMITED";
        error.status = 429;
        error.details = { retryAfterMs: rate.retryAfterMs };
        throw error;
      }
      const result = await handler(payload);
      const { afterAcknowledgement, ...data } = result ?? {};
      if (typeof acknowledgement === "function") acknowledgement({ ok: true, ...data });
      // Mantem o ack em um frame Socket.IO separado antes de iniciar streams de eventos.
      if (typeof afterAcknowledgement === "function") setTimeout(afterAcknowledgement, 10);
    } catch (error) {
      if (["MATCH_IN_PROGRESS", "MATCH_OWNERSHIP_LOST", "DISTRIBUTED_LOCK_TIMEOUT"].includes(error?.code)) {
        try {
          const forwarded = await socket.data.forwardEvent?.(eventName, payload);
          if (forwarded) {
            if (typeof acknowledgement === "function") acknowledgement(forwarded);
            else if (forwarded.ok === false) socket.emit("server:error", { event: eventName, error: forwarded.error });
            return;
          }
        } catch {
          // Mantem o erro original quando nenhuma replica proprietaria responde.
        }
      }
      const serialized = clientError(error);
      if (typeof acknowledgement === "function") acknowledgement({ ok: false, error: serialized });
      else socket.emit("server:error", { event: eventName, error: serialized });
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
