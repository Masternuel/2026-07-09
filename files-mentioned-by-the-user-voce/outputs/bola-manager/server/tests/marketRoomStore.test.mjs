import assert from "node:assert/strict";
import test from "node:test";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const OWNER_ID = "uid-owner";
const MEMBER_ID = "uid-second";
const NOW = new Date("2026-07-18T12:00:00.000Z");

function baseCatalog() {
  const leagues = [{
    id: "BR-A",
    name: "Liga de teste",
    country: "Brasil",
    division: "Serie A",
    clubs: [
      {
        id: "AUR",
        name: "Aurora",
        code: "AUR",
        color: "#c8ff3d",
        reputation: 15,
        budget: 60_000_000,
        crestImageUrl: null,
        leagueId: "BR-A",
      },
      {
        id: "SAN",
        name: "Santos",
        code: "SAN",
        color: "#ffffff",
        reputation: 14,
        budget: 40_000_000,
        crestImageUrl: null,
        leagueId: "BR-A",
      },
    ],
  }];
  const players = [
    {
      id: "aur-1",
      clubId: "AUR",
      name: "Atacante Aurora",
      position: "ATA",
      age: 24,
      overall: 15,
      marketValue: 14_000_000,
      active: true,
    },
    {
      id: "san-1",
      clubId: "SAN",
      name: "Meia Santos",
      position: "MEI",
      age: 23,
      overall: 14,
      marketValue: 12_000_000,
      active: true,
    },
    {
      id: "san-2",
      clubId: "SAN",
      name: "Zagueiro Santos",
      position: "ZAG",
      age: 27,
      overall: 13,
      marketValue: 9_000_000,
      active: true,
    },
    {
      id: "esp-1",
      clubId: "RMA",
      name: "Jogador fora da sala",
      position: "ATA",
      age: 25,
      overall: 18,
      marketValue: 50_000_000,
      active: true,
    },
  ];
  return {
    leagues,
    players,
    async listCompetitionCatalog() {
      return structuredClone(leagues);
    },
    async listPlayers(clubId) {
      const roster = players.filter((player) => player.clubId === clubId);
      return {
        players: structuredClone(roster),
        count: roster.length,
        source: "creator-catalog",
      };
    },
    async get(entity, id) {
      if (entity !== "players") throw new Error("Entidade inesperada");
      const player = players.find((candidate) => candidate.id === id);
      if (!player) {
        const error = new Error("Jogador nao encontrado");
        error.code = "EDITOR_RECORD_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      return structuredClone(player);
    },
  };
}

function storeHarness() {
  const persistence = new MemoryRoomPersistence();
  const creatorCatalog = baseCatalog();
  const scopeCalls = [];
  let currentNow = NOW;
  const catalogStore = {
    forOwner(ownerId) {
      scopeCalls.push(ownerId);
      if (ownerId === OWNER_ID) return creatorCatalog;
      return {
        async listCompetitionCatalog() { return []; },
        async listPlayers() { return { players: [], count: 0, source: "foreign-catalog" }; },
      };
    },
  };
  const codes = ["BOLA-MR01", "BOLA-MR02"];
  let nextCode = 0;
  const options = {
    persistence,
    catalogStore,
    codeFactory: () => codes[nextCode++] ?? "BOLA-MR99",
    now: () => currentNow,
  };
  return {
    persistence,
    creatorCatalog,
    catalogStore,
    scopeCalls,
    store: new RoomStore(options),
    reload: () => new RoomStore({ ...options, codeFactory: () => "BOLA-RLD1" }),
    setNow: (value) => { currentNow = new Date(value); },
  };
}

async function activeRoom(store) {
  const created = await store.createRoom({
    name: "Mercado persistente",
    creatorId: OWNER_ID,
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 2,
  });
  await store.joinRoom(created.code, {
    managerId: MEMBER_ID,
    managerName: "Segundo",
    clubId: "SAN",
  });
  await store.setReady(created.code, OWNER_ID, true);
  await store.setReady(created.code, MEMBER_ID, true);
  return store.startRoom(created.code, OWNER_ID);
}

test("RoomStore persiste transferencia no save e preserva a base pessoal do criador", async () => {
  const harness = storeHarness();
  const room = await activeRoom(harness.store);

  const ownerInitial = await harness.store.getMarketSnapshot(room.code, OWNER_ID);
  const memberInitial = await harness.store.getMarketSnapshot(room.code, MEMBER_ID);
  assert.equal(ownerInitial.finance.balance, 60_000_000);
  assert.equal(memberInitial.finance.balance, 40_000_000);
  assert.deepEqual(
    ownerInitial.candidates.map((player) => player.id).sort(),
    ["san-1", "san-2"],
  );
  assert.deepEqual(memberInitial.candidates.map((player) => player.id), ["aur-1"]);

  await assert.rejects(
    harness.store.createMarketOffer(room.code, OWNER_ID, {
      requestId: "room-store-out-of-scope-1",
      playerId: "esp-1",
      dealType: "transfer",
      amount: 50_000_000,
    }),
    (error) => ["MARKET_PLAYER_NOT_FOUND", "MARKET_PLAYER_OUT_OF_SCOPE"].includes(error.code),
  );

  const offered = await harness.store.createMarketOffer(room.code, OWNER_ID, {
    requestId: "room-store-offer-1",
    playerId: "san-1",
    dealType: "transfer",
    amount: 12_000_000,
    message: "Proposta integral",
  });
  assert.equal(offered.offer.status, "pending");
  assert.equal(offered.offer.direction, "outgoing");
  assert.equal(offered.snapshot.finance.committed, 12_000_000);

  const memberWithOffer = await harness.store.getMarketSnapshot(room.code, MEMBER_ID);
  assert.equal(memberWithOffer.offers.length, 1);
  assert.equal(memberWithOffer.offers[0].id, offered.offer.id);
  assert.equal(memberWithOffer.offers[0].direction, "incoming");
  assert.equal(memberWithOffer.offers[0].permissions.accept, true);

  const accepted = await harness.store.respondMarketOffer(room.code, MEMBER_ID, {
    requestId: "room-store-accept-1",
    offerId: offered.offer.id,
    action: "accept",
  });
  assert.equal(accepted.offer.status, "accepted");
  assert.equal(accepted.transaction.player.id, "san-1");
  assert.equal(accepted.transaction.fromClubId, "SAN");
  assert.equal(accepted.transaction.toClubId, "AUR");

  const savedRoom = await harness.store.requireRoom(room.code);
  const [auroraRoster, santosRoster, baseSantosRoster] = await Promise.all([
    listRoomPlayers(harness.creatorCatalog, savedRoom, "AUR"),
    listRoomPlayers(harness.creatorCatalog, savedRoom, "SAN"),
    harness.creatorCatalog.listPlayers("SAN"),
  ]);
  assert.deepEqual(auroraRoster.players.filter((player) => !player.academy).map((player) => player.id).sort(), ["aur-1", "san-1"]);
  assert.equal(auroraRoster.players.find((player) => player.id === "san-1").clubId, "AUR");
  assert.deepEqual(santosRoster.players.filter((player) => !player.academy).map((player) => player.id), ["san-2"]);
  assert.deepEqual(baseSantosRoster.players.map((player) => player.id), ["san-1", "san-2"]);
  assert.equal(baseSantosRoster.players[0].clubId, "SAN");

  const reloadedStore = harness.reload();
  const reloadedRoom = await reloadedStore.requireRoom(room.code);
  const reloadedSnapshot = await reloadedStore.getMarketSnapshot(room.code, OWNER_ID);
  const reloadedAurora = await listRoomPlayers(harness.creatorCatalog, reloadedRoom, "AUR");
  assert.equal(reloadedSnapshot.transactions.length, 1);
  assert.equal(reloadedSnapshot.transactions[0].player.id, "san-1");
  assert.equal(reloadedSnapshot.finance.balance, 48_000_000);
  assert.deepEqual(reloadedAurora.players.filter((player) => !player.academy).map((player) => player.id).sort(), ["aur-1", "san-1"]);
  assert.equal(
    (await reloadedStore.getMarketSnapshot(room.code, MEMBER_ID)).finance.balance,
    52_000_000,
  );

  await assert.rejects(
    reloadedStore.getMarketSnapshot(room.code, "uid-intruder"),
    (error) => error.code === "ROOM_NOT_FOUND" && error.status === 404,
  );

  const waiting = await harness.store.createRoom({
    name: "Novo save sem transferencia",
    creatorId: OWNER_ID,
    creatorName: "Owner",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
  });
  const waitingRoom = await harness.store.requireRoom(waiting.code);
  assert.deepEqual(
    (await listRoomPlayers(harness.creatorCatalog, waitingRoom, "SAN")).players.map((player) => player.id),
    ["san-1", "san-2"],
  );
  await assert.rejects(
    harness.store.getMarketSnapshot(waiting.code, OWNER_ID),
    (error) => error.code === "MARKET_ROOM_NOT_ACTIVE" && error.status === 409,
  );

  assert.equal(harness.scopeCalls.length > 0, true);
  assert.equal(harness.scopeCalls.every((ownerId) => ownerId === OWNER_ID), true);
});

test("snapshot sinaliza settlement expirado somente na primeira sincronizacao", async () => {
  const harness = storeHarness();
  const room = await activeRoom(harness.store);
  const listed = await harness.store.createMarketListing(room.code, OWNER_ID, {
    requestId: "room-store-list-expiry",
    playerId: "aur-1",
    mode: "direct",
    dealType: "transfer",
    askingPrice: 14_000_000,
    expiresInHours: 1,
  });
  const offered = await harness.store.createMarketOffer(room.code, OWNER_ID, {
    requestId: "room-store-offer-expiry",
    playerId: "san-1",
    dealType: "transfer",
    amount: 10_000_000,
  });
  assert.equal(listed.listing.status, "open");
  assert.equal(offered.offer.status, "pending");
  assert.equal(offered.snapshot.finance.committed, 10_000_000);

  harness.setNow("2026-07-20T13:00:00.000Z");
  const first = await harness.store.getMarketSnapshot(room.code, MEMBER_ID, { withMetadata: true });
  assert.equal(first.settlementChanged, true);
  assert.equal(first.snapshot.listings.find((item) => item.id === listed.listing.id).status, "expired");
  assert.equal(first.snapshot.offers.find((item) => item.id === offered.offer.id).status, "expired");

  const second = await harness.store.getMarketSnapshot(room.code, OWNER_ID, { withMetadata: true });
  assert.equal(second.settlementChanged, false);
  assert.equal(second.snapshot.finance.committed, 0);
  assert.equal(second.snapshot.offers.find((item) => item.id === offered.offer.id).status, "expired");

  const defaultSnapshot = await harness.store.getMarketSnapshot(room.code, OWNER_ID);
  assert.equal(Array.isArray(defaultSnapshot.listings), true);
  assert.equal(Object.hasOwn(defaultSnapshot, "snapshot"), false);
  assert.equal(Object.hasOwn(defaultSnapshot, "settlementChanged"), false);
});

test("mercado exige aprovacao explicita durante aviso persistido", async () => {
  const harness = storeHarness();
  const room = await activeRoom(harness.store);
  await harness.store.manageProfessionalLifecycle(room.code, OWNER_ID, {
    requestId: "market-notice-start-1",
    action: "notice_start",
    professionalType: "coach",
    effectiveAt: "2026-08-18T12:00:00.000Z",
    reason: "planned_transition",
  });

  await assert.rejects(
    harness.store.createMarketOffer(room.code, OWNER_ID, {
      requestId: "market-notice-offer-blocked",
      playerId: "san-1",
      dealType: "transfer",
      amount: 12_000_000,
    }),
    { code: "PROFESSIONAL_NOTICE_BOARD_APPROVAL_REQUIRED", status: 409 },
  );

  const approved = await harness.reload().createMarketOffer(room.code, OWNER_ID, {
    requestId: "market-notice-offer-approved",
    playerId: "san-1",
    dealType: "transfer",
    amount: 12_000_000,
    noticeApproval: true,
  });
  assert.equal(approved.offer.status, "pending");
});
