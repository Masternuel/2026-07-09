import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

const redisUrl = process.env.TEST_REDIS_URL;

test("Redis adapter entrega broadcast entre duas replicas", { skip: !redisUrl }, async (context) => {
  let staging;
  if (process.env.STAGING_RUN_ID) {
    const { authorize, sameTargets } = await import("../../scripts/security-staging-runner.mjs");
    const { readReceipt, openRedis, closeRedis } = await import("../../scripts/staging/fixtures.mjs");
    const { createAdapter } = await import("@socket.io/redis-adapter");
    const preflight = await authorize(process.env, "redis");
    const receipt = readReceipt(process.env.STAGING_RUN_ID);
    assert.equal(receipt.group, "redis");
    assert.equal(sameTargets(receipt, preflight), true);
    staging = async () => {
      const runtime = await openRedis(process.env, receipt, { existing: true });
      context.after(() => closeRedis(runtime));
      return { redisRuntime: runtime, socketAdapterFactory: (pub, sub, options) => createAdapter(pub, sub, { ...options, key: receipt.runId }) };
    };
  }
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    codeFactory: () => "CLUSTER-1",
  });
  const first = await startTestServer({ store, env: { REDIS_URL: redisUrl }, ...(staging ? await staging() : {}) });
  const second = await startTestServer({ store, env: { REDIS_URL: redisUrl }, ...(staging ? await staging() : {}) });
  const clients = [];
  context.after(async () => {
    clients.forEach((client) => client.disconnect());
    await Promise.all([first.server.close(), second.server.close()]);
  });

  const created = await jsonRequest(`${first.url}/api/rooms`, "owner-token", {
    method: "POST",
    body: { name: "Cluster", seasonLength: 1, maxManagers: 2 },
  });
  const { room } = await created.json();
  const connect = (url) => new Promise((resolve, reject) => {
    const client = createClient(url, {
      transports: ["websocket"],
      auth: { token: "owner-token" },
    });
    clients.push(client);
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
  const [sender, receiver] = await Promise.all([connect(first.url), connect(second.url)]);
  await Promise.all([sender, receiver].map((client) => client.timeout(1_000).emitWithAck(
    "room:resume",
    { code: room.code },
  )));

  const received = new Promise((resolve) => receiver.once("chat:message", resolve));
  const acknowledgement = await sender.timeout(1_000).emitWithAck("chat:send", {
    code: room.code,
    message: "entre replicas",
  });
  assert.equal(acknowledgement.ok, true);
  assert.equal((await received).message, "entre replicas");
});
