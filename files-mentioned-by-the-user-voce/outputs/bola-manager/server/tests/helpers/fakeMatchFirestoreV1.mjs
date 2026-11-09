import { encodeMatchFields } from "../../store/matchFirestoreValues.mjs";

export function createFakeMatchFirestoreV1({ intercept, closeError } = {}) {
  const database = "projects/match-fixture/databases/(default)";
  const documents = new Map();
  const versions = new Map();
  const transactions = new Map();
  const calls = [];
  let sequence = 0;
  let closed = 0;
  const error = (code) => Object.assign(new Error(`Firestore fixture status ${code}`), { code });
  const key = (transaction) => Buffer.from(transaction).toString("hex");
  const dispatch = async (method, request) => {
    if (method === "beginTransaction") {
      const transaction = Buffer.from(String(++sequence));
      transactions.set(key(transaction), new Map());
      return { transaction };
    }
    if (method === "getDocument") {
      if (request.transaction?.length) {
        const reads = transactions.get(key(request.transaction));
        if (!reads) throw error(10);
        reads.set(request.name, versions.get(request.name) ?? 0);
      }
      if (!documents.has(request.name)) throw error(5);
      return { name: request.name, fields: structuredClone(documents.get(request.name)), createTime: { seconds: 1 }, updateTime: { seconds: 1 } };
    }
    if (method === "rollback") { transactions.delete(key(request.transaction)); return {}; }
    if (method === "commit") {
      const reads = request.transaction?.length ? transactions.get(key(request.transaction)) : new Map();
      if (!reads || [...reads].some(([name, version]) => version !== (versions.get(name) ?? 0))) throw error(10);
      for (const { update } of request.writes) {
        documents.set(update.name, structuredClone(update.fields));
        versions.set(update.name, (versions.get(update.name) ?? 0) + 1);
      }
      if (request.transaction?.length) transactions.delete(key(request.transaction));
      return { commitTime: { seconds: 1, nanos: 0 }, writeResults: request.writes.map(() => ({ updateTime: { seconds: 1 } })) };
    }
    throw error(12);
  };
  return {
    database, documents, transactions, calls, dispatch,
    get closed() { return closed; },
    seed(code, record) { documents.set(`${database}/documents/activeMatches/${code}`, encodeMatchFields(record)); },
    createClient() {
      return {
        ...Object.fromEntries(["getDocument", "beginTransaction", "commit", "rollback"].map((method) => [method, (request, options) => {
          calls.push({ method, at: performance.now(), request, options });
          let rejectCall;
          let cancelled = false;
          const promise = new Promise((resolve, reject) => {
            rejectCall = reject;
            Promise.resolve().then(async () => {
              await intercept?.(method, request);
              if (cancelled) return;
              return dispatch(method, request);
            }).then((response) => { if (!cancelled) resolve([response]); }, reject);
          });
          promise.cancel = () => { cancelled = true; rejectCall(error(1)); };
          return promise;
        }])),
        async close() { closed += 1; if (closeError) throw closeError; },
      };
    },
  };
}
