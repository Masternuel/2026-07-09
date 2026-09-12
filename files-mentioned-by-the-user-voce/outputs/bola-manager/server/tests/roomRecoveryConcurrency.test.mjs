import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { canonicalChecksum } from "../store/roomPersistenceSections.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

async function fixture() {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const before = { id: "recovery-race", code: "RACE", ownerId: "owner", managerIds: ["owner"],
    revision: 1, version: 1, name: "Previous", managers: [{ id: "owner", ready: false }],
    careerState: { players: [{ id: "P1", clubId: "SAN" }] } };
  const after = { ...before, revision: 2, version: 2, name: "Current", managers: [{ id: "owner", ready: true }],
    careerState: { players: [{ id: "P2", clubId: "SAN" }] } };
  await persistence.create(before);
  await persistence.save(after);
  const root = firestore.read("rooms/RACE");
  const descriptor = root.roomSections.find(({ path }) => path === "careerState.players");
  await firestore.collection("rooms").doc("RACE").collection(descriptor.domain).doc(descriptor.documentId).delete();
  return { firestore, persistence, before, after, root };
}

function interceptTransactions(firestore, hook) {
  const run = firestore.runTransaction.bind(firestore);
  firestore.runTransaction = (callback, ...args) => run(async (transaction) => {
    const writes = [];
    const proxy = new Proxy(transaction, {
      get(target, name) {
        if (name === "set" || name === "create") return (reference, data, ...options) => {
          writes.push({ reference, data });
          return target[name](reference, data, ...options);
        };
        return typeof target[name] === "function" ? target[name].bind(target) : target[name];
      },
    });
    const result = await callback(proxy);
    await hook(writes);
    return result;
  }, ...args);
}

test("recovery CAS rejects concurrent metadata change even when commit ID is unchanged", async () => {
  const { firestore, persistence, root } = await fixture();
  let injected = false;
  interceptTransactions(firestore, (writes) => {
    if (!injected && writes.some(({ data }) => data.saveRecovery)) {
      injected = true;
      firestore.seed("rooms/RACE", { ...root, name: "Concurrent change" });
    }
  });
  await assert.rejects(persistence.get("RACE"), { code: "SAVE_WRITE_CONFLICT" });
  assert.equal(firestore.read("rooms/RACE").name, "Concurrent change");
  assert.equal(firestore.read("rooms/RACE").saveCommitId, root.saveCommitId);
  assert.ok(firestore.read("rooms/RACE/maintenance/recovery-previous"));
});

test("recovery does not resurrect a concurrently deleted room", async () => {
  const { firestore, persistence } = await fixture();
  let injected = false;
  interceptTransactions(firestore, (writes) => {
    if (!injected && writes.some(({ data }) => data.saveRecovery)) {
      injected = true;
      firestore.seed("rooms/RACE", { code: "RACE", deleted: true });
    }
  });
  await assert.rejects(persistence.get("RACE"), { code: "SAVE_WRITE_CONFLICT" });
  assert.equal(await persistence.get("RACE"), null);
  assert.equal(firestore.read("rooms/RACE").deleted, true);
});

test("lost ACK during repair is reconciled and never repeats the rollback", async () => {
  const { firestore, persistence, before } = await fixture();
  let injected = false;
  interceptTransactions(firestore, (writes) => {
    if (!injected && writes.some(({ data }) => data.saveRecovery)) {
      injected = true;
      firestore.failAfterCommit(new Error("Lost recovery ACK"), "transaction");
    }
  });
  const recovered = await persistence.get("RACE");
  assert.deepEqual(recovered.managers, before.managers);
  const commit = firestore.read("rooms/RACE").saveCommitId;
  await persistence.get("RACE");
  assert.equal(firestore.read("rooms/RACE").saveCommitId, commit);
  assert.equal(firestore.read("rooms/RACE/maintenance/storage-writers"), undefined);
});

test("recovery lease blocks writers and GC until validation and repair complete", async () => {
  const { firestore, persistence, after } = await fixture();
  const run = firestore.runTransaction.bind(firestore);
  let release;
  let signal;
  const gate = new Promise((resolve) => { release = resolve; });
  const acquired = new Promise((resolve) => { signal = resolve; });
  let held = false;
  firestore.runTransaction = async (...args) => {
    const result = await run(...args);
    if (!held && firestore.read("rooms/RACE/maintenance/storage-writers")?.recoveryLeaseId) {
      held = true;
      signal();
      await gate;
    }
    return result;
  };
  const reading = persistence.get("RACE");
  await acquired;
  try {
    await assert.rejects(persistence.save({ ...after, revision: 3 }), { code: "SAVE_MAINTENANCE_BUSY" });
    await assert.rejects(persistence.collectGarbage("RACE"), { code: "SAVE_MAINTENANCE_BUSY" });
  } finally {
    release();
  }
  await reading;
  await persistence.collectGarbage("RACE");
  const current = await persistence.get("RACE");
  await persistence.save({ ...current, revision: current.revision + 1 });
});

test("expired GC root lease does not hide a recoverable previous generation", async () => {
  const { firestore, persistence, root, before } = await fixture();
  const { saveCommitId, ...base } = root;
  const leased = { ...base, saveMaintenanceLease: {
    id: "expired", operation: "storage-gc", baseSaveCommitId: saveCommitId,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  } };
  firestore.seed("rooms/RACE", { ...leased, saveCommitId: canonicalChecksum(leased) });
  assert.deepEqual((await persistence.get("RACE")).managers, before.managers);
  assert.equal(firestore.read("rooms/RACE").saveMaintenanceLease, undefined);
});

test("expired recovery cannot release a newer writer's aggregate lock", async () => {
  const { firestore, persistence } = await fixture();
  const run = firestore.runTransaction.bind(firestore);
  let replaced = false;
  const replacement = { activeLeaseCount: 1, activeUntil: new Date(Date.now() + 60000).toISOString() };
  firestore.runTransaction = async (...args) => {
    const result = await run(...args);
    const state = firestore.read("rooms/RACE/maintenance/storage-writers");
    if (!replaced && state?.recoveryLeaseId) {
      replaced = true;
      const path = `rooms/RACE/maintenance/storage-writer--${state.recoveryLeaseId}`;
      firestore.seed(path, { ...firestore.read(path), expiresAt: new Date(Date.now() - 1000).toISOString() });
      firestore.seed("rooms/RACE/maintenance/storage-writers", replacement);
    }
    return result;
  };
  await assert.rejects(persistence.get("RACE"), { code: "SAVE_WRITE_CONFLICT" });
  assert.deepEqual(firestore.read("rooms/RACE/maintenance/storage-writers"), replacement);
});

test("failed repair preserves both original root and previous checkpoint atomically", async () => {
  const { firestore, persistence, root } = await fixture();
  const checkpoint = firestore.read("rooms/RACE/maintenance/recovery-previous");
  let injected = false;
  interceptTransactions(firestore, (writes) => {
    if (!injected && writes.some(({ data }) => data.saveRecovery)) {
      injected = true;
      firestore.failOnWrite(3, new Error("Repair write failed"));
    }
  });
  await assert.rejects(persistence.get("RACE"), /Repair write failed/);
  assert.deepEqual(firestore.read("rooms/RACE"), root);
  assert.deepEqual(firestore.read("rooms/RACE/maintenance/recovery-previous"), checkpoint);
  assert.equal(firestore.read("rooms/RACE/maintenance/recovery-last"), undefined);
  assert.equal(firestore.read("rooms/RACE/maintenance/storage-writers"), undefined);
  assert.equal((await persistence.get("RACE")).name, "Previous");
});
