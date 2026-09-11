import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { FIXTURE_SCHEDULE_VERSION } from "../game/fixtures.mjs";
import {
  FirestoreRoomPersistence,
  ROOM_DOCUMENT_SAFE_BYTES,
} from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { canonicalChecksum } from "../store/roomPersistenceSections.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

function baseRoom(overrides = {}) {
  return {
    id: "room-v2",
    code: "BOLA-V200",
    name: "Carreira v2",
    ownerId: "uid-owner",
    catalogOwnerId: "uid-owner",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    unlimitedSeasons: true,
    currentSeason: 1,
    seasonYear: 2026,
    seasonHistory: [],
    careerCompleted: false,
    maxManagers: 4,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    startedAt: "2026-07-01T00:00:00.000Z",
    revision: 1,
    version: 1,
    currentFixtureId: "rodada-1",
    completedFixtureIds: [],
    completedMatches: [],
    managerIds: ["uid-owner"],
    managers: [{ id: "uid-owner", name: "Owner", clubId: "SAN", ready: true }],
    competitionCatalog: [{ id: "BR-A", name: "Brasileirao", clubs: [{ id: "SAN", name: "Santos" }] }],
    tournamentCatalog: [],
    careerState: { players: [{ id: "P1", clubId: "SAN", name: "Jogador" }] },
    marketState: { transactions: [] },
    ...overrides,
  };
}

function legacyCompressedBundle(room, chunkCount = 1) {
  const serialized = JSON.stringify(room);
  const payload = gzipSync(Buffer.from(serialized, "utf8")).toString("base64");
  if (chunkCount === 1) {
    return {
      document: {
        code: room.code,
        name: room.name,
        ownerId: room.ownerId,
        managerIds: room.managerIds,
        revision: room.revision,
        roomStorageFormat: "gzip-json-v1",
        roomStorageRawBytes: Buffer.byteLength(serialized, "utf8"),
        roomStoragePayload: payload,
      },
      chunks: [],
    };
  }
  const generation = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  const chunkSize = Math.ceil(payload.length / chunkCount);
  const chunks = Array.from({ length: chunkCount }, (_, index) => ({
    id: `${room.code}--${generation}--${String(index).padStart(3, "0")}`,
    data: {
      roomCode: room.code,
      generation,
      index,
      roomStorageChunkPayload: payload.slice(index * chunkSize, (index + 1) * chunkSize),
    },
  }));
  return {
    document: {
      code: room.code,
      name: room.name,
      ownerId: room.ownerId,
      managerIds: room.managerIds,
      revision: room.revision,
      roomStorageFormat: "gzip-json-chunks-v1",
      roomStorageRawBytes: Buffer.byteLength(serialized, "utf8"),
      roomStorageGeneration: generation,
      roomStorageChunkCount: chunks.length,
    },
    chunks,
  };
}

function largeMatchHistory(count = 5_000) {
  return Array.from({ length: count }, (_, index) => ({
    fixtureId: `H-${String(index).padStart(6, "0")}`,
    season: 1 + Math.floor(index / 380),
    homeClubId: `C-${index % 20}`,
    awayClubId: `C-${(index + 1) % 20}`,
    score: [index % 4, (index + 1) % 3],
    commentary: `Partida historica ${index} ${"x".repeat(120)}`,
  }));
}

function isContentPagePath(path, code = null) {
  const prefix = code ? `rooms/${code}/` : "rooms/";
  return String(path).startsWith(prefix) && (
    String(path).includes("/sectionPages/")
    || /\/(catalog|career)\/page--[a-f0-9]{64}$/i.test(String(path))
  );
}

function roomDomainStoragePaths(firestore, code) {
  return firestore.paths().filter((path) => (
    path.startsWith(`rooms/${code}/catalog/`)
    || path.startsWith(`rooms/${code}/career/`)
  ));
}

function seedCleanupPages(firestore, code, count) {
  for (let index = 0; index < count; index += 1) {
    const pageId = index.toString(16).padStart(64, "0");
    firestore.seed(`rooms/${code}/career/page--${pageId}`, {
      encoding: "json",
      payload: "[]",
      checksum: pageId,
      rawBytes: 2,
    });
  }
}

function cleanupPagePaths(firestore, code) {
  return firestore.paths().filter((path) => path.startsWith(`rooms/${code}/career/page--`));
}

function isPagedBlobPath(path, code) {
  return new RegExp(
    `^rooms/${code}/(?:catalog|career)/(?:page|page-index)--[a-f0-9]{64}$`,
    "i",
  ).test(String(path));
}

async function pagedManifestWriteOffset(room, sectionPath) {
  const probe = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(probe);
  assert.equal(await persistence.create(room), true);

  const root = probe.read(`rooms/${room.code}`);
  const descriptor = root.roomSections.find(({ path }) => path === sectionPath);
  assert.ok(descriptor?.pageCount > 0, "secao do teste precisa gerar paginas");
  const manifestPath = `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`;
  const manifestIndex = probe.metrics.attemptedWritePaths.indexOf(manifestPath);
  assert.ok(manifestIndex > 1, "manifesto deve ser gravado depois dos blobs paginados");

  const blobPaths = probe.metrics.attemptedWritePaths
    .slice(0, manifestIndex)
    .filter((path) => isPagedBlobPath(path, room.code));
  assert.ok(blobPaths.length > 0);
  assert.ok(blobPaths.some((path) => path.includes("/page--")));
  assert.ok(blobPaths.some((path) => path.includes("/page-index--")));
  return manifestIndex + 1;
}

function contentPageIdFromPath(path) {
  return String(path).split("/").at(-1).replace(/^page--/, "");
}

function rootWithMaintenanceLease(root, lease) {
  const { saveCommitId: _commit, saveMaintenanceLease: _lease, ...base } = root;
  const next = lease ? { ...base, saveMaintenanceLease: lease } : base;
  return { ...next, saveCommitId: canonicalChecksum(next) };
}

async function readSectionPageAndPath(persistence, firestore, code, path, page) {
  firestore.resetMetrics();
  const result = await persistence.getSection(code, path, { page });
  const readPaths = [...firestore.metrics.readPaths];
  const pagePath = readPaths.at(-1);
  assert.ok(pagePath, `Leitura da pagina ${page} deve acessar um documento de dados`);
  assert.notEqual(pagePath, `rooms/${code}`, "Ultima leitura nao pode ser somente metadata");
  return { result, pagePath };
}

test("RoomStore usa schema v2, revisoes monotonicas e tombstone", async () => {
  const firestore = createFakeFirestore();
  const store = new RoomStore({
    persistence: new FirestoreRoomPersistence(firestore),
    codeFactory: () => "BOLA-F1RE",
    now: () => new Date("2026-07-10T01:00:00.000Z"),
  });
  const room = await store.createRoom({
    name: "Sala Firestore",
    creatorId: "uid-owner",
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 4,
  });
  const ready = await store.setReady(room.code, "uid-owner", true);
  const started = await store.startRoom(room.code, "uid-owner");
  assert.equal(ready.revision, 2);
  assert.equal(started.revision, 3);
  assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, 2);
  assert.equal((await store.listRoomsForManager("uid-owner")).length, 1);
  await store.deleteRoom(room.code, "uid-owner");
  assert.equal((await store.getRoom(room.code)), null);
  assert.equal(firestore.read(`rooms/${room.code}`).deleted, true);
});

test("separa catalogo e carreira, lista so metadata e grava apenas secao alterada", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom();
  assert.equal(await persistence.create(room), true);

  const root = firestore.read(`rooms/${room.code}`);
  assert.equal(root.saveSchemaVersion, 2);
  assert.equal(root.saveStorageFormat, "firestore-sections-v2");
  assert.ok(Buffer.byteLength(JSON.stringify(root), "utf8") < ROOM_DOCUMENT_SAFE_BYTES);
  assert.ok(firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/catalog/`)));
  assert.ok(firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/career/`)));
  assert.equal(firestore.paths().some((path) => path.startsWith("roomPayloads/")), false);
  assert.deepEqual(await persistence.get(room.code), room);

  firestore.resetMetrics();
  const summaries = await persistence.listMetadataByManager("uid-owner");
  assert.equal(summaries[0].name, room.name);
  assert.equal(firestore.metrics.readPaths.some((path) => path.includes("/career/")), false);

  firestore.resetMetrics();
  await persistence.mutate(room.code, (current) => ({ ...current, name: "Nome alterado", revision: 2 }));
  assert.equal(firestore.metrics.writePaths.some((path) => path.includes("/catalog/")), false);
  assert.equal(firestore.metrics.writePaths.some((path) => path.includes("/career/")), false);
  assert.equal((await persistence.get(room.code)).name, "Nome alterado");
});

