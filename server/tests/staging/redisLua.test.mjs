import test from "node:test";
import assert from "node:assert/strict";
import { authorize, sameTargets } from "../../../scripts/security-staging-runner.mjs";
import { readReceipt, openRedis, closeRedis } from "../../../scripts/staging/fixtures.mjs";
import { checkLua, checkAiReservation } from "../../../scripts/staging/redis-checks.mjs";

test("Lua real: locks, rate limit e reserva de IA no namespace da execucao", { timeout: 30_000 }, async () => {
  const preflight = await authorize(process.env, "redis");
  const receipt = readReceipt(process.env.STAGING_RUN_ID);
  assert.equal(receipt.group, "redis");
  assert.equal(sameTargets(receipt, preflight), true);
  const runtime = await openRedis(process.env, receipt, { existing: true });
  try {
    await checkLua(runtime.client);
    await checkAiReservation(runtime, receipt.runId, async () => {});
  } finally { closeRedis(runtime); }
});
