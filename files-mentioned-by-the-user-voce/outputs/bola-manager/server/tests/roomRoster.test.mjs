import assert from "node:assert/strict";
import test from "node:test";
import {
  careerPlayerFor,
  currentPlayerClubId,
  listRoomPlayers,
  registrationForPlayer,
} from "../game/roomRoster.mjs";

function player(id, clubId, overall, extra = {}) {
  return { id, clubId, name: id, overall, active: true, ...extra };
}

function catalog(playersByClub, { source = "firestore", onGet } = {}) {
  return {
    async listPlayers(clubId) {
      const players = playersByClub[clubId] ?? [];
      return { players, count: players.length, source };
    },
    async get(entity, playerId) {
      assert.equal(entity, "players");
      onGet?.(playerId);
      for (const players of Object.values(playersByClub)) {
        const found = players.find((candidate) => candidate.id === playerId);
        if (found) return found;
      }
      throw new Error("Jogador nao encontrado");
    },
  };
}

test("elenco sem registros preserva shape, source e base", async () => {
  const basePlayers = [player("aur-1", "AUR", 15)];
  const baseCatalog = catalog({ AUR: basePlayers }, { source: "demo-fallback" });
  const result = await listRoomPlayers(baseCatalog, {}, "AUR");

  assert.deepEqual(result, {
    players: basePlayers,
    count: 1,
    source: "demo-fallback",
  });
  assert.equal(result.players, basePlayers, "sem overlay devolve contrato original do catalogo");
});

test("transferencia e emprestimo movem elenco somente no save", async () => {
  const auroraBase = [
    player("aur-stay", "AUR", 13),
    player("aur-sale", "AUR", 16, { isStar: true }),
  ];
  const santosBase = [
    player("san-stay", "SAN", 12),
    player("san-loan", "SAN", 18),
  ];
  const originalCatalog = {
    AUR: structuredClone(auroraBase),
    SAN: structuredClone(santosBase),
  };
  let getCalls = 0;
  const baseCatalog = catalog(originalCatalog, { onGet: () => { getCalls += 1; } });
  const room = {
    marketState: {
      registrations: [
        {
          playerId: "aur-sale",
          originalClubId: "AUR",
          permanentClubId: "SAN",
          currentClubId: "SAN",
          playerSnapshot: auroraBase[1],
          transferId: "transfer-1",
          loan: null,
        },
        {
          playerId: "san-loan",
          originalClubId: "SAN",
          permanentClubId: "SAN",
          currentClubId: "AUR",
          playerSnapshot: santosBase[1],
          transferId: "loan-1",
          loan: {
            id: "loan-1",
            lenderClubId: "SAN",
            borrowerClubId: "AUR",
            startedSeason: 1,
            returnSeason: 2,
          },
        },
      ],
    },
  };

  const aurora = await listRoomPlayers(baseCatalog, room, "AUR");
  const santos = await listRoomPlayers(baseCatalog, room, "SAN");

  assert.deepEqual(aurora.players.map(({ id, clubId }) => ({ id, clubId })), [
    { id: "san-loan", clubId: "AUR" },
    { id: "aur-stay", clubId: "AUR" },
  ]);
  assert.deepEqual(santos.players.map(({ id, clubId }) => ({ id, clubId })), [
    { id: "aur-sale", clubId: "SAN" },
    { id: "san-stay", clubId: "SAN" },
  ]);
  assert.equal(getCalls, 0, "snapshot evita depender da base apos a negociacao");
  assert.deepEqual(originalCatalog.AUR, auroraBase, "overlay nao altera jogadores do Editor");
  assert.deepEqual(originalCatalog.SAN, santosBase, "overlay nao altera jogadores do Editor");
});

