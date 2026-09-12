import assert from "node:assert/strict";
import test from "node:test";
import { createImageLoader } from "../../shared/imageLoader.mjs";

const blob = new Blob(["pixels"], { type: "image/png" });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup(options = {}) {
  const revoked = [];
  let sequence = 0;
  const loader = createImageLoader({ fetchImage: async () => blob, createUrl: () => `blob:test-${++sequence}`, revokeUrl: (url) => revoked.push(url), ...options });
  return { loader, revoked };
}

test("deduplica imagens simultaneas e reusa cache; revoke somente sem consumidores", async () => {
  let calls = 0;
  const { loader, revoked } = setup({ fetchImage: async () => { calls += 1; return blob; }, maxEntries: 1 });
  const first = loader.acquire("one");
  const second = loader.acquire("one");
  assert.equal(await first.promise, await second.promise);
  assert.equal(calls, 1);
  first.release(); first.release();
  assert.equal(await loader.acquire("two").promise, null);
  assert.deepEqual(revoked, []);
  second.release();
  const third = loader.acquire("two");
  assert.equal(await third.promise, "blob:test-2");
  assert.deepEqual(revoked, ["blob:test-1"]);
  third.release(); loader.clear();
});

test("limite de bytes e expiracao nao acumulam blobs nem cache de falhas", async () => {
  let time = 0;
  const { loader, revoked } = setup({ now: () => time, maxBytes: blob.size });
  const first = loader.acquire("one");
  assert.ok(await first.promise);
  const second = loader.acquire("two");
  assert.equal(await second.promise, null);
  second.release(); first.release();
  time = 300_001;
  const third = loader.acquire("two");
  assert.ok(await third.promise);
  assert.equal(revoked.length, 1);
  third.release(); loader.clear();
});

test("fila usa somente tres requisicoes; desmontagem cancela jobs e nao retorna URL tardia", async () => {
  const pending = [];
  const { loader, revoked } = setup({ fetchImage: (url, signal) => new Promise((resolve, reject) => {
    pending.push({ url, resolve });
    signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
  }) });
  const leases = Array.from({ length: 6 }, (_, i) => loader.acquire(String(i)));
  await tick();
  assert.equal(pending.length, 3);
  leases[0].release();
  leases[4].release();
  await tick();
  assert.equal(pending.length, 4);
  assert.equal(await leases[0].promise, null);
  assert.equal(await leases[4].promise, null);
  loader.clear();
  for (const lease of leases) { assert.equal(await lease.promise, null); lease.release(); }
  assert.deepEqual(revoked, []);
});

test("mime invalido e resposta vazia nunca produzem blob URL", async () => {
  for (const response of [new Blob(["<svg/>"], { type: "image/svg+xml" }), new Blob([], { type: "image/png" })]) {
    const { loader, revoked } = setup({ fetchImage: async () => response, createUrl: () => { throw new Error("must not run"); } });
    const lease = loader.acquire("one");
    assert.equal(await lease.promise, null);
    lease.release(); loader.clear();
    assert.deepEqual(revoked, []);
  }
});
