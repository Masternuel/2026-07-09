import assert from "node:assert/strict";
import test from "node:test";
import { buildOpponentStudy } from "../game/opponentStudy.mjs";
import { REQUIRED_ATTRIBUTE_KEYS } from "../game/lineupStrength.mjs";
import { FORMATION_ROLES } from "../game/tactics.mjs";

function attributes(value = 11, overrides = {}) {
  return Object.fromEntries(REQUIRED_ATTRIBUTE_KEYS.map((key) => [key, overrides[key] ?? value]));
}

function player(id, position, {
  clubId = "OPP",
  name = id,
  overall = 11,
  value = 11,
  attributeOverrides = {},
  ...overrides
} = {}) {
  return {
    id,
    clubId,
    name,
    shortName: name,
    position,
    overall,
    active: true,
    attributes: attributes(value, attributeOverrides),
    ...overrides,
  };
}

function rosterFor(formationId = "4-3-3") {
  return FORMATION_ROLES[formationId].map((role, index) => {
    const id = `opp-${String(index + 1).padStart(2, "0")}`;
    if (["LD", "LE"].includes(role)) {
      return player(id, role, {
        name: `Lateral ${index}`,
        overall: 8,
        value: 8,
        attributeOverrides: { defesa: 5, velocidade: 7, nocao: 6, resistencia: 7, passe: 7 },
      });
    }
    if (role === "ATA") {
      return player(id, role, {
        name: "Matador Real",
        overall: 19,
        value: 18,
        attributeOverrides: { chute: 20, nocao: 19, peBom: 19, impulsao: 18, forca: 18 },
      });
    }
    if (["PD", "PE"].includes(role)) {
      return player(id, role, {
        name: `Ponta ${index}`,
        overall: 15,
        value: 14,
        attributeOverrides: { velocidade: 17, drible: 16, chute: 14 },
      });
    }
    if (["VOL", "MC", "MEI"].includes(role)) {
      return player(id, role, {
        name: `Meia ${index}`,
        overall: 10,
        value: 9,
        attributeOverrides: { defesa: 7, nocao: 9, forca: 8, resistencia: 9, passe: 11 },
      });
    }
    return player(id, role, { name: `Defensor ${index}`, overall: 11, value: 10 });
  });
}

const fixture = {
  fixtureId: "rodada-8",
  homeClubId: "VIEW",
  awayClubId: "OPP",
  homeTeam: "Time do manager",
  awayTeam: "Real Clube",
};

const publicPreview = {
  formationId: "4-3-3",
  mentality: "attacking",
  teamInstructions: {
    pressureLine: "high",
    width: "wide",
    tempo: "fast",
    pressing: "aggressive",
    offensiveTransition: "build-up",
    defensiveTransition: "counter-press",
  },
};

test("estudo profundo usa elenco real, preview público e produz leitura determinística", () => {
  const opponentPlayers = rosterFor();
  const input = {
    fixture,
    viewerClubId: "view",
    opponentClub: { id: "OPP", code: "REA", name: "Real Clube" },
    players: [
      player("viewer-decoy", "ATA", { clubId: "VIEW", name: "Não pode aparecer", overall: 20, value: 20 }),
      ...opponentPlayers,
    ],
    lineup: { lineupIds: opponentPlayers.map((candidate) => candidate.id) },
    tacticPreview: publicPreview,
    depth: "deep",
  };

  const first = buildOpponentStudy(input);
  const second = buildOpponentStudy(structuredClone(input));

  assert.deepEqual(first, second);
  assert.equal(first.status, "available");
  assert.equal(first.fixtureId, "rodada-8");
  assert.deepEqual(first.opponent, { id: "OPP", code: "REA", name: "Real Clube" });
  assert.deepEqual(first.probableFormation, {
    id: "4-3-3",
    source: "public-preview",
    confidence: 96,
  });
  assert.equal(first.probableLineup.length, 11);
  assert.equal(first.probableLineup.some((candidate) => candidate.id === "viewer-decoy"), false);
  assert.equal(first.dangerousPlayers.length, 3);
  assert.equal(first.dangerousPlayers[0].name, "Matador Real");
  assert.equal(first.style.source, "public-preview");
  assert.ok(first.style.traits.some((trait) => trait.code === "HIGH_PRESS"));
  assert.ok(first.style.traits.some((trait) => trait.code === "WIDE_PLAY"));
  assert.ok(first.sectors.attack.rating > first.sectors.defense.rating);
  assert.ok(first.weaknesses.some((weakness) => weakness.code === "FLANK_DEFENSE"));
  assert.ok(first.recommendations.some((recommendation) => recommendation.code === "ATTACK_FLANKS"));
  assert.equal(first.evidence.tacticSource, "public-preview");
});
test("plano secreto dentro da escalação é ignorado e formação é inferida", () => {
  const opponentPlayers = rosterFor("4-4-2");
  const report = buildOpponentStudy({
    fixture,
    viewerClubId: "VIEW",
    opponentClub: { id: "OPP", name: "Real Clube" },
    players: opponentPlayers,
    lineup: {
      lineupIds: opponentPlayers.map((candidate) => candidate.id),
      tactics: {
        formationId: "5-4-1",
        mentality: "attacking",
        secretMarker: "SEGREDO_QUE_NAO_PODE_VAZAR",
      },
    },
    depth: "standard",
  });

  const serialized = JSON.stringify(report);
  assert.equal(report.probableFormation.id, "4-4-2");
  assert.equal(report.probableFormation.source, "lineup-inference");
  assert.equal(report.style.source, "player-data-inference");
  assert.equal(report.evidence.tacticSource, "not-disclosed");
  assert.doesNotMatch(serialized, /5-4-1|SEGREDO_QUE_NAO_PODE_VAZAR/);
});

