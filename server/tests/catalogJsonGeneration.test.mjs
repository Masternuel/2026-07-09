import assert from "node:assert/strict";
import test from "node:test";
import { CatalogStore } from "../store/catalogStore.mjs";
import { parseCatalogDatabase } from "../services/catalogDatabase.mjs";
import { canonicalChecksum } from "../store/roomPersistenceSections.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const OWNER = "json-owner";
const ROOT = `catalogDatabases/${OWNER}`;
const NOW = "2026-09-07T12:00:00.000Z";
const COLLECTIONS = { leagues: "brasfootLeagues", clubs: "brasfootClubs", players: "brasfootPlayers", tournaments: "tournaments" };
const path = (generation, collection, id) => `${ROOT}${generation ? `/generations/${generation}` : ""}/${collection}/${id}`;
const receiptPath = (id) => `${ROOT}/jsonImports/${id}`;
const code = (expected) => (error) => error.code === expected;

function database(club = "NEW", name = "Clube importado") {
  return {
    format: "bola-manager-database", version: 1,
    records: {
      leagues: [{ id: "LEAGUE", name: "Liga" }],
      clubs: [{ id: club, name, leagueId: "LEAGUE" }],
      players: [{ id: `${club}-9`, clubId: club, name: "Atacante", position: "ATA", age: 21,
        attributes: { velocidade: 12, chute: 13, drible: 12, nocao: 11, defesa: 5, passe: 10, peBom: 14, peRuim: 8 } }],
      tournaments: [],
    },
  };
}

async function reload(firestore, now = () => new Date(NOW)) {
  const store = new CatalogStore({ firestore, now }).forOwner(OWNER);
  await store.ensureInitialized();
  return store;
}

async function fixture(generation = "previous") {
  const metadata = { ownerId: OWNER, initialized: true, status: "ready", revision: 3,
    ...(generation ? { activeGenerationId: generation } : {}) };
  const initialDocuments = { [ROOT]: metadata };
  for (const [entity, records] of Object.entries(parseCatalogDatabase(database("OLD", "Clube anterior")).records)) {
    for (const record of records) initialDocuments[path(generation, COLLECTIONS[entity], record.id)] = record;
  }
  initialDocuments[path(generation, "brasfootCups", "CUP")] = { id: "CUP", name: "Copa legada" };
  const firestore = createFakeFirestore({ initialDocuments });
  return { firestore, metadata, store: await reload(firestore) };
}

function interceptActivation(firestore, action) {
  const original = firestore.runTransaction;
  firestore.runTransaction = (callback) => original(async (transaction) => {
    const set = transaction.set.bind(transaction);
    transaction.set = (reference, data, ...options) => {
      if (reference.path === ROOT && data.lastJsonImportId && data.importOperation === null) action(data);
      return set(reference, data, ...options);
    };
    return callback(transaction);
  });
  return () => { firestore.runTransaction = original; };
}

for (const generation of [null, "previous"]) {
  test(`JSON publica geracao completa e reload preserva base ${generation ?? "legada"}`, async () => {
    const { firestore, metadata, store } = await fixture(generation);
    const before = firestore.dump();
    const result = await store.importDatabase(database(), OWNER, { operationId: "success", batchSize: 1 });
    assert.equal(result.imported, true);
    assert.equal(result.idempotent, false);
    assert.equal(result.revision, 4);
    assert.equal(result.total, 3);
    const current = firestore.read(ROOT);
    assert.equal(current.activeGenerationId, result.generationId);
    assert.deepEqual(current.counts, { leagues: 1, clubs: 2, players: 2, tournaments: 0 });
    assert.equal(current.importOperation, null);
    for (const [key, value] of Object.entries(before)) if (key !== ROOT) assert.deepEqual(firestore.read(key), value);
    const loaded = await reload(firestore);
    assert.equal((await loaded.collection("clubs").doc("NEW").get()).data().updatedBy, OWNER);
    assert.equal((await loaded.collection("players").get()).size, 2);
    assert.equal(firestore.has(path(result.generationId, "brasfootCups", "CUP")), true);
    const receipt = firestore.read(receiptPath("success"));
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.validated, true);
    assert.equal(receipt.baseRevision, metadata.revision);
  });
}

