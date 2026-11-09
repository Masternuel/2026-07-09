import test from "node:test";
import assert from "node:assert/strict";
import { createAiUsage, AI_ACQUIRE_SCRIPT, AI_RELEASE_SCRIPT } from "../infrastructure/aiUsage.mjs";
import { createSocialAiService } from "../services/socialAi.mjs";
import { createCoachInterviewAiService } from "../services/coachInterviewAi.mjs";

// Atomic Redis contract double: shared hashes/zsets, no per-replica state.
function backend() {
  const hashes = new Map();
  const active = new Map();
  const state = { now: 1_000, calls: 0 };
  state.runtime = () => ({ enabled: true, publisher: { isReady: true }, subscriber: { isReady: true }, client: {
    isReady: true,
    async eval(script, { keys, arguments: args }) {
      state.calls += 1;
      if (script === AI_RELEASE_SCRIPT) {
        keys.forEach((key) => active.get(key)?.delete(args[0]));
        return 1;
      }
      assert.equal(script, AI_ACQUIRE_SCRIPT);
      const p = JSON.parse(args[0]);
      const counters = keys.slice(0, 3).map((key) => {
        const old = hashes.get(key);
        return { count: old?.reset > state.now ? old.count : 0, reset: old?.reset > state.now ? old.reset : state.now + p.windowMs, cooldown: old?.cooldown ?? 0 };
      });
      if (counters[0].cooldown > state.now) return [0, "cooldown"];
      const sets = keys.slice(3).map((key) => {
        if (!active.has(key)) active.set(key, new Map());
        const set = active.get(key);
        for (const [id, expiry] of set) if (expiry <= state.now) set.delete(id);
        return set;
      });
      if (sets[0].size >= p.userConcurrent || sets[1].size >= p.globalConcurrent) return [0, "concurrency"];
      if (counters.some((value, i) => value.count + p.units > [p.operationLimit, p.userLimit, p.globalLimit][i])) return [0, "budget"];
      counters.forEach((value, i) => hashes.set(keys[i], { ...value, count: value.count + p.units, ...(i === 0 ? { cooldown: state.now + p.cooldownMs } : {}) }));
      sets.forEach((set) => set.set(args[1], state.now + p.leaseMs));
      return [1, "accepted"];
    },
  } });
  return state;
}
const limited = (reason) => (error) => error.code === "AI_USAGE_LIMITED" && error.details.reason === reason;

test("IA aceita primeira chamada, compartilha cooldown entre replicas e separa UID/operacao", async () => {
  const redis = backend();
  const a = createAiUsage({ runtime: redis.runtime(), required: true });
  const b = createAiUsage({ runtime: redis.runtime(), required: true });
  await (await a.acquire("A", "feed"))();
  await assert.rejects(b.acquire("A", "feed"), limited("cooldown"));
  await (await b.acquire("B", "feed"))();
  await (await b.acquire("A", "post"))();
  redis.now += 10_001;
  await (await b.acquire("A", "feed"))();
});

test("IA concorrente em replicas diferentes nao ultrapassa admissao por UID", async () => {
  const redis = backend();
  const replicas = [createAiUsage({ runtime: redis.runtime() }), createAiUsage({ runtime: redis.runtime() })];
  const results = await Promise.allSettled(replicas.map((replica) => replica.acquire("A", "feed")));
  assert.equal(results.filter((value) => value.status === "fulfilled").length, 1);
  await assert.rejects(replicas[1].acquire("A", "post"), limited("concurrency"));
  await results.find((value) => value.status === "fulfilled").value();
  await (await replicas[1].acquire("A", "post"))();
});

test("orcamento global cobre retries e nao pode ser excedido alternando replicas/UID", async () => {
  const redis = backend();
  const limits = { globalLimit: 5 };
  const a = createAiUsage({ runtime: redis.runtime(), limits });
  const b = createAiUsage({ runtime: redis.runtime(), limits });
  await (await a.acquire("A", "feed", { units: 3 }))();
  await assert.rejects(b.acquire("B", "feed", { units: 3 }), limited("budget"));
  await (await b.acquire("B", "feed", { units: 2 }))();
  await assert.rejects(a.acquire("C", "post"), limited("budget"));
  redis.now += 3_600_001;
  await (await b.acquire("C", "post"))();
});