test("profundidade controla confiança e quantidade máxima de achados", () => {
  const opponentPlayers = rosterFor();
  const base = {
    fixture,
    viewerClubId: "VIEW",
    opponentClub: { id: "OPP", name: "Real Clube" },
    players: opponentPlayers,
    lineup: { lineupIds: opponentPlayers.map((candidate) => candidate.id) },
    tacticPreview: publicPreview,
  };
  const quick = buildOpponentStudy({ ...base, depth: "quick" });
  const standard = buildOpponentStudy({ ...base, depth: "standard" });
  const deep = buildOpponentStudy({ ...base, depth: "deep" });

  assert.ok(quick.confidence.score < standard.confidence.score);
  assert.ok(standard.confidence.score < deep.confidence.score);
  assert.equal(quick.confidence.depth, "quick");
  assert.equal(deep.confidence.depth, "deep");
  assert.ok(quick.weaknesses.length <= 2);
  assert.ok(standard.weaknesses.length <= 4);
  assert.ok(deep.weaknesses.length <= 6);
  assert.ok(quick.recommendations.length <= 2);
  assert.ok(deep.strengths.length >= quick.strengths.length);
});

test("velocidade da comissão reduz tempo e amplia precisão do estudo", () => {
  const opponentPlayers = rosterFor();
  const base = {
    fixture,
    viewerClubId: "VIEW",
    opponentClub: { id: "OPP", name: "Real Clube" },
    players: opponentPlayers,
    lineup: { lineupIds: opponentPlayers.map((candidate) => candidate.id) },
    tacticPreview: publicPreview,
    depth: "standard",
  };
  const regular = buildOpponentStudy({ ...base, professionalSpeedMultiplier: 1 });
  const fast = buildOpponentStudy({ ...base, professionalSpeedMultiplier: 0.75 });

  assert.equal(regular.confidence.estimatedStudyHours, 16);
  assert.equal(fast.confidence.estimatedStudyHours, 12);
  assert.equal(fast.confidence.scoutingSpeedMultiplier, 0.75);
  assert.ok(fast.confidence.score > regular.confidence.score);
  assert.equal(fast.evidence.estimatedStudyHours, 12);
});

test("fallback sem elenco é explícito e não inventa atletas ou setores", () => {
  const report = buildOpponentStudy({
    fixture: { fixtureId: "sem-dados", homeClubId: "VIEW", awayClubId: "EMPTY", awayTeam: "Sem Dados" },
    viewerClubId: "VIEW",
    opponentClub: { id: "EMPTY", name: "Sem Dados" },
    players: [],
    depth: "valor-inválido",
  });

  assert.equal(report.status, "unavailable");
  assert.equal(report.confidence.depth, "standard");
  assert.equal(report.probableFormation.source, "default");
  assert.deepEqual(report.probableLineup, []);
  assert.deepEqual(report.dangerousPlayers, []);
  assert.equal(report.sectors.attack.rating, null);
  assert.equal(report.weaknesses[0].code, "DATA_INSUFFICIENT");
  assert.equal(report.recommendations[0].code, "GATHER_MORE_DATA");
  assert.deepEqual(report.strongestSectors, []);
  assert.deepEqual(report.vulnerableSectors, []);
});
