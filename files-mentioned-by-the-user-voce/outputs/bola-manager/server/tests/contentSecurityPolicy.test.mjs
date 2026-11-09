import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { APP_CSP_REPORT_ONLY, THEME_SCRIPT_HASH } from "../../shared/contentSecurityPolicy.mjs";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const directives = (policy) => Object.fromEntries(policy.split(";").map((part) => {
  const [name, ...values] = part.trim().split(/\s+/);
  return [name, values];
}));

test("hash do script inline de tema corresponde ao index.html", async () => {
  const html = await read("index.html");
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.equal(scripts.length, 1, "index.html deve ter exatamente um script inline");
  const actual = `sha256-${createHash("sha256").update(scripts[0]).digest("base64")}`;
  assert.equal(actual, THEME_SCRIPT_HASH, "atualize THEME_SCRIPT_HASH ao editar o script inline");
});

test("politica completa bloqueia scripts inline e eval, exceto o hash de tema", () => {
  const policy = directives(APP_CSP_REPORT_ONLY);
  assert.deepEqual(policy["default-src"], ["'self'"]);
  assert.ok(policy["script-src"].includes(`'${THEME_SCRIPT_HASH}'`));
  for (const unsafe of ["'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"]) {
    assert.equal(policy["script-src"].includes(unsafe), false, `script-src nao pode conter ${unsafe}`);
  }
  assert.deepEqual(policy["object-src"], ["'none'"]);
  assert.deepEqual(policy["frame-ancestors"], ["'none'"]);
  assert.deepEqual(policy["base-uri"], ["'self'"]);
});

test("vercel e vite preview publicam a politica em modo report-only", async () => {
  const vercel = JSON.parse(await read("vercel.json"));
  const headers = vercel.headers[0].headers;
  assert.equal(headers.find((header) => header.key === "Content-Security-Policy-Report-Only")?.value, APP_CSP_REPORT_ONLY);
  const vite = await read("vite.config.ts");
  assert.match(vite, /preview: \{ headers: \{[^}]*'Content-Security-Policy-Report-Only': APP_CSP_REPORT_ONLY/);
});

test("dev server do Vite escuta somente em loopback", async () => {
  const vite = await read("vite.config.ts");
  assert.match(vite, /host: '127\.0\.0\.1'/);
  assert.equal(/host: true/.test(vite), false);
});
