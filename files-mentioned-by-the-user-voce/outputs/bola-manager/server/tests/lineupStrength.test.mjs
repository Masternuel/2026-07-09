import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLineupAttributeProfiles,
  calculatePlayerOverall,
  calculateLineupAttributeProfile,
  NEW_ATTRIBUTE_KEYS,
  physicalSecondHalfModifier,
  playerAttributeRatings,
  REQUIRED_ATTRIBUTE_KEYS,
  strengthBonusForRating,
} from "../game/lineupStrength.mjs";

function attributes(overrides = {}) {
  return Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((key) => [key, overrides[key] ?? 10]));
}

function player(id, position, overrides = {}) {
  return { id, position, attributes: attributes(overrides), active: true };
}

test("ratings posicionais seguem os pesos canonicos 1-20", () => {
  assert.deepEqual(playerAttributeRatings(player("gk", "GOL", { reflexos: 20 })), {
    sector: "goalkeeper",
    positional: 13.5,
    physical: 10,
  });
  assert.equal(playerAttributeRatings(player("zag", "ZAG", { defesa: 20 })).positional, 13);
  assert.equal(playerAttributeRatings(player("mei", "MEI", { passe: 20 })).positional, 12.5);
  assert.equal(playerAttributeRatings(player("ata", "ATA", { chute: 20 })).positional, 12.5);
  assert.equal(playerAttributeRatings(player("fis", "ATA", { resistencia: 20 })).physical, 13);
});

test("overall e arredondado automaticamente pelos atributos da posicao", () => {
  assert.equal(calculatePlayerOverall(player("gk", "GOL", { reflexos: 20 })), 14);
  assert.equal(calculatePlayerOverall(player("zag", "ZAG", { defesa: 20 })), 13);
  assert.equal(calculatePlayerOverall(player("mei", "MEI", { passe: 20 })), 13);
  assert.equal(calculatePlayerOverall(player("ata", "ATA", { chute: 20 })), 13);
  assert.equal(calculatePlayerOverall({ position: "ATA", attributes: {} }, 17), 17);
});

test("qualquer atributo novo ausente desativa todo o impacto da escalacao", () => {
  for (const missing of NEW_ATTRIBUTE_KEYS) {
    const incomplete = player(`missing-${missing}`, "ATA");
    delete incomplete.attributes[missing];
    const profile = calculateLineupAttributeProfile([incomplete], { lineupIds: [incomplete.id] });
    assert.equal(profile.status, "legacy", missing);
    assert.equal(profile.strengthBonus, 0, missing);
    assert.equal(profile.physicalSecondHalfModifier, 0, missing);
  }

  const partialLegacy = player("missing-passe", "MEI");
  delete partialLegacy.attributes.passe;
  assert.equal(
    calculateLineupAttributeProfile([partialLegacy], { lineupIds: [partialLegacy.id] }).available,
    false,
  );
});

test("perfil calcula bonus de forca e fisico com clamp", () => {
  const elite = player("elite", "ATA", Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((key) => [key, 20])));
  const profile = calculateLineupAttributeProfile([elite], { lineupIds: [elite.id] });
  assert.equal(profile.available, true);
  assert.equal(profile.rating, 20);
  assert.equal(profile.strengthBonus, 1.2);
  assert.equal(profile.physical, 20);
  assert.equal(profile.physicalSecondHalfModifier, 0.4);
  assert.equal(strengthBonusForRating(100), 1.5);
  assert.equal(strengthBonusForRating(-100), -1);
  assert.equal(physicalSecondHalfModifier(100), 0.4);
  assert.equal(physicalSecondHalfModifier(-100), -0.4);
});

test("atributos entram depois da estrela e preservam bonus separados", () => {
  const home = calculateLineupAttributeProfile([
    player("home", "ATA", Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((key) => [key, 15]))),
  ], { lineupIds: ["home"] });
  const away = calculateLineupAttributeProfile([
    player("away", "GOL"),
  ], { lineupIds: ["away"] });
  const adjusted = applyLineupAttributeProfiles({
    homeTeam: "Casa",
    awayTeam: "Fora",
    homeStrength: 12.5,
    awayStrength: 10.25,
    strengthProfile: {
      home: { base: 12, starBonus: 0.5, effective: 12.5 },
      away: { base: 10, starBonus: 0.25, effective: 10.25 },
    },
  }, home, away);

  assert.equal(adjusted.strengthProfile.home.base, 12);
  assert.equal(adjusted.strengthProfile.home.starBonus, 0.5);
  assert.equal(adjusted.strengthProfile.home.attributeBonus, 0.6);
  assert.equal(adjusted.strengthProfile.home.effective, 13.1);
  assert.equal(adjusted.strengthProfile.away.starBonus, 0.25);
  assert.equal(adjusted.strengthProfile.away.attributeBonus, 0);
  assert.equal(adjusted.homeStrength, 13.1);
  assert.equal(adjusted.awayGoalkeeperRating, 10);
});
