import assert from "node:assert/strict";
import test from "node:test";
import { simulateMatch } from "../game/matchSimulator.mjs";
import {
  applyStarImpactToFixture,
  calculateStarImpact,
  loadStarImpactsAtomically,
} from "../game/starImpact.mjs";
import { CatalogStore } from "../store/catalogStore.mjs";

function document(id, data) {
  return { id, data: () => structuredClone(data) };
}

test("impacto considera apenas estrelas ativas e aplica todos os tetos", () => {
  const activeStars = Array.from({ length: 7 }, (_, index) => ({
    id: `star-${index}`,
    name: `Estrela ${index}`,
    active: true,
    isStar: true,
  }));
  const impact = calculateStarImpact("AUR", [
    ...activeStars,
    { id: "inactive", name: "Arquivado", active: false, isStar: true },
    { id: "legacy", name: "Legado", active: true },
    { id: "regular", name: "Regular", active: true, isStar: false },
  ]);

  assert.equal(impact.catalogPlayerCount, 10);
  assert.equal(impact.starCount, 7);
  assert.equal(impact.starPlayers.length, 7);
  assert.equal(impact.playingStarCount, 7);
  assert.equal(impact.matchStrengthBonus, 1);
  assert.equal(impact.sponsorBoostPercent, 25);
  assert.equal(impact.sponsorAnnualBonus, 12_500_000);
});

test("estrela fora do top 11 agrega patrocinio sem aumentar forca", () => {
  const starters = Array.from({ length: 11 }, (_, index) => ({
    id: `titular-${index}`,
    name: `Titular ${index}`,
    overall: 20 - index / 10,
    active: true,
    isStar: false,
  }));
  const reserveStar = { id: "reserva", name: "Estrela reserva", overall: 1, active: true, isStar: true };
  const impact = calculateStarImpact("AUR", [...starters, reserveStar]);

  assert.equal(impact.starCount, 1);
  assert.equal(impact.playingStarCount, 0);
  assert.deepEqual(impact.playingStarPlayers, []);
  assert.equal(impact.matchStrengthBonus, 0);
  assert.equal(impact.sponsorBoostPercent, 5);
  assert.equal(impact.sponsorAnnualBonus, 2_500_000);

  const savedAsStarter = calculateStarImpact("AUR", [...starters, reserveStar], {
    lineupIds: [reserveStar.id, ...starters.slice(0, 10).map((player) => player.id)],
  });
  assert.equal(savedAsStarter.playingStarCount, 1);
  assert.equal(savedAsStarter.matchStrengthBonus, 0.25);
  assert.equal(savedAsStarter.lineupSource, "saved");
});

test("escalacao salva exclui estrelas lesionadas e suspensas do bonus de campo", () => {
  const players = [
    { id: "ok", name: "Disponivel", overall: 10, isStar: true, active: true },
    { id: "inj", name: "Lesionado", overall: 20, isStar: true, active: true, injured: true },
    { id: "sus", name: "Suspenso", overall: 19, isStar: true, active: true, status: "suspenso" },
    { id: "eng", name: "Injured", overall: 18, isStar: true, active: true, status: "injured" },
  ];
  const impact = calculateStarImpact("AUR", players, { lineupIds: players.map((player) => player.id) });

  assert.equal(impact.starCount, 4);
  assert.equal(impact.playingStarCount, 1);
  assert.deepEqual(impact.playingStarPlayers, [{ id: "ok", name: "Disponivel" }]);
  assert.equal(impact.matchStrengthBonus, 0.25);
  assert.equal(impact.sponsorBoostPercent, 20);
});

test("buff de partida e idempotente e mantem simulacao deterministica", () => {
  const fixture = {
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeStrength: 14,
    awayStrength: 13,
    seed: "star-seed",
  };
  const homeImpact = calculateStarImpact("AUR", Array.from({ length: 4 }, (_, index) => ({
    id: `h-${index}`,
    name: `H ${index}`,
    isStar: true,
  })));
  const awayImpact = calculateStarImpact("SAN", []);
  const adjusted = applyStarImpactToFixture(fixture, homeImpact, awayImpact);
  const repeatedApplication = applyStarImpactToFixture(adjusted, homeImpact, awayImpact);

  assert.equal(fixture.homeStrength, 14);
  assert.equal(adjusted.homeStrength, 15);
  assert.equal(repeatedApplication.homeStrength, 15);
  assert.deepEqual(simulateMatch(adjusted), simulateMatch(repeatedApplication));
});