test("emprestimo muda clube atual sem trocar contrato principal do proprietario", async () => {
  const loaned = player("aur-loan", "AUR", 15, {
    wage: 30_000,
    contract: {
      clubId: "AUR",
      startSeason: 1,
      endSeason: 4,
      wage: 30_000,
      status: "active",
    },
  });
  const baseCatalog = catalog({ AUR: [loaned], SAN: [] });
  const room = {
    marketState: {
      registrations: [{
        playerId: loaned.id,
        originalClubId: "AUR",
        currentClubId: "SAN",
        playerSnapshot: loaned,
        loan: {
          id: "legacy-loan",
          lenderClubId: "AUR",
          borrowerClubId: "SAN",
          remainingRounds: 4,
        },
      }],
    },
    careerState: {
      currentSeason: 2,
      players: [{ ...loaned, age: 25 }],
    },
  };

  assert.deepEqual((await listRoomPlayers(baseCatalog, room, "AUR")).players, []);
  const borrowerRoster = await listRoomPlayers(baseCatalog, room, "SAN");
  assert.equal(borrowerRoster.players.length, 1);
  assert.equal(borrowerRoster.players[0].clubId, "SAN");
  assert.equal(borrowerRoster.players[0].contract.clubId, "AUR");
  assert.equal(borrowerRoster.players[0].contract.wage, 30_000);
  assert.equal(loaned.clubId, "AUR", "overlay nao altera jogador do catalogo");
  assert.equal(loaned.contract.clubId, "AUR", "overlay nao altera contrato do catalogo");
});

test("incoming legado sem snapshot usa catalog.get e sobrescreve clubId", async () => {
  const calls = [];
  const baseCatalog = catalog({
    AUR: [player("aur-1", "AUR", 10)],
    PAL: [player("pal-9", "PAL", 19, {
      contract: { clubId: "PAL", endSeason: 4, status: "active" },
    })],
  }, { onGet: (playerId) => calls.push(playerId) });
  const room = {
    marketState: {
      registrations: [{
        playerId: "pal-9",
        originalClubId: "PAL",
        permanentClubId: "AUR",
        currentClubId: "AUR",
        playerSnapshot: null,
      }],
    },
  };

  const result = await listRoomPlayers(baseCatalog, room, "AUR");
  assert.deepEqual(calls, ["pal-9"]);
  assert.deepEqual(result.players.map(({ id, clubId }) => ({ id, clubId })), [
    { id: "pal-9", clubId: "AUR" },
    { id: "aur-1", clubId: "AUR" },
  ]);
  assert.equal(result.players[0].contract.clubId, "AUR");
});

test("duas salas compartilham catalogo sem compartilhar transferencia", async () => {
  const basePlayers = [player("aur-1", "AUR", 14)];
  const baseCatalog = catalog({ AUR: basePlayers, SAN: [] });
  const transferredRoom = {
    marketState: {
      registrations: [{
        playerId: "aur-1",
        originalClubId: "AUR",
        permanentClubId: "SAN",
        currentClubId: "SAN",
        playerSnapshot: basePlayers[0],
      }],
    },
  };
  const untouchedRoom = { marketState: { registrations: [] } };

  assert.deepEqual((await listRoomPlayers(baseCatalog, transferredRoom, "AUR")).players, []);
  assert.deepEqual(
    (await listRoomPlayers(baseCatalog, transferredRoom, "SAN")).players.map((item) => item.id),
    ["aur-1"],
  );
  assert.deepEqual(
    (await listRoomPlayers(baseCatalog, untouchedRoom, "AUR")).players.map((item) => item.id),
    ["aur-1"],
  );
  assert.equal(basePlayers[0].clubId, "AUR");
});

test("helpers encontram registro em array ou mapa com IDs sem diferenciar caixa", () => {
  const registration = {
    playerId: "Jogador-1",
    originalClubId: "AUR",
    permanentClubId: "SAN",
    currentClubId: "san",
  };
  const room = { marketState: { registrations: { one: registration } } };

  assert.equal(registrationForPlayer(room, "jogador-1"), registration);
  assert.equal(currentPlayerClubId(room, "JOGADOR-1", "AUR"), "san");
  assert.equal(currentPlayerClubId(room, "ausente", "AUR"), "AUR");
});

test("careerState sobrepoe idade, overall, atributos, contrato e treino sem perder base", async () => {
  const basePlayer = player("aur-1", "AUR", 10, {
    age: 20,
    position: "MEI",
    attributes: { chute: 8, passe: 9 },
  });
  const baseCatalog = catalog({ AUR: [basePlayer] });
  const room = {
    careerState: {
      currentSeason: 2,
      players: [{
        id: "aur-1",
        clubId: "AUR",
        age: 21,
        overall: 13.5,
        attributes: { chute: 14, drible: 13 },
        contract: { clubId: "AUR", startSeason: 1, endSeason: 4, status: "active", wage: 25_000 },
        training: { focus: "balanced", intensity: "normal" },
      }],
      trainingPlans: [{ playerId: "AUR-1", focus: "attacking", intensity: "high", active: true }],
    },
  };

  const result = await listRoomPlayers(baseCatalog, room, "AUR");
  assert.equal(result.count, 1);
  assert.deepEqual(result.players[0], {
    ...basePlayer,
    age: 21,
    overall: 13.5,
    attributes: { chute: 14, passe: 9, drible: 13 },
    contract: { clubId: "AUR", startSeason: 1, endSeason: 4, status: "active", wage: 25_000 },
    training: {
      focus: "attacking",
      intensity: "high",
      active: true,
      playerId: "AUR-1",
    },
  });
  assert.equal(careerPlayerFor(room, "AUR-1"), room.careerState.players[0]);
  assert.deepEqual(basePlayer.attributes, { chute: 8, passe: 9 }, "catalogo continua imutavel");
});

