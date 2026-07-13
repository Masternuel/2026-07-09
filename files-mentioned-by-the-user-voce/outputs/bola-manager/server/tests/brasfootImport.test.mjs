import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDataset } from "../../scripts/import-brasfoot.mjs";

function validDataset() {
  return {
    version: "teste-2026",
    clubs: [{
      id: "santos-sp",
      name: "Santos",
      abbreviation: "SAN",
      colors: ["#ffffff", "#000000"],
      reputation: 12,
    }],
    players: [{
      id: "player-1",
      clubId: "santos-sp",
      name: "Joao Teste",
      position: "ATA",
      age: 20,
      attributes: { velocidade: 75, passe: 12 },
    }],
    leagues: [],
    cups: [],
  };
}

test("normaliza atributos sem alterar IDs canonicos", () => {
  const result = normalizeDataset(validDataset());
  const player = result.players[0];

  assert.equal(result.clubs[0].id, "santos-sp");
  assert.equal(player.clubId, "santos-sp");
  assert.equal(player.attributes.velocidade, 15);
  assert.equal(player.attributes.passe, 12);
  assert.equal(player.stars.velocidade, 8);
  assert.equal(player.marketValue, 21_000_000);
  assert.equal(player.isStar, false);
  assert.deepEqual(Object.keys(player.attributes), [
    "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
  ]);
});

test("preserva jogador estrela explicitamente sem inferir por overall", () => {
  const dataset = validDataset();
  dataset.players[0].isStar = true;
  dataset.players.push({
    ...dataset.players[0],
    id: "player-overall-alto",
    isStar: undefined,
    overall: 100,
  });
  const result = normalizeDataset(dataset);

  assert.equal(result.players[0].isStar, true);
  assert.equal(result.players[1].isStar, false);
});

test("preserva IDs numericos curtos usados por bases legadas", () => {
  const dataset = validDataset();
  dataset.clubs[0].id = 1;
  dataset.players[0].clubId = 1;
  const result = normalizeDataset(dataset);

  assert.equal(result.clubs[0].id, "1");
  assert.equal(result.players[0].clubId, "1");
});

test("rejeita IDs ambiguos, invalidos e referencias divergentes", () => {
  const duplicate = validDataset();
  duplicate.clubs.push({ id: "SANTOS-SP", name: "Duplicado", reputation: 10 });
  assert.throws(() => normalizeDataset(duplicate), /ID duplicado em clubes/);

  const invalid = validDataset();
  invalid.clubs[0].id = "br/santos";
  assert.throws(() => normalizeDataset(invalid), /ID nao pode conter/);

  const mismatchedReference = validDataset();
  mismatchedReference.players[0].clubId = "SANTOS-SP";
  assert.throws(() => normalizeDataset(mismatchedReference), /referencia clube inexistente/);
});