test("CatalogStore consulta por clubId, normaliza legado e devolve fallback sem Firestore", async () => {
  const calls = [];
  const firestore = {
    collection(name) {
      calls.push(["collection", name]);
      return {
        where(field, operator, value) {
          calls.push(["where", field, operator, value]);
          return {
            async get() {
              return {
                docs: [
                  document("p1", { clubId: "AUR", name: "Estrela", overall: 12, isStar: true, active: true }),
                  document("p2", { clubId: "AUR", name: "Legado", overall: 15, active: true }),
                  document("p3", { clubId: "AUR", name: "Arquivado", overall: 20, isStar: true, active: false }),
                ],
              };
            },
          };
        },
      };
    },
  };
  const impact = await new CatalogStore({ firestore }).getStarImpact("AUR");

  assert.deepEqual(calls, [
    ["collection", "brasfootPlayers"],
    ["where", "clubId", "==", "AUR"],
  ]);
  assert.equal(impact.catalogPlayerCount, 3);
  assert.equal(impact.starCount, 1);
  assert.equal(impact.source, "firestore");
  assert.deepEqual(impact.starPlayers, [{ id: "p1", name: "Estrela" }]);

  const roster = await new CatalogStore({ firestore }).listPlayers("AUR");
  assert.deepEqual(roster.players.map((player) => player.id), ["p2", "p1"]);
  assert.equal(roster.players[0].isStar, false);
  assert.equal(roster.count, 2);
  assert.equal(roster.source, "firestore");

  const unavailable = new CatalogStore();
  assert.equal(unavailable.source, "brasfoot-not-loaded");
  assert.deepEqual(await unavailable.getStarImpact("AUR"), {
    clubId: "AUR",
    catalogPlayerCount: 0,
    starCount: 0,
    starPlayers: [],
    playingStarCount: 0,
    playingStarPlayers: [],
    lineupSource: "deterministic-top11",
    matchStrengthBonus: 0,
    sponsorBoostPercent: 0,
    sponsorAnnualBonus: 0,
    source: "brasfoot-not-loaded",
  });
});

test("Aurora usa fallback demo apenas quando a consulta nao encontra nenhum jogador real", async () => {
  const storeFor = (docs) => new CatalogStore({
    firestore: {
      collection() {
        return {
          where() {
            return { async get() { return { docs }; } };
          },
        };
      },
    },
  });

  const fallback = await storeFor([]).getStarImpact("AUR");
  assert.deepEqual(fallback.starPlayers, [
    { id: "p10", name: "Felipe Rocha" },
    { id: "p08", name: "Igor Sampaio" },
  ]);
  assert.equal(fallback.catalogPlayerCount, 2);
  assert.equal(fallback.starCount, 2);
  assert.equal(fallback.matchStrengthBonus, 0.5);
  assert.equal(fallback.sponsorBoostPercent, 10);
  assert.equal(fallback.sponsorAnnualBonus, 5_000_000);
  assert.equal(fallback.source, "demo-fallback");
  assert.equal(fallback.playingStarCount, 2);
  const fallbackRoster = await storeFor([]).listPlayers("AUR");
  assert.deepEqual(fallbackRoster, { players: [], count: 0, source: "demo-fallback" });

  const realPlayer = document("real-1", {
    clubId: "AUR",
    name: "Jogador real",
    active: true,
  });
  const catalogWins = await storeFor([realPlayer]).getStarImpact("AUR");
  assert.equal(catalogWins.catalogPlayerCount, 1);
  assert.equal(catalogWins.starCount, 0);
  assert.deepEqual(catalogWins.starPlayers, []);
  assert.equal(catalogWins.source, "firestore");

  const otherClub = await storeFor([]).getStarImpact("SAN");
  assert.equal(otherClub.starCount, 0);
  assert.equal(otherClub.source, "firestore");
});

test("falha unilateral ou timeout zera atomicamente os dois clubes", async () => {
  const homeStars = calculateStarImpact("AUR", [{
    id: "h1", name: "Estrela", overall: 20, active: true, isStar: true,
  }]);
  const unilateral = await loadStarImpactsAtomically({
    async getStarImpact(clubId) {
      if (clubId === "AUR") return homeStars;
      throw new Error("Firestore indisponivel");
    },
  }, "AUR", "SAN", { timeoutMs: 50 });

  assert.equal(unilateral.status, "unavailable");
  for (const impact of [unilateral.home, unilateral.away]) {
    assert.equal(impact.matchStrengthBonus, 0);
    assert.equal(impact.source, "unavailable");
    assert.equal(impact.status, "unavailable");
  }

  const timedOut = await loadStarImpactsAtomically({
    getStarImpact() { return new Promise(() => {}); },
  }, "AUR", "SAN", { timeoutMs: 10 });
  assert.equal(timedOut.status, "unavailable");
  assert.equal(timedOut.home.matchStrengthBonus, 0);
  assert.equal(timedOut.away.matchStrengthBonus, 0);
});