test("staging permite leitura antiga mas bloqueia CRUD e importacao concorrente", async () => {
  const { firestore, store } = await fixture();
  let checked = false;
  await store.importDatabase(database(), OWNER, { operationId: "first", onProgress: async () => {
    if (checked) return;
    checked = true;
    const reader = await reload(firestore);
    assert.equal((await reader.collection("clubs").doc("OLD").get()).exists, true);
    assert.equal((await reader.collection("clubs").doc("NEW").get()).exists, false);
    await assert.rejects(reader.update("clubs", "OLD", { name: "Mudou" }, OWNER), code("CATALOG_DATABASE_IMPORT_IN_PROGRESS"));
    await assert.rejects(reader.importDatabase(database(), OWNER, { operationId: "second" }), code("CATALOG_DATABASE_IMPORT_IN_PROGRESS"));
    assert.equal(firestore.has(receiptPath("second")), false);
  } });
  assert.equal(checked, true);
});

test("falha em lote nao toca base ativa; retry do mesmo ID conclui", async () => {
  const { firestore, metadata, store } = await fixture();
  let injected = false;
  await assert.rejects(store.importDatabase(database(), OWNER, { operationId: "retry", batchSize: 1,
    onProgress() { if (!injected) { injected = true; firestore.failBeforeCommit(new Error("batch interrompido")); } },
  }), /batch interrompido/);
  assert.deepEqual(firestore.read(ROOT), metadata);
  assert.equal(firestore.read(receiptPath("retry")).status, "failed");
  assert.equal(firestore.paths().some((key) => key.includes("/generations/") && !key.includes("/previous/")), false);
  const result = await (await reload(firestore)).importDatabase(database(), OWNER, { operationId: "retry" });
  assert.equal(result.revision, 4);
  assert.equal(firestore.read(receiptPath("retry")).status, "completed");
});

for (const corruption of ["missing", "changed", "extra"]) {
  test(`staging ${corruption} nunca e ativado`, async () => {
    const { firestore, metadata, store } = await fixture();
    await assert.rejects(store.importDatabase(database(), OWNER, { operationId: corruption,
      async onProgress(collection) {
        if (collection !== "brasfootCups") return;
        const generation = firestore.read(ROOT).importOperation.generationId;
        const target = path(generation, "brasfootClubs", "NEW");
        if (corruption === "missing") await firestore.doc(target).delete();
        if (corruption === "changed") firestore.seed(target, { ...firestore.read(target), name: "Corrompido" });
        if (corruption === "extra") firestore.seed(path(generation, "brasfootClubs", "EXTRA"), { id: "EXTRA" });
      },
    }), code("CATALOG_DATABASE_IMPORT_VALIDATION_FAILED"));
    assert.deepEqual(firestore.read(ROOT), metadata);
    assert.equal(firestore.read(receiptPath(corruption)).status, "failed");
  });
}

test("valida referencias do catalogo combinado, nao apenas do arquivo", async () => {
  const { firestore, metadata, store } = await fixture();
  firestore.seed(path("previous", "tournaments", "LEGACY-CUP"), { id: "LEGACY-CUP", active: true, teamIds: ["OLD"] });
  const incoming = database("OLD");
  incoming.records.clubs[0].active = false;
  await assert.rejects(store.importDatabase(incoming, OWNER), code("CATALOG_DATABASE_REFERENCE_INVALID"));
  assert.deepEqual(firestore.read(ROOT), metadata);
});

