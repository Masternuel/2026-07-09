import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createCachedReadiness, createFirestoreReadinessCheck, createReadinessChecker } from "../infrastructure/readiness.mjs";
import { startTestServer } from "./testHarness.mjs";
import { HTTP_CSP, IMAGE_CSP } from "../../shared/imagePolicy.mjs";

test("readiness coalesce concorrencia, usa cache curto e renova depois da expiracao", async () => {
  let calls = 0;
  let now = 0;
  let finish;
  const check = createCachedReadiness(() => { calls += 1; return new Promise((resolve) => { finish = resolve; }); }, { now: () => now, cacheMs: 50 });
  const requests = Array.from({ length: 30 }, () => check());
  await Promise.resolve();
  assert.equal(calls, 1);
  finish({ ok: true });
  assert.ok((await Promise.all(requests)).every((value) => value.ok));
  await check();
  assert.equal(calls, 1);
  now = 51;
  const next = check();
  await Promise.resolve();
  finish({ ok: false });
  assert.equal((await next).ok, false);
  assert.equal(calls, 2);
});

test("readiness limita timeout e nao duplica probe subjacente ainda pendente", async () => {
  let calls = 0;
  let now = 0;
  const check = createCachedReadiness(createReadinessChecker({
    checks: { firestore: createFirestoreReadinessCheck({ doc: () => ({ get: () => { calls += 1; return new Promise(() => {}); } }) }, { timeoutMs: 5 }) }, timeoutMs: 10,
  }), { now: () => now, cacheMs: 5, timeoutMs: 20 });
  assert.equal((await check()).ok, false);
  now = 100;
  assert.equal((await check()).ok, false);
  assert.equal(calls, 1);
});

test("falhas e resultados de providers nao expoem detalhes internos", async () => {
  for (const probe of [
    () => { throw new Error("redis://secret@internal"); },
    () => ({ ok: false, secret: "private", dependencies: { redis: { ok: false, status: "secret@internal", secret: "private" } } }),
  ]) {
    const result = await createCachedReadiness(probe)();
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /secret|private|internal/);
  }
});

test("endpoint publico suporta probes legitimos sem 429 e limita consultas caras por instancia", async (context) => {
  let calls = 0;
  const { server, url } = await startTestServer({ readinessCheck: async () => { calls += 1; return { ok: false }; } });
  context.after(() => server.close());
  const responses = await Promise.all(Array.from({ length: 40 }, () => fetch(`${url}/ready`)));
  assert.ok(responses.every((response) => response.status === 503));
  assert.equal(calls, 1);
  assert.equal(responses[0].headers.get("cache-control"), "no-store");
  assert.equal((await fetch(`${url}/health`)).status, 200);
});

test("headers anti-framing sao servidos pelo HTTP e configurados no Vercel/dev/preview", async (context) => {
  const { server, url } = await startTestServer();
  context.after(() => server.close());
  for (const path of ["/health", "/ready", "/api/rooms", "/missing"]) {
    const response = await fetch(`${url}${path}`);
    assert.equal(response.headers.get("content-security-policy"), HTTP_CSP);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  }
  assert.equal(HTTP_CSP, `${IMAGE_CSP}; frame-ancestors 'none'`);
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.equal(vercel.headers[0].source, "/(.*)");
  assert.equal(vercel.headers[0].headers.find((header) => header.key === "Content-Security-Policy").value, HTTP_CSP);
  assert.equal(vercel.headers[0].headers.find((header) => header.key === "X-Frame-Options").value, "DENY");
  const vite = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");
  assert.equal((vite.match(/'X-Frame-Options': 'DENY'/g) ?? []).length, 2);
});
