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
      const result = await handler(payload);
      const { afterAcknowledgement, ...data } = result ?? {};
      if (typeof acknowledgement === "function") acknowledgement({ ok: true, ...data });
      // Mantem o ack em um frame Socket.IO separado antes de iniciar streams de eventos.
      if (typeof afterAcknowledgement === "function") setTimeout(afterAcknowledgement, 10);
    } catch (error) {
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