test("retry persistente nao reativa geracao antiga nem sobrescreve edicoes posteriores", async () => {
  const { firestore, store } = await fixture();
  const first = await store.importDatabase(database(), OWNER, { operationId: "first" });
  const second = await store.importDatabase(database("NEXT"), OWNER, { operationId: "second" });
  const loaded = await reload(firestore);
  const writes = firestore.metrics.writes;
  const retry = await loaded.importDatabase(database(), OWNER, { operationId: "first" });
  assert.equal(retry.idempotent, true);
  assert.equal(retry.generationId, first.generationId);
  assert.equal(firestore.metrics.writes, writes);
  assert.equal(firestore.read(ROOT).activeGenerationId, second.generationId);
  assert.equal((await loaded.collection("clubs").doc("NEXT").get()).exists, true);
});

test("ID automatico por conteudo e idempotente; ID reutilizado com outro arquivo e rejeitado", async () => {
  const { firestore, store } = await fixture();
  const first = await store.importDatabase(database(), OWNER);
  const retry = await (await reload(firestore)).importDatabase(database(), OWNER);
  assert.equal(first.operationId, retry.operationId);
  assert.equal(retry.idempotent, true);
  const writes = firestore.metrics.writes;
  await assert.rejects(store.importDatabase(database("OTHER"), OWNER, { operationId: first.operationId }), code("CATALOG_DATABASE_IMPORT_ID_CONFLICT"));
  assert.equal(firestore.metrics.writes, writes);
});

test("reinicio recupera lease expirado em geracao nova; falha nao restaura lock abandonado", async () => {
  const { firestore, metadata } = await fixture();
  const incoming = database();
  const abandoned = { type: "json", runId: "restart", generationId: "abandoned", baseRevision: 3,
    startedAt: "2026-09-07T11:00:00.000Z", heartbeatAt: "2026-09-07T11:00:00.000Z" };
  firestore.seed(ROOT, { ...metadata, importOperation: abandoned });
  firestore.seed(receiptPath("restart"), { ...abandoned, status: "staging", inputChecksum: canonicalChecksum(parseCatalogDatabase(incoming)) });
  firestore.seed(path("abandoned", "brasfootClubs", "PARTIAL"), { id: "PARTIAL" });
  await assert.rejects((await reload(firestore)).importDatabase(incoming, OWNER, { operationId: "restart",
    onProgress() { throw new Error("nova interrupcao"); },
  }), /nova interrupcao/);
  assert.equal(firestore.read(ROOT).importOperation, null);
  const result = await (await reload(firestore)).importDatabase(incoming, OWNER, { operationId: "restart" });
  assert.notEqual(result.generationId, "abandoned");
  assert.equal(firestore.has(path(result.generationId, "brasfootClubs", "PARTIAL")), false);
  assert.equal(result.revision, 4);
});

test("worker antigo nao publica depois de perder lease para novo worker", async () => {
  const { firestore, store } = await fixture();
  let successor;
  await assert.rejects(store.importDatabase(database(), OWNER, { operationId: "same-operation",
    async onProgress() {
      if (successor) return;
      const replacement = await reload(firestore, () => new Date("2026-09-07T12:11:00.000Z"));
      successor = await replacement.importDatabase(database(), OWNER, { operationId: "same-operation" });
    },
  }), code("CATALOG_DATABASE_IMPORT_REPLACED"));
  assert.equal(firestore.read(ROOT).activeGenerationId, successor.generationId);
  assert.equal(firestore.read(receiptPath("same-operation")).status, "completed");
  assert.equal(firestore.has(path(successor.generationId, "brasfootClubs", "NEW")), true);
});

