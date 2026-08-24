import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { FirestoreRoomPersistence } from "../store/roomPersistence.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

const LEGACY_CHUNK_CHARACTERS = 600_000;

function baseRoom(overrides = {}) {
  return {
    id: "room-stress",
    code: "BOLA-STRESS",
    name: "Carreira de stress",
    ownerId: "uid-owner",
    catalogOwnerId: "uid-owner",
    status: "active",
    activeLeagues: ["L-1"],
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
    managers: [{ id: "uid-owner", name: "Owner", clubId: "C-000", ready: true }],
    competitionCatalog: [{ id: "L-1", name: "Liga 1", clubs: [{ id: "C-000", name: "Clube 0" }] }],
    tournamentCatalog: [],
    careerState: { players: [] },
    marketState: { transactions: [] },
    ...overrides,
  };
}

function opaqueText(prefix, index, characters = 480) {
  let value = "";
  for (let part = 0; value.length < characters; part += 1) {
    value += createHash("sha256")
      .update(`${prefix}:${index}:${part}`)
      .digest("base64url");
  }
  return value.slice(0, characters);
}

function legacyChunkedBundle(room) {
  const serialized = JSON.stringify(room);
  const payload = gzipSync(Buffer.from(serialized, "utf8")).toString("base64");
  const generation = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  const chunkCount = Math.ceil(payload.length / LEGACY_CHUNK_CHARACTERS);
  const chunks = Array.from({ length: chunkCount }, (_, index) => ({
    id: `${room.code}--${generation}--${String(index).padStart(3, "0")}`,
    data: {
      roomCode: room.code,
      generation,
      index,
      roomStorageChunkPayload: payload.slice(
        index * LEGACY_CHUNK_CHARACTERS,
        (index + 1) * LEGACY_CHUNK_CHARACTERS,
      ),
    },
  }));
  return {
    payloadLength: payload.length,
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

function seedLegacy(firestore, room, bundle = legacyChunkedBundle(room)) {
  firestore.seed(`rooms/${room.code}`, bundle.document);
  for (const chunk of bundle.chunks) {
    firestore.seed(`roomPayloads/${chunk.id}`, chunk.data);
  }
  return bundle;
}

function largeLegacyRoom() {
  const completedMatches = Array.from({ length: 10_000 }, (_, index) => ({
    fixtureId: `M-${String(index).padStart(5, "0")}`,
    season: 1 + Math.floor(index / 380),
    homeClubId: `C-${index % 20}`,
    awayClubId: `C-${(index + 1) % 20}`,
    score: [index % 4, (index + 1) % 3],
    report: opaqueText("match", index),
  }));
  const transactions = Array.from({ length: 5_000 }, (_, index) => ({
    id: `T-${String(index).padStart(5, "0")}`,
    playerId: `P-${index}`,
    fromClubId: `C-${index % 20}`,
    toClubId: `C-${(index + 3) % 20}`,
    value: 1_000_000 + index,
    audit: opaqueText("transfer", index),
  }));
  return baseRoom({
    code: "BOLA-LEGACY-BIG",
    currentSeason: 27,
    completedFixtureIds: completedMatches.map(({ fixtureId }) => fixtureId),
    completedMatches,
    seasonHistory: Array.from({ length: 26 }, (_, index) => ({
      season: index + 1,
      championId: `C-${index % 20}`,
    })),
    marketState: { transactions },
  });
}

function mediumRoom() {
  const playerCatalog = Array.from({ length: 600 }, (_, index) => ({
    id: `MED-P-${index}`,
    clubId: `C-${index % 20}`,
    name: `Jogador medio ${index}`,
    position: ["GOL", "ZAG", "MEI", "ATA"][index % 4],
    overall: 5 + (index % 16),
  }));
  const completedMatches = Array.from({ length: 800 }, (_, index) => ({
    fixtureId: `MED-M-${index}`,
    season: 1 + Math.floor(index / 38),
    homeClubId: `C-${index % 20}`,
    awayClubId: `C-${(index + 1) % 20}`,
    score: [index % 4, (index + 2) % 3],
  }));
  const transactions = Array.from({ length: 200 }, (_, index) => ({
    id: `MED-T-${index}`,
    playerId: playerCatalog[index].id,
    fromClubId: `C-${index % 20}`,
    toClubId: `C-${(index + 5) % 20}`,
    value: 100_000 + index * 1_000,
  }));
  return baseRoom({
    code: "BOLA-MEDIUM",
    currentSeason: 22,
    playerCatalog,
    completedFixtureIds: completedMatches.map(({ fixtureId }) => fixtureId),
    completedMatches,
    seasonHistory: Array.from({ length: 21 }, (_, index) => ({
      season: index + 1,
      championId: `C-${index % 20}`,
    })),
    marketState: { transactions },
  });
}

function realisticLargeRoom() {
  const leagueCount = 6;
  const clubsPerLeague = 20;
  const playersPerClub = 24;
  const clubs = Array.from({ length: leagueCount * clubsPerLeague }, (_, index) => ({
    id: `C-${String(index).padStart(3, "0")}`,
    name: `Clube ${index}`,
    country: `Pais ${index % leagueCount}`,
    division: 1 + Math.floor(index / clubsPerLeague),
    reputation: 40 + (index % 60),
    stadiumId: `S-${String(index).padStart(3, "0")}`,
    primaryColor: `#${(0x100000 + index * 7919).toString(16).slice(-6)}`,
  }));
  const competitionCatalog = Array.from({ length: leagueCount }, (_, league) => ({
    id: `L-${league + 1}`,
    name: `Liga ${league + 1}`,
    country: `Pais ${league}`,
    clubs: clubs.slice(league * clubsPerLeague, (league + 1) * clubsPerLeague),
  }));
  const playerCatalog = clubs.flatMap((club, clubIndex) => (
    Array.from({ length: playersPerClub }, (_, playerIndex) => ({
      id: `${club.id}-P-${String(playerIndex).padStart(2, "0")}`,
      clubId: club.id,
      name: `Jogador ${clubIndex}-${playerIndex}`,
      position: ["GOL", "ZAG", "VOL", "MEI", "ATA"][playerIndex % 5],
      age: 18 + ((clubIndex + playerIndex) % 19),
      overall: 8 + ((clubIndex + playerIndex) % 13),
      potential: 10 + ((clubIndex + playerIndex) % 11),
      profile: `Perfil real ${clubIndex}-${playerIndex} ${"p".repeat(180)}`,
    }))
  ));
  const coachCatalog = Array.from({ length: 360 }, (_, index) => ({
    id: `COACH-${index}`,
    name: `Treinador ${index}`,
    nationality: `Pais ${index % leagueCount}`,
    reputation: 30 + (index % 70),
    preferredFormation: ["4-3-3", "4-4-2", "3-5-2"][index % 3],
    biography: `Carreira do treinador ${index} ${"c".repeat(220)}`,
  }));
  const stadiumCatalog = clubs.map((club, index) => ({
    id: club.stadiumId,
    clubId: club.id,
    name: `Estadio ${index}`,
    capacity: 12_000 + index * 300,
    city: `Cidade ${index}`,
  }));
  const seasonHistory = Array.from({ length: 500 }, (_, index) => ({
    season: index + 1,
    championId: clubs[index % clubs.length].id,
    summary: `Resumo completo da temporada ${index + 1} ${"s".repeat(700)}`,
  }));
  const completedMatches = Array.from({ length: 4_000 }, (_, index) => ({
    fixtureId: `F-${String(index).padStart(5, "0")}`,
    season: 1 + Math.floor(index / 8),
    homeClubId: clubs[index % clubs.length].id,
    awayClubId: clubs[(index + 1) % clubs.length].id,
    score: [index % 4, (index + 2) % 4],
    commentary: `Relatorio da partida ${index} ${"m".repeat(180)}`,
  }));
  const transactions = Array.from({ length: 1_500 }, (_, index) => ({
    id: `TX-${index}`,
    playerId: playerCatalog[index % playerCatalog.length].id,
    fromClubId: clubs[index % clubs.length].id,
    toClubId: clubs[(index + 7) % clubs.length].id,
    value: 500_000 + index * 10_000,
    note: `Transferencia auditada ${index} ${"t".repeat(180)}`,
  }));
  return baseRoom({
    code: "BOLA-REAL-BIG",
    activeLeagues: competitionCatalog.map(({ id }) => id),
    currentSeason: seasonHistory.length + 1,
    competitionCatalog,
    playerCatalog,
    coachCatalog,
    stadiumCatalog,
    seasonHistory,
    completedFixtureIds: completedMatches.map(({ fixtureId }) => fixtureId),
    completedMatches,
    careerState: {
      players: playerCatalog.slice(0, 200).map((player) => ({
        ...player,
        condition: 85 + (Number(player.age) % 16),
      })),
    },
    marketState: { transactions },
  });
}

function manifestPath(code, descriptor) {
  return `rooms/${code}/${descriptor.domain}/${descriptor.documentId}`;
}

function contentPageReads(firestore, code) {
  return firestore.metrics.readPaths.filter((path) => (
    path.startsWith(`rooms/${code}/catalog/page--`)
    || path.startsWith(`rooms/${code}/career/page--`)
  ));
}

test("save medio com centenas de jogadores e partidas faz roundtrip exato", async () => {
  const room = mediumRoom();
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);

  assert.equal(await persistence.create(room), true);
  assert.deepEqual(await persistence.get(room.code), room);
});

test("migra legado realmente maior que sete chunks sem perder partidas ou transferencias", {
  timeout: 60_000,
}, async () => {
  const room = largeLegacyRoom();
  const firestore = createFakeFirestore();
  const bundle = seedLegacy(firestore, room);
  assert.ok(bundle.chunks.length > 7, `fixture precisa exceder sete chunks; recebeu ${bundle.chunks.length}`);
  assert.ok(bundle.payloadLength > 7 * LEGACY_CHUNK_CHARACTERS);

  const persistence = new FirestoreRoomPersistence(firestore);
  const migrated = await persistence.get(room.code);

  assert.deepEqual(migrated, room);
  assert.equal(migrated.completedMatches.length, 10_000);
  assert.equal(migrated.marketState.transactions.length, 5_000);
  const root = firestore.read(`rooms/${room.code}`);
  assert.equal(root.saveSchemaVersion, 2);
  assert.equal(root.completedMatchCount, 10_000);
  assert.equal(root.seasonHistoryCount, room.seasonHistory.length);
  assert.ok(root.saveMigration?.backupPath);
  assert.equal(
    firestore.read(`rooms/${room.code}/${root.saveMigration.backupPath}`)?.validated,
    true,
  );
  assert.equal(
    firestore.paths().filter((path) => path.startsWith(`roomPayloads/${room.code}--`)).length,
    bundle.chunks.length,
    "origem legada deve permanecer ate a migracao validada",
  );
});

test("retry apos reinicio nao depende de memoria da instancia anterior", async (t) => {
  await t.test("migracao interrompida", async () => {
    const room = baseRoom({
      code: "BOLA-RESTART-MIG",
      completedMatches: Array.from({ length: 600 }, (_, index) => ({
        id: `M-${index}`,
        report: `Relatorio ${index} ${"x".repeat(500)}`,
      })),
    });
    const firestore = createFakeFirestore();
    seedLegacy(firestore, room);
    const firstProcess = new FirestoreRoomPersistence(firestore);
    // Falha depois da aquisicao do lease, durante a primeira renovacao/staging.
    firestore.failOnGlobalWrite(5, new Error("processo caiu durante migracao"));
    await assert.rejects(firstProcess.get(room.code), /processo caiu durante migracao/);
    assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, undefined);

    const restartedProcess = new FirestoreRoomPersistence(firestore);
    assert.deepEqual(await restartedProcess.get(room.code), room);
    assert.equal(firestore.read(`rooms/${room.code}`).saveSchemaVersion, 2);
  });

  await t.test("cleanup de exclusao interrompido", async () => {
    const room = baseRoom({ code: "BOLA-RESTART-DEL" });
    const firestore = createFakeFirestore();
    seedLegacy(firestore, room);
    const firstProcess = new FirestoreRoomPersistence(firestore);
    firestore.failOnGlobalWrite(2, new Error("processo caiu durante exclusao"));
    await assert.rejects(
      firstProcess.remove(room.code, () => {}),
      /processo caiu durante exclusao/,
    );
    assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, true);

    const restartedProcess = new FirestoreRoomPersistence(firestore);
    let authorizedOwner = null;
    await restartedProcess.remove(room.code, (current) => {
      authorizedOwner = current.ownerId;
    });
    assert.equal(authorizedOwner, room.ownerId);
    assert.equal(firestore.read(`rooms/${room.code}`).storageCleanupPending, false);
    assert.equal(
      firestore.paths().some((path) => path.startsWith(`roomPayloads/${room.code}--`)),
      false,
    );
  });
});

