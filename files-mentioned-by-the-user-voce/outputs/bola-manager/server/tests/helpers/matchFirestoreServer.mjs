import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { v1, Firestore } from "firebase-admin/firestore";
import { createFakeMatchFirestoreV1 } from "./fakeMatchFirestoreV1.mjs";

// Public package APIs; wire fixture implements only the documented Firestore RPCs
// used here. No Google service, credentials, emulator or SDK internals are used.
const sdkRequire = createRequire(import.meta.resolve("@google-cloud/firestore"));
const { grpc } = sdkRequire("google-gax");
const gaxRequire = createRequire(sdkRequire.resolve("google-gax"));
const loader = gaxRequire("@grpc/proto-loader");
const { OAuth2Client } = gaxRequire("google-auth-library");
const definition = loader.loadSync(fileURLToPath(new URL("../fixtures/matchFirestore.proto", import.meta.url)), {
  longs: String, enums: String, defaults: false, oneofs: true,
});

function fromRest(value) {
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map(fromRest);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === "nullValue" && item === null ? 0 : fromRest(item)]));
}

export function matchV1Source(port, extra = {}, beforeHeaders) {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: "synthetic-loopback-only", expiry_date: Date.now() + 3_600_000 });
  if (beforeHeaders) {
    const headers = auth.getRequestHeaders.bind(auth);
    auth.getRequestHeaders = async (...args) => { await beforeHeaders(); return headers(...args); };
  }
  const calls = [];
  return {
    database: "projects/match-fixture/databases/(default)",
    calls,
    createClient: () => {
      const client = new v1.FirestoreClient({
        projectId: "match-fixture", apiEndpoint: "127.0.0.1", port,
        fallback: true, protocol: "http", auth, ...extra,
      });
      for (const method of ["getDocument", "beginTransaction", "commit", "rollback"]) {
        const original = client[method].bind(client);
        client[method] = (request, options) => {
          calls.push({ method, at: performance.now(), timeout: options.timeout, retry: options.retry });
          return original(request, options);
        };
      }
      return client;
    },
  };
}

export async function startMatchFirestoreServer({ before, after, beforeHeaders } = {}) {
  const state = createFakeMatchFirestoreV1();
  const calls = [];
  const connections = new Set();
  const requestHeaders = [];
  const server = new grpc.Server();
  const run = async (method, call) => {
    calls.push({ method, at: performance.now(), request: structuredClone(call.request), deadline: call.getDeadline() });
    await before?.(method, call);
    if (call.cancelled) throw Object.assign(new Error("fixture cancelled"), { code: 1 });
    const result = await state.dispatch(method, call.request);
    await after?.(method, call, result);
    return result;
  };
  server.addService(grpc.loadPackageDefinition(definition).google.firestore.v1.Firestore.service, {
    ...Object.fromEntries(["getDocument", "beginTransaction", "commit", "rollback"].map((method) => [method,
      (call, callback) => { run(method, call).then((value) => callback(null, value), callback); },
    ])),
    async batchGetDocuments(call) {
      try {
        let transaction = call.request.transaction;
        if (call.request.newTransaction) ({ transaction } = await state.dispatch("beginTransaction", {}));
        for (const name of call.request.documents) {
          try {
            const found = await state.dispatch("getDocument", { name, transaction });
            call.write({ found, transaction, readTime: { seconds: 1 } });
          } catch (error) {
            if (error.code !== 5) throw error;
            call.write({ missing: name, transaction, readTime: { seconds: 1 } });
          }
        }
        call.end();
      } catch (error) { call.destroy(error); }
    },
  });
  const port = await new Promise((resolve, reject) => server.bindAsync("127.0.0.1:0", grpc.ServerCredentials.createInsecure(), (error, port) => error ? reject(error) : resolve(port)));
  const rest = createServer(async (request, response) => {
    requestHeaders.push({ connection: request.headers.connection });
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      const path = url.pathname.replace(/^\/v1\//, "");
      const method = path.endsWith(":beginTransaction") ? "beginTransaction"
        : path.endsWith(":commit") ? "commit" : path.endsWith(":rollback") ? "rollback" : "getDocument";
      const input = method === "getDocument" ? { name: decodeURIComponent(path), transaction: url.searchParams.get("transaction") || undefined }
        : { ...body, database: path.split("/documents:")[0] };
      if (input.transaction) input.transaction = Buffer.from(input.transaction, "base64");
      const methodDefinition = grpc.loadPackageDefinition(definition).google.firestore.v1.Firestore.service[method[0].toUpperCase() + method.slice(1)];
      const decoded = methodDefinition.requestDeserialize(methodDefinition.requestSerialize(fromRest(input)));
      const call = { request: decoded, get cancelled() { return response.destroyed; }, getDeadline: () => null };
      const result = await run(method, call);
      const output = { ...result };
      if (output.transaction) output.transaction = Buffer.from(output.transaction).toString("base64");
      for (const field of ["commitTime", "createTime", "updateTime"]) if (output[field]) output[field] = "1970-01-01T00:00:01Z";
      if (output.writeResults) output.writeResults = output.writeResults.map(() => ({ updateTime: "1970-01-01T00:00:01Z" }));
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(output, (_, value) => typeof value === "number" && !Number.isFinite(value) ? String(value) : value));
    } catch (error) {
      const status = { 1: 499, 5: 404, 7: 403, 10: 409, 14: 503 }[error.code] ?? 500;
      const name = { 1: "CANCELLED", 5: "NOT_FOUND", 7: "PERMISSION_DENIED", 10: "ABORTED", 14: "UNAVAILABLE" }[error.code] ?? "INTERNAL";
      response.writeHead(status, { "content-type": "application/json", connection: "close" });
      response.end(JSON.stringify({ error: { code: status, status: name, message: "local fixture" } }));
    }
  });
  rest.on("connection", (socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
  });
  await new Promise((resolve) => rest.listen(0, "127.0.0.1", resolve));
  return {
    state, calls, connections, requestHeaders, source: matchV1Source(rest.address().port, {}, beforeHeaders),
    legacyClient: () => new Firestore({ projectId: "match-fixture", host: `127.0.0.1:${port}`, ssl: false }),
    close: async () => {
      await new Promise((resolve) => rest.close(resolve));
      await new Promise((resolve, reject) => server.tryShutdown((error) => error ? reject(error) : resolve()));
    },
  };
}