for (const phase of ["lock", "activation"]) {
  test(`ACK perdido em ${phase} e reconciliado sem duplicar importacao`, async () => {
    const { firestore, store } = await fixture();
    if (phase === "lock") firestore.failAfterCommit(new Error("ACK perdido"), "transaction");
    else interceptActivation(firestore, () => firestore.failAfterCommit(new Error("ACK perdido"), "transaction"));
    const result = await store.importDatabase(database(), OWNER, { operationId: phase });
    assert.equal(firestore.read(ROOT).activeGenerationId, result.generationId);
    assert.equal(firestore.read(receiptPath(phase)).status, "completed");
    assert.equal((await store.importDatabase(database(), OWNER, { operationId: phase })).idempotent, true);
    assert.equal(firestore.read(ROOT).revision, 4);
  });
}

test("falha na escrita do recibo reverte ativacao atomica", async () => {
  const { firestore, metadata, store } = await fixture();
  const restore = interceptActivation(firestore, () => firestore.failOnWrite(2, new Error("recibo indisponivel")));
  await assert.rejects(store.importDatabase(database(), OWNER, { operationId: "atomic" }), /recibo indisponivel/);
  restore();
  assert.deepEqual(firestore.read(ROOT), metadata);
  assert.equal(firestore.read(receiptPath("atomic")).status, "failed");
});

for (const mutation of [{ revision: 10 }, { activeGenerationId: "other" }, { updatedAt: "concurrent", revision: 10 }]) {
  test(`conflito de metadata nao e sobrescrito pelo rollback: ${Object.keys(mutation)}`, async () => {
    const { firestore, store } = await fixture();
    let changed = false;
    await assert.rejects(store.importDatabase(database(), OWNER, { operationId: "conflict", onProgress() {
      if (changed) return;
      changed = true;
      firestore.seed(ROOT, { ...firestore.read(ROOT), ...mutation });
    } }), code("CATALOG_DATABASE_IMPORT_CONFLICT"));
    for (const [key, value] of Object.entries(mutation)) assert.equal(firestore.read(ROOT)[key], value);
    assert.equal(firestore.read(ROOT).importOperation, null);
  });
}

test("store desatualizado e identificador invalido nao iniciam staging", async () => {
  const { firestore, store } = await fixture();
  const stale = await reload(firestore);
  await store.importDatabase(database(), OWNER, { operationId: "fresh" });
  const writes = firestore.metrics.writes;
  await assert.rejects(stale.importDatabase(database("OTHER"), OWNER), code("CATALOG_DATABASE_IMPORT_CONFLICT"));
  for (const operationId of ["../unsafe", [], "", "x".repeat(129)]) {
    await assert.rejects(store.importDatabase(database(), OWNER, { operationId }), code("CATALOG_DATABASE_IMPORT_ID_INVALID"));
  }
  assert.equal(firestore.metrics.writes, writes);
});

test("imagens antigas preservadas; importacao nao transfere propriedade de midia", async () => {
  const { firestore, store } = await fixture();
  const originalPath = path("previous", "brasfootClubs", "OLD");
  const original = { ...firestore.read(originalPath), crestImageUrl: "https://example.com/old.png",
    crestImagePath: "editor-media/clubs/OLD/owned.png", createdAt: "2020-01-01T00:00:00.000Z" };
  firestore.seed(originalPath, original);
  const same = database("OLD");
  same.records.clubs[0].crestImageUrl = original.crestImageUrl;
  same.records.clubs[0].crestImagePath = "editor-media/clubs/OTHER/not-owned.png";
  const first = await store.importDatabase(same, OWNER, { operationId: "same-image" });
  assert.deepEqual(first.previousMediaPaths, []);
  assert.equal((await store.collection("clubs").doc("OLD").get()).data().crestImagePath, original.crestImagePath);
  same.records.clubs[0].crestImageUrl = "https://example.com/new.png";
  await store.importDatabase(same, OWNER, { operationId: "new-image" });
  assert.equal((await store.collection("clubs").doc("OLD").get()).data().crestImagePath, null);
  assert.deepEqual(firestore.read(originalPath), original);
});

