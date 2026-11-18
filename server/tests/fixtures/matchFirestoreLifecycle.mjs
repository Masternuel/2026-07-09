import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import { FirestoreMatchSessionPersistence } from "../../store/matchSessionPersistence.mjs";
import { matchV1Source } from "../helpers/matchFirestoreServer.mjs";

export async function runMatchFirestoreLifecycle(mode = "silent") {
  const sockets = new Set();
  const closedSockets = [];
  let peakSockets = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    peakSockets = Math.max(peakSockets, sockets.size);
    socket.once("data", () => {
      if (mode === "body") socket.write("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 9999\r\n\r\n{");
    });
    closedSockets.push(once(socket, "close"));
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  if (mode === "refused") await new Promise((resolve) => server.close(resolve));
  const source = matchV1Source(port);
  const createClient = source.createClient;
  let clientCloseMs = 0;
  let socketsBeforeClose = 0;
  let closeStarted;
  source.createClient = () => {
    const client = createClient();
    const close = client.close.bind(client);
    client.close = async () => {
      closeStarted = performance.now();
      socketsBeforeClose = sockets.size;
      await close();
      clientCloseMs = performance.now() - closeStarted;
    };
    return client;
  };
  const store = new FirestoreMatchSessionPersistence(source);
  const started = performance.now();
  let error;
  try { await store.get("LOCAL-TIMEOUT-FIXTURE"); } catch (caught) { error = caught; }
  const elapsedMs = performance.now() - started;
  assert.ok(error, "A failed dependency must not return success");
  await store.close();
  // No forced cleanup in the child: the parent watchdog fails the test if the
  // public client close does not close the real socket and allow natural exit.
  await Promise.all(closedSockets);
  if (mode !== "refused") await new Promise((resolve) => server.close(resolve));
  const cleanupMs = performance.now() - closeStarted;
  return {
    mode, elapsedMs: Math.round(elapsedMs), cleanupMs: Number(cleanupMs.toFixed(3)),
    clientCloseMs: Number(clientCloseMs.toFixed(3)),
    timeoutMs: Math.round(closeStarted - started), errorCode: error.code,
    causeCode: error.cause?.code, peakSockets, socketsBeforeClose,
    socketsAfterClose: sockets.size, rpcCount: source.calls.length,
    rpcAfterDeadline: source.calls.filter(({ at }) => at >= started + 15_000).length,
  };
}