test("catalogo real grande e carreira longa coexistem com roundtrip e leitura lazy", {
  timeout: 60_000,
}, async () => {
  const room = realisticLargeRoom();
  const firestore = createFakeFirestore();
  const persistence = new FirestoreRoomPersistence(firestore);
  assert.equal(await persistence.create(room), true);

  const root = firestore.read(`rooms/${room.code}`);
  const descriptorFor = (path) => root.roomSections.find((descriptor) => descriptor.path === path);
  const playerDescriptor = descriptorFor("playerCatalog");
  const matchDescriptor = descriptorFor("completedMatches");
  const transferDescriptor = descriptorFor("marketState.transactions");
  const seasonDescriptor = descriptorFor("seasonHistory");
  assert.equal(playerDescriptor.domain, "catalog");
  assert.equal(matchDescriptor.domain, "career");
  assert.equal(transferDescriptor.domain, "career");
  assert.equal(seasonDescriptor.domain, "career");
  for (const descriptor of [playerDescriptor, matchDescriptor, transferDescriptor, seasonDescriptor]) {
    assert.ok(descriptor.pageCount > 1, `${descriptor.path} deve estar paginada`);
  }

  const loaded = await persistence.get(room.code);
  assert.equal(loaded.playerCatalog.length, room.playerCatalog.length);
  assert.equal(loaded.completedMatches.length, room.completedMatches.length);
  assert.equal(loaded.marketState.transactions.length, room.marketState.transactions.length);
  assert.equal(loaded.seasonHistory.length, 500);
  assert.deepEqual(loaded.seasonHistory[0], room.seasonHistory[0]);
  assert.deepEqual(loaded.seasonHistory.at(-1), room.seasonHistory.at(-1));

  const excludedPaths = [
    "playerCatalog",
    "coachCatalog",
    "stadiumCatalog",
    "careerState",
    "marketState.transactions",
    "completedMatches",
    "seasonHistory",
  ];
  const excludedManifests = new Set(root.roomSections
    .filter((descriptor) => excludedPaths.some((path) => (
      descriptor.path === path || descriptor.path.startsWith(`${path}.`)
    )))
    .map((descriptor) => manifestPath(room.code, descriptor)));
  firestore.resetMetrics();
  const partial = await persistence.getPartial(room.code, { excludePaths: excludedPaths });
  assert.equal(partial.completedMatchCount, room.completedMatches.length);
  assert.equal(partial.seasonHistoryCount, room.seasonHistory.length);
  for (const path of excludedPaths) {
    if (!path.includes(".")) {
      assert.equal(path in partial, false, `${path} nao deve ser hidratado`);
      continue;
    }
    const [rootPath, childPath] = path.split(".");
    assert.equal(partial[rootPath]?.[childPath], undefined, `${path} nao deve ser hidratado`);
  }
  assert.equal(
    firestore.metrics.readPaths.some((path) => excludedManifests.has(path)),
    false,
  );
  assert.deepEqual(contentPageReads(firestore, room.code), []);

  firestore.resetMetrics();
  const firstPage = await persistence.getSection(room.code, "seasonHistory", { page: 0 });
  assert.deepEqual(firstPage.items[0], room.seasonHistory[0]);
  assert.equal(contentPageReads(firestore, room.code).length, 1);
  firestore.resetMetrics();
  const lastPage = await persistence.getSection(room.code, "seasonHistory", {
    page: firstPage.pageCount - 1,
  });
  assert.deepEqual(lastPage.items.at(-1), room.seasonHistory.at(-1));
  assert.equal(contentPageReads(firestore, room.code).length, 1);
});
