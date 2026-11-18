import assert from "node:assert/strict";
import test from "node:test";
import { CatalogStore } from "../store/catalogStore.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const OWNER_ID = "owner-brasfoot-generation";
const NOW = "2026-08-24T12:00:00.000Z";
const METADATA_PATH = `catalogDatabases/${OWNER_ID}`;

function generationPath(generationId, collection, id) {
  return `${METADATA_PATH}/generations/${generationId}/${collection}/${id}`;
}

function ownerStore(firestore) {
  return new CatalogStore({
    firestore,
    now: () => new Date(NOW),
  }).forOwner(OWNER_ID);
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("importacao Brasfoot publica geracao e reload usa base ativa", async () => {
  const previousGeneration = "generation-before-import";
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 3,
        activeGenerationId: previousGeneration,
      },
      [generationPath(previousGeneration, "brasfootClubs", "OLD")]: {
        id: "OLD",
        name: "Clube preservado",
      },
    },
  });
  const store = ownerStore(firestore);
  await store.ensureInitialized();

  const result = await store.importBrasfootData({
    runId: "brasfoot-run-success",
    batchSize: 2,
    data: {
      clubs: [{ id: "NEW", name: "Clube importado" }],
      players: [{ id: "NEW-9", name: "Atacante", clubId: "NEW", position: "ATA" }],
      leagues: [{ id: "LEAGUE", name: "Liga importada", active: true }],
      cups: [],
    },
  });

  const metadata = firestore.read(METADATA_PATH);
  assert.equal(metadata.activeGenerationId, result.generationId);
  assert.equal(metadata.lastBrasfootImportId, "brasfoot-run-success");
  assert.equal(metadata.revision, 4);
  assert.equal(metadata.importOperation, null);

  const reloaded = ownerStore(firestore);
  await reloaded.ensureInitialized();
  assert.equal((await reloaded.collection("clubs").doc("OLD").get()).data().name, "Clube preservado");
  assert.equal((await reloaded.collection("clubs").doc("NEW").get()).data().name, "Clube importado");
  assert.equal((await reloaded.collection("players").doc("NEW-9").get()).exists, true);
  assert.equal((await reloaded.collection("leagues").doc("LEAGUE").get()).exists, true);
});

test("lock Brasfoot fresco rejeita concorrente sem alterar geracao ativa", async () => {
  const activeGeneration = "generation-live";
  const metadata = {
    ownerId: OWNER_ID,
    initialized: true,
    status: "ready",
    revision: 7,
    activeGenerationId: activeGeneration,
    importOperation: {
      type: "brasfoot",
      runId: "brasfoot-run-active",
      generationId: "generation-staging",
      baseRevision: 7,
      startedAt: NOW,
      heartbeatAt: NOW,
    },
  };
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: metadata,
      [generationPath(activeGeneration, "brasfootClubs", "LIVE")]: {
        id: "LIVE",
        name: "Clube ao vivo",
      },
    },
  });
  const pathsBefore = firestore.paths();
  const store = ownerStore(firestore);
  await store.ensureInitialized();

  await assert.rejects(
    () => store.importBrasfootData({
      runId: "brasfoot-run-concurrent",
      data: {
        clubs: [{ id: "NEW", name: "Nao publicar" }],
        players: [],
        leagues: [],
        cups: [],
      },
    }),
    (error) => error.code === "BRASFOOT_IMPORT_IN_PROGRESS",
  );

  assert.deepEqual(firestore.read(METADATA_PATH), metadata);
  assert.deepEqual(firestore.paths(), pathsBefore);
  const reloaded = ownerStore(firestore);
  await reloaded.ensureInitialized();
  assert.equal((await reloaded.collection("clubs").doc("LIVE").get()).data().name, "Clube ao vivo");
  assert.equal((await reloaded.collection("clubs").doc("NEW").get()).exists, false);
});

test("ACK perdido ao adquirir lock e reconciliado e conclui importacao", async () => {
  const activeGeneration = "generation-before-lock-ack";
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 2,
        activeGenerationId: activeGeneration,
      },
      [generationPath(activeGeneration, "brasfootClubs", "LIVE")]: {
        id: "LIVE",
        name: "Clube existente",
      },
    },
  });
  const store = ownerStore(firestore);
  await store.ensureInitialized();
  firestore.failAfterCommit(new Error("ACK perdido no lock"), "transaction");

  const result = await store.importBrasfootData({
    runId: "brasfoot-run-lock-ack",
    data: {
      clubs: [{ id: "NEW", name: "Clube novo" }],
      players: [],
      leagues: [],
      cups: [],
    },
  });

  const metadata = firestore.read(METADATA_PATH);
  assert.equal(metadata.activeGenerationId, result.generationId);
  assert.equal(metadata.lastBrasfootImportId, "brasfoot-run-lock-ack");
  assert.equal(metadata.importOperation, null);
  assert.equal((await store.collection("clubs").doc("LIVE").get()).exists, true);
  assert.equal((await store.collection("clubs").doc("NEW").get()).exists, true);
});

