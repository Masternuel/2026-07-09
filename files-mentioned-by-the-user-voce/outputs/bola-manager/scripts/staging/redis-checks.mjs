import assert from "node:assert/strict";
import { AI_ACQUIRE_SCRIPT, AI_RELEASE_SCRIPT, createAiUsage } from "../../server/infrastructure/aiUsage.mjs";
import { RELEASE_LOCK_SCRIPT, RENEW_LOCK_SCRIPT } from "../../server/infrastructure/distributedLock.mjs";
import { FIXED_WINDOW_SCRIPT } from "../../server/infrastructure/distributedRateLimit.mjs";

export async function checkLua(client) {
  const evaluate = (script, keys, args) => client.eval(script, { keys, arguments: args.map(String) });
  await client.set("lua:lock", "owner", { NX: true, PX: 60_000 });
  assert.equal(Number(await evaluate(RENEW_LOCK_SCRIPT, ["lua:lock"], ["intruder", 60_000])), 0);
  assert.equal(Number(await evaluate(RELEASE_LOCK_SCRIPT, ["lua:lock"], ["intruder"])), 0);
  assert.equal(Number(await evaluate(RENEW_LOCK_SCRIPT, ["lua:lock"], ["owner", 60_000])), 1);
  assert.equal(Number(await evaluate(RELEASE_LOCK_SCRIPT, ["lua:lock"], ["owner"])), 1);
  const limits = await Promise.all(Array.from({ length: 6 }, () => evaluate(FIXED_WINDOW_SCRIPT, ["lua:rate"], [1, 60_000])));
  assert.deepEqual(limits.map((value) => Number(value[0])).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  assert.ok(limits.every((value) => Number(value[1]) > 0));
  const keys = ["lua:op", "lua:uid", "lua:global", "lua:user-active", "lua:global-active"];
  const policy = { windowMs: 60_000, cooldownMs: 0, leaseMs: 60_000, operationLimit: 1, userLimit: 1, globalLimit: 1, userConcurrent: 1, globalConcurrent: 1, units: 1 };
  assert.deepEqual(await evaluate(AI_ACQUIRE_SCRIPT, keys, [JSON.stringify(policy), "lease"]), [1, "accepted"]);
  assert.deepEqual(await evaluate(AI_ACQUIRE_SCRIPT, keys, [JSON.stringify(policy), "other"]), [0, "concurrency"]);
  await evaluate(AI_RELEASE_SCRIPT, keys.slice(3), ["wrong-lease"]);
  assert.equal(await client.zCard(keys[3]), 1);
  await evaluate(AI_RELEASE_SCRIPT, keys.slice(3), ["lease"]);
  assert.equal(await client.zCard(keys[3]), 0);
  assert.deepEqual(await evaluate(AI_ACQUIRE_SCRIPT, keys, [JSON.stringify(policy), "other"]), [0, "budget"]);
  const cooldownKeys = keys.map((key) => `${key}:cooldown`);
  const cooldownPolicy = { ...policy, cooldownMs: 60_000, operationLimit: 2, userLimit: 2, globalLimit: 2 };
  await evaluate(AI_ACQUIRE_SCRIPT, cooldownKeys, [JSON.stringify(cooldownPolicy), "lease"]);
  await evaluate(AI_RELEASE_SCRIPT, cooldownKeys.slice(3), ["lease"]);
  assert.deepEqual(await evaluate(AI_ACQUIRE_SCRIPT, cooldownKeys, [JSON.stringify(cooldownPolicy), "other"]), [0, "cooldown"]);
}

export async function checkAiReservation(runtime, runId, task) {
  const usage = createAiUsage({ runtime, required: true, limits: { operationLimit: 1, userLimit: 1, globalLimit: 1, userConcurrent: 1, globalConcurrent: 1 } });
  await usage.run(runId, "interview", { units: 1, leaseMs: 60_000 }, task);
  let invoked = false;
  await assert.rejects(() => usage.run(runId, "interview", { units: 1 }, () => { invoked = true; }), { code: "AI_USAGE_LIMITED" });
  assert.equal(invoked, false);
}