test("leitura parcial exclui container, descendentes e historico sem ler seus documentos", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-PARTIAL",
    careerState: {
      players: [{ id: "P1", clubId: "SAN", name: "Jogador" }],
      contracts: [{ id: "C1", playerId: "P1" }],
      statistics: { seasons: 12 },
    },
    completedMatches: largeMatchHistory(300),
  });
  assert.equal(await persistence.create(room), true);

  const root = firestore.read(`rooms/${room.code}`);
  const excludedDescriptors = root.roomSections.filter((descriptor) => (
    descriptor.path === "completedMatches" || descriptor.path.startsWith("careerState.")
  ));
  assert.ok(excludedDescriptors.length >= 4);
  const excludedDocumentPaths = new Set(excludedDescriptors.map(
    (descriptor) => `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`,
  ));

  firestore.resetMetrics();
  const partial = await persistence.getPartial(room.code, {
    excludePaths: ["careerState", "completedMatches"],
  });

  assert.equal("careerState" in partial, false);
  assert.equal("completedMatches" in partial, false);
  assert.equal(partial.completedMatchCount, 300);
  assert.equal(partial.seasonHistoryCount, 0);
  assert.equal(partial.competitionCatalog[0].id, "BR-A");
  assert.deepEqual(partial.marketState, { transactions: [] });
  for (const path of firestore.metrics.readPaths) {
    assert.equal(excludedDocumentPaths.has(path), false, `secao excluida nao deve ser lida: ${path}`);
  }
});

test("snapshot de carreira le somente secoes ativas e a cauda do historico", { timeout: 30_000 }, async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const seasonHistory = Array.from({ length: 2_000 }, (_, index) => ({
    seasonNumber: index + 1,
    careerSummary: { season: index + 1, note: `Resumo ${index + 1} ${"h".repeat(180)}` },
  }));
  const room = baseRoom({
    code: "BOLA-CAREER-LAZY",
    currentSeason: 2_001,
    careerState: {
      players: [
        { id: "P1", clubId: "SAN", currentClubId: "SAN", name: "Titular" },
        { id: "P2", clubId: "FLA", currentClubId: "FLA", name: "Rival" },
      ],
      trainingPlans: [{ playerId: "P1", focus: "technical", intensity: "high" }],
      nationalSquads: [{ teamId: "BRA", playerIds: ["P1"] }],
      statistics: { payload: "nao necessario".repeat(30_000) },
    },
    marketState: {
      registrations: [{ playerId: "P1", currentClubId: "SAN", permanentClubId: "SAN" }],
      transactions: largeMatchHistory(2_000),
    },
    seasonHistory,
    completedMatches: largeMatchHistory(4_000),
  });
  assert.equal(await persistence.create(room), true);

  const root = firestore.read(`rooms/${room.code}`);
  const descriptorFor = (path) => root.roomSections.find((descriptor) => descriptor.path === path);
  const completedDescriptor = descriptorFor("completedMatches");
  const statisticsDescriptor = descriptorFor("careerState.statistics");
  const transactionsDescriptor = descriptorFor("marketState.transactions");
  const historyDescriptor = descriptorFor("seasonHistory");
  assert.ok(historyDescriptor.pageCount > 1, "historico do teste precisa ocupar varias paginas");
  const manifestPath = (descriptor) => (
    `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`
  );

  firestore.resetMetrics();
  const store = new RoomStore({ persistence });
  const snapshot = await store.getCareerSnapshot(room.code, "uid-owner");

  assert.deepEqual(snapshot.players.map((player) => player.id), ["P1"]);
  assert.deepEqual(snapshot.trainingPlans, [{ playerId: "P1", focus: "technical", intensity: "high" }]);
  assert.deepEqual(snapshot.nationalSquads, [{ teamId: "BRA", playerIds: ["P1"] }]);
  assert.deepEqual(snapshot.lastSummary, seasonHistory.at(-1).careerSummary);
  assert.equal(snapshot.currentSeason, 2_001);
  assert.equal(firestore.metrics.readPaths.includes(manifestPath(completedDescriptor)), false);
  assert.equal(firestore.metrics.readPaths.includes(manifestPath(statisticsDescriptor)), false);
  assert.equal(firestore.metrics.readPaths.includes(manifestPath(transactionsDescriptor)), false);
  assert.equal(firestore.metrics.readPaths.includes(manifestPath(historyDescriptor)), true);
  assert.equal(
    firestore.metrics.readPaths.filter((path) => isContentPagePath(path, room.code)).length,
    1,
    "somente a ultima pagina do historico deve ser carregada",
  );
});

test("save maior que antigo teto de 7 blocos usa paginas dinamicas", { timeout: 30_000 }, async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const opaqueCatalogData = randomBytes(3_500_000).toString("base64");
  assert.ok(Math.ceil(opaqueCatalogData.length / 600_000) > 7);
  const room = baseRoom({ code: "BOLA-HUGE", opaqueCatalogData });

  assert.equal(await persistence.create(room), true);
  const root = firestore.read("rooms/BOLA-HUGE");
  const descriptor = root.roomSections.find((section) => section.path === "opaqueCatalogData");
  assert.equal(descriptor.domain, "catalog");
  assert.ok(descriptor.pageCount > 7);
  assert.deepEqual(await persistence.get(room.code), room);
});