test("ativacao incerta preserva geracao; reload e retry reconciliam recibo duravel", async () => {
  const { firestore, store } = await fixture();
  let unavailable = false;
  const collection = firestore.collection;
  firestore.collection = (name) => {
    const reference = collection(name);
    const doc = reference.doc.bind(reference);
    reference.doc = (id) => {
      const document = doc(id);
      const get = document.get.bind(document);
      document.get = () => {
        if (unavailable && document.path === ROOT) throw new Error("Firebase indisponivel");
        return get();
      };
      return document;
    };
    return reference;
  };
  const restore = interceptActivation(firestore, () => {
    unavailable = true;
    firestore.failAfterCommit(new Error("ACK perdido"), "transaction");
  });
  await assert.rejects(store.importDatabase(database(), OWNER, { operationId: "uncertain" }), (error) => {
    assert.equal(error.code, "CATALOG_DATABASE_IMPORT_COMMIT_UNCERTAIN");
    assert.equal(error.details.stagingPreserved, true);
    return true;
  });
  restore();
  unavailable = false;
  const generation = firestore.read(ROOT).activeGenerationId;
  assert.notEqual(generation, "previous");
  assert.equal(firestore.has(path(generation, "brasfootClubs", "NEW")), true);
  const retried = await (await reload(firestore)).importDatabase(database(), OWNER, { operationId: "uncertain" });
  assert.equal(retried.idempotent, true);
  assert.equal(retried.generationId, generation);
  assert.equal(firestore.read(ROOT).revision, 4);
});

test("recibo confirma ativacao mesmo se outra geracao foi publicada antes da reconciliacao", async () => {
  const { firestore, store } = await fixture();
  const original = firestore.runTransaction;
  let next;
  firestore.runTransaction = async (callback) => {
    let activating = false;
    try {
      return await original(async (transaction) => {
        const set = transaction.set.bind(transaction);
        transaction.set = (reference, data, ...options) => {
          if (reference.path === ROOT && data.lastJsonImportId === "lost-ack" && data.importOperation === null) {
            activating = true;
            firestore.failAfterCommit(new Error("ACK perdido"), "transaction");
          }
          return set(reference, data, ...options);
        };
        return callback(transaction);
      });
    } catch (error) {
      if (activating) {
        firestore.runTransaction = original;
        next = await (await reload(firestore)).importDatabase(database("NEXT"), OWNER, { operationId: "successor" });
      }
      throw error;
    }
  };
  const first = await store.importDatabase(database(), OWNER, { operationId: "lost-ack" });
  assert.equal(firestore.read(ROOT).activeGenerationId, next.generationId);
  assert.equal(firestore.read(ROOT).revision, 5);
  assert.equal(firestore.has(path(first.generationId, "brasfootClubs", "NEW")), true);
  assert.equal((await store.collection("clubs").doc("NEXT").get()).exists, true);
});

test("lotes grandes respeitam limite de bytes alem da quantidade de documentos", async () => {
  const { firestore, store } = await fixture();
  const incoming = database();
  incoming.records.players = Array.from({ length: 24 }, (_, index) => ({
    ...incoming.records.players[0], id: `NEW-${index}`, description: "x".repeat(400 * 1024),
  }));
  const original = firestore.batch;
  let playerBatches = 0;
  firestore.batch = () => {
    const batch = original();
    const set = batch.set.bind(batch);
    const commit = batch.commit.bind(batch);
    let size = 0;
    let hasPlayers = false;
    batch.set = (reference, record) => {
      size += Buffer.byteLength(JSON.stringify(record), "utf8") + 1024;
      hasPlayers ||= reference.path.includes("/brasfootPlayers/");
      return set(reference, record);
    };
    batch.commit = () => {
      assert.ok(size <= 8 * 1024 * 1024);
      if (hasPlayers) playerBatches += 1;
      return commit();
    };
    return batch;
  };
  await store.importDatabase(incoming, OWNER);
  assert.equal(playerBatches, 2);
  assert.equal((await store.collection("players").get()).size, 25);
});