test("limites por UID e operacao independem da sala e de outras operacoes", async () => {
  const redis = backend();
  const usage = createAiUsage({ runtime: redis.runtime(), limits: { userLimit: 3, operationLimit: 2 } });
  await (await usage.acquire("A", "feed", { units: 2 }))();
  redis.now += 10_001;
  await assert.rejects(usage.acquire("A", "feed"), limited("budget"));
  await (await usage.acquire("A", "post"))();
  await assert.rejects(usage.acquire("A", "comment"), limited("budget"));
  await (await usage.acquire("B", "comment"))();
});

test("concorrencia global limita UIDs distintos e recupera reserva expirada", async () => {
  const redis = backend();
  const a = createAiUsage({ runtime: redis.runtime(), limits: { globalConcurrent: 1 } });
  const b = createAiUsage({ runtime: redis.runtime(), limits: { globalConcurrent: 1 } });
  const oldRelease = await a.acquire("A", "feed", { leaseMs: 10 });
  await assert.rejects(b.acquire("B", "post"), limited("concurrency"));
  redis.now += 11;
  const release = await b.acquire("B", "post");
  await oldRelease();
  await assert.rejects(a.acquire("C", "post"), limited("concurrency"));
  await release();
});

test("erro libera concorrencia mas nao reembolsa custo potencial do provedor", async () => {
  const redis = backend();
  const usage = createAiUsage({ runtime: redis.runtime(), limits: { globalLimit: 1 } });
  await assert.rejects(usage.run("A", "feed", {}, async () => { throw new Error("provider failed"); }), /provider failed/);
  await assert.rejects(usage.acquire("B", "post"), limited("budget"));
});

test("Redis obrigatorio ausente/indisponivel/falhando nunca libera geracao paga", async () => {
  const redis = backend();
  const failed = redis.runtime();
  failed.client.eval = async () => { throw new Error("redis://private:secret@internal"); };
  for (const runtime of [null, { enabled: false }, { ...redis.runtime(), subscriber: { isReady: false } }, failed]) {
    let calls = 0;
    const usage = createAiUsage({ runtime, required: true });
    await assert.rejects(usage.run("A", "feed", {}, () => { calls += 1; }), (error) => error.code === "REDIS_REQUIRED" && !/secret|internal/.test(error.message));
    assert.equal(calls, 0);
  }
});

test("Redis pendente retorna indisponibilidade limitada sem acessar provedor", async () => {
  const runtime = backend().runtime();
  runtime.client.eval = () => new Promise(() => {});
  await assert.rejects(createAiUsage({ runtime, required: true, commandTimeoutMs: 5 }).acquire("A", "feed"), { code: "REDIS_REQUIRED" });
});

test("desenvolvimento local preserva cooldown e orcamento sem Redis", async () => {
  let now = 0;
  const usage = createAiUsage({ now: () => now, limits: { globalLimit: 2 } });
  await (await usage.acquire("A", "feed"))();
  await assert.rejects(usage.acquire("A", "feed"), limited("cooldown"));
  now += 10_001;
  await (await usage.acquire("A", "feed"))();
  await assert.rejects(usage.acquire("B", "post"), limited("budget"));
});

test("servicos social/entrevista usam a reserva antes de qualquer fetch", async () => {
  let fetches = 0;
  const usage = createAiUsage({ required: true });
  const options = { usage, apiKey: "test-key", fetchImpl: async () => { fetches += 1; throw new Error("unexpected fetch"); }, logger: { warn() {} } };
  await assert.rejects(createSocialAiService(options).generate({ posts: [], clubName: "Clube" }, { uid: "A", operation: "feed" }), { code: "REDIS_REQUIRED" });
  await assert.rejects(createCoachInterviewAiService(options).generateTurn({}, { uid: "A" }), { code: "REDIS_REQUIRED" });
  assert.equal(fetches, 0);
});

test("servico reserva pior caso de tentativas com UID do servidor", async () => {
  let reservation;
  let uid;
  const usage = { async run(actor, _operation, limits, task) { uid = actor; reservation = limits; return task(); } };
  const service = createSocialAiService({ usage, apiKey: "test-key", model: "test-model", fallbackModels: ["fallback-model"], retriesPerModel: 1, retryDelayMs: 0, fetchImpl: async () => new Response("{}", { status: 400 }), logger: { warn() {} } });
  await service.generate({ clubName: "Clube", posts: [] }, { uid: "server-uid", operation: "post" });
  assert.equal(uid, "server-uid");
  assert.equal(reservation.units, 4);
  assert.ok(reservation.leaseMs > 0);
});
