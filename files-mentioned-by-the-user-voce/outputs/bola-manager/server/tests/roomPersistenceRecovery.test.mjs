import test from "node:test";
import assert from "node:assert/strict";
import { FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { canonicalChecksum, metadataRoomFromDocument } from "../store/roomPersistenceSections.mjs";
import { resolveAllPageIds } from "../store/roomPersistencePageIndex.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const CODE = "BOLA-RECOVERY";
const ROOT = `rooms/${CODE}`;
const CHECKPOINT = `${ROOT}/maintenance/recovery-previous`;

function roomGeneration(generation, { paged = false } = {}) {
  const previous = generation === 1;
  const matches = Array.from({ length: paged ? 720 : generation + 1 }, (_, index) => ({
    id: `match-${generation}-${index}`,
    season: generation,
    score: [generation, index % 4],
    report: `${generation}:${index}:${"relatorio ".repeat(paged ? 55 : 1)}`,
  }));
  return {
    id: "room-recovery",
    code: CODE,
    name: `Carreira ${generation}`,
    ownerId: `owner-${generation}`,
    catalogOwnerId: `catalog-owner-${generation}`,
    status: previous ? "active" : "finished",
    managerIds: [`owner-${generation}`],
    managers: [{ id: `owner-${generation}`, name: `Manager ${generation}`, ready: previous }],
    activeLeagues: [`league-${generation}`],
    seasonLength: generation + 2,
    unlimitedSeasons: previous,
    currentSeason: generation + 3,
    seasonYear: 2025 + generation,
    seasonStartedAt: `2026-0${generation}-01T00:00:00.000Z`,
    careerCompleted: !previous,
    maxManagers: generation + 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: `2026-0${generation}-02T00:00:00.000Z`,
    startedAt: `2026-0${generation}-01T00:00:00.000Z`,
    revision: previous ? 7 : 12,
    version: generation,
    currentFixtureId: `fixture-${generation}`,
    scheduleVersion: generation,
    ...(previous ? {} : { scheduleIssue: "only-current", careerCompletedAt: "2026-02-02" }),
    completedFixtureIds: matches.map(({ id }) => id),
    completedMatches: matches,
    seasonHistory: Array.from({ length: generation }, (_, index) => ({ season: index + 1 })),
    competitionCatalog: [{ id: `league-${generation}`, clubs: [{ id: `club-${generation}` }] }],
    playerCatalog: [{ id: `player-${generation}`, name: `Player ${generation}` }],
    tournamentCatalog: [],
    careerState: {
      players: [{ id: `player-${generation}`, condition: 80 + generation }],
      ...(previous ? { priorOnly: { suspended: true } } : { currentOnly: ["new"] }),
    },
    marketState: { transactions: [{ id: `transfer-${generation}`, amount: generation * 100 }] },
    ...(previous ? { clubCareerState: {} } : { professionalLeaveState: {} }),
  };
}

async function fixture(options = {}) {
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  const previous = roomGeneration(1, options);
  const current = roomGeneration(2, options);
  assert.equal(await persistence.create(previous), true);
  const previousRoot = firestore.read(ROOT);
  await persistence.save(current);
  // Drain background maintenance while both generations are healthy.
  await persistence.collectGarbage(CODE);
  return { firestore, persistence, previous, current, previousRoot, currentRoot: firestore.read(ROOT) };
}

function signedDocument(document) {
  const { saveCommitId: _commit, ...base } = document;
  return { ...base, saveCommitId: canonicalChecksum(base) };
}

function checkpointDocument(document) {
  const { saveMaintenanceLease: _lease, ...base } = document;
  return signedDocument({ ...base, previousRoomSections: [] });
}

function assertCheckpoint(firestore, previousRoot) {
  const checkpoint = firestore.read(CHECKPOINT);
  assert.ok(checkpoint, "a geracao anterior deve ser persistida fora da memoria");
  const { checksum: digest, ...base } = checkpoint;
  assert.equal(checkpoint.format, "previous-generation-v1");
  assert.equal(checkpoint.currentCommitId, firestore.read(ROOT).saveCommitId);
  assert.equal(digest, canonicalChecksum(base));
  assert.deepEqual(checkpoint.document, checkpointDocument(previousRoot));
  assert.deepEqual(checkpoint.document.previousRoomSections, []);
  return checkpoint;
}

function descriptor(root, path) {
  const value = root.roomSections.find((section) => section.path === path);
  assert.ok(value, `fixture precisa ter a secao ${path}`);
  return value;
}

function manifestPath(root, path) {
  const section = descriptor(root, path);
  return `${ROOT}/${section.domain}/${section.documentId}`;
}

async function pagePaths(firestore, root, path) {
  const manifest = firestore.read(manifestPath(root, path));
  const domainPrefix = manifest.pageStorageFormat
    ? `${ROOT}/${manifest.domain}/page--`
    : `${ROOT}/sectionPages/`;
  const indexPrefix = manifest.pageStorageFormat
    ? `${ROOT}/${manifest.domain}/page-index--`
    : `${ROOT}/sectionPageIndexes/`;
  const ids = manifest.pageDocumentIds ?? await resolveAllPageIds({
    rootId: manifest.pageIndexRootId,
    depth: manifest.pageIndexDepth,
    pageCount: manifest.pageCount,
  }, async (id) => firestore.read(`${indexPrefix}${id}`));
  assert.ok(ids.length > 1, "fixture precisa de multiplas paginas");
  return ids.map((id) => `${domainPrefix}${id}`);
}

async function damage(firestore, root, kind, path = "completedMatches") {
  if (kind === "root") {
    firestore.seed(ROOT, { ...root, name: "metadados adulterados" });
    return;
  }
  let target = manifestPath(root, path);
  if (kind.includes("page")) {
    const pages = await pagePaths(firestore, root, path);
    target = kind.includes("tail") ? pages.at(-1) : pages[0];
  }
  if (kind.startsWith("missing")) await firestore.doc(target).delete();
  else {
    const document = firestore.read(target);
    firestore.seed(target, kind.includes("page")
      ? { ...document, payload: "payload-corrompido" }
      : { ...document, checksum: "0".repeat(64) });
  }
}

function assertRestoredRoot(firestore, previousRoot, damagedRoot, reason) {
  const restored = firestore.read(ROOT);
  const { saveCommitId, saveRecovery, ...base } = restored;
  const { saveCommitId: _oldCommit, ...expectedBase } = checkpointDocument(previousRoot);
  assert.deepEqual(base, {
    ...expectedBase,
    revision: Math.max(previousRoot.revision, damagedRoot.revision) + 1,
    version: Math.max(previousRoot.revision, damagedRoot.revision) + 1,
  });
  assert.equal(saveCommitId, canonicalChecksum({ ...base, saveRecovery }));
  assert.equal(saveRecovery.reason, reason);
  assert.equal(saveRecovery.sourceCommitId, checkpointDocument(previousRoot).saveCommitId);
  assert.equal(saveRecovery.replacedCommitId, damagedRoot.saveCommitId);
  assert.ok(saveRecovery.id);
  assert.ok(Number.isFinite(Date.parse(saveRecovery.recoveredAt)));
  assert.equal(firestore.has(CHECKPOINT), false, "checkpoint consumido nao pode ser reutilizado");
  assert.deepEqual(restored.previousRoomSections, []);
  return restored;
}

function observeTransactions(firestore, onWrites) {
  const original = firestore.runTransaction.bind(firestore);
  firestore.runTransaction = (operation, options) => original(async (transaction) => {
    const writes = [];
    const wrapped = { ...transaction };
    for (const type of ["set", "create", "update", "delete"]) {
      wrapped[type] = (reference, ...args) => {
        writes.push({ type, path: reference.path, data: args[0] });
        transaction[type](reference, ...args);
        return wrapped;
      };
    }
    const result = await operation(wrapped);
    onWrites(writes);
    return result;
  }, options);
}

test("recuperacao restaura metadados, contadores, containers e todas as secoes", async () => {
  const { firestore, persistence, previous, previousRoot, currentRoot } = await fixture();
  assertCheckpoint(firestore, previousRoot);
  await damage(firestore, currentRoot, "missing-manifest");

  assert.deepEqual(await persistence.get(CODE), { ...previous, revision: 13, version: 13 });
  assertRestoredRoot(firestore, previousRoot, currentRoot, "SAVE_INCOMPLETE");
  assert.deepEqual(await persistence.getMetadata(CODE), metadataRoomFromDocument({
    ...previousRoot, revision: 13, version: 13,
  }));
});

test("todas as leituras publicas recuperam manifestos, paginas ou raiz danificados", async (t) => {
  const cases = [
    ["get", "missing-manifest", (p) => p.get(CODE), (value, room) => assert.deepEqual(value.completedMatches, room.completedMatches)],
    ["getPaths", "corrupt-manifest", (p) => p.getPaths(CODE, ["completedMatches"]), (value, room) => assert.deepEqual(value.completedMatches, room.completedMatches)],
    ["getPartial", "missing-page", (p) => p.getPartial(CODE, { excludePaths: ["playerCatalog"] }), (value, room) => {
      assert.deepEqual(value.completedMatches, room.completedMatches);
      assert.equal(value.playerCatalog, undefined);
    }],
    ["getSection", "corrupt-page", (p) => p.getSection(CODE, "completedMatches"), (value, room) => assert.deepEqual(value, room.completedMatches)],
    ["getSection page", "missing-page", (p) => p.getSection(CODE, "completedMatches", { page: 0 }), (value, room) => {
      assert.ok(value.items.length > 0);
      assert.deepEqual(value.items, room.completedMatches.slice(0, value.items.length));
      assert.equal(value.page, 0);
      assert.equal(value.hasMore, true);
    }],
    ["getSectionTail", "corrupt-tail-page", (p) => p.getSectionTail(CODE, "completedMatches"), (value, room) => assert.deepEqual(value, room.completedMatches.at(-1))],
    ["getMetadata", "root", (p) => p.getMetadata(CODE), (value, room) => {
      assert.equal(value.name, room.name);
      assert.equal(value.currentSeason, room.currentSeason);
      assert.equal(value.revision, 13);
    }],
  ];
  for (const [name, kind, read, verify] of cases) {
    await t.test(name, async () => {
      const { firestore, persistence, previous, previousRoot, currentRoot } = await fixture({ paged: true });
      await damage(firestore, currentRoot, kind);
      verify(await read(persistence), previous);
      assertRestoredRoot(firestore, previousRoot, currentRoot,
        kind.startsWith("missing") ? "SAVE_INCOMPLETE" : "SAVE_DOCUMENT_CORRUPT");
      assert.deepEqual(await persistence.get(CODE), { ...previous, revision: 13, version: 13 });
    });
  }
});

test("geracao anterior deve ser validada por inteiro mesmo numa leitura de uma secao", async (t) => {
  for (const kind of ["missing-manifest", "corrupt-manifest", "missing-page", "corrupt-page"]) {
    await t.test(kind, async () => {
      const paged = kind.includes("page");
      const { firestore, persistence, previousRoot, currentRoot } = await fixture({ paged });
      const requestedPath = paged ? "marketState.transactions" : "completedMatches";
      await damage(firestore, currentRoot, "missing-manifest", requestedPath);
      await damage(firestore, previousRoot, kind, paged ? "completedMatches" : "playerCatalog");
      const checkpoint = firestore.read(CHECKPOINT);
      await assert.rejects(persistence.getSection(CODE, requestedPath), { code: "SAVE_RECOVERY_FAILED" });
      assert.deepEqual(firestore.read(ROOT), currentRoot);
      assert.deepEqual(firestore.read(CHECKPOINT), checkpoint);
      assert.equal(firestore.has(`${ROOT}/maintenance/recovery-last`), false);
    });
  }
});

test("recuperacao usa a maior revisao quando a raiz danificada regrediu", async () => {
  const { firestore, persistence, previous, previousRoot, currentRoot } = await fixture();
  const regressed = signedDocument({ ...currentRoot, revision: 3, version: 3 });
  const { checksum: _digest, ...checkpoint } = firestore.read(CHECKPOINT);
  const checkpointBase = { ...checkpoint, currentCommitId: regressed.saveCommitId };
  firestore.seed(ROOT, regressed);
  firestore.seed(CHECKPOINT, { ...checkpointBase, checksum: canonicalChecksum(checkpointBase) });
  await damage(firestore, regressed, "root");

  assert.deepEqual(await persistence.get(CODE), { ...previous, revision: 8, version: 8 });
  assertRestoredRoot(firestore, previousRoot, regressed, "SAVE_DOCUMENT_CORRUPT");
});

test("listagens revalidam managers depois de restaurar a geracao anterior", async (t) => {
  for (const method of ["listByManager", "listMetadataByManager"]) {
    await t.test(method, async () => {
      const { firestore, persistence, previousRoot, currentRoot, previous } = await fixture();
      await damage(firestore, currentRoot, "root");
      assert.deepEqual(await persistence[method]("owner-2"), [], "manager removido pelo rollback nao recebe a sala");
      assertRestoredRoot(firestore, previousRoot, currentRoot, "SAVE_DOCUMENT_CORRUPT");
      const restored = method === "listByManager"
        ? { ...previous, revision: 13, version: 13 }
        : metadataRoomFromDocument({ ...previousRoot, revision: 13, version: 13 });
      assert.deepEqual(await persistence[method]("owner-1"), [restored]);
    });
  }
});

test("checkpoint adulterado ou de outra geracao falha sem alterar a raiz", async (t) => {
  const changes = [
    ["checksum", (checkpoint) => ({ ...checkpoint, checksum: "0".repeat(64) })],
    ["commit atual", (checkpoint) => ({ ...checkpoint, currentCommitId: "outro-commit" })],
    ["metadados anteriores", (checkpoint) => ({ ...checkpoint, document: { ...checkpoint.document, currentSeason: 999 } })],
    ["identidade anterior", (checkpoint) => ({ ...checkpoint, document: signedDocument({ ...checkpoint.document, code: "OUTRA-SALA" }) })],
  ];
  for (const [name, change] of changes) {
    await t.test(name, async () => {
      const { firestore, persistence, currentRoot } = await fixture();
      await damage(firestore, currentRoot, "missing-manifest");
      const changed = change(firestore.read(CHECKPOINT));
      const { checksum: _digest, ...base } = changed;
      firestore.seed(CHECKPOINT, name === "checksum" ? changed : { ...base, checksum: canonicalChecksum(base) });
      await assert.rejects(persistence.get(CODE), { code: "SAVE_RECOVERY_FAILED" });
      assert.deepEqual(firestore.read(ROOT), currentRoot);
    });
  }
});

test("save e mutatePaths publicam checkpoint completo atomicamente com a nova raiz", async (t) => {
  for (const method of ["save", "mutatePaths"]) {
    await t.test(method, async () => {
      const { firestore, persistence, current, currentRoot } = await fixture();
      const commits = [];
      observeTransactions(firestore, (writes) => commits.push(writes));
      if (method === "save") await persistence.save({ ...current, revision: 13, name: "Terceira geracao" });
      else await persistence.mutatePaths(CODE, ["completedMatches"], (room) => ({
        ...room, revision: room.revision + 1, completedMatches: [...room.completedMatches, { id: "novo" }],
      }));
      assertCheckpoint(firestore, currentRoot);
      const publications = commits.filter((writes) => writes.some((write) => write.path === ROOT));
      assert.equal(publications.length, 1);
      assert.equal(publications[0].filter((write) => write.path === CHECKPOINT && write.type === "set").length, 1);
      await persistence.collectGarbage(CODE);
    });
  }
});

test("falha no commit de save ou mutatePaths preserva raiz e checkpoint juntos", async (t) => {
  for (const method of ["save", "mutatePaths"]) {
    await t.test(method, async () => {
      const { firestore, persistence, current, currentRoot } = await fixture();
      const checkpoint = firestore.read(CHECKPOINT);
      const injected = new Error("falha atomica na publicacao");
      let injectedOnce = false;
      observeTransactions(firestore, (writes) => {
        if (injectedOnce || !writes.some((write) => write.path === ROOT)) return;
        assert.ok(writes.some((write) => write.path === CHECKPOINT));
        injectedOnce = true;
        firestore.failOnWrite(writes.length, injected);
      });
      const operation = method === "save"
        ? persistence.save({ ...current, revision: 13, name: "Nao publicar" })
        : persistence.mutatePaths(CODE, ["completedMatches"], (room) => ({
          ...room, revision: 13, completedMatches: [...room.completedMatches, { id: "nao-publicar" }],
        }));
      await assert.rejects(operation, (error) => error === injected);
      assert.equal(injectedOnce, true);
      assert.deepEqual(firestore.read(ROOT), currentRoot);
      assert.deepEqual(firestore.read(CHECKPOINT), checkpoint);
      assert.deepEqual(await persistence.get(CODE), current);
    });
  }
});

test("commit interrompido durante recuperacao nao consome checkpoint nem publica meia raiz", async () => {
  const { firestore, persistence, previous, currentRoot } = await fixture();
  await damage(firestore, currentRoot, "missing-manifest");
  const checkpoint = firestore.read(CHECKPOINT);
  const injected = new Error("recuperacao interrompida no commit");
  let injectedOnce = false;
  observeTransactions(firestore, (writes) => {
    if (injectedOnce || !writes.some((write) => write.path === ROOT && write.data?.saveRecovery)) return;
    assert.ok(writes.some((write) => write.path === CHECKPOINT && write.type === "delete"));
    injectedOnce = true;
    firestore.failOnWrite(writes.length, injected);
  });
  await assert.rejects(persistence.get(CODE), (error) => error === injected);
  assert.equal(injectedOnce, true);
  assert.deepEqual(firestore.read(ROOT), currentRoot);
  assert.deepEqual(firestore.read(CHECKPOINT), checkpoint);
  assert.deepEqual(await new FirestoreRoomPersistence(firestore).get(CODE), { ...previous, revision: 13, version: 13 });
});

test("recuperacao sobrevive a reinicio, novas mutacoes e garbage collection", async () => {
  const { firestore, previous, currentRoot } = await fixture({ paged: true });
  await damage(firestore, currentRoot, "missing-page");
  const restarted = new FirestoreRoomPersistence(firestore);
  const recovered = await restarted.get(CODE);
  assert.deepEqual(recovered, { ...previous, revision: 13, version: 13 });
  await restarted.collectGarbage(CODE);
  assert.deepEqual(await new FirestoreRoomPersistence(firestore).get(CODE), recovered);
  const recoveredRoot = firestore.read(ROOT);

  await restarted.mutatePaths(CODE, ["marketState.transactions"], (room) => ({
    ...room,
    revision: room.revision + 1,
    marketState: { transactions: [...room.marketState.transactions, { id: "after-recovery", amount: 250 }] },
  }));
  assertCheckpoint(firestore, recoveredRoot);
  await restarted.collectGarbage(CODE);
  const expected = {
    ...recovered,
    revision: 14,
    marketState: { transactions: [...previous.marketState.transactions, { id: "after-recovery", amount: 250 }] },
  };
  assert.deepEqual(await new FirestoreRoomPersistence(firestore).get(CODE), expected);
  assert.equal(firestore.has(manifestPath(currentRoot, "completedMatches")), false);
});

test("sem checkpoint a leitura preserva o erro original e a raiz", async (t) => {
  for (const [kind, code] of [["missing-manifest", "SAVE_INCOMPLETE"], ["root", "SAVE_DOCUMENT_CORRUPT"]]) {
    await t.test(kind, async () => {
      const { firestore, persistence, currentRoot } = await fixture();
      await firestore.doc(CHECKPOINT).delete();
      await damage(firestore, currentRoot, kind);
      const damagedRoot = firestore.read(ROOT);
      await assert.rejects(persistence.get(CODE), { code });
      assert.deepEqual(firestore.read(ROOT), damagedRoot);
      assert.equal(firestore.has(CHECKPOINT), false);
    });
  }
});

test("checksum ausente numa pagina armazenada dispara recovery", async () => {
  const { firestore, persistence, currentRoot, previous } = await fixture({ paged: true });
  const [target] = await pagePaths(firestore, currentRoot, "completedMatches");
  const { checksum: _checksum, ...page } = firestore.read(target);
  firestore.seed(target, page);
  const recoveredPage = await persistence.getSection(CODE, "completedMatches", { page: 0 });
  assert.deepEqual(recoveredPage.items, previous.completedMatches.slice(0, recoveredPage.items.length));
  assert.deepEqual(await persistence.get(CODE), { ...previous, revision: 13, version: 13 });
});

test("mutacoes recuperam antes de executar o callback do jogo", async (t) => {
  for (const method of ["mutate", "mutatePaths"]) {
    await t.test(method, async () => {
      const { firestore, persistence, currentRoot, previous } = await fixture();
      await damage(firestore, currentRoot, "missing-manifest", "careerState.players");
      let calls = 0;
      const mutation = (room) => {
        calls += 1;
        assert.deepEqual(room.careerState.players, previous.careerState.players);
        assert.equal(room.currentSeason, previous.currentSeason);
        return { ...room, name: "Apos recovery", revision: room.revision + 1, version: room.version + 1 };
      };
      if (method === "mutate") await persistence.mutate(CODE, mutation);
      else await persistence.mutatePaths(CODE, ["careerState.players"], mutation);
      assert.equal(calls, 1);
      assert.deepEqual(await persistence.get(CODE), { ...previous, name: "Apos recovery", revision: 14, version: 14 });
    });
  }
});

test("falhas de rede, permissao e schema futuro nunca disparam fallback", async (t) => {
  for (const code of ["unavailable", "permission-denied"]) {
    await t.test(code, async () => {
      const { firestore, persistence, currentRoot } = await fixture({ paged: true });
      const checkpoint = firestore.read(CHECKPOINT);
      const injected = Object.assign(new Error(`Firestore ${code}`), { code });
      firestore.getAll = async () => { throw injected; };
      firestore.resetMetrics();
      await assert.rejects(persistence.get(CODE), (error) => error === injected);
      assert.deepEqual(firestore.read(ROOT), currentRoot);
      assert.deepEqual(firestore.read(CHECKPOINT), checkpoint);
      assert.equal(firestore.metrics.transactions, 0);
      assert.equal(firestore.metrics.writes, 0);
      assert.equal(firestore.metrics.readPaths.includes(CHECKPOINT), false);
    });
  }
  await t.test("schema futuro", async () => {
    const { firestore, persistence, currentRoot } = await fixture();
    const future = signedDocument({ ...currentRoot, saveSchemaVersion: 999 });
    firestore.seed(ROOT, future);
    firestore.resetMetrics();
    await assert.rejects(persistence.get(CODE), { code: "SAVE_SCHEMA_VERSION_UNSUPPORTED" });
    assert.deepEqual(firestore.read(ROOT), future);
    assert.equal(firestore.metrics.transactions, 0);
    assert.equal(firestore.metrics.writes, 0);
    assert.equal(firestore.metrics.readPaths.includes(CHECKPOINT), false);
  });
});