test("carreira longa pagina historicos e carrega uma pagina sob demanda", { timeout: 30_000 }, async () => {
  const matches = Array.from({ length: 10_000 }, (_, index) => ({
    fixtureId: `F-${index}`,
    season: 1 + Math.floor(index / 380),
    score: [index % 4, (index + 1) % 3],
    playedAt: `2026-08-${String(1 + (index % 28)).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const transfers = Array.from({ length: 5_000 }, (_, index) => ({
    id: `T-${index}`,
    playerId: `P-${index}`,
    fromClubId: `C-${index % 20}`,
    toClubId: `C-${(index + 1) % 20}`,
    value: 1_000_000 + index,
  }));
  const seasons = Array.from({ length: 60 }, (_, index) => ({ season: index + 1, championId: `C-${index % 20}` }));
  const room = baseRoom({
    code: "BOLA-STRESS",
    completedMatches: matches,
    completedFixtureIds: matches.map((match) => match.fixtureId),
    seasonHistory: seasons,
    marketState: { transactions: transfers },
  });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  assert.equal(await persistence.create(room), true);
  assert.equal((await persistence.get(room.code)).completedMatches.length, 10_000);
  assert.equal((await persistence.get(room.code)).marketState.transactions.length, 5_000);

  firestore.resetMetrics();
  const page = await persistence.getSection(room.code, "completedMatches", { page: 0 });
  assert.ok(page.items.length > 0);
  assert.equal(page.hasMore, true);
  assert.equal(firestore.metrics.readPaths.filter((path) => isContentPagePath(path)).length, 1);
});

test("salvar e carregar repetidamente mantem revisao e nao duplica secoes", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-LOOP" });
  await persistence.create(room);
  const sectionPaths = firestore.paths().filter((path) => /\/(catalog|career)\//.test(path));
  for (let revision = 2; revision <= 40; revision += 1) {
    await persistence.mutate(room.code, (current) => ({ ...current, revision, version: revision }));
    assert.equal((await persistence.get(room.code)).revision, revision);
  }
  assert.deepEqual(
    firestore.paths().filter((path) => /\/(catalog|career)\//.test(path)),
    sectionPaths,
  );
});

test("migra JSON, gzip e formato legado com mais de 7 partes sem apagar origem", async (t) => {
  for (const variant of ["json", "gzip", "chunks"]) {
    await t.test(variant, async () => {
      const code = `LEGACY-${variant.toUpperCase()}`;
      const room = baseRoom({ code, revision: 7 });
      const firestore = createFakeFirestore();
      if (variant === "json") {
        firestore.seed(`rooms/${code}`, room);
      } else {
        const bundle = legacyCompressedBundle(room, variant === "chunks" ? 9 : 1);
        firestore.seed(`rooms/${code}`, bundle.document);
        for (const chunk of bundle.chunks) firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
      }
      const persistence = new FirestoreRoomPersistence(firestore);
      assert.deepEqual(await persistence.get(code), room);
      const root = firestore.read(`rooms/${code}`);
      assert.equal(root.saveSchemaVersion, 2);
      assert.equal(root.saveMigration.sourceSchemaVersion, 1);
      assert.ok(firestore.has(`rooms/${code}/${root.saveMigration.backupPath}`));
      if (variant === "chunks") {
        assert.equal(firestore.paths().filter((path) => path.startsWith("roomPayloads/")).length, 9);
      }
    });
  }
});

test("falha durante migracao preserva legado e retry conclui", async () => {
  const room = baseRoom({ code: "BOLA-MFAIL" });
  const firestore = createFakeFirestore({ initialDocuments: { [`rooms/${room.code}`]: room } });
  const persistence = new FirestoreRoomPersistence(firestore);
  firestore.failOnGlobalWrite(1, new Error("conexao interrompida"));
  await assert.rejects(persistence.get(room.code), /conexao interrompida/);
  assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, undefined);
  assert.deepEqual(await persistence.get(room.code), room);
  assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, 2);
});

test("create limpa paginas e indices se o set do manifesto paginado falhar", async () => {
  const room = {
    code: "BOLA-CSTAGE",
    ownerId: "uid-owner",
    managerIds: ["uid-owner"],
    pagedCatalog: largeMatchHistory(2_000),
  };
  const manifestOffset = await pagedManifestWriteOffset(room, "pagedCatalog");
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  let failureContext;
  firestore.failOnGlobalWrite(manifestOffset, (context) => {
    failureContext = context;
    return new Error("falha no set do manifesto durante create");
  });

  await assert.rejects(
    persistence.create(room),
    /falha no set do manifesto durante create/,
  );

  assert.equal(failureContext?.kind, "direct");
  assert.equal(failureContext?.type, "set");
  assert.match(failureContext?.path, /^rooms\/BOLA-CSTAGE\/catalog\/(?!page(?:-index)?--)[^/]+$/);
  const attemptsBeforeManifest = firestore.metrics.attemptedWritePaths
    .slice(0, failureContext.globalIndex - 1);
  assert.ok(attemptsBeforeManifest.some((path) => path.includes("/page--")));
  assert.ok(attemptsBeforeManifest.some((path) => path.includes("/page-index--")));
  assert.ok(firestore.metrics.writePaths.some((path) => path.includes("/page--")));
  assert.ok(firestore.metrics.writePaths.some((path) => path.includes("/page-index--")));
  assert.equal(firestore.has(`rooms/${room.code}`), false);
  assert.deepEqual(roomDomainStoragePaths(firestore, room.code), []);
});

test("migracao limpa paginas e indices se o set do manifesto paginado falhar", async () => {
  const legacyRoom = {
    code: "BOLA-MSTAGE",
    ownerId: "uid-owner",
    managerIds: ["uid-owner"],
    pagedCatalog: largeMatchHistory(2_000),
  };
  const manifestOffset = await pagedManifestWriteOffset(legacyRoom, "pagedCatalog");
  const rootPath = `rooms/${legacyRoom.code}`;
  const firestore = createFakeFirestore({
    initialDocuments: { [rootPath]: legacyRoom },
  });
  const persistence = new FirestoreRoomPersistence(firestore);
  let failureContext;
  firestore.failOnGlobalWrite(manifestOffset, (context) => {
    failureContext = context;
    return new Error("falha no set do manifesto durante migracao");
  });

  await assert.rejects(
    persistence.get(legacyRoom.code),
    /falha no set do manifesto durante migracao/,
  );

  assert.equal(failureContext?.kind, "direct");
  assert.equal(failureContext?.type, "set");
  assert.match(failureContext?.path, /^rooms\/BOLA-MSTAGE\/catalog\/(?!page(?:-index)?--)[^/]+$/);
  const attemptsBeforeManifest = firestore.metrics.attemptedWritePaths
    .slice(0, failureContext.globalIndex - 1);
  assert.ok(attemptsBeforeManifest.some((path) => path.includes("/page--")));
  assert.ok(attemptsBeforeManifest.some((path) => path.includes("/page-index--")));
  assert.ok(firestore.metrics.writePaths.some((path) => path.includes("/page--")));
  assert.ok(firestore.metrics.writePaths.some((path) => path.includes("/page-index--")));
  assert.deepEqual(firestore.read(rootPath), legacyRoom);
  assert.deepEqual(roomDomainStoragePaths(firestore, legacyRoom.code), []);
});

test("falha durante salvamento mantem geracao anterior visivel", async () => {
  const room = baseRoom({ code: "BOLA-WFAIL" });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);
  const previousCommit = firestore.read(`rooms/${room.code}`).saveCommitId;
  firestore.failOnGlobalWrite(1, new Error("queda durante staging"));
  await assert.rejects(persistence.mutate(room.code, (current) => ({
    ...current,
    careerState: { ...current.careerState, newField: "nao pode vazar" },
  })), /queda durante staging/);
  assert.equal(firestore.read(`rooms/${room.code}`).saveCommitId, previousCommit);
  assert.equal((await persistence.get(room.code)).careerState.newField, undefined);
});

test("ACK perdido depois de criar raiz preserva a geracao confirmada", async () => {
  const room = baseRoom({ code: "BOLA-CACK" });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);

  firestore.failAfterCommit(new Error("ACK da criacao perdido"), "transaction");
  assert.equal(await persistence.create(room), true);
  assert.deepEqual(await persistence.get(room.code), room);

  const root = firestore.read(`rooms/${room.code}`);
  for (const descriptor of root.roomSections) {
    assert.equal(
      firestore.has(`rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`),
      true,
      `manifesto confirmado deve sobreviver: ${descriptor.path}`,
    );
  }
});

test("ACK perdido depois de salvar e tratado como sucesso sem corromper manifestos", async () => {
  const room = baseRoom({ code: "BOLA-WACK" });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  firestore.failAfterCommit(new Error("ACK do save perdido"), "transaction");
  await persistence.mutate(room.code, (current) => ({
    ...current,
    revision: 2,
    careerState: { ...current.careerState, ackRecovered: true },
  }));

  const stored = await persistence.get(room.code);
  assert.equal(stored.careerState.ackRecovered, true);
  const root = firestore.read(`rooms/${room.code}`);
  for (const descriptor of [...root.roomSections, ...root.previousRoomSections]) {
    assert.equal(
      firestore.has(`rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`),
      true,
      `geracao atual/anterior deve sobreviver: ${descriptor.path}`,
    );
  }
});

test("ACK perdido na migracao v1 para v2 nao apaga a geracao publicada", async () => {
  const room = baseRoom({ code: "BOLA-MACK" });
  const firestore = createFakeFirestore({
    initialDocuments: { [`rooms/${room.code}`]: room },
  });
  const persistence = new FirestoreRoomPersistence(firestore);

  firestore.failAfterCommit(new Error("ACK da migracao perdido"), "transaction");
  assert.deepEqual(await persistence.get(room.code), room);
  const root = firestore.read(`rooms/${room.code}`);
  assert.equal(root.saveSchemaVersion, 2);
  for (const descriptor of root.roomSections) {
    assert.equal(
      firestore.has(`rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`),
      true,
    );
  }
});

test("migracoes concorrentes usam geracoes isoladas e limpam apenas a perdedora", async () => {
  const room = baseRoom({ code: "BOLA-MRACE" });
  const firestore = createFakeFirestore({
    initialDocuments: { [`rooms/${room.code}`]: room },
  });
  const first = new FirestoreRoomPersistence(firestore);
  const second = new FirestoreRoomPersistence(firestore);

  const [left, right] = await Promise.all([first.get(room.code), second.get(room.code)]);
  assert.deepEqual(left, room);
  assert.deepEqual(right, room);

  const root = firestore.read(`rooms/${room.code}`);
  const manifestPaths = firestore.paths().filter(
    (path) => new RegExp(`^rooms/${room.code}/(?:catalog|career)/`).test(path),
  );
  assert.equal(manifestPaths.length, root.roomSections.length);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith(`rooms/${room.code}/migrations/legacy-`)).length,
    1,
    "registro de auditoria da mesma origem deve permanecer idempotente",
  );
});

test("detecta secao ausente, chunk legado ausente e versao futura", async (t) => {
  await t.test("secao v2 ausente", async () => {
    const room = baseRoom({ code: "BOLA-PART" });
    const firestore = createFakeFirestore();
    const persistence = new FirestoreRoomPersistence(firestore);
    await persistence.create(room);
    const descriptor = firestore.read(`rooms/${room.code}`).roomSections[0];
    await firestore.doc(`rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`).delete();
    await assert.rejects(persistence.get(room.code), { code: "SAVE_INCOMPLETE" });
  });

  await t.test("chunk legado ausente", async () => {
    const room = baseRoom({ code: "BOLA-CHMISS" });
    const bundle = legacyCompressedBundle(room, 3);
    const firestore = createFakeFirestore({ initialDocuments: { [`rooms/${room.code}`]: bundle.document } });
    firestore.seed(`roomPayloads/${bundle.chunks[0].id}`, bundle.chunks[0].data);
    firestore.seed(`roomPayloads/${bundle.chunks[2].id}`, bundle.chunks[2].data);
    const persistence = new FirestoreRoomPersistence(firestore);
    await assert.rejects(persistence.get(room.code), { code: "ROOM_DOCUMENT_CORRUPT" });
    assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, undefined);
  });

  await t.test("versao futura", async () => {
    const room = baseRoom({ code: "BOLA-FUTURE" });
    const firestore = createFakeFirestore({
      initialDocuments: { [`rooms/${room.code}`]: { ...room, saveSchemaVersion: 99 } },
    });
    const persistence = new FirestoreRoomPersistence(firestore);
    await assert.rejects(persistence.get(room.code), { code: "SAVE_SCHEMA_VERSION_UNSUPPORTED" });
    assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, 99);
  });
});

test("mutacoes concorrentes preservam mudancas em vez de last-write-wins", async () => {
  const room = baseRoom({ code: "BOLA-RACE", flags: {} });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);
  await Promise.all([
    persistence.mutate(room.code, (current) => ({ ...current, flags: { ...current.flags, a: true } })),
    persistence.mutate(room.code, (current) => ({ ...current, flags: { ...current.flags, b: true } })),
  ]);
  assert.deepEqual((await persistence.get(room.code)).flags, { a: true, b: true });
});

test("migracao de calendario legado continua compativel", async () => {
  const legacyRoom = baseRoom({
    code: "BOLA-MIGR",
    competitionCatalog: undefined,
    tournamentCatalog: undefined,
    careerState: undefined,
    marketState: undefined,
    currentFixtureId: "copa-ida",
    completedFixtureIds: ["ABERTURA", "RODADA-2"],
    scheduleVersion: undefined,
    matchReadiness: undefined,
  });
  const firestore = createFakeFirestore({ initialDocuments: { "rooms/BOLA-MIGR": legacyRoom } });
  const store = new RoomStore({
    persistence: new FirestoreRoomPersistence(firestore),
    now: () => new Date("2026-07-11T00:00:00.000Z"),
  });
  const migrated = await store.setMatchReady(legacyRoom.code, "uid-owner", true, "copa-ida");
  assert.equal(migrated.scheduleVersion, FIXTURE_SCHEDULE_VERSION);
  assert.equal(migrated.currentFixtureId, "rodada-3");
  assert.equal(firestore.read("rooms/BOLA-MIGR").saveSchemaVersion, 2);
});

test("rejeita documento marcado como v2 com formato de storage invalido", async () => {
  const room = baseRoom({ code: "BOLA-BAD2", completedMatches: [{ fixtureId: "F-1" }] });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const rootPath = `rooms/${room.code}`;
  const validRoot = firestore.read(rootPath);
  await firestore.doc(rootPath).set({ ...validRoot, saveStorageFormat: "formato-v2-desconhecido" });

  await assert.rejects(persistence.get(room.code), { code: "SAVE_DOCUMENT_CORRUPT" });
  const preserved = firestore.read(rootPath);
  assert.equal(preserved.saveStorageFormat, "formato-v2-desconhecido");
  assert.equal(preserved.saveMigration, undefined, "v2 corrompido nao pode ser reinterpretado como v1");
});

test("detecta adulteracao do documento raiz pelo saveCommitId", async () => {
  const room = baseRoom({ code: "BOLA-TAMP" });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const rootPath = `rooms/${room.code}`;
  const validRoot = firestore.read(rootPath);
  await firestore.doc(rootPath).set({ ...validRoot, name: "Nome adulterado sem novo commit" });

  await assert.rejects(persistence.get(room.code), { code: "SAVE_DOCUMENT_CORRUPT" });
});

test("pagina referenciada ausente gera SAVE_INCOMPLETE em vez de lista vazia", async () => {
  const room = baseRoom({ code: "BOLA-PMISS", completedMatches: largeMatchHistory(4_000) });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const firstRead = await readSectionPageAndPath(
    persistence,
    firestore,
    room.code,
    "completedMatches",
    0,
  );
  assert.equal(firstRead.result.page, 0);
  assert.ok(firstRead.result.pageCount > 1);
  await firestore.doc(firstRead.pagePath).delete();

  await assert.rejects(
    persistence.getSection(room.code, "completedMatches", { page: 0 }),
    { code: "SAVE_INCOMPLETE" },
  );
});

test("save concorrente nao confirma dois snapshots quando um sobrescreveria o outro", async () => {
  const room = baseRoom({ code: "BOLA-SRACE", flags: {} });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const results = await Promise.allSettled([
    persistence.save({ ...room, revision: 2, version: 2, flags: { a: true } }),
    persistence.save({ ...room, revision: 2, version: 2, flags: { b: true } }),
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1, "somente um snapshot obsoleto pode ser confirmado");
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "SAVE_WRITE_CONFLICT");

  const stored = await persistence.get(room.code);
  assert.ok(
    JSON.stringify(stored.flags) === JSON.stringify({ a: true })
      || JSON.stringify(stored.flags) === JSON.stringify({ b: true }),
    "estado final deve corresponder integralmente ao unico save confirmado",
  );
});

test("save rejeita snapshot obsoleto mesmo quando chega depois do primeiro commit", async () => {
  const room = baseRoom({ code: "BOLA-STALE", flags: {} });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  await persistence.save({ ...room, revision: 2, version: 2, flags: { current: true } });
  await assert.rejects(
    persistence.save({ ...room, revision: 2, version: 2, flags: { stale: true } }),
    { code: "SAVE_WRITE_CONFLICT" },
  );
  assert.deepEqual((await persistence.get(room.code)).flags, { current: true });
});

test("rejeita versao malformada e formato legado desconhecido sem migrar", async (t) => {
  await t.test("schema fracionario", async () => {
    const room = baseRoom({ code: "BOLA-VBAD" });
    const firestore = createFakeFirestore({
      initialDocuments: { [`rooms/${room.code}`]: { ...room, saveSchemaVersion: 1.5 } },
    });
    const persistence = new FirestoreRoomPersistence(firestore);
    await assert.rejects(persistence.get(room.code), { code: "SAVE_SCHEMA_VERSION_INVALID" });
  });

  await t.test("storage legado desconhecido", async () => {
    const room = baseRoom({ code: "BOLA-FBAD" });
    const firestore = createFakeFirestore({
      initialDocuments: {
        [`rooms/${room.code}`]: { ...room, roomStorageFormat: "gzip-json-v0-desconhecido" },
      },
    });
    const persistence = new FirestoreRoomPersistence(firestore);
    await assert.rejects(persistence.get(room.code), { code: "ROOM_DOCUMENT_CORRUPT" });
    assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, undefined);
  });
});

test("falha apos preparar varias secoes remove toda geracao nao confirmada", async () => {
  const room = baseRoom({
    code: "BOLA-ORPH",
    alphaState: { value: 1 },
    betaState: { value: 1 },
  });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);
  const pathsBefore = firestore.paths();
  const commitBefore = firestore.read(`rooms/${room.code}`).saveCommitId;

  firestore.failOnGlobalWrite(2, new Error("falha depois da primeira secao"));
  await assert.rejects(persistence.mutate(room.code, (current) => ({
    ...current,
    alphaState: { value: 2 },
    betaState: { value: 2 },
  })), /falha depois da primeira secao/);

  assert.equal(firestore.read(`rooms/${room.code}`).saveCommitId, commitBefore);
  assert.deepEqual(
    firestore.paths(),
    pathsBefore,
    "staging abortado nao pode deixar manifestos, paginas ou journals orfaos",
  );
});

test("getSection legado respeita contrato paginado depois da migracao", async () => {
  const matches = largeMatchHistory(4_000);
  const room = baseRoom({ code: "BOLA-LPAGE", completedMatches: matches });
  const bundle = legacyCompressedBundle(room);
  const firestore = createFakeFirestore({
    initialDocuments: { [`rooms/${room.code}`]: bundle.document },
  });
  const persistence = new FirestoreRoomPersistence(firestore);

  const first = await persistence.getSection(room.code, "completedMatches", { page: 0 });
  assert.equal(first.page, 0);
  assert.ok(Array.isArray(first.items));
  assert.ok(first.items.length > 0 && first.items.length < matches.length);
  assert.ok(first.pageCount > 1);
  assert.equal(first.hasMore, true);
  assert.deepEqual(first.items[0], matches[0]);
  assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, 2);
});

test("append em historico grande reutiliza paginas de conteudo inalteradas", async () => {
  const matches = largeMatchHistory(6_000);
  const room = baseRoom({ code: "BOLA-PREUSE", completedMatches: matches });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const firstPage = await readSectionPageAndPath(
    persistence,
    firestore,
    room.code,
    "completedMatches",
    0,
  );
  assert.ok(firstPage.result.pageCount > 3);
  const pagePathsBefore = [firstPage.pagePath];
  for (let page = 1; page < firstPage.result.pageCount; page += 1) {
    const read = await readSectionPageAndPath(
      persistence,
      firestore,
      room.code,
      "completedMatches",
      page,
    );
    pagePathsBefore.push(read.pagePath);
  }

  firestore.resetMetrics();
  const appended = {
    fixtureId: "H-APPEND",
    season: 99,
    homeClubId: "C-1",
    awayClubId: "C-2",
    score: [2, 1],
    commentary: `Nova partida ${"z".repeat(120)}`,
  };
  await persistence.mutate(room.code, (current) => ({
    ...current,
    completedMatches: [...current.completedMatches, appended],
    revision: current.revision + 1,
    version: current.version + 1,
  }));
  const appendWritePaths = [...firestore.metrics.writePaths];

  const pagePathsAfter = [];
  const pageZeroAfter = await readSectionPageAndPath(
    persistence,
    firestore,
    room.code,
    "completedMatches",
    0,
  );
  pagePathsAfter.push(pageZeroAfter.pagePath);
  for (let page = 1; page < pageZeroAfter.result.pageCount; page += 1) {
    const read = await readSectionPageAndPath(
      persistence,
      firestore,
      room.code,
      "completedMatches",
      page,
    );
    pagePathsAfter.push(read.pagePath);
  }

  const reused = pagePathsBefore.filter((path) => pagePathsAfter.includes(path));
  assert.ok(
    reused.length >= pagePathsBefore.length - 1,
    "append deve trocar somente ultima pagina parcial e paginas novas",
  );
  assert.equal(
    appendWritePaths.some((path) => reused.includes(path)),
    false,
    "paginas de conteudo reutilizadas nao podem ser regravadas",
  );
  assert.deepEqual((await persistence.get(room.code)).completedMatches.at(-1), appended);
});

test("manifesto paginado permanece limitado e aceita paginas de conteudo repetidas", async () => {
  const repeated = { kind: "repeat", payload: "x".repeat(180_000) };
  const values = Array.from({ length: 8 }, () => structuredClone(repeated));
  const room = baseRoom({ code: "BOLA-IDX", repeatedHistory: values });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);

  await persistence.create(room);
  const root = firestore.read(`rooms/${room.code}`);
  const descriptor = root.roomSections.find(({ path }) => path === "repeatedHistory");
  const manifest = firestore.read(
    `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`,
  );

  assert.equal(manifest.pageDocumentIds, undefined);
  assert.match(manifest.pageIndexRootId, /^[a-f0-9]{64}$/);
  assert.ok(manifest.pageIndexDepth >= 1);
  assert.ok(Buffer.byteLength(JSON.stringify(manifest), "utf8") < 20_000);
  assert.equal(
    firestore.paths().filter((path) => isContentPagePath(path)).length,
    1,
    "conteudo identico deve reutilizar um unico documento imutavel",
  );
  assert.deepEqual((await persistence.get(room.code)).repeatedHistory, values);
});

test("paginas e indices novos ficam fisicamente isolados entre catalogo e carreira", async () => {
  const repeated = { kind: "same-content", payload: "d".repeat(180_000) };
  const values = Array.from({ length: 3 }, () => structuredClone(repeated));
  const room = baseRoom({
    code: "BOLA-DOMAINS",
    competitionCatalog: structuredClone(values),
    completedMatches: structuredClone(values),
  });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);

  await persistence.create(room);
  const root = firestore.read(`rooms/${room.code}`);
  const catalogDescriptor = root.roomSections.find(({ path }) => path === "competitionCatalog");
  const careerDescriptor = root.roomSections.find(({ path }) => path === "completedMatches");
  const catalogManifest = firestore.read(
    `rooms/${room.code}/catalog/${catalogDescriptor.documentId}`,
  );
  const careerManifest = firestore.read(
    `rooms/${room.code}/career/${careerDescriptor.documentId}`,
  );
  assert.equal(catalogManifest.pageStorageFormat, "domain-content-addressed-v1");
  assert.equal(careerManifest.pageStorageFormat, "domain-content-addressed-v1");

  const paths = firestore.paths();
  const catalogPages = paths.filter((path) => (
    path.startsWith(`rooms/${room.code}/catalog/page--`)
  ));
  const careerPages = paths.filter((path) => (
    path.startsWith(`rooms/${room.code}/career/page--`)
  ));
  const catalogIndexes = paths.filter((path) => (
    path.startsWith(`rooms/${room.code}/catalog/page-index--`)
  ));
  const careerIndexes = paths.filter((path) => (
    path.startsWith(`rooms/${room.code}/career/page-index--`)
  ));
  assert.ok(catalogPages.length > 0);
  assert.ok(careerPages.length > 0);
  assert.ok(catalogIndexes.length > 0);
  assert.ok(careerIndexes.length > 0);
  assert.deepEqual(
    catalogPages.map((path) => path.split("/").at(-1)).sort(),
    careerPages.map((path) => path.split("/").at(-1)).sort(),
    "mesmo conteudo deve existir uma vez em cada dominio, nunca numa colecao compartilhada",
  );
  assert.equal(paths.some((path) => path.includes("/sectionPages/")), false);
  assert.equal(paths.some((path) => path.includes("/sectionPageIndexes/")), false);
  assert.deepEqual(await persistence.get(room.code), room);
});

test("v2 anterior sem localizacao no manifesto continua lendo colecoes compartilhadas", async () => {
  const room = baseRoom({ code: "BOLA-V2SHARED", completedMatches: largeMatchHistory(4_000) });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const rootPath = `rooms/${room.code}`;
  const root = firestore.read(rootPath);
  const descriptor = root.roomSections.find(({ path }) => path === "completedMatches");
  const manifestPath = `${rootPath}/${descriptor.domain}/${descriptor.documentId}`;
  const manifest = firestore.read(manifestPath);
  const domainPrefix = `${rootPath}/${descriptor.domain}/`;
  for (const path of firestore.paths().filter((candidate) => candidate.startsWith(domainPrefix))) {
    const documentId = path.slice(domainPrefix.length);
    if (documentId.startsWith("page--")) {
      await firestore.doc(`${rootPath}/sectionPages/${documentId.slice("page--".length)}`)
        .set(firestore.read(path));
    } else if (documentId.startsWith("page-index--")) {
      await firestore.doc(`${rootPath}/sectionPageIndexes/${documentId.slice("page-index--".length)}`)
        .set(firestore.read(path));
    }
  }

  const { pageStorageFormat: _storage, ...legacyManifest } = manifest;
  await firestore.doc(manifestPath).set(legacyManifest);
  const legacyDescriptors = root.roomSections.map((candidate) => (
    candidate.path === descriptor.path
      ? { ...candidate, manifestChecksum: canonicalChecksum(legacyManifest) }
      : candidate
  ));
  const { saveCommitId: _commit, ...rootBase } = { ...root, roomSections: legacyDescriptors };
  await firestore.doc(rootPath).set({ ...rootBase, saveCommitId: canonicalChecksum(rootBase) });

  firestore.resetMetrics();
  assert.deepEqual(await persistence.get(room.code), room);
  assert.ok(firestore.metrics.readPaths.some((path) => path.includes("/sectionPages/")));
  assert.ok(firestore.metrics.readPaths.some((path) => path.includes("/sectionPageIndexes/")));
  assert.equal(
    firestore.metrics.readPaths.some((path) => /\/(catalog|career)\/page--/.test(path)),
    false,
  );
});

test("descritor raiz ancora o manifesto e detecta troca da raiz Merkle", async () => {
  const room = baseRoom({ code: "BOLA-MTAMP", completedMatches: largeMatchHistory(4_000) });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const root = firestore.read(`rooms/${room.code}`);
  const descriptor = root.roomSections.find(({ path }) => path === "completedMatches");
  assert.match(descriptor.manifestChecksum, /^[a-f0-9]{64}$/);
  const manifestPath = `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`;
  const manifest = firestore.read(manifestPath);
  await firestore.doc(manifestPath).set({ ...manifest, pageIndexRootId: "0".repeat(64) });

  await assert.rejects(persistence.get(room.code), { code: "SAVE_DOCUMENT_CORRUPT" });
});

test("pagina enderecada por conteudo valida ID e payload", async () => {
  const room = baseRoom({ code: "BOLA-PTAMP", completedMatches: largeMatchHistory(4_000) });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const { pagePath } = await readSectionPageAndPath(
    persistence,
    firestore,
    room.code,
    "completedMatches",
    0,
  );
  const pageId = contentPageIdFromPath(pagePath);
  const page = firestore.read(pagePath);
  await firestore.doc(pagePath).set({ ...page, payload: "[]", checksum: pageId });

  await assert.rejects(
    persistence.getSection(room.code, "completedMatches", { page: 0 }),
    { code: "SAVE_DOCUMENT_CORRUPT" },
  );
});

test("cauda lazy valida a identidade e o payload da ultima pagina", async () => {
  const room = baseRoom({ code: "BOLA-TTAIL", seasonHistory: largeMatchHistory(4_000) });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  firestore.resetMetrics();
  await persistence.getSectionTail(room.code, "seasonHistory");
  const pagePath = firestore.metrics.readPaths
    .filter((path) => isContentPagePath(path, room.code))
    .at(-1);
  assert.ok(pagePath);
  const pageId = contentPageIdFromPath(pagePath);
  const page = firestore.read(pagePath);
  await firestore.doc(pagePath).set({ ...page, payload: "[]", checksum: pageId });

  await assert.rejects(
    persistence.getSectionTail(room.code, "seasonHistory"),
    { code: "SAVE_DOCUMENT_CORRUPT" },
  );
});

test("descritor v2 antigo sem checksum de manifesto continua legivel", async () => {
  const room = baseRoom({ code: "BOLA-V2COMP" });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const rootPath = `rooms/${room.code}`;
  const current = firestore.read(rootPath);
  const legacyDescriptors = current.roomSections.map(({ manifestChecksum: _ignored, ...descriptor }) => descriptor);
  const { saveCommitId: _commit, ...base } = { ...current, roomSections: legacyDescriptors };
  await firestore.doc(rootPath).set({ ...base, saveCommitId: canonicalChecksum(base) });

  assert.deepEqual(await persistence.get(room.code), room);
});

test("mutatePaths le e grava somente secoes pedidas preservando historicos e contadores", async () => {
  const completedMatches = largeMatchHistory(2_000);
  const seasonHistory = largeMatchHistory(1_500);
  const room = baseRoom({
    code: "BOLA-MPATH",
    completedFixtureIds: ["R1", "R2", "R3"],
    completedMatches,
    seasonHistory,
    lineups: { SAN: ["P1"] },
  });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  const before = firestore.read(`rooms/${room.code}`);
  const completedDescriptor = before.roomSections.find(({ path }) => path === "completedMatches");
  const historyDescriptor = before.roomSections.find(({ path }) => path === "seasonHistory");
  const catalogDescriptor = before.roomSections.find(({ path }) => path === "competitionCatalog");
  const heavyManifestPaths = new Set([completedDescriptor, historyDescriptor].map((descriptor) => (
    `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`
  )));

  firestore.resetMetrics();
  const partial = await persistence.mutatePaths(
    room.code,
    ["lineups", "competitionCatalog"],
    (current) => {
      assert.equal("completedMatches" in current, false);
      assert.equal("seasonHistory" in current, false);
      return {
        ...current,
        name: "Save parcial",
        revision: current.revision + 1,
        version: current.version + 1,
        lineups: { ...current.lineups, SAN: ["P1", "P2"] },
      };
    },
  );

  assert.equal(partial.completedFixtureCount, 3);
  assert.equal(partial.completedMatchCount, completedMatches.length);
  assert.equal(partial.seasonHistoryCount, seasonHistory.length);
  assert.equal(
    firestore.metrics.readPaths.some((path) => heavyManifestPaths.has(path)),
    false,
  );
  assert.equal(
    firestore.metrics.readPaths.some((path) => isContentPagePath(path, room.code)),
    false,
  );
  assert.equal(
    firestore.metrics.writePaths.includes(
      `rooms/${room.code}/${catalogDescriptor.domain}/${catalogDescriptor.documentId}`,
    ),
    false,
  );
  assert.equal(
    firestore.metrics.writePaths.filter((path) => /\/(catalog|career)\//.test(path)).length,
    1,
    "somente lineups alterada deve gerar novo manifesto",
  );

  const root = firestore.read(`rooms/${room.code}`);
  assert.equal(root.completedFixtureCount, 3);
  assert.equal(root.completedMatchCount, completedMatches.length);
  assert.equal(root.seasonHistoryCount, seasonHistory.length);
  const reloaded = await persistence.get(room.code);
  assert.equal(reloaded.name, "Save parcial");
  assert.deepEqual(reloaded.lineups.SAN, ["P1", "P2"]);
  assert.deepEqual(reloaded.completedMatches, completedMatches);
  assert.deepEqual(reloaded.seasonHistory, seasonHistory);
});

test("mutatePaths concorrente preserva mudancas em secoes independentes", async () => {
  const room = baseRoom({
    code: "BOLA-MPRACE",
    completedMatches: largeMatchHistory(100),
    seasonHistory: largeMatchHistory(80),
    lineups: { SAN: ["P1"] },
  });
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  await persistence.create(room);

  await Promise.all([
    persistence.mutatePaths(room.code, ["lineups"], (current) => ({
      ...current,
      revision: current.revision + 1,
      version: current.version + 1,
      lineups: { SAN: ["P1", "P2"] },
    })),
    persistence.mutatePaths(room.code, ["competitionCatalog"], (current) => ({
      ...current,
      revision: current.revision + 1,
      version: current.version + 1,
      competitionCatalog: current.competitionCatalog.map((competition) => ({
        ...competition,
        name: "Serie A atualizada",
      })),
    })),
  ]);

  const root = firestore.read(`rooms/${room.code}`);
  assert.equal(root.completedMatchCount, 100);
  assert.equal(root.seasonHistoryCount, 80);
  const reloaded = await persistence.get(room.code);
  assert.deepEqual(reloaded.lineups.SAN, ["P1", "P2"]);
  assert.equal(reloaded.competitionCatalog[0].name, "Serie A atualizada");
  assert.equal(reloaded.revision, 3);
  assert.equal(reloaded.version, 3);
  assert.equal(reloaded.completedMatches.length, 100);
  assert.equal(reloaded.seasonHistory.length, 80);
});

test("GC mark-sweep limita paginas e indices a geracao atual e anterior", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-GC01",
    completedMatches: largeMatchHistory(2_000),
  });
  await persistence.create(room);
  const initialPages = firestore.paths().filter((path) => isContentPagePath(path, room.code));
  assert.ok(initialPages.length > 1);

  for (let revision = 2; revision <= 6; revision += 1) {
    await persistence.mutatePaths(room.code, ["completedMatches"], (current) => ({
      ...current,
      revision,
      version: revision,
      completedMatches: current.completedMatches.map((match) => ({
        ...match,
        commentary: `${match.commentary} geracao-${revision}`,
      })),
    }));
  }

  // GC roda fora do ACK do save; chamada explicita aguarda job deduplicado.
  await persistence.collectGarbage(room.code);
  assert.ok(initialPages.some((path) => !firestore.has(path)), "paginas antigas devem ser coletadas");
  const beforeSecondSweep = firestore.paths();
  const sweep = await persistence.collectGarbage(room.code);
  assert.equal(sweep.deletedCount, 0, "segunda varredura deve ser idempotente");
  assert.deepEqual(firestore.paths(), beforeSecondSweep);
  assert.equal((await persistence.get(room.code)).completedMatches.length, 2_000);
});

test("GC falha fechado em grafo corrompido e nao apaga candidato", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-GCBAD", completedMatches: largeMatchHistory(1_500) });
  await persistence.create(room);
  const root = firestore.read(`rooms/${room.code}`);
  const descriptor = root.roomSections.find(({ path }) => path === "completedMatches");
  const manifestPath = `rooms/${room.code}/${descriptor.domain}/${descriptor.documentId}`;
  const manifest = firestore.read(manifestPath);
  firestore.seed(manifestPath, { ...manifest, itemCount: manifest.itemCount + 1 });
  const orphanPath = `rooms/${room.code}/career/page--${"a".repeat(64)}`;
  firestore.seed(orphanPath, { encoding: "json", payload: "[]", checksum: "a".repeat(64), rawBytes: 2 });

  await assert.rejects(persistence.collectGarbage(room.code), { code: "SAVE_DOCUMENT_CORRUPT" });
  assert.equal(firestore.has(orphanPath), true, "mark incompleto nao pode iniciar sweep");
});

test("lease de manutencao bloqueia writer e lease expirada e recuperavel", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-GCLOCK" });
  await persistence.create(room);
  const rootPath = `rooms/${room.code}`;
  const active = rootWithMaintenanceLease(firestore.read(rootPath), {
    id: "gc-ativo",
    operation: "storage-gc",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  firestore.seed(rootPath, active);
  await assert.rejects(
    persistence.mutatePaths(room.code, ["lineups"], (current) => ({ ...current, lineups: { SAN: ["P1"] } })),
    { code: "SAVE_MAINTENANCE_BUSY", status: 409 },
  );

  firestore.seed(rootPath, rootWithMaintenanceLease(active, {
    id: "gc-expirado",
    operation: "storage-gc",
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  }));
  await persistence.mutatePaths(room.code, ["lineups"], (current) => ({
    ...current,
    revision: current.revision + 1,
    version: current.version + 1,
    lineups: { SAN: ["P1"] },
  }));
  assert.deepEqual((await persistence.get(room.code)).lineups, { SAN: ["P1"] });
});

test("GC nao varre blobs enquanto writer esta entre staging e commit", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-WRLOCK",
    completedMatches: largeMatchHistory(1_500),
  });
  await persistence.create(room);

  const originalBatch = firestore.batch.bind(firestore);
  let stagedResolve;
  let continueResolve;
  const staged = new Promise((resolve) => { stagedResolve = resolve; });
  const continueCommit = new Promise((resolve) => { continueResolve = resolve; });
  let heldFirstBatch = false;
  firestore.batch = () => {
    const batch = originalBatch();
    const commit = batch.commit.bind(batch);
    batch.commit = async () => {
      const result = await commit();
      if (!heldFirstBatch) {
        heldFirstBatch = true;
        stagedResolve();
        await continueCommit;
      }
      return result;
    };
    return batch;
  };

  const writing = persistence.mutate(room.code, (current) => ({
    ...current,
    revision: current.revision + 1,
    version: current.version + 1,
    completedMatches: current.completedMatches.map((match, index) => (
      index === 0 ? { ...match, writerLeaseProbe: true } : match
    )),
  }));
  await staged;
  assert.ok(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/maintenance/storage-writer--`)),
  );
  await assert.rejects(persistence.collectGarbage(room.code), {
    code: "SAVE_MAINTENANCE_BUSY",
    status: 409,
  });

  continueResolve();
  await writing;
  firestore.batch = originalBatch;
  const loaded = await persistence.get(room.code);
  assert.equal(loaded.completedMatches[0].writerLeaseProbe, true);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith(`rooms/${room.code}/maintenance/storage-writer`)).length,
    0,
  );
});

