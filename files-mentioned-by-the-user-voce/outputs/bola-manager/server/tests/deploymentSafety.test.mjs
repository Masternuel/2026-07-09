import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseEnv(source) {
  return Object.fromEntries(source
    .split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).trim()];
    }));
}

test("exemplo de ambiente nao publica credenciais", async () => {
  const source = await readFile(path.join(projectRoot, ".env.example"), "utf8");
  const env = parseEnv(source);
  for (const name of [
    "CLOUDINARY_URL",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
    "GEMINI_API_KEY",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "METRICS_TOKEN",
  ]) {
    assert.equal(env[name], "", `${name} deve permanecer vazio no arquivo de exemplo`);
  }
});

test("Railway usa readiness e multiplas replicas coordenadas", async () => {
  const config = JSON.parse(await readFile(path.join(projectRoot, "railway.json"), "utf8"));
  assert.ok(config.deploy.numReplicas >= 2);
  assert.equal(config.deploy.multiRegionConfig, null);
  assert.equal(config.deploy.healthcheckPath, "/ready");
  assert.ok(config.deploy.overlapSeconds > 0);
});

test("RPC Socket.IO usa API de eventos entre servidores", async () => {
  const source = await readFile(path.join(projectRoot, "server", "sockets", "index.mjs"), "utf8");
  assert.match(source, /io\.serverSideEmitWithAck\("cluster:match-command"/);
  assert.doesNotMatch(source, /io\.timeout\([^)]*\)\s*\.serverSideEmitWithAck/);
});

test("exemplo de ambiente documenta Redis sem publicar URL", async () => {
  const source = await readFile(path.join(projectRoot, ".env.example"), "utf8");
  const env = parseEnv(source);
  assert.equal(env.REDIS_URL, "");
  assert.ok(Number(env.LOCK_TTL_MS) > 0);
  assert.ok(Number(env.RATE_LIMIT_HTTP_MAX) > 0);
});

test("snapshots de partidas ativas nao ficam acessiveis pelo cliente Firebase", async () => {
  const rules = await readFile(path.join(projectRoot, "firestore.rules"), "utf8");
  assert.match(
    rules,
    /match \/activeMatches\/\{document=\*\*\}\s*\{\s*allow read, write: if false;\s*\}/,
  );
});
