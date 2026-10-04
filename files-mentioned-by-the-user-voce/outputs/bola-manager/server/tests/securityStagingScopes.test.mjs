import assert from "node:assert/strict";
import test from "node:test";
import { rmSync } from "node:fs";
import { SCOPES, evaluatePreflight, isolationTemplate, fingerprint, createScopeEvidence } from "../../scripts/security-staging-preflight.mjs";
import { sameTargets } from "../../scripts/security-staging-runner.mjs";
import { createReceipt, readReceipt, receiptPath } from "../../scripts/staging/fixtures.mjs";

const now = 1_800_000_000_000;
function fixture(scope) {
  const account = (id) => JSON.stringify({ type: "service_account", project_id: "isolated-fixture", client_email: `${id}@isolated-fixture.iam.gserviceaccount.com`, private_key: "-----BEGIN PRIVATE KEY-----\nsynthetic-fixture\n-----END PRIVATE KEY-----" });
  const env = { NODE_ENV: "test", BOLA_ENV_FILES: "false", STAGING_ENVIRONMENT: "staging", STAGING_ALLOW_WRITES: "false",
    STAGING_BACKEND_URL: "https://api.example.test", STAGING_FRONTEND_ORIGIN: "https://ui.example.test", VITE_SERVER_URL: "https://api.example.test", CLIENT_ORIGIN: "https://ui.example.test", TRUST_PROXY: "false",
    STAGING_REPLICA_COUNT: "2", ROOM_STORE: "firestore", ALLOW_DEMO_AUTH: "false", ALLOW_LOCAL_EDITOR: "false", METRICS_TOKEN: "m".repeat(32),
    FIREBASE_PROJECT_ID: "isolated-fixture", FIREBASE_SERVICE_ACCOUNT_JSON: account("runtime"), STAGING_FIREBASE_ADMIN_JSON: account("tests"), FIREBASE_USE_APPLICATION_DEFAULT: "false",
    VITE_FIREBASE_PROJECT_ID: "isolated-fixture", VITE_FIREBASE_API_KEY: "synthetic-web-key", VITE_FIREBASE_AUTH_DOMAIN: "isolated-fixture.firebaseapp.com", VITE_FIREBASE_APP_ID: "synthetic-app", VITE_FIREBASE_MESSAGING_SENDER_ID: "123" };
  const isolation = isolationTemplate(env);
  isolation.environment = "staging"; isolation.productionInventoryReviewed = true;
  for (const service of SCOPES[scope]) Object.assign(isolation.services[service], { environment: "staging", isolated: true, evidence: "unit fixture only" });
  const runtimeIdentity = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON).client_email, testIdentity = JSON.parse(env.STAGING_FIREBASE_ADMIN_JSON).client_email;
  isolation.reviewEvidence = { production: { projectId: "production-project", environmentId: "production-environment", serviceIds: ["production-service"] }, staging: {
    projectId: "staging-project", environmentId: "staging-environment", firebaseProject: env.FIREBASE_PROJECT_ID, firestoreDatabase: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)`, runtimeIdentity, testIdentity,
    services: [{ id: "backend", domains: { serviceDomains: [{ domain: "api.example.test" }] } }, { id: "frontend", domains: { serviceDomains: [{ domain: "ui.example.test" }] } }, { id: "redis" }] } };
  const observation = { projectId: "staging-project", environmentId: "staging-environment", backendServiceId: "backend", frontendServiceId: "frontend", redisServiceId: "redis", redisPrivate: true, redisDedicated: true,
    firebaseProject: env.FIREBASE_PROJECT_ID, database: isolation.reviewEvidence.staging.firestoreDatabase, mode: "FIRESTORE_NATIVE", runtimeIdentity, testIdentity,
    runtimeCredentialHash: fingerprint(env.FIREBASE_SERVICE_ACCOUNT_JSON), instances: ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"].map(id => ({ id, firestoreReady: true, redisReady: true })) };
  isolation.scopeEvidence = { [scope]: createScopeEvidence(env, isolation, scope, observation, now) };
  return { env, isolation, observation };
}
const evaluate = (f, scope, destructive = false, time = now) => evaluatePreflight(f.env, f.isolation, { scope, destructive, now: time });

for (const scope of Object.keys(SCOPES)) {
  test(`${scope}: read-only passes without unrelated providers; global still fails`, () => {
    const f = fixture(scope), result = evaluate(f, scope);
    assert.equal(result.ok, true);
    assert.equal(evaluatePreflight(f.env, f.isolation).ok, false);
    assert.equal(evaluatePreflight(f.env, f.isolation, { group: "all" }).ok, false);
    for (const service of ["storage", "cloudinary", "gemini", ...(scope === "frontend-socketio" ? ["REDIS_URL (local)", "TEST_REDIS_URL (local)"] : ["redis", "redisTest"])]) assert.equal(result.rows.find(row => row.name === service)?.status, "NOT_APPLICABLE");
    if (scope === "frontend-socketio") assert.equal(result.rows.find(row => row.name === "Redis (Railway private)").status, "PASS");
    assert.ok(!result.rows.some(row => row.name === "FIREBASE_STORAGE_BUCKET" || row.name === "GEMINI_API_KEY" || row.name === "REDIS_URL"));
    assert.equal(evaluate(f, scope, true).ok, false);
    f.env.STAGING_ALLOW_WRITES = "true"; assert.equal(evaluate(f, scope, true).ok, true);
  });
  for (const guard of ["inventory", "isolation", "target", "credentials", "database", "identity", "backend", "stale", "missing-evidence", "emulator", "production", "adc"]) {
    test(`${scope}: ${guard} remains fail closed`, () => {
      const f = fixture(scope), proof = f.isolation.scopeEvidence[scope];
      if (guard === "inventory") f.isolation.productionInventoryReviewed = false;
      if (guard === "isolation") f.isolation.services.firebase.isolated = false;
      if (guard === "target") f.isolation.services.firebase.targetHash = "f".repeat(64);
      if (guard === "credentials") f.env.FIREBASE_SERVICE_ACCOUNT_JSON += " ";
      if (guard === "database") proof.observation.database = "projects/production-project/databases/(default)";
      if (guard === "identity") f.env.STAGING_FIREBASE_ADMIN_JSON = f.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      if (guard === "backend") f.env.STAGING_BACKEND_URL = "https://other.example.test";
      if (guard === "stale") proof.observedAt = new Date(now - 900_001).toISOString();
      if (guard === "missing-evidence") delete f.isolation.scopeEvidence;
      if (guard === "emulator") f.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
      if (guard === "production") f.env.RAILWAY_ENVIRONMENT_NAME = "production";
      if (guard === "adc") f.env.FIREBASE_USE_APPLICATION_DEFAULT = "true";
      assert.equal(evaluate(f, scope).ok, false);
    });
  }
  test(`${scope}: receipt cannot be reused across scopes/groups`, (t) => {
    const f = fixture(scope), result = evaluate(f, scope), receipt = createReceipt("firebase", result.targetHashes, { scope });
    t.after(() => rmSync(receiptPath(receipt.runId), { force: true }));
    assert.equal(readReceipt(receipt.runId).scope, scope);
    assert.equal(sameTargets(receipt, result), true);
    assert.equal(sameTargets(receipt, { ...result, scope: undefined }), false);
    assert.equal(sameTargets(receipt, { ...result, scope: "other" }), false);
  });
}
test("frontend-socketio requires real remote Redis observations and distinct replicas", () => {
  for (const change of [o => { o.redisPrivate = false; }, o => { o.redisDedicated = false; }, o => { o.redisServiceId = "unknown"; }, o => { o.instances[0].redisReady = false; }, o => { o.instances[1].id = o.instances[0].id; }]) {
    const f = fixture("frontend-socketio"); change(f.isolation.scopeEvidence["frontend-socketio"].observation);
    assert.equal(evaluate(f, "frontend-socketio").ok, false);
  }
});
test("unknown scopes and scope/group combinations cannot silently fall back", () => {
  const f = fixture("firestore-match-persistence");
  assert.throws(() => evaluatePreflight(f.env, f.isolation, { scope: "unknown" }), /INVALID_SCOPE/);
  assert.throws(() => evaluatePreflight(f.env, f.isolation, { scope: "firestore-match-persistence", group: "firebase" }), /INVALID_SCOPE/);
});
test("partial owner inventory never confirms scope observations", () => {
  for (const field of ["projectId", "environmentId", "serviceIds"]) {
    const f = fixture("firestore-match-persistence"); delete f.isolation.reviewEvidence.production[field];
    assert.equal(evaluate(f, "firestore-match-persistence").ok, false);
  }
});
