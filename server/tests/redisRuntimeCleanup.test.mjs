import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRedisRuntime } from "../infrastructure/redisRuntime.mjs";

const fixture = new URL("./fixtures/redisRuntimeLifecycle.mjs", import.meta.url).href;
const exec = promisify(execFile);
for (const mode of ["silent", "refused", "healthy", "shutdown-stalled"]) {
  test(`Redis lifecycle TCP real: ${mode}, sem sockets/processo residual`, async () => {
    const script = `import { runLifecycleScenario } from ${JSON.stringify(fixture)};
      console.log(JSON.stringify(await runLifecycleScenario(${JSON.stringify(mode)})));`;
    // Parent watchdog only: the child must exit on its own, without process.exit.
    const { stdout, stderr } = await exec(process.execPath, ["--input-type=module", "--eval", script], {
      timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024,
      env: { ...process.env, BOLA_ENV_FILES: "false" },
    });
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    assert.equal(result.mode, mode);
    assert.equal(result.socketsAfterClose, 0);
    if (mode === "silent") assert.equal(result.errorCode, "DEPENDENCY_TIMEOUT");
    if (mode === "refused") assert.equal(result.errorCode, "ECONNREFUSED");
  });
}

function client({ connectError, destroyError } = {}) {
  return {
    isOpen: true, isReady: true, destroyed: 0, quitCount: 0,
    on() {},
    async connect() { if (connectError) throw connectError; this.isOpen = true; this.isReady = true; },
    async quit() { this.quitCount++; },
    destroy() { this.destroyed++; this.isOpen = false; this.isReady = false; if (destroyError) throw destroyError; },
  };
}

test("startup parcial: falha no terceiro factory fecha os dois clientes criados", async () => {
  const original = Error("factory failed");
  const created = [client(), client()];
  let count = 0;
  await assert.rejects(createRedisRuntime({ url: "redis://fixture", clientFactory: async () => {
    if (count === created.length) throw original;
    return created[count++];
  } }), error => error === original);
  assert.deepEqual(created.map(c => [c.destroyed, c.quitCount]), [[1, 0], [1, 0]]);
});

test("startup parcial: falha em duplicate fecha todos os clientes anteriores", async () => {
  const original = Error("duplicate failed");
  const first = client(), second = client();
  let count = 0;
  first.duplicate = () => { if (count++) throw original; return second; };
  await assert.rejects(createRedisRuntime({ url: "redis://fixture", clientFactory: async () => first }), error => error === original);
  assert.equal(first.destroyed, 1);
  assert.equal(second.destroyed, 1);
});

test("forced cleanup de todos os clientes preserva identidade do erro original de connect", async () => {
  const original = Object.assign(Error("connection failed"), { code: "ECONNREFUSED" });
  const created = [client({ connectError: original, destroyError: Error("cleanup failed") }), client(), client()];
  created.forEach(c => { c.isOpen = false; c.isReady = false; });
  let count = 0;
  await assert.rejects(createRedisRuntime({ url: "redis://fixture", clientFactory: async () => created[count++] }), error => error === original);
  assert.deepEqual(created.map(c => c.destroyed), [1, 1, 1]);
  assert.deepEqual(created.map(c => c.quitCount), [0, 0, 0]);
});

test("falha de QUIT no shutdown ainda força encerramento dos três clientes", async () => {
  const created = [client(), client(), client()];
  for (const c of created) c.sendCommand = async () => { c.quitCount++; throw Error("peer disconnected"); };
  let count = 0;
  const runtime = await createRedisRuntime({ url: "redis://fixture", clientFactory: async () => created[count++] });
  await runtime.close();
  assert.deepEqual(created.map(c => [c.destroyed, c.quitCount]), [[1, 1], [1, 1], [1, 1]]);
});
