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
  assert.equal(player.attributes.passe, 2);
  assert.equal(player.overall, 10);
  assert.equal(player.stars.velocidade, 8);
  assert.equal(player.marketValue, 15_000_000);
  assert.equal(player.isStar, false);
  assert.deepEqual(Object.keys(player.attributes), [
    "velocidade", "chute", "drible", "nocao", "defesa", "passe", "peBom", "peRuim",
    "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
  ]);
  assert.ok([
    "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
  ].every((key) => player.attributes[key] >= 1 && player.attributes[key] <= 20));
});

test("converte atributos Brasfoot 0-100 para escala interna 1-20", () => {
  const dataset = validDataset();
  dataset.players[0].attributes = {
    velocidade: 100,
    chute: 75,
    drible: 50,
    nocao: 25,
    defesa: 74,
    passe: 72,
    peBom: 0,
    peRuim: 125,
    forca: -25,
    resistencia: 0,
    impulsao: 101,
  };
  const attributes = normalizeDataset(dataset).players[0].attributes;

  assert.equal(attributes.velocidade, 20);
  assert.equal(attributes.chute, 15);
  assert.equal(attributes.drible, 10);
  assert.equal(attributes.nocao, 5);
  assert.equal(attributes.defesa, 15);
  assert.equal(attributes.passe, 14);
  assert.equal(attributes.peBom, 1);
  assert.equal(attributes.peRuim, 20);
  assert.equal(attributes.forca, 1);
  assert.equal(attributes.resistencia, 1);
  assert.equal(attributes.impulsao, 20);
});

test("preserva atributos legados 1-20 sem nova conversao", () => {
  const dataset = validDataset();
  dataset.players[0].attributes = {
    velocidade: 20,
    chute: 15,
    drible: 10,
    nocao: 5,
    defesa: 1,
    passe: 12,
    peBom: 18,
    peRuim: 6,
  };
  const attributes = normalizeDataset(dataset).players[0].attributes;

  assert.deepEqual(
    Object.fromEntries(Object.keys(dataset.players[0].attributes).map((key) => [key, attributes[key]])),
    dataset.players[0].attributes,
  );
});

test("marker ou overall detecta escala 100 para todos os campos do jogador", () => {
  const marked = validDataset();
  marked.players[0].attributeScale = 100;
  marked.players[0].overall = 20;
  marked.players[0].attributes = { velocidade: 15, passe: 10 };
  const markedPlayer = normalizeDataset(marked).players[0];
  assert.equal(markedPlayer.overall, 4);
  assert.equal(markedPlayer.attributes.velocidade, 3);
  assert.equal(markedPlayer.attributes.passe, 2);
  assert.equal(Object.hasOwn(markedPlayer, "attributeScale"), false);

  const detectedByOverall = validDataset();
  detectedByOverall.players[0].overall = 75;
  detectedByOverall.players[0].attributes = { velocidade: 15, passe: 10 };
  const detectedPlayer = normalizeDataset(detectedByOverall).players[0];
  assert.equal(detectedPlayer.overall, 14);
  assert.equal(detectedPlayer.attributes.velocidade, 3);
  assert.equal(detectedPlayer.attributes.passe, 2);
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

test("gera atributos ausentes conforme a posicao sem alterar valores explicitos", () => {
  const dataset = validDataset();
  dataset.players = [
    { ...dataset.players[0], id: "zag", name: "Perfil ZAG", position: "ZAG", overall: 100, attributeScale: 100, attributes: {} },
    { ...dataset.players[0], id: "ata", name: "Perfil ATA", position: "ATA", overall: 100, attributeScale: 100, attributes: {} },
    { ...dataset.players[0], id: "gol", name: "Perfil GOL", position: "GOL", overall: 100, attributeScale: 100, attributes: {} },
    { ...dataset.players[0], id: "explicito", name: "ZAG explicito", position: "ZAG", overall: 50, attributeScale: 100, attributes: { chute: 100 } },
  ];
  const [defender, attacker, goalkeeper, explicit] = normalizeDataset(dataset).players;

  assert.ok(defender.attributes.defesa > defender.attributes.chute);
  assert.ok(defender.attributes.nocao > defender.attributes.drible);
  assert.ok(defender.attributes.reflexos < defender.attributes.defesa);
  assert.ok(attacker.attributes.chute > attacker.attributes.defesa);
  assert.ok(goalkeeper.attributes.reflexos > goalkeeper.attributes.chute);
  assert.equal(explicit.attributes.chute, 20);
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
