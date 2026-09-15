import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { evaluatePreflight, isolationTemplate, serviceTargets, fingerprint, printPreflight } from "../../scripts/security-staging-preflight.mjs";
import { sameTargets, childProcess } from "../../scripts/security-staging-runner.mjs";
import { createReceipt, readReceipt, receiptPath, scopedRedis, updateReceipt } from "../../scripts/staging/fixtures.mjs";
import { isOwned, ownedFixture } from "../../scripts/staging/providers.mjs";
import reporter from "../../scripts/staging/reporter.mjs";

function configuration() {
  const account = (name) => JSON.stringify({ type: "service_account", project_id: "isolated-fixture", client_email: `${name}@isolated-fixture.iam.gserviceaccount.com`, private_key: "-----BEGIN PRIVATE KEY-----\nsynthetic-unit-fixture\n-----END PRIVATE KEY-----\n" });
  return {
    NODE_ENV: "test", STAGING_ENVIRONMENT: "staging", STAGING_ALLOW_WRITES: "true", BOLA_ENV_FILES: "false",
    STAGING_BACKEND_URL: "https://api.example.test", STAGING_FRONTEND_ORIGIN: "https://ui.example.test", VITE_SERVER_URL: "https://api.example.test",
    CLIENT_ORIGIN: "https://ui.example.test", TRUST_PROXY: "false", STAGING_REPLICA_COUNT: "2", ROOM_STORE: "firestore", ALLOW_DEMO_AUTH: "false", ALLOW_LOCAL_EDITOR: "false", METRICS_TOKEN: "m".repeat(32),
    TEST_REDIS_URL: "rediss://test-credential:unit-secret@redis.example.test:6379/1", REDIS_URL: "rediss://redis.example.test:6379/0",
    FIREBASE_PROJECT_ID: "isolated-fixture", FIREBASE_STORAGE_BUCKET: "isolated-fixture.firebasestorage.app",
    FIREBASE_SERVICE_ACCOUNT_JSON: account("runtime"), STAGING_FIREBASE_ADMIN_JSON: account("test-admin"),
    VITE_FIREBASE_PROJECT_ID: "isolated-fixture", VITE_FIREBASE_STORAGE_BUCKET: "isolated-fixture.firebasestorage.app", VITE_FIREBASE_API_KEY: "synthetic-web-key",
    VITE_FIREBASE_AUTH_DOMAIN: "isolated-fixture.firebaseapp.com", VITE_FIREBASE_APP_ID: "synthetic-app", VITE_FIREBASE_MESSAGING_SENDER_ID: "123",
    CLOUDINARY_CLOUD_NAME: "isolated-fixture", CLOUDINARY_API_KEY: "synthetic-cloud-key", CLOUDINARY_API_SECRET: "synthetic-cloud-secret",
    STAGING_GEMINI_PROJECT_ID: "isolated-fixture", GEMINI_API_KEY: "synthetic-gemini-key", GEMINI_MODEL: "configured-model", STAGING_AI_BUDGET_CONFIRMED: "true",
  };
}
function confirmed(env) {
  const isolation = isolationTemplate(env);
  isolation.environment = "staging";
  isolation.productionInventoryReviewed = true;
  for (const proof of Object.values(isolation.services)) Object.assign(proof, { environment: "staging", isolated: true, evidence: "unit-test-only; not operational evidence" });
  return isolation;
}
const evaluate = (env, isolation = confirmed(env), group = "all") => evaluatePreflight(env, isolation, { group, destructive: true });