test("delete bloqueia writer ativo e nao deixa blobs tardios orfaos", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-WRDEL",
    completedMatches: largeMatchHistory(1_500),
  });
  await persistence.create(room);
  await persistence.collectGarbage(room.code);

  const originalBatch = firestore.batch.bind(firestore);
  let stagedResolve;
  let continueResolve;
  const staged = new Promise((resolve) => { stagedResolve = resolve; });
  const continueCommit = new Promise((resolve) => { continueResolve = resolve; });
  let heldFirstBatch = false;
  firestore.batch = () => {
    const batch = originalBatch();
    const commit = batch.commit.bind(batch);
    batch.commit = async () => {
      const result = await commit();
      if (!heldFirstBatch) {
        heldFirstBatch = true;
        stagedResolve();
        await continueCommit;
      }
      return result;
    };
    return batch;
  };

  let writing;
  try {
    writing = persistence.mutate(room.code, (current) => ({
      ...current,
      revision: current.revision + 1,
      version: current.version + 1,
      completedMatches: current.completedMatches.map((match, index) => (
        index === 0 ? { ...match, deleteRaceProbe: true } : match
      )),
    }));
    await staged;
    await assert.rejects(
      persistence.remove(room.code, () => {}),
      { code: "SAVE_MAINTENANCE_BUSY", status: 409 },
    );
    continueResolve();
    await writing;
  } finally {
    continueResolve?.();
    await writing?.catch(() => {});
    firestore.batch = originalBatch;
  }

  await persistence.collectGarbage(room.code);
  const removed = await persistence.remove(room.code, () => {});
  assert.equal(removed.code, room.code);
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/`)),
    false,
  );
});

test("renew nao revive lease individual de writer expirada", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-WREXP",
    completedMatches: largeMatchHistory(1_500),
  });
  await persistence.create(room);
  await persistence.collectGarbage(room.code);
  const next = {
    ...room,
    revision: 2,
    version: 2,
    completedMatches: room.completedMatches.map((match, index) => (
      index === 0 ? { ...match, expiredLeaseProbe: true } : match
    )),
  };

  const originalBatch = firestore.batch.bind(firestore);
  let stagedResolve;
  let continueResolve;
  const staged = new Promise((resolve) => { stagedResolve = resolve; });
  const continueCommit = new Promise((resolve) => { continueResolve = resolve; });
  let heldFirstBatch = false;
  firestore.batch = () => {
    const batch = originalBatch();
    const commit = batch.commit.bind(batch);
    batch.commit = async () => {
      const result = await commit();
      if (!heldFirstBatch) {
        heldFirstBatch = true;
        stagedResolve();
        await continueCommit;
      }
      return result;
    };
    return batch;
  };

  let saving;
  try {
    saving = persistence.save(next);
    await staged;
    const writerPath = firestore.paths().find((path) => (
      path.startsWith(`rooms/${room.code}/maintenance/storage-writer--`)
    ));
    assert.ok(writerPath);
    const expiredAt = new Date(Date.now() - 1_000).toISOString();
    firestore.seed(writerPath, { ...firestore.read(writerPath), expiresAt: expiredAt });
    const statePath = `rooms/${room.code}/maintenance/storage-writers`;
    firestore.seed(statePath, {
      ...firestore.read(statePath),
      activeUntil: expiredAt,
    });
    continueResolve();
    await assert.rejects(saving, { code: "SAVE_WRITE_CONFLICT", status: 409 });
  } finally {
    continueResolve?.();
    await saving?.catch(() => {});
    firestore.batch = originalBatch;
  }
  assert.equal(firestore.read(`rooms/${room.code}`).revision, room.revision);
});

test("GC remove leases storage-writer expiradas sem limite fixo", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-WRGC" });
  await persistence.create(room);
  await persistence.collectGarbage(room.code);

  const expiredAt = new Date(Date.now() - 1_000).toISOString();
  for (let index = 0; index < 230; index += 1) {
    const id = String(index).padStart(4, "0");
    firestore.seed(`rooms/${room.code}/maintenance/storage-writer--abandoned-${id}`, {
      id: `abandoned-${id}`,
      operation: "commit-save",
      acquiredAt: expiredAt,
      expiresAt: expiredAt,
    });
  }
  await persistence.collectGarbage(room.code);
  assert.equal(
    firestore.paths().some((path) => (
      path.startsWith(`rooms/${room.code}/maintenance/storage-writer--`)
    )),
    false,
  );
});

test("GC reconcilia ACK perdido ao adquirir lease e sempre libera root", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-GCACK" });
  await persistence.create(room);
  await persistence.collectGarbage(room.code);

  firestore.failAfterCommit(new Error("ACK do lease GC perdido"), "transaction");
  const result = await persistence.collectGarbage(room.code);
  assert.ok(result.reachableCount > 0);
  assert.equal(firestore.read(`rooms/${room.code}`).saveMaintenanceLease, undefined);
});

test("falha durante staging paginado nao deixa blobs orfaos", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({
    code: "BOLA-GCFAIL",
    largeA: largeMatchHistory(2_000),
    largeB: largeMatchHistory(2_000).map((item) => ({ ...item, fixtureId: `B-${item.fixtureId}` })),
  });
  await persistence.create(room);
  const beforeStorage = firestore.paths().filter((path) => path.startsWith(`rooms/${room.code}/`));
  firestore.failOnGlobalWrite(8, new Error("queda durante staging paginado"));

  await assert.rejects(persistence.mutate(room.code, (current) => ({
    ...current,
    revision: current.revision + 1,
    version: current.version + 1,
    largeA: current.largeA.map((item) => ({ ...item, extra: "A" })),
    largeB: current.largeB.map((item) => ({ ...item, extra: "B" })),
  })));
  assert.deepEqual(
    firestore.paths().filter((path) => path.startsWith(`rooms/${room.code}/`)),
    beforeStorage,
  );
  assert.equal((await persistence.get(room.code)).revision, room.revision);
});

test("tombstone remove manifestos, paginas, indices, backups e chunks legados", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-GCDEL", completedMatches: largeMatchHistory(1_500) });
  const legacy = legacyCompressedBundle(room, 9);
  firestore.seed(`rooms/${room.code}`, legacy.document);
  for (const chunk of legacy.chunks) firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
  await persistence.get(room.code);
  assert.ok(firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/migrations/`)));
  assert.ok(firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)));

  const removed = await persistence.remove(room.code, (current) => {
    assert.equal(current.ownerId, room.ownerId);
  });
  assert.equal(removed.code, room.code);
  assert.equal(firestore.read(`rooms/${room.code}`).deleted, true);
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/`)),
    false,
  );
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)),
    false,
  );
});

test("tombstone limpa centenas de paginas e chunks legados em lotes limitados", async () => {
  const room = baseRoom({ code: "BOLA-DELBIG" });
  const legacy = legacyCompressedBundle(room, 725);
  const firestore = createFakeFirestore({
    initialDocuments: { [`rooms/${room.code}`]: legacy.document },
  });
  for (const chunk of legacy.chunks) firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
  seedCleanupPages(firestore, room.code, 475);
  const persistence = new FirestoreRoomPersistence(firestore);
  firestore.resetMetrics();

  await persistence.remove(room.code, (current) => {
    assert.equal(current.ownerId, room.ownerId);
  });

  const batchCommits = firestore.metrics.commitKinds.filter((kind) => kind === "batch").length;
  assert.ok(batchCommits >= 6, "cleanup grande deve ser dividido em varios commits limitados");
  assert.deepEqual(cleanupPagePaths(firestore, room.code), []);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)),
    false,
  );
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
});

test("falha em lote tardio preserva tombstone e retry conclui cleanup volumoso", async () => {
  const room = baseRoom({ code: "BOLA-DELBAT" });
  const legacy = legacyCompressedBundle(room, 725);
  const firestore = createFakeFirestore({
    initialDocuments: { [`rooms/${room.code}`]: legacy.document },
  });
  for (const chunk of legacy.chunks) firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
  seedCleanupPages(firestore, room.code, 475);
  const persistence = new FirestoreRoomPersistence(firestore);
  firestore.resetMetrics();

  // 1 escrita cria o tombstone; 400 paginas sao apagadas nos dois primeiros
  // lotes. A falha ocorre dentro do terceiro lote, que deve ser atomico.
  firestore.failOnGlobalWrite(411, new Error("queda no terceiro lote de cleanup"));
  await assert.rejects(
    persistence.remove(room.code, () => {}),
    /queda no terceiro lote de cleanup/,
  );

  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, true);
  assert.equal(cleanupPagePaths(firestore, room.code).length, 75);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith(`roomPayloads/${room.code}--`)).length,
    725,
    "chunks devem esperar retry quando falha ocorre antes dessa fase",
  );

  let retryAuthorized = false;
  await persistence.remove(room.code, (current) => {
    retryAuthorized = current.ownerId === room.ownerId;
  });

  assert.equal(retryAuthorized, true);
  assert.deepEqual(cleanupPagePaths(firestore, room.code), []);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)),
    false,
  );
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
});

test("retry de tombstone retoma cleanup interrompido e finaliza exclusao", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-DELRETRY", completedMatches: largeMatchHistory(1_500) });
  const legacy = legacyCompressedBundle(room, 9);
  firestore.seed(`rooms/${room.code}`, legacy.document);
  for (const chunk of legacy.chunks) firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
  await persistence.get(room.code);

  firestore.failOnGlobalWrite(2, new Error("queda durante cleanup do tombstone"));
  await assert.rejects(
    persistence.remove(room.code, () => {}),
    /queda durante cleanup do tombstone/,
  );
  const pendingTombstone = firestore.read(`rooms/${room.code}`);
  assert.equal(pendingTombstone.deleted, true);
  assert.equal(pendingTombstone.storageCleanupPending, true);
  assert.equal("ownerId" in pendingTombstone, false);
  assert.equal("managerIds" in pendingTombstone, false);
  assert.equal(pendingTombstone.deletedOwnerId, room.ownerId);
  assert.deepEqual(pendingTombstone.storageCleanupRecipients, room.managerIds);
  assert.deepEqual(await persistence.listMetadataByManager(room.ownerId), []);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/`)),
    true,
    "falha atomica no primeiro batch deve deixar storage para o retry",
  );

  let retryAuthorization = null;
  await persistence.remove(room.code, (current) => {
    retryAuthorization = current;
    assert.equal(current.ownerId, room.ownerId);
    assert.deepEqual(current.managerIds, room.managerIds);
  });

  assert.deepEqual(retryAuthorization, {
    code: room.code,
    ownerId: room.ownerId,
    managerIds: room.managerIds,
  });
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/`)),
    false,
  );
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)),
    false,
  );
});

test("retry de tombstone finaliza exclusao quando cleanup terminou sem ACK final", async () => {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const room = baseRoom({ code: "BOLA-DELFN", completedMatches: largeMatchHistory(1_500) });
  await persistence.create(room);
  const storageDocumentCount = firestore.paths().filter(
    (path) => path.startsWith(`rooms/${room.code}/`),
  ).length;

  firestore.failOnGlobalWrite(
    storageDocumentCount + 2,
    new Error("queda ao finalizar tombstone"),
  );
  await assert.rejects(
    persistence.remove(room.code, () => {}),
    /queda ao finalizar tombstone/,
  );
  assert.equal(firestore.read(`rooms/${room.code}`).deleted, true);
  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, true);
  assert.equal(
    firestore.paths().some((path) => path.startsWith(`rooms/${room.code}/`)),
    false,
    "cleanup confirmado deve sobreviver a falha do set final",
  );

  await persistence.remove(room.code, () => {});

  assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
  assert.equal(await persistence.get(room.code), null);
});

test("listMetadataByManager rejeita raiz corrompida ou de versao futura", async (t) => {
  await t.test("checksum da raiz adulterado", async () => {
    const room = baseRoom({ code: "BOLA-LISTBAD" });
    const firestore = createFakeFirestore();
    const persistence = new FirestoreRoomPersistence(firestore);
    await persistence.create(room);
    const rootPath = `rooms/${room.code}`;
    firestore.seed(rootPath, { ...firestore.read(rootPath), name: "metadata adulterada" });

    await assert.rejects(
      persistence.listMetadataByManager(room.ownerId),
      { code: "SAVE_DOCUMENT_CORRUPT" },
    );
  });

  await t.test("schema futuro", async () => {
    const room = baseRoom({ code: "BOLA-LISTFUT" });
    const firestore = createFakeFirestore({
      initialDocuments: {
        [`rooms/${room.code}`]: { ...room, saveSchemaVersion: 99 },
      },
    });
    const persistence = new FirestoreRoomPersistence(firestore);

    await assert.rejects(
      persistence.listMetadataByManager(room.ownerId),
      { code: "SAVE_SCHEMA_VERSION_UNSUPPORTED" },
    );
  });
});
