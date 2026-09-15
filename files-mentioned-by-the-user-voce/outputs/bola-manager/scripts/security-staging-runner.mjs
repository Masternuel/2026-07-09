import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { GROUPS, evaluatePreflight, readIsolation, printPreflight } from "./security-staging-preflight.mjs";
import { createReceipt, readReceipt, updateReceipt, openRedis, closeRedis, cleanupRedis } from "./staging/fixtures.mjs";

export async function authorize(env, group) {
  const result = evaluatePreflight(env, await readIsolation(env), { group, destructive: true });
  if (!result.ok) {
    printPreflight(result);
    throw new Error("STAGING_BLOCKED");
  }
  return result;
}

export function sameTargets(receipt, result) {
  return Object.keys(result.targetHashes).length === Object.keys(receipt.targetHashes ?? {}).length
    && Object.entries(result.targetHashes).every(([name, hash]) => receipt.targetHashes[name] === hash);
}

async function worker(env, group, runId, cleanup) {
  const result = await authorize(env, group);
  const receipt = readReceipt(runId);
  if (receipt.group !== group || !sameTargets(receipt, result) || receipt.state === "cleaned") throw new Error("RECEIPT_MISMATCH");
  const providers = await import("./staging/providers.mjs");
  if (cleanup) {
    if (["redis", "ai"].includes(group)) await cleanupRedis(env, receipt);
    if (group === "firebase") await providers.cleanupFirebase(env, receipt);
    if (group === "media") await providers.cleanupMedia(env, receipt);
    updateReceipt(runId, (value) => { value.state = "cleaned"; });
    return;
  }
  if (group === "firebase") await providers.checkFirebase(env, receipt);
  if (group === "media") await providers.checkMedia(env, receipt);
  if (group === "ai") await providers.checkAi(env, receipt);
}

export async function childProcess(args, env) {
  const started = Date.now();
  return new Promise((resolveResult) => {
    // Do not inherit NODE_OPTIONS, provider debug flags, startup hooks or automatic env loading.
    const childEnv = Object.fromEntries(Object.entries(env).filter(([name]) => /^(?:PATH|Path|SystemRoot|WINDIR|TEMP|TMP|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|NODE_ENV|BOLA_ENV_FILES|STAGING_.*|TEST_REDIS_URL|REDIS_URL|FIREBASE_.*|CLOUDINARY_.*|GEMINI_.*|GOOGLE_APPLICATION_CREDENTIALS|TRUST_PROXY|RAILWAY_ENVIRONMENT_NAME|APP_ENV|ENVIRONMENT)$/.test(name)));
    const child = spawn(process.execPath, args, { cwd: fileURLToPath(new URL("../", import.meta.url)), env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let stderrBytes = 0;
    let timedOut = false;
    child.stdout.on("data", (chunk) => { if (output.length < 32_768) output += chunk; });
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120_000);
    child.once("error", () => { clearTimeout(timer); resolveResult({ code: 1, signal: null, durationMs: Date.now() - started, stderrBytes, timedOut }); });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      let counts;
      for (const line of output.split("\n")) {
        try {
          const value = JSON.parse(line);
          const keys = ["tests", "passed", "failed", "cancelled", "skipped"];
          if (keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) counts = Object.fromEntries(keys.map((key) => [key, value[key]]));
        } catch { /* Drop all raw child output, including assertion messages. */ }
      }
      resolveResult({ code, signal, durationMs: Date.now() - started, stderrBytes, timedOut, ...(counts ? { counts } : {}) });
    });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--worker" && args.length === 3 && ["check", "cleanup"].includes(args[2])) {
    await worker(process.env, args[0], args[1], args[2] === "cleanup");
    return;
  }
  const cleanup = command === "cleanup";
  if ((!cleanup && (!Object.hasOwn(GROUPS, command) || command === "all" || args.length)) || (cleanup && args.length !== 1)) throw new Error("INVALID_ARGUMENTS");
  const previous = cleanup ? readReceipt(args[0]) : null;
  const group = previous?.group ?? command;
  const result = await authorize(process.env, group);
  if (previous && !sameTargets(previous, result)) throw new Error("RECEIPT_MISMATCH");
  const receipt = previous ?? createReceipt(group, result.targetHashes);
  console.log(`Run: ${receipt.runId}; stage: ${cleanup ? "cleanup" : group}`);
  let childArgs;
  if (group === "redis" && !cleanup) {
    const runtime = await openRedis(process.env, receipt);
    closeRedis(runtime);
    childArgs = ["--test", "--test-concurrency=1", "--test-reporter=./scripts/staging/reporter.mjs", "server/tests/socketClusterRedis.test.mjs", "server/tests/staging/redisLua.test.mjs"];
  } else childArgs = ["scripts/security-staging-runner.mjs", "--worker", group, receipt.runId, cleanup ? "cleanup" : "check"];
  const outcome = await childProcess(childArgs, { ...process.env, STAGING_RUN_ID: receipt.runId });
  const passed = outcome.code === 0 && !outcome.timedOut && (group !== "redis" || cleanup
    || (outcome.counts?.tests === 2 && outcome.counts.passed === 2 && outcome.counts.skipped === 0 && outcome.counts.failed === 0 && outcome.counts.cancelled === 0));
  updateReceipt(receipt.runId, (value) => {
    value.lastResult = outcome;
    if (!cleanup) value.state = passed ? "passed" : "failed";
  });
  console.log(`${passed ? "PASS" : "INVALID"}: ${JSON.stringify(outcome)}`);
  console.log(cleanup
    ? passed ? "Cleanup processed only recorded run fixtures." : "Cleanup refused or incomplete; retain the receipt for investigation."
    : "Cleanup is separate; retain the run ID and local receipt.");
  process.exitCode = passed ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error("Staging: INVALID; blocked or incomplete. No automatic retry/cleanup."); process.exitCode = 1; });
}