test("preflight sem configuracao bloqueia, sem ler env local", () => {
  const result = evaluatePreflight({}, null);
  assert.equal(result.ok, false);
  assert.ok(result.rows.some((row) => row.status === "MISSING"));
  assert.ok(result.rows.some((row) => row.reason === "ISOLATION_UNCONFIRMED"));
});
test("template nunca confirma isolamento automaticamente", () => {
  const env = configuration();
  assert.equal(evaluate(env, isolationTemplate(env)).ok, false);
  assert.ok(!JSON.stringify(isolationTemplate(env)).includes(env.GEMINI_API_KEY));
});
test("configuracao declarada valida passa sem rede", () => { assert.equal(evaluate(configuration()).ok, true); });
test("grupos independentes: Redis nao exige credenciais de outro servico", () => {
  const env = { NODE_ENV: "test", BOLA_ENV_FILES: "false", STAGING_ENVIRONMENT: "staging", STAGING_ALLOW_WRITES: "true", TEST_REDIS_URL: "redis://redis.example.test" };
  assert.equal(evaluate(env, confirmed(env), "redis").ok, true);
  assert.equal(evaluate(env).ok, false);
});
for (const key of ["NODE_ENV", "STAGING_ENVIRONMENT"]) test(`${key} production bloqueia escrita`, () => {
  const env = { ...configuration(), [key]: "production" };
  assert.equal(evaluate(env).ok, false);
});
test("NODE_ENV production pode ser inspecionado mas nao usado para escrever", () => {
  const env = { ...configuration(), NODE_ENV: "production" };
  assert.equal(evaluatePreflight(env, confirmed(env)).ok, true);
  assert.equal(evaluate(env).ok, false);
});
test("sem opt-in de escrita bloqueia runner", () => {
  assert.equal(evaluate({ ...configuration(), STAGING_ALLOW_WRITES: "false" }).ok, false);
});
for (const service of ["backend", "frontend", "firebase", "storage", "cloudinary", "gemini", "redisTest"]) test(`nega ${service} conhecido como producao`, () => {
  const env = configuration(); const isolation = confirmed(env);
  isolation.production[service] = [fingerprint(serviceTargets(env)[service])];
  assert.equal(evaluate(env, isolation).ok, false);
});
test("Redis de producao bloqueia outro DB/credencial/esquema da mesma instancia", () => {
  const env = configuration(); const isolation = confirmed(env);
  isolation.production.redis = [fingerprint(serviceTargets({ REDIS_URL: "redis://other:other@redis.example.test:6379/9" }).redis)];
  assert.equal(evaluate(env, isolation, "redis").ok, false);
});
test("nao adivinha producao pelo hostname", () => {
  const env = { ...configuration(), STAGING_BACKEND_URL: "https://example.test", VITE_SERVER_URL: "https://example.test" };
  assert.equal(evaluate(env).ok, true);
});
for (const service of ["backend", "frontend", "firebase", "cloudinary"]) test(`${service} rotulado producao bloqueia`, () => {
  const env = configuration(); const isolation = confirmed(env); isolation.services[service].environment = "production";
  assert.ok(evaluate(env, isolation).rows.some((row) => row.reason === "PRODUCTION_BLOCKED"));
});
test("pasta Cloudinary sem prova da conta nao e isolamento", () => {
  const env = configuration(); const isolation = confirmed(env); isolation.services.cloudinary.isolated = false;
  assert.equal(evaluate(env, isolation, "media").ok, false);
});
test("trocar chave Gemini invalida confirmacao anterior", () => {
  const env = configuration(); const isolation = confirmed(env); env.GEMINI_API_KEY = "changed-fixture";
  assert.equal(evaluate(env, isolation, "ai").ok, false);
});
test("identidades Firebase devem ser distintas e do mesmo projeto", () => {
  const env = configuration(); env.STAGING_FIREBASE_ADMIN_JSON = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  assert.equal(evaluate(env).ok, false);
  env.STAGING_FIREBASE_ADMIN_JSON = JSON.stringify({ project_id: "different-project" });
  assert.equal(evaluate(env).ok, false);
});
test("ADC e emuladores nao substituem staging real", () => {
  for (const key of ["GOOGLE_APPLICATION_CREDENTIALS", "FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST", "STORAGE_EMULATOR_HOST"]) {
    assert.equal(evaluate({ ...configuration(), [key]: "synthetic-value" }).ok, false);
  }
});
test("origins invalidos e trust proxy generico bloqueiam", () => {
  for (const changes of [{ CLIENT_ORIGIN: "*" }, { TRUST_PROXY: "true" }, { STAGING_BACKEND_URL: "https://user:pass@example.test" }, { TEST_REDIS_URL: "https://example.test" }]) {
    assert.equal(evaluate({ ...configuration(), ...changes }).ok, false);
  }
});
test("inventario e evidencia ausentes bloqueiam", () => {
  const env = configuration(); const isolation = confirmed(env);
  isolation.productionInventoryReviewed = false; assert.equal(evaluate(env, isolation).ok, false);
  isolation.productionInventoryReviewed = true; isolation.services.firebase.evidence = ""; assert.equal(evaluate(env, isolation).ok, false);
});
test("manifesto malformado falha fechado", () => {
  const env = configuration(); const isolation = confirmed(env); isolation.production.redis = {};
  assert.equal(evaluate(env, isolation).ok, false);
  assert.equal(evaluate(env, isolation, "redis").ok, false);
});
test("origin extra sem confirmacao e ambiente Railway produtivo bloqueiam", () => {
  const env = configuration();
  assert.equal(evaluate({ ...env, CLIENT_ORIGIN: `${env.CLIENT_ORIGIN},https://other.example.test` }).ok, false);
  assert.equal(evaluate({ ...env, RAILWAY_ENVIRONMENT_NAME: "production" }).ok, false);
});
test("CLI nao inicia fixtures sem prova de isolamento", async () => {
  const result = await childProcess(["scripts/security-staging-runner.mjs", "redis"], { NODE_ENV: "test", BOLA_ENV_FILES: "false" });
  assert.equal(result.code, 1);
  assert.equal(result.timedOut, false);
});
test("saida nao revela valores de configuracao ou hashes", () => {
  const env = configuration(); const result = evaluate(env); let output = "";
  const previous = console.log; console.log = (line) => { output += line; };
  try { printPreflight(result); } finally { console.log = previous; }
  for (const key of ["TEST_REDIS_URL", "FIREBASE_SERVICE_ACCOUNT_JSON", "CLOUDINARY_API_SECRET", "GEMINI_API_KEY", "METRICS_TOKEN"]) assert.ok(!output.includes(env[key]));
  assert.ok(output.includes("configured: true"));
  assert.ok(!output.includes(result.targetHashes.firebase));
});
test("cleanup recusa troca de alvo ou credencial", () => {
  const env = configuration(); const before = evaluate(env);
  assert.equal(sameTargets({ targetHashes: before.targetHashes }, before), true);
  const after = evaluate({ ...env, CLOUDINARY_API_SECRET: "changed" });
  assert.equal(sameTargets({ targetHashes: before.targetHashes }, after), false);
});
test("run id impede travessia de caminhos", () => { assert.throws(() => receiptPath("../production"), /INVALID_RUN_ID/); });
test("fixtures Redis registram apenas chaves prefixadas e recusam comandos genericos", async (context) => {
  const receipt = createReceipt("redis", {}); context.after(() => rmSync(receiptPath(receipt.runId), { force: true }));
  const calls = [];
  const client = scopedRedis({ async set(...args) { calls.push(args); }, async eval(...args) { calls.push(args); } }, receipt.runId);
  await client.set("fixture", "value");
  await client.eval("return 1", { keys: ["counter"], arguments: [] });
  assert.ok(readReceipt(receipt.runId).redisKeys.every((key) => key.startsWith(`{${receipt.runId}}:`)));
  assert.equal(calls[0][0], `{${receipt.runId}}:fixture`);
  assert.throws(() => client.flushAll, /UNSCOPED_REDIS_COMMAND/);
  updateReceipt(receipt.runId, (value) => value.redisKeys.push("unowned-key"));
  assert.throws(() => readReceipt(receipt.runId), /INVALID_RECEIPT/);
});
test("propriedade exige run id e prova, nao somente prefixo", () => {
  const receipt = { runId: "run", owner: "proof" };
  assert.equal(isOwned(ownedFixture(receipt), receipt), true);
  assert.equal(isOwned({ runId: "run" }, receipt), false);
  assert.equal(isOwned(ownedFixture(receipt), { ...receipt, owner: "other" }), false);
});
test("reporter ignora detalhes de erros e stdout dos provedores", async () => {
  const events = [{ type: "test:stderr", data: "synthetic-secret" }, { type: "test:fail", data: { error: "synthetic-secret" } }, { type: "test:summary", data: { counts: { tests: 2, passed: 1, failed: 1, cancelled: 0, skipped: 0 } } }];
  let output = ""; for await (const item of reporter(events)) output += item;
  assert.equal(JSON.parse(output).failed, 1); assert.ok(!output.includes("synthetic-secret"));
});
test("subprocesso registra codigo sem vazar stdout/stderr nem herdar NODE_OPTIONS", async () => {
  const result = await childProcess(["-e", 'console.log(JSON.stringify({tests:1,passed:0,failed:1,cancelled:0,skipped:0,secret:"synthetic-secret"})); console.error("synthetic-secret"); process.exit(3)'], { ...process.env, NODE_OPTIONS: "--invalid-option" });
  assert.equal(result.code, 3); assert.ok(result.stderrBytes > 0); assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});
test("templates nao carregam env.local e todos os valores sao placeholders", () => {
  const template = readFileSync(new URL("../../.env.staging.example", import.meta.url), "utf8");
  assert.ok(template.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).every((line) => /^[A-Z0-9_]+=$/.test(line)));
  const script = readFileSync(new URL("../../scripts/security-staging-preflight.mjs", import.meta.url), "utf8");
  assert.ok(!script.includes("loadLocalEnvironment("));
});
