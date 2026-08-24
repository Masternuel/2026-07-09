import assert from "node:assert/strict";
import test from "node:test";
import { careerDateFor } from "../game/clubCareerSystem.mjs";
import { buildCoachCareerSnapshot } from "../services/coachCareerSnapshot.mjs";
import {
  FirestoreRoomPersistence,
  MemoryRoomPersistence,
} from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const NOW = new Date("2026-07-21T12:00:00.000Z");
const OWNER_ID = "manager-lazy";
const CODE = "COACH-LZ";

const catalogStore = {
  async listCompetitionCatalog() {
    return [{
      id: "BR-A",
      name: "Brasileirao Serie A",
      country: "Brasil",
      division: "Serie A",
      clubs: [
        { id: "SAN", code: "SAN", name: "Santos", reputation: 76, leagueId: "BR-A" },
        { id: "AUR", code: "AUR", name: "Aurora FC", reputation: 72, leagueId: "BR-A" },
      ],
    }];
  },
};

function storeFor(persistence) {
  return new RoomStore({
    persistence,
    catalogStore,
    codeFactory: () => CODE,
    now: () => new Date(NOW),
  });
}

function largeUnrelatedList(prefix, count = 1_200) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    fixtureId: `${prefix}-fixture-${index}`,
    playerId: `${prefix}-player-${index}`,
    note: `${prefix} ${index} ${"x".repeat(320)}`,
  }));
}

function physicalPagePathsFor(firestore, code, descriptor) {
  const manifestPath = `rooms/${code}/${descriptor.domain}/${descriptor.documentId}`;
  const manifest = firestore.read(manifestPath);
  const paths = new Set([manifestPath]);
  if (!manifest || !manifest.pageIndexRootId) return paths;

  const domainStorage = Boolean(manifest.pageStorageFormat);
  const indexPath = (id) => domainStorage
    ? `rooms/${code}/${descriptor.domain}/page-index--${id}`
    : `rooms/${code}/sectionPageIndexes/${id}`;
  const pagePath = (id) => domainStorage
    ? `rooms/${code}/${descriptor.domain}/page--${id}`
    : `rooms/${code}/sectionPages/${id}`;
  const visit = (id) => {
    const path = indexPath(id);
    paths.add(path);
    const node = firestore.read(path);
    if (node?.kind === "leaf") {
      for (const pageId of node.pageIds ?? []) paths.add(pagePath(pageId));
      return;
    }
    for (const child of node?.children ?? []) visit(child.id);
  };
  visit(manifest.pageIndexRootId);
  return paths;
}

test("snapshot da carreira ignora paginas de historicos e jogadores nao relacionados", async () => {
  const memory = new MemoryRoomPersistence();
  const setupStore = storeFor(memory);
  const created = await setupStore.createRoom({
    name: "Carreira lazy",
    creatorId: OWNER_ID,
    creatorName: "Emanuel",
    clubId: "SAN",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    maxManagers: 1,
  });
  await setupStore.setReady(created.code, OWNER_ID, true);
  await setupStore.startRoom(created.code, OWNER_ID);

  const fullRoom = await memory.get(created.code);
  fullRoom.completedMatches = largeUnrelatedList("completed");
  fullRoom.completedFixtureIds = largeUnrelatedList("fixtures").map(({ id }) => id);
  fullRoom.careerState.players = largeUnrelatedList("players");
  fullRoom.marketState.transactions = largeUnrelatedList("transactions");
  const baseline = buildCoachCareerSnapshot(fullRoom, OWNER_ID, {
    now: careerDateFor(fullRoom, NOW),
  });

  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  assert.equal(await persistence.create(fullRoom), true);
  const root = firestore.read(`rooms/${CODE}`);
  const heavyPaths = new Set();
  for (const sectionPath of [
    "completedMatches",
    "completedFixtureIds",
    "careerState.players",
    "marketState.transactions",
  ]) {
    const descriptor = root.roomSections.find(({ path }) => path === sectionPath);
    assert.ok(descriptor, `secao ${sectionPath} deve existir no save`);
    for (const path of physicalPagePathsFor(firestore, CODE, descriptor)) heavyPaths.add(path);
  }

  firestore.resetMetrics();
  const snapshot = await storeFor(persistence).getCoachCareerSnapshot(CODE, OWNER_ID);

  assert.deepEqual(snapshot, baseline);
  assert.equal(
    firestore.metrics.readPaths.some((path) => heavyPaths.has(path)),
    false,
    "manifestos, indices e paginas sem relacao com a carreira nao devem ser lidos",
  );
});

test("snapshot da carreira preserva carregamento completo para adapter legado", async () => {
  const memory = new MemoryRoomPersistence();
  const setupStore = storeFor(memory);
  const created = await setupStore.createRoom({
    name: "Carreira legada",
    creatorId: OWNER_ID,
    creatorName: "Emanuel",
    clubId: "SAN",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    maxManagers: 1,
  });
  await setupStore.setReady(created.code, OWNER_ID, true);
  await setupStore.startRoom(created.code, OWNER_ID);
  const fullRoom = await memory.get(created.code);
  const baseline = buildCoachCareerSnapshot(fullRoom, OWNER_ID, {
    now: careerDateFor(fullRoom, NOW),
  });
  let partialReads = 0;
  let fullReads = 0;
  const legacyAdapter = {
    async getPaths() {
      partialReads += 1;
      return {
        code: CODE,
        status: "active",
        managerIds: [OWNER_ID],
        managers: [{ id: OWNER_ID, clubId: "SAN" }],
      };
    },
    async get() {
      fullReads += 1;
      return structuredClone(fullRoom);
    },
    async mutate(_code, mutation) {
      const current = structuredClone(fullRoom);
      return mutation(current) ?? current;
    },
  };

  const snapshot = await storeFor(legacyAdapter).getCoachCareerSnapshot(CODE, OWNER_ID);

  assert.deepEqual(snapshot, baseline);
  assert.equal(partialReads, 1);
  assert.equal(fullReads, 1);
});
