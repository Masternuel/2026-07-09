import test from "node:test";
import assert from "node:assert/strict";
import { io as createClient } from "socket.io-client";
import { MemoryRoomPersistence, FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { roomCreationOperation } from "../store/roomCreationOperation.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { startTestServer, jsonRequest } from "./testHarness.mjs";

const input = { name: "Sala idempotente", creatorId: "uid-owner", creatorName: "Owner", clubId: "AUR",
  activeLeagues: ["BR-A"], seasonLength: 1, unlimitedSeasons: false, maxManagers: 6, operationId: "create-1" };

function setup(kind) {
  const firestore = kind === "firestore" ? createFakeFirestore() : null;
  const persistence = firestore ? new FirestoreRoomPersistence(firestore) : new MemoryRoomPersistence();
  let code = 0;
  const makeStore = (adapter = persistence, extra = {}) => new RoomStore({ persistence: adapter,
    codeFactory: () => `BOLA-${String(++code).padStart(4, "0")}`, ...extra });
  return { firestore, persistence, makeStore, store: makeStore() };
}

for (const kind of ["memory", "firestore"]) {
  test(`${kind}: retry apos resposta perdida e reload retorna sala atual, sem consultar catalogo`, async () => {
    const { firestore, persistence, makeStore, store } = setup(kind);
    const created = await store.createRoom(input);
    await store.setReady(created.code, input.creatorId, true);
    const adapter = firestore ? new FirestoreRoomPersistence(firestore) : persistence;
    const retry = makeStore(adapter, { catalogStore: { forOwner() { throw new Error("offline"); } } });
    const recovered = await retry.createRoom({ ...input, creatorName: "Nome atualizado" });
    assert.equal(recovered.id, created.id);
    assert.equal(recovered.managers[0].ready, true);
    assert.equal((await retry.listRoomsForManager(input.creatorId)).length, 1);
  });

  test(`${kind}: replicas concorrentes publicam apenas uma sala por operacao`, async () => {
    const { firestore, persistence, makeStore } = setup(kind);
    const secondAdapter = firestore ? new FirestoreRoomPersistence(firestore) : persistence;
    const stores = [makeStore(), makeStore(secondAdapter)];
    const rooms = await Promise.all(stores.map((store) => store.createRoom(input)));
    assert.equal(rooms[0].id, rooms[1].id);
    assert.equal((await stores[0].listRoomsForManager(input.creatorId)).length, 1);
  });

  test(`${kind}: mesmo ID com outro payload rejeitado; outro ID ou conta permite nova sala`, async () => {
    const { store } = setup(kind);
    const first = await store.createRoom(input);
    await assert.rejects(store.createRoom({ ...input, name: "Outra sala" }), { code: "ROOM_CREATION_CONFLICT" });
    const second = await store.createRoom({ ...input, operationId: "create-2" });
    const other = await store.createRoom({ ...input, creatorId: "uid-other" });
    assert.equal(new Set([first.id, second.id, other.id]).size, 3);
    assert.equal((await store.listRoomsForManager(input.creatorId)).length, 2);
  });

  test(`${kind}: retry de sala excluida nao ressuscita nem cria substituta`, async () => {
    const { store, persistence } = setup(kind);
    const room = await store.createRoom(input);
    await store.deleteRoom(room.code, input.creatorId);
    await assert.rejects(store.createRoom(input), { code: "ROOM_CREATION_GONE" });
    assert.equal((await store.listRoomsForManager(input.creatorId)).length, 0);
    assert.equal((await persistence.findCreation(roomCreationOperation(input))).roomId, room.id);
  });

  test(`${kind}: requestId funciona como alias; chamadas legadas continuam independentes`, async () => {
    const { store } = setup(kind);
    const first = await store.createRoom({ ...input, operationId: undefined, requestId: "alias-1" });
    assert.equal((await store.createRoom({ ...input, operationId: "alias-1" })).id, first.id);
    await assert.rejects(store.createRoom({ ...input, requestId: "diferente" }), { code: "VALIDATION_ERROR" });
    const legacy = { ...input, operationId: undefined };
    assert.notEqual((await store.createRoom(legacy)).id, (await store.createRoom(legacy)).id);
  });
}

function failActivation(firestore, phase) {
  const transaction = firestore.runTransaction.bind(firestore);
  let armed = true;
  firestore.runTransaction = (callback, options) => transaction(async (tx) => {
    const set = tx.set.bind(tx);
    tx.set = (reference, ...args) => {
      if (armed && reference.path.startsWith("roomsCreationOperations/")) {
        armed = false;
        if (phase === "after") firestore.failAfterCommit(new Error("ACK perdido"), "transaction");
        else firestore.failBeforeCommit(new Error("Falha de ativacao"));
      }
      return set(reference, ...args);
    };
    return callback(tx);
  }, options);
}

test("Firestore: falha na ativacao nao grava sala ou recibo; retry pode concluir", async () => {
  const { firestore, store, persistence } = setup("firestore");
  failActivation(firestore, "before");
  await assert.rejects(store.createRoom(input), /Falha de ativacao/);
  assert.equal(await persistence.findCreation(roomCreationOperation(input)), null);
  assert.equal((await store.listRoomsForManager(input.creatorId)).length, 0);
  await store.createRoom(input);
  assert.equal((await store.listRoomsForManager(input.creatorId)).length, 1);
});

test("Firestore: ACK da transacao perdido preserva publicacao atomica e replay apos reinicio", async () => {
  const { firestore, store, makeStore } = setup("firestore");
  failActivation(firestore, "after");
  const created = await store.createRoom(input);
  const recovered = await makeStore(new FirestoreRoomPersistence(firestore)).createRoom(input);
  assert.equal(recovered.id, created.id);
  assert.equal(firestore.dump("roomsCreationOperations").size, 1);
});

test("Firestore: recibo corrompido falha fechado, sem criar outra sala", async () => {
  const { firestore, store } = setup("firestore");
  await store.createRoom(input);
  const operation = roomCreationOperation(input);
  const path = `roomsCreationOperations/${operation.key}`;
  firestore.seed(path, { ...firestore.read(path), roomId: null });
  await assert.rejects(store.createRoom(input), { code: "ROOM_CREATION_RECEIPT_INVALID" });
  assert.equal((await store.listRoomsForManager(input.creatorId)).length, 1);
});

function connect(url) {
  return new Promise((resolve, reject) => {
    const client = createClient(url, { auth: { token: "owner-token" }, forceNew: true, reconnection: false });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

test("Socket real: timeout depois do commit, retry concorrente, reconnect e retry HTTP", async (t) => {
  const { store } = setup("memory");
  const create = store.createRoom.bind(store);
  let release;
  const responseGate = new Promise((resolve) => { release = resolve; });
  let committed;
  const committedGate = new Promise((resolve) => { committed = resolve; });
  let first = true;
  store.createRoom = async (payload) => {
    const room = await create(payload);
    if (first) { first = false; committed(room); await responseGate; }
    return room;
  };
  const { server, url } = await startTestServer({ store });
  const clients = [];
  t.after(async () => { release(); clients.forEach((client) => client.disconnect()); await server.close(); });
  const client = await connect(url);
  clients.push(client);
  const body = { name: input.name, activeLeagues: input.activeLeagues, clubId: input.clubId,
    requestId: "wire-1", creatorId: "spoofed-owner", creatorName: "Spoofed" };
  const timeout = assert.rejects(client.timeout(150).emitWithAck("room:create", body), /timed out/);
  const room = await committedGate;
  await timeout;
  client.disconnect();
  const reconnected = await connect(url);
  clients.push(reconnected);
  const retries = await Promise.all([1, 2].map(() => reconnected.timeout(2_000).emitWithAck("room:create", body)));
  for (const retry of retries) {
    assert.equal(retry.ok, true);
    assert.equal(retry.room.id, room.id);
    assert.equal(retry.room.ownerId, "uid-owner");
  }
  const http = await jsonRequest(`${url}/api/rooms`, "owner-token", { method: "POST", body });
  assert.equal(http.status, 201);
  assert.equal((await http.json()).room.id, room.id);
  assert.equal((await store.listRoomsForManager("uid-owner")).length, 1);
  release();
});
