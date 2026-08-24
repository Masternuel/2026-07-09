import assert from "node:assert/strict";
import test from "node:test";
import { buildBuiltinCatalog } from "../../scripts/lib/builtin-catalog.mjs";

test("base interna possui IDs unicos e referencias validas", () => {
  const catalog = buildBuiltinCatalog();
  const leagueIds = new Set(catalog.leagues.map(({ id }) => id));
  const clubIds = new Set(catalog.clubs.map(({ id }) => id));
  const playerIds = new Set(catalog.players.map(({ id }) => id));

  assert.equal(catalog.leagues.length, 1);
  assert.equal(catalog.clubs.length, 16);
  assert.equal(catalog.players.length, 20);
  assert.equal(clubIds.size, catalog.clubs.length);
  assert.equal(playerIds.size, catalog.players.length);
  assert.ok(catalog.clubs.every(({ leagueId }) => leagueIds.has(leagueId)));
  assert.ok(catalog.players.every(({ clubId }) => clubIds.has(clubId)));
});

test("base interna converte atributos visuais para escala 1-20 e preserva estrelas", () => {
  const { players } = buildBuiltinCatalog();
  const igor = players.find(({ id }) => id === "p08");
  const felipe = players.find(({ id }) => id === "p10");

  assert.equal(igor.attributes.velocidade, 16);
  assert.equal(igor.attributes.passe, 20);
  assert.equal(igor.attributes.forca, 10);
  assert.equal(igor.attributes.resistencia, 10);
  assert.equal(igor.attributes.impulsao, 10);
  assert.equal(igor.attributes.reflexos, 10);
  assert.equal(igor.attributes.posicionamentoGol, 10);
  assert.equal(igor.attributes.saidaGol, 10);
  assert.equal(igor.attributes.penaltis, 10);
  assert.equal(igor.overall, 17);
  assert.equal(igor.isStar, true);
  assert.equal(felipe.isStar, true);
  assert.ok(players.every(({ attributes, overall }) => (
    Object.values(attributes).every((value) => value >= 1 && value <= 20)
      && overall >= 1
      && overall <= 20
  )));
});
