import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RUN_PATTERN = /^security-validation-\d{13}-[a-f0-9]{24}$/;
const ROOT = fileURLToPath(new URL("../../.tmp/security-staging/", import.meta.url));
export function validRunId(value) { return RUN_PATTERN.test(value ?? ""); }
export function receiptPath(runId) {
  if (!validRunId(runId)) throw new Error("INVALID_RUN_ID");
  return resolve(ROOT, `${runId}.json`);
}
export function readReceipt(runId) {
  const receipt = JSON.parse(readFileSync(receiptPath(runId), "utf8"));
  if (receipt.version !== 1 || receipt.runId !== runId || !["redis", "firebase", "media", "ai"].includes(receipt.group)
    || !/^[a-f0-9]{48}$/.test(receipt.owner ?? "") || !Array.isArray(receipt.redisKeys)
    || receipt.redisKeys.length > 200 || !receipt.redisKeys.every((key) => typeof key === "string" && key.startsWith(`{${runId}}:`) && key.length < 1024)) throw new Error("INVALID_RECEIPT");
  return receipt;
}
export function createReceipt(group, targetHashes) {
  const runId = `security-validation-${Date.now()}-${randomBytes(12).toString("hex")}`;
  const receipt = { version: 1, runId, group, targetHashes, owner: randomBytes(24).toString("hex"), createdAt: new Date().toISOString(), redisKeys: [], state: "pending" };
  mkdirSync(dirname(receiptPath(runId)), { recursive: true });
  writeFileSync(receiptPath(runId), `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return receipt;
}
export function updateReceipt(runId, update) {
  const receipt = readReceipt(runId);
  update(receipt);
  const path = receiptPath(runId);
  const temporary = `${path}.write`;
  writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
  return receipt;
}
export const ownerKey = (runId) => `{${runId}}:owner`;

export function scopedRedis(client, runId) {
  const keyFor = (key) => {
    const result = `{${runId}}:${key}`;
    updateReceipt(runId, (receipt) => {
      if (!receipt.redisKeys.includes(result)) receipt.redisKeys.push(result);
      if (receipt.redisKeys.length > 200) throw new Error("FIXTURE_LIMIT");
    });
    return result;
  };
  const keyed = new Set(["set", "get", "incr", "pTTL", "hGet", "zCard", "exists"]);
  return new Proxy(client, {
    get(target, property) {
      if (property === "eval") return (script, options) => target.eval(script, { ...options, keys: options.keys.map(keyFor) });
      if (keyed.has(property)) return (key, ...args) => target[property](keyFor(key), ...args);
      if (["isReady", "isOpen"].includes(property)) return target[property];
      if (["ping", "quit", "disconnect", "destroy", "on"].includes(property)) return target[property].bind(target);
      throw new Error("UNSCOPED_REDIS_COMMAND");
    },
  });
}

export async function openRedis(env, receipt, { existing = false } = {}) {
  const { createRedisRuntime } = await import("../../server/infrastructure/redisRuntime.mjs");
  const url = receipt.group === "redis" ? env.TEST_REDIS_URL : env.REDIS_URL;
  const runtime = await createRedisRuntime({ url, socket: { reconnectStrategy: false }, logger: { error() {} } });
  const client = runtime.client;
  try {
    if (existing) {
      if (await client.get(ownerKey(receipt.runId)) !== receipt.owner) throw new Error("OWNERSHIP_UNCONFIRMED");
    } else if (await client.set(ownerKey(receipt.runId), receipt.owner, { NX: true }) !== "OK") {
      throw new Error("RUN_ALREADY_EXISTS");
    }
    return { ...runtime, raw: client, client: scopedRedis(client, receipt.runId) };
  } catch (error) { closeRedis(runtime); throw error; }
}

export function closeRedis(runtime) {
  for (const client of [runtime.raw ?? runtime.client, runtime.publisher, runtime.subscriber]) if (client?.isOpen) client.destroy();
}

const CLEANUP_REDIS = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
for i = 2, #KEYS do redis.call('DEL', KEYS[i]) end
redis.call('DEL', KEYS[1])
return 1
`;
export async function cleanupRedis(env, receipt) {
  const runtime = await openRedis(env, receipt, { existing: true });
  try {
    const deleted = await runtime.raw.eval(CLEANUP_REDIS, { keys: [ownerKey(receipt.runId), ...receipt.redisKeys], arguments: [receipt.owner] });
    if (Number(deleted) !== 1) throw new Error("OWNERSHIP_UNCONFIRMED");
  } finally { closeRedis(runtime); }
}
