import assert from "node:assert/strict";
import test from "node:test";
import { simulateAiFixture } from "../game/aiMatchSimulation.mjs";

const POSITIONS = ["GOL", "LE", "ZAG", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "ATA", "PD", "ATA"];

function attributes(position, identity) {
  const attacking = ["PE", "ATA", "PD", "MEI"].includes(position);
  const defensive = ["GOL", "LE", "ZAG", "LD", "VOL"].includes(position);
  const fastSide = identity === "fast";
  return {
    velocidade: fastSide ? 18 : 8,
    chute: attacking ? (fastSide ? 18 : 8) : 9,
    drible: attacking ? (fastSide ? 17 : 8) : 9,
    nocao: defensive && !fastSide ? 18 : 12,
    defesa: defensive ? (fastSide ? 10 : 18) : 8,
    passe: fastSide ? 14 : 11,
    peBom: 13,
    peRuim: 8,
    forca: fastSide ? 12 : 17,
    resistencia: fastSide ? 17 : 12,
    impulsao: defensive && !fastSide ? 18 : 11,
    reflexos: position === "GOL" ? (fastSide ? 11 : 18) : 8,
    posicionamentoGol: position === "GOL" ? (fastSide ? 11 : 18) : 8,
    saidaGol: position === "GOL" ? (fastSide ? 11 : 17) : 8,
    penaltis: position === "GOL" ? (fastSide ? 10 : 17) : 8,
  };
}

function roster(clubId, identity) {
  return POSITIONS.map((position, index) => ({
    id: `${clubId}-${index + 1}`,
    clubId,
    name: `${clubId} Jogador ${String(index + 1).padStart(2, "0")}`,
    position,
    overall: 14,
    condition: 100,
    active: true,
    attributes: attributes(position, identity),
  }));
}

function room(index = 1) {
  return {
    id: `room-ai-tactics-${index}`,
    code: `BOLA-TA${String(index).padStart(2, "0")}`,
    currentSeason: 1,
    playerStates: [],
  };
}

function fixture(index = 1) {
  return {
    leagueFixtureId: `league:1:round:${index}:ai-tactics`,
    leagueId: "league:1",
    round: index,
    homeClubId: "FAST",
    awayClubId: "BLOCK",
    homeTeam: "Velocidade",
    awayTeam: "Bloco",
    homeStrength: 12,
    awayStrength: 12,
  };
}

function rosters() {
  return new Map([
    ["FAST", roster("FAST", "fast")],
    ["BLOCK", roster("BLOCK", "block")],
  ]);
}

test("IA monta planos pelo elenco e aplica encaixe tatico limitado", () => {
  const result = simulateAiFixture(
    room(),
    fixture(),
    rosters(),
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal(result.homeTacticalProfile.available, true);
  assert.equal(result.awayTacticalProfile.available, true);
  assert.notEqual(result.homeTacticalProfile.attack, result.awayTacticalProfile.attack);
  assert.equal(result.tacticalMatchup.version, 1);
  assert.equal(result.tacticalMatchup.reasons.length > 0, true);
  assert.equal(Math.abs(result.tacticalMatchup.home.modifier) <= 0.4, true);
  assert.equal(result.tacticalMatchup.away.modifier, -result.tacticalMatchup.home.modifier);
  for (const side of ["home", "away"]) {
    const strength = result.strengthProfile[side];
    assert.equal(strength.formationFitBonus >= -0.4 && strength.formationFitBonus <= 0.2, true);
    assert.equal(Math.abs(strength.tacticalMatchupBonus) <= 0.4, true);
    assert.equal(
      strength.effective,
      Math.round((strength.base + strength.attributeBonus + strength.starBonus
        + strength.formationFitBonus + strength.tacticalMatchupBonus) * 1_000) / 1_000,
    );
  }
});

test("vantagem tatica influencia sem transformar placar em resultado garantido", () => {
  const results = Array.from({ length: 24 }, (_, index) => simulateAiFixture(
    room(index + 1),
    fixture(index + 1),
    rosters(),
    "2026-07-20T12:00:00.000Z",
  ));
  const homeFavored = results[0].tacticalMatchup.home.modifier > 0;
  assert.notEqual(results[0].tacticalMatchup.home.modifier, 0);
  const favoredWins = results.filter((result) => (
    homeFavored ? result.score[0] > result.score[1] : result.score[1] > result.score[0]
  )).length;
  assert.equal(favoredWins > 0, true);
  assert.equal(favoredWins < results.length, true);
});

test("elenco parcial nao inventa plano nem cria vantagem assimetrica", () => {
  const partial = rosters();
  partial.set("BLOCK", partial.get("BLOCK").slice(0, 8));
  const result = simulateAiFixture(
    room(30),
    fixture(30),
    partial,
    "2026-07-20T12:00:00.000Z",
  );

  assert.equal("tacticalMatchup" in result, false);
  assert.equal("homeTacticalProfile" in result, false);
  assert.equal("awayTacticalProfile" in result, false);
});