test("careerState inclui jovens e remove aposentados, livres e contratos vencidos", async () => {
  const baseCatalog = catalog({
    AUR: [
      player("senior", "AUR", 14),
      player("retired", "AUR", 15),
      player("free", "AUR", 12),
      player("expired", "AUR", 11),
    ],
  });
  const room = {
    careerState: {
      currentSeason: 3,
      players: {
        senior: {
          id: "senior",
          clubId: "AUR",
          contract: { clubId: "AUR", endSeason: 5, status: "active" },
        },
        retired: {
          id: "retired",
          clubId: null,
          retired: true,
          active: false,
          careerStage: "retired",
          contract: { clubId: null, endSeason: 2, status: "retired" },
        },
        free: {
          id: "free",
          clubId: null,
          contract: { clubId: null, endSeason: 2, status: "free_agent" },
        },
        expired: {
          id: "expired",
          clubId: "AUR",
          contract: { clubId: "AUR", endSeason: 2, status: "active" },
        },
        youth: {
          name: "Joia da Base",
          clubId: "AUR",
          position: "ATA",
          age: 16,
          overall: 9,
          academy: true,
          youth: true,
          careerStage: "academy",
          contract: { clubId: "AUR", endSeason: 4, status: "academy" },
        },
      },
    },
  };

  const result = await listRoomPlayers(baseCatalog, room, "AUR");
  assert.deepEqual(result.players.map((candidate) => candidate.id), ["senior", "youth"]);
  assert.equal(result.players[1].academy, true);
  assert.equal(result.players[1].name, "Joia da Base");
});

test("mercado define clube atual e carreira conserva evolucao do jogador", async () => {
  const sold = player("aur-sale", "AUR", 12, { age: 23, attributes: { passe: 8 } });
  const baseCatalog = catalog({ AUR: [sold], SAN: [] });
  const room = {
    marketState: {
      registrations: [{
        playerId: sold.id,
        originalClubId: "AUR",
        permanentClubId: "SAN",
        currentClubId: "SAN",
        playerSnapshot: sold,
      }],
    },
    careerState: {
      currentSeason: 2,
      players: [{
        ...sold,
        age: 24,
        overall: 15,
        attributes: { passe: 14 },
        contract: { clubId: "AUR", endSeason: 4, status: "active" },
      }],
    },
  };

  assert.deepEqual((await listRoomPlayers(baseCatalog, room, "AUR")).players, []);
  const santos = await listRoomPlayers(baseCatalog, room, "SAN");
  assert.equal(santos.players[0].age, 24);
  assert.equal(santos.players[0].overall, 15);
  assert.equal(santos.players[0].attributes.passe, 14);
  assert.equal(santos.players[0].clubId, "SAN");
  assert.equal(santos.players[0].contract.clubId, "SAN");
  assert.equal(currentPlayerClubId(room, sold.id, "AUR"), "SAN");
});

test("mudanca de clube registrada pela carreira aparece sem alterar catalogo", async () => {
  const moved = player("aur-move", "AUR", 14, { age: 25 });
  const baseCatalog = catalog({ AUR: [moved], SAN: [] });
  const room = {
    careerState: {
      currentSeason: 4,
      players: [{
        ...moved,
        clubId: "SAN",
        age: 26,
        contract: { clubId: "SAN", endSeason: 6, status: "active" },
      }],
    },
  };

  assert.deepEqual((await listRoomPlayers(baseCatalog, room, "AUR")).players, []);
  assert.deepEqual(
    (await listRoomPlayers(baseCatalog, room, "SAN")).players.map(({ id, clubId, age }) => ({ id, clubId, age })),
    [{ id: "aur-move", clubId: "SAN", age: 26 }],
  );
  assert.equal(moved.clubId, "AUR");
});
