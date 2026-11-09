import assert from "node:assert/strict";
import { createServer } from "node:net";
import { performance } from "node:perf_hooks";
import { createRedisRuntime } from "../../infrastructure/redisRuntime.mjs";
import { createClient } from "redis";

// 2500 ms is the deployed dependency timeout. Allow 1500 ms for CI scheduling,
// not for another cleanup deadline. The parent also verifies natural process exit.
export const CONNECT_TIMEOUT_MS = 2500;
export const MAX_REJECTION_MS = CONNECT_TIMEOUT_MS + 1500;

export async function runLifecycleScenario(mode) {
  assert.ok(["silent", "refused", "healthy", "shutdown-stalled"].includes(mode));
  const sockets = new Set();
  let accepted = 0, quitCommands = 0, runtime, pendingClosed;
  const server = createServer((socket) => {
    accepted++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => {
      sockets.delete(socket);
      if (!sockets.size) pendingClosed?.();
    });
    let buffer = "";
    socket.on("data", (bytes) => {
      if (mode === "silent") return;
      buffer += bytes.toString();
      // Minimal RESP peer: acknowledge the real client's handshake, PING and
      // QUIT only. No replacement client or library internals are used.
      while (buffer.length) {
        const header = /^\*(\d+)\r\n/.exec(buffer);
        if (!header) return;
        let offset = header[0].length;
        const args = [];
        for (let i = 0; i < Number(header[1]); i++) {
          const length = /^\$(\d+)\r\n/.exec(buffer.slice(offset));
          if (!length) return;
          offset += length[0].length;
          const size = Number(length[1]);
          if (buffer.length < offset + size + 2) return;
          args.push(buffer.slice(offset, offset + size));
          offset += size + 2;
        }
        buffer = buffer.slice(offset);
        if (args[0] === "QUIT") {
          quitCommands++;
          if (mode === "healthy") socket.end("+OK\r\n");
        } else if (args[0] === "PING") socket.write("+PONG\r\n");
        else if (args[0] === "CLIENT") socket.write("+OK\r\n");
        else socket.write("-ERR unsupported fixture command\r\n");
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const url = `redis://127.0.0.1:${server.address().port}`;
  if (mode === "refused") await new Promise(resolve => server.close(resolve));
  const started = performance.now();
  let error, elapsedMs, socketsBeforeClose;
  try {
    if (mode === "silent" || mode === "refused") {
      try {
        await createRedisRuntime({
          url, connectTimeoutMs: CONNECT_TIMEOUT_MS, logger: { error() {} },
          ...(mode === "refused" ? { socket: { reconnectStrategy: false } } : {}),
        });
      } catch (caught) { error = caught; }
      elapsedMs = performance.now() - started;
      assert.ok(error, "Startup must reject");
      if (mode === "silent") {
        assert.equal(error.name, "TimeoutError");
        assert.equal(error.code, "DEPENDENCY_TIMEOUT");
        assert.match(error.message, /^redis-(command|publisher|subscriber) readiness timeout$/);
        assert.equal(accepted, 3);
        assert.ok(elapsedMs >= CONNECT_TIMEOUT_MS - 50);
      } else assert.equal(error.code, "ECONNREFUSED");
      assert.ok(elapsedMs < MAX_REJECTION_MS, `Rejection took ${elapsedMs} ms`);
      socketsBeforeClose = accepted;
    } else {
      runtime = await createRedisRuntime({ url, connectTimeoutMs: CONNECT_TIMEOUT_MS, logger: { error() {} } });
      assert.equal((await runtime.ping()).ok, true);
      socketsBeforeClose = sockets.size;
      const closingAt = performance.now();
      await runtime.close();
      elapsedMs = performance.now() - closingAt;
      assert.equal(quitCommands, 3, "Graceful shutdown must be attempted for every client");
      assert.ok(elapsedMs < MAX_REJECTION_MS);
      if (mode === "shutdown-stalled") assert.ok(elapsedMs >= CONNECT_TIMEOUT_MS - 50);
      await runtime.close();
      assert.equal(quitCommands, 3, "Close must remain idempotent");
      for (const client of [runtime.client, runtime.publisher, runtime.subscriber]) assert.equal(client.isOpen, false);
    }
    if (sockets.size) {
      let timer;
      try {
        await Promise.race([
          new Promise(resolve => { pendingClosed = resolve; }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Residual fixture sockets")), 500); }),
        ]);
      } finally { clearTimeout(timer); pendingClosed = null; }
    }
    assert.equal(sockets.size, 0);
    return { mode, elapsedMs: Math.round(elapsedMs), errorName: error?.name, errorCode: error?.code,
      errorMessage: error?.message, accepted, socketsBeforeClose, socketsAfterClose: sockets.size, quitCommands };
  } finally {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    for (const client of [runtime?.client, runtime?.publisher, runtime?.subscriber]) {
      if (client?.isOpen) client.destroy();
    }
  }
}

// Importing redis above keeps lazy module loading out of the timed handshake.
assert.equal(typeof createClient, "function");
