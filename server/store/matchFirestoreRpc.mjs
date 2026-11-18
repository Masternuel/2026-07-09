import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { decodeMatchFields, encodeMatchFields } from "./matchFirestoreValues.mjs";

function timeoutError(label, cause) {
  const dependency = Object.assign(new Error(`match-persistence:${label} readiness timeout`), {
    name: "TimeoutError", code: "DEPENDENCY_TIMEOUT", ...(cause ? { cause } : {}),
  });
  return Object.assign(new Error(`Persistencia da partida excedeu o tempo limite (${label})`), {
    code: "MATCH_PERSISTENCE_TIMEOUT", status: 503, expose: true, cause: dependency,
  });
}

function closedError() {
  return Object.assign(new Error("Persistencia de partidas encerrada"), { code: "MATCH_PERSISTENCE_CLOSED" });
}

export class MatchFirestoreRpc {
  #source;
  #collection;
  #timeoutMs;
  #active = new Set();
  #closed = false;

  constructor(source, { collectionName = "activeMatches", operationTimeoutMs = 15_000 } = {}) {
    if (!source?.createClient || !/^projects\/[^/]+\/databases\/[^/]+$/.test(source.database)) {
      throw new Error("Cliente Firestore v1 e obrigatorio para persistir partidas em andamento");
    }
    if (!collectionName || collectionName.split("/").some((part) => !part)
      || collectionName.split("/").length % 2 !== 1) throw new Error("Colecao de partidas invalida");
    this.#source = source;
    this.#collection = collectionName;
    this.#timeoutMs = Number.isInteger(Number(operationTimeoutMs)) && Number(operationTimeoutMs) > 0
      ? Number(operationTimeoutMs) : 15_000;
  }

  #name(code) {
    if (!code || code.includes("/")) throw new Error("Codigo de partida invalido");
    return `${this.#source.database}/documents/${this.#collection}/${code}`;
  }

  async #run(label, operation) {
    if (this.#closed) throw closedError();
    const deadline = performance.now() + this.#timeoutMs;
    const client = this.#source.createClient();
    let activeCall;
    let rejectActive;
    let stopped;
    let commitSent = false;
    let finish;
    const done = new Promise((resolve) => { finish = resolve; });
    const stop = (error) => {
      stopped ??= error;
      // Public GAX cancellation aborts the underlying REST request (or gRPC call),
      // including a call still awaiting client initialization. Not a Promise.race.
      try { activeCall?.cancel(); } finally {
        // Some GAX transports abort the HTTP body without settling their returned
        // promise. Settle our operation too, AFTER invoking real transport abort.
        rejectActive?.(stopped);
      }
    };
    const remaining = () => {
      if (!stopped && performance.now() >= deadline) stop(timeoutError(label));
      if (stopped) throw stopped;
      return Math.max(1, Math.floor(deadline - performance.now()));
    };
    const handle = { stop, done };
    this.#active.add(handle);
    const timer = setTimeout(() => stop(timeoutError(label)), Math.max(0, deadline - performance.now()));
    const rpc = async (method, request) => {
      const timeout = remaining();
      if (method === "commit") commitSent = true;
      activeCall = client[method](request, {
        timeout, retry: null,
        // REST's public close() does not own Node's shared keep-alive agent.
        // Do not leave an idle connection behind when this operation closes.
        otherArgs: { headers: { connection: "close" } },
      });
      try {
        const [response] = await new Promise((resolve, reject) => {
          rejectActive = reject;
          activeCall.then(resolve, reject);
        });
        remaining();
        return response;
      } catch (error) {
        if (error?.code === 4 && !stopped) stopped = timeoutError(label, error);
        throw stopped ?? error;
      } finally {
        activeCall = null;
        rejectActive = null;
      }
    };
    let result;
    let failure;
    try {
      result = await operation({ rpc, remaining, resetCommit: () => { commitSent = false; } });
    } catch (error) {
      failure = error;
      // Sending Commit and losing its response is NOT evidence of rollback.
      if (commitSent && error?.code !== 10) error.commitOutcome = "unknown";
    } finally {
      clearTimeout(timer);
      try {
        await client.close();
      } catch (error) {
        failure ??= error;
      } finally {
        this.#active.delete(handle);
        finish();
      }
    }
    if (failure) throw failure;
    return result;
  }

  async #read(rpc, name, transaction) {
    try {
      const document = await rpc("getDocument", { name, ...(transaction ? { transaction } : {}) });
      return decodeMatchFields(document.fields ?? {});
    } catch (error) {
      if (error?.code === 5) return null;
      throw error;
    }
  }

  get(code) {
    const name = this.#name(code);
    return this.#run("get", ({ rpc }) => this.#read(rpc, name));
  }

  update(code, label, decide) {
    const name = this.#name(code);
    const database = this.#source.database;
    return this.#run(label, async ({ rpc, remaining, resetCommit }) => {
      // Match the high-level SDK's five transaction attempts, but retry ONLY an
      // explicit ABORTED response. Never retry a possibly committed operation.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        let transaction;
        let commitSent = false;
        try {
          remaining();
          resetCommit();
          ({ transaction } = await rpc("beginTransaction", { database, options: { readWrite: {} } }));
          if (!transaction?.length) throw new Error("Firestore nao retornou uma transacao");
          const current = await this.#read(rpc, name, transaction);
          remaining();
          const { record, result } = decide(current);
          remaining();
          if (record === undefined) {
            await rpc("rollback", { database, transaction });
          } else {
            const fields = encodeMatchFields(record);
            remaining();
            commitSent = true;
            await rpc("commit", { database, transaction, writes: [{ update: { name, fields } }] });
          }
          return result;
        } catch (error) {
          // No new RPC (including rollback) after the budget. A sent/ambiguous
          // commit must not be described as rolled back; the server owns expiry.
          if (transaction && (!commitSent || error?.code === 10)) {
            try { await rpc("rollback", { database, transaction }); } catch { /* Preserve the original failure. */ }
          }
          if (error?.code !== 10 || attempt === 4) throw error;
          resetCommit();
          const wait = Math.min(20 * 2 ** attempt, remaining());
          await delay(wait);
        }
      }
    });
  }

  async close() {
    this.#closed = true;
    const active = [...this.#active];
    for (const operation of active) operation.stop(closedError());
    await Promise.all(active.map((operation) => operation.done));
  }
}
