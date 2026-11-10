import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredLogger } from "../infrastructure/observability.mjs";
import { startTestServer } from "./testHarness.mjs";

// D-03: at the default info level each HTTP request yields one line, and healthy probes none.
test("D-03: no nivel info, request gera so request_end e probes saudaveis nao geram linhas", async (t) => {
  const lines = [];
  const capture = Object.fromEntries(["debug", "info", "warn", "error", "log"].map((method) => [method, (line) => lines.push(JSON.parse(line))]));
  const { server, url } = await startTestServer({
    structuredLogger: createStructuredLogger({ output: capture, level: "info" }),
    readinessCheck: async () => ({ ok: true, dependencies: {} }),
  });
  t.after(() => server.close());
  const http = (entry) => entry.event?.startsWith("http.request_");

  await (await fetch(`${url}/health`, { headers: { "X-Request-Id": "probe-health" } })).text();
  await (await fetch(`${url}/ready`, { headers: { "X-Request-Id": "probe-ready" } })).text();
  assert.deepEqual(lines.filter((entry) => http(entry) && entry.requestId?.startsWith("probe-")), []);

  await (await fetch(`${url}/api/nao-existe`, { headers: { "X-Request-Id": "api-request" } })).text();
  const api = lines.filter((entry) => http(entry) && entry.requestId === "api-request");
  assert.deepEqual(api.map((entry) => [entry.level, entry.event]), [["info", "http.request_end"]]);
  assert.equal(typeof api[0].durationMs, "number");
});