test("ACK perdido na promocao reconcilia sem apagar geracao ativa", async () => {
  const previousGeneration = "generation-before-promotion-ack";
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 5,
        activeGenerationId: previousGeneration,
      },
      [generationPath(previousGeneration, "brasfootClubs", "LIVE")]: {
        id: "LIVE",
        name: "Clube existente",
      },
    },
  });
  const store = ownerStore(firestore);
  await store.ensureInitialized();

  const result = await store.importBrasfootData({
    runId: "brasfoot-run-promotion-ack",
    batchSize: 1,
    data: {
      clubs: [],
      players: [],
      leagues: [],
      cups: [{ id: "CUP", name: "Copa importada" }],
    },
    onProgress(collectionName, committed) {
      if (collectionName === "brasfootCups" && committed === 1) {
        firestore.failAfterCommit(new Error("ACK perdido na promocao"), "transaction");
      }
    },
  });

  const metadata = firestore.read(METADATA_PATH);
  assert.equal(metadata.activeGenerationId, result.generationId);
  assert.equal(metadata.revision, 6);
  assert.equal(firestore.has(generationPath(result.generationId, "brasfootClubs", "LIVE")), true);
  assert.equal(firestore.has(generationPath(result.generationId, "brasfootCups", "CUP")), true);
});

test("CRUD durante lock Brasfoot e rejeitado", async () => {
  const activeGeneration = "generation-crud-lock";
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 4,
        activeGenerationId: activeGeneration,
      },
      [generationPath(activeGeneration, "brasfootClubs", "LIVE")]: {
        id: "LIVE",
        name: "Clube existente",
      },
    },
  });
  const importer = ownerStore(firestore);
  const editor = ownerStore(firestore);
  await Promise.all([importer.ensureInitialized(), editor.ensureInitialized()]);
  const lockAcquired = deferred();
  const releaseImport = deferred();
  let paused = false;
  const importing = importer.importBrasfootData({
    runId: "brasfoot-run-crud-lock",
    data: {
      clubs: [{ id: "NEW", name: "Clube importado" }],
      players: [],
      leagues: [],
      cups: [],
    },
    async onProgress() {
      if (paused) return;
      paused = true;
      lockAcquired.resolve();
      await releaseImport.promise;
    },
  });
  await lockAcquired.promise;

  let assertionError;
  try {
    await assert.rejects(
      () => editor.create("clubs", { id: "CRUD", name: "Nao gravar" }, "editor"),
      (error) => error.status === 409 && /IMPORT_IN_PROGRESS$/.test(error.code),
    );
  } catch (error) {
    assertionError = error;
  } finally {
    releaseImport.resolve();
    await importing;
  }
  if (assertionError) throw assertionError;
  assert.equal(firestore.has(generationPath(activeGeneration, "brasfootClubs", "CRUD")), false);
});

test("mudanca de revision antes da promocao preserva CRUD e causa conflito", async () => {
  const activeGeneration = "generation-before-revision-conflict";
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 9,
        activeGenerationId: activeGeneration,
      },
      [generationPath(activeGeneration, "brasfootClubs", "LIVE")]: {
        id: "LIVE",
        name: "Clube existente",
      },
    },
  });
  const store = ownerStore(firestore);
  await store.ensureInitialized();
  let changed = false;

  await assert.rejects(
    () => store.importBrasfootData({
      runId: "brasfoot-run-revision-conflict",
      data: {
        clubs: [{ id: "NEW", name: "Nao promover" }],
        players: [],
        leagues: [],
        cups: [{ id: "CUP", name: "Copa" }],
      },
      async onProgress(collectionName, committed) {
        if (changed || collectionName !== "brasfootCups" || committed !== 1) return;
        changed = true;
        await firestore.runTransaction(async (transaction) => {
          const metadataReference = firestore.doc(METADATA_PATH);
          const crudReference = firestore.doc(
            generationPath(activeGeneration, "brasfootClubs", "CRUD"),
          );
          const current = await transaction.get(metadataReference);
          transaction.set(crudReference, { id: "CRUD", name: "Edicao concorrente" });
          transaction.set(metadataReference, {
            ...current.data(),
            revision: Number(current.data().revision) + 1,
          });
        });
      },
    }),
    (error) => error.code === "BRASFOOT_IMPORT_CONFLICT",
  );

  const metadata = firestore.read(METADATA_PATH);
  assert.equal(metadata.activeGenerationId, activeGeneration);
  assert.equal(metadata.revision, 10);
  assert.equal(metadata.importOperation, null);
  assert.equal(firestore.read(generationPath(activeGeneration, "brasfootClubs", "CRUD")).name, "Edicao concorrente");
  assert.equal(metadata.lastBrasfootImportId, undefined);
});

test("onProgress informa cada batch com total acumulado", async () => {
  const firestore = createFakeFirestore({
    initialDocuments: {
      [METADATA_PATH]: {
        ownerId: OWNER_ID,
        initialized: true,
        status: "ready",
        revision: 1,
      },
    },
  });
  const store = ownerStore(firestore);
  await store.ensureInitialized();
  const progress = [];

  await store.importBrasfootData({
    runId: "brasfoot-run-progress",
    batchSize: 2,
    data: {
      clubs: Array.from({ length: 5 }, (_, index) => ({
        id: `CLUB-${index + 1}`,
        name: `Clube ${index + 1}`,
      })),
      players: [],
      leagues: [],
      cups: [],
    },
    onProgress(collectionName, committed) {
      if (collectionName === "brasfootClubs") progress.push(committed);
    },
  });

  assert.deepEqual(progress, [2, 4, 5]);
});
