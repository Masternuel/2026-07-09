import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import {
  DEFAULT_TACTIC_PLAN,
  FORMATION_IDS,
  FORMATION_ROLES,
  applyPregameTacticsToFixture,
  calculateTacticalProfile,
} from "../game/tactics.mjs";
import { simulateMatch } from "../game/matchSimulator.mjs";
import { lineupSaveSchema, tacticPlanSchema } from "../schemas.mjs";
import { roomForViewer } from "../services/roomVisibility.mjs";
import { startTestServer } from "./testHarness.mjs";

const lineupIds = Array.from({ length: 11 }, (_, index) => `p${String(index + 1).padStart(2, "0")}`);

function plan(overrides = {}) {
  const base = structuredClone(DEFAULT_TACTIC_PLAN);
  return {
    ...base,
    ...overrides,
    teamInstructions: {
      ...base.teamInstructions,
      ...(overrides.teamInstructions ?? {}),
    },
    individualInstructions: overrides.individualInstructions ?? base.individualInstructions,
    setPieces: {
      ...base.setPieces,
      ...(overrides.setPieces ?? {}),
    },
  };
}

function playersForFormation(formationId = "4-3-3", prefix = "p") {
  return FORMATION_ROLES[formationId].map((position, index) => ({
    id: `${prefix}${String(index + 1).padStart(2, "0")}`,
    clubId: prefix === "aur" ? "AUR" : prefix === "san" ? "SAN" : "AUR",
    name: `Jogador ${index + 1}`,
    shortName: `J${index + 1}`,
    position,
    overall: 10,
    active: true,
    attributes: {
      chute: index === 8 ? 20 : 10,
      passe: index === 8 ? 20 : 10,
      nocao: index === 8 ? 20 : 10,
      peBom: index === 8 ? 20 : 10,
    },
  }));
}

function idsFor(prefix) {
  return Array.from({ length: 11 }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

function fullPlan(ids, overrides = {}) {
  return plan({
    ...overrides,
    individualInstructions: overrides.individualInstructions ?? [{
      playerId: ids[8],
      withBall: "attack-space",
      withoutBall: "press-more",
    }],
    setPieces: {
      corner: { takerId: ids[8], routine: "far-post" },
      freeKick: { takerId: ids[8], routine: "direct" },
      goalKick: { takerId: ids[0], routine: "short" },
      ...(overrides.setPieces ?? {}),
    },
  });
}

function connect(url, token = "owner-token") {
  return new Promise((resolve, reject) => {
    const client = createClient(url, {
      auth: { token },
      forceNew: true,
      reconnection: false,
      timeout: 1_000,
    });
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

test("catalogo tatico oferece nove formacoes completas com um goleiro", () => {
  assert.deepEqual(FORMATION_IDS, [
    "4-3-3",
    "4-4-2",
    "3-5-2",
    "4-2-3-1",
    "5-3-2",
    "3-4-3",
    "4-1-4-1",
    "5-4-1",
    "4-3-2-1",
  ]);
  for (const formationId of FORMATION_IDS) {
    const roles = FORMATION_ROLES[formationId];
    assert.equal(roles.length, 11, `${formationId} deve ter onze funcoes`);
    assert.equal(roles.filter((role) => role === "GOL").length, 1, `${formationId} deve ter um goleiro`);
  }
});

test("schemas aceitam plano completo e preservam payload legado sem taticas", () => {
  const validPlan = fullPlan(lineupIds);
  assert.deepEqual(tacticPlanSchema.parse(validPlan), validPlan);

  const legacy = { code: "bola-t3st", lineupIds };
  assert.deepEqual(lineupSaveSchema.parse(legacy), {
    code: "BOLA-T3ST",
    lineupIds,
  });

  const current = lineupSaveSchema.parse({ ...legacy, tactics: validPlan });
  assert.deepEqual(current.tactics, validPlan);
});

test("schemas rejeitam enums invalidos, individuo repetido ou fora e cobrador fora", () => {
  const invalidEnum = plan({ mentality: "reckless" });
  assert.equal(tacticPlanSchema.safeParse(invalidEnum).success, false);

  const duplicated = fullPlan(lineupIds, {
    individualInstructions: [
      { playerId: lineupIds[1], withBall: "hold-width", withoutBall: "hold-position" },
      { playerId: lineupIds[1], withBall: "attack-space", withoutBall: "press-more" },
    ],
  });
  assert.equal(tacticPlanSchema.safeParse(duplicated).success, false);

  const outsiderInstruction = fullPlan(lineupIds, {
    individualInstructions: [
      { playerId: "reserva-12", withBall: "hold-width", withoutBall: "hold-position" },
    ],
  });
  const instructionResult = lineupSaveSchema.safeParse({
    code: "BOLA-T3ST",
    lineupIds,
    tactics: outsiderInstruction,
  });
  assert.equal(instructionResult.success, false);
  assert.deepEqual(instructionResult.error.issues[0].path, [
    "tactics",
    "individualInstructions",
    0,
    "playerId",
  ]);

  const outsiderTaker = fullPlan(lineupIds, {
    setPieces: {
      corner: { takerId: "reserva-12", routine: "short" },
    },
  });
  const takerResult = lineupSaveSchema.safeParse({
    code: "BOLA-T3ST",
    lineupIds,
    tactics: outsiderTaker,
  });
  assert.equal(takerResult.success, false);
  assert.deepEqual(takerResult.error.issues[0].path, [
    "tactics",
    "setPieces",
    "corner",
    "takerId",
  ]);
});

test("perfil tatico e deterministico, limitado e segredo nao altera simulacao", () => {
  const players = playersForFormation();
  const aggressivePlan = fullPlan(lineupIds, {
    mentality: "attacking",
    teamInstructions: {
      pressureLine: "very-high",
      width: "very-wide",
      tempo: "very-fast",
      pressing: "aggressive",
      offensiveTransition: "counter",
      defensiveTransition: "counter-press",
    },
    individualInstructions: lineupIds.map((playerId) => ({
      playerId,
      withBall: "attack-space",
      withoutBall: "press-more",
    })),
  });
  const first = calculateTacticalProfile(aggressivePlan, players, lineupIds);
  const second = calculateTacticalProfile(aggressivePlan, players, lineupIds);
  assert.deepEqual(first, second);
  assert.ok(first.attack >= -0.75 && first.attack <= 0.75);
  assert.ok(first.control >= -0.75 && first.control <= 0.75);
  assert.ok(first.defense >= -0.75 && first.defense <= 0.75);
  assert.ok(first.setPiece >= -0.08 && first.setPiece <= 0.08);
  assert.ok(first.disciplineRisk >= -0.1 && first.disciplineRisk <= 0.1);
  assert.ok(first.fatigueSecondHalfModifier >= -0.25 && first.fatigueSecondHalfModifier <= 0.05);
  assert.ok(first.formationFitBonus >= -0.4 && first.formationFitBonus <= 0.2);

  const publicPlan = { ...aggressivePlan, secret: false };
  assert.deepEqual(
    calculateTacticalProfile(publicPlan, players, lineupIds),
    first,
    "sigilo e regra de visibilidade, nao bonus esportivo",
  );
});

test("instrucoes individuais e bolas paradas mudam partes correspondentes do perfil", () => {
  const players = playersForFormation();
  const base = plan();
  const baseProfile = calculateTacticalProfile(base, players, lineupIds);
  const instructed = plan({
    individualInstructions: [{
      playerId: lineupIds[8],
      withBall: "attack-space",
      withoutBall: "press-more",
    }],
  });
  const instructedProfile = calculateTacticalProfile(instructed, players, lineupIds);
  assert.notDeepEqual(instructedProfile.individualImpact, baseProfile.individualImpact);
  assert.notEqual(instructedProfile.attack, baseProfile.attack);

  const specialized = plan({
    setPieces: {
      corner: { takerId: lineupIds[8], routine: "near-post" },
      freeKick: { takerId: lineupIds[8], routine: "direct" },
      goalKick: { takerId: lineupIds[0], routine: "long" },
    },
  });
  const specializedProfile = calculateTacticalProfile(specialized, players, lineupIds);
  assert.notEqual(specializedProfile.setPiece, baseProfile.setPiece);
  assert.equal(specializedProfile.setPieces.corner.takerName, "J9");
  assert.notEqual(specializedProfile.control, baseProfile.control);
});

test("aplicacao pre-jogo mantem referencia legada e compoe bonus sem apagar outros", () => {
  const fixture = {
    homeStrength: 12.5,
    awayStrength: 10,
    homePhysicalSecondHalfModifier: 0.05,
    strengthProfile: {
      home: {
        baseline: 10,
        starBonus: 0.25,
        attributeBonus: 2.25,
        effective: 12.5,
      },
      away: {
        baseline: 10,
        starBonus: 0,
        attributeBonus: 0,
        effective: 10,
      },
    },
  };
  assert.equal(applyPregameTacticsToFixture(fixture, null, null, null, null), fixture);
  assert.equal(applyPregameTacticsToFixture(fixture, {}, {}, {}, {}), fixture);

  const players = playersForFormation();
  const adjusted = applyPregameTacticsToFixture(
    fixture,
    { lineupIds, tactics: plan() },
    null,
    { players, initialLineupIds: lineupIds },
    null,
  );
  assert.notEqual(adjusted, fixture);
  assert.equal(adjusted.strengthProfile.home.starBonus, 0.25);
  assert.equal(adjusted.strengthProfile.home.attributeBonus, 2.25);
  assert.equal(adjusted.strengthProfile.home.formationFitBonus, 0.2);
  assert.ok(Math.abs(adjusted.homeStrength - (
    12.5
    + adjusted.strengthProfile.home.formationFitBonus
    + adjusted.strengthProfile.home.tacticalMatchupBonus
    + adjusted.strengthProfile.home.cohesionBonus
  )) < 0.001);
  assert.equal(adjusted.strengthProfile.home.effective, adjusted.homeStrength);
  assert.ok(Math.abs(adjusted.tacticalMatchup.home.modifier) <= 0.4);
  assert.deepEqual(adjusted.strengthProfile.away, fixture.strengthProfile.away);
});

test("visibilidade oculta plano secreto e publica somente resumo sanitizado", () => {
  const ownerPlan = fullPlan(lineupIds, { secret: true });
  const publicIds = idsFor("san");
  const publicPlan = fullPlan(publicIds, {
    formationId: "5-4-1",
    mentality: "cautious",
    secret: false,
  });
  const room = {
    code: "BOLA-T3ST",
    lineups: [
      {
        managerId: "uid-owner",
        clubId: "AUR",
        lineupIds,
        tactics: ownerPlan,
        updatedAt: "2026-07-10T00:00:00.000Z",
      },
      {
        managerId: "uid-second",
        clubId: "SAN",
        lineupIds: publicIds,
        tactics: publicPlan,
        updatedAt: "2026-07-10T00:01:00.000Z",
      },
    ],
  };

  const secondView = roomForViewer(room, "uid-second");
  assert.deepEqual(secondView.lineups.map((entry) => entry.managerId), ["uid-second"]);
  assert.equal(secondView.tacticPreviews.length, 0, "plano secreto do adversario nao gera preview");

  const ownerView = roomForViewer(room, "uid-owner");
  assert.deepEqual(ownerView.lineups.map((entry) => entry.managerId), ["uid-owner"]);
  assert.deepEqual(ownerView.tacticPreviews, [{
    managerId: "uid-second",
    clubId: "SAN",
    formationId: "5-4-1",
    mentality: "cautious",
    teamInstructions: publicPlan.teamInstructions,
    updatedAt: "2026-07-10T00:01:00.000Z",
  }]);
  assert.equal("lineupIds" in ownerView.tacticPreviews[0], false);
  assert.equal("individualInstructions" in ownerView.tacticPreviews[0], false);
  assert.equal("setPieces" in ownerView.tacticPreviews[0], false);
  assert.equal(JSON.stringify(ownerView).includes("san09"), false, "IDs e cobradores nao vazam no preview");
});

test("simulador com perfil tatico e deterministico e difere do fluxo legado", () => {
  const players = playersForFormation();
  const profile = calculateTacticalProfile(fullPlan(lineupIds), players, lineupIds);
  const matchInput = {
    homeTeam: "Aurora",
    awayTeam: "Santos",
    homeStrength: 11,
    awayStrength: 11,
    seed: "taticas-v1",
  };
  const legacy = simulateMatch(matchInput);
  const first = simulateMatch({ ...matchInput, homeTacticalProfile: profile });
  const second = simulateMatch({ ...matchInput, homeTacticalProfile: profile });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, legacy);
  assert.ok(first.events.some((event) => event.type === "corner"));
});

test("socket persiste plano completo, isola adversario e recupera apos reconexao", async (context) => {
  const aurIds = idsFor("aur");
  const sanIds = idsFor("san");
  const playersByClub = {
    AUR: playersForFormation("4-3-3", "aur"),
    SAN: playersForFormation("4-3-3", "san"),
  };
  const catalogStore = {
    source: "firestore",
    async listPlayers(clubId) {
      const players = playersByClub[clubId] ?? [];
      return { players, count: players.length, source: "firestore" };
    },
  };
  const { server, url } = await startTestServer({ catalogStore });
  context.after(() => server.close());
  const owner = await connect(url);
  const second = await connect(url, "second-token");
  context.after(() => owner.disconnect());
  context.after(() => second.disconnect());

  const created = await owner.timeout(1_000).emitWithAck("room:create", {
    name: "Planos persistidos",
    clubId: "AUR",
    maxManagers: 2,
  });
  await second.timeout(1_000).emitWithAck("room:join", {
    code: created.room.code,
    clubId: "SAN",
  });

  const ownerPlan = fullPlan(aurIds, { formationId: "4-2-3-1", secret: true });
  const secondPlan = fullPlan(sanIds, { formationId: "5-4-1", mentality: "cautious", secret: true });
  const ownerSaved = await owner.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: aurIds,
    tactics: ownerPlan,
  });
  const secondSaved = await second.timeout(1_000).emitWithAck("lineup:save", {
    code: created.room.code,
    lineupIds: sanIds,
    tactics: secondPlan,
  });
  assert.equal(ownerSaved.ok, true);
  assert.deepEqual(ownerSaved.lineup.tactics, ownerPlan);
  assert.equal(secondSaved.ok, true);
  assert.deepEqual(secondSaved.lineup.tactics, secondPlan);

  const ownerSync = await owner.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
  const secondSync = await second.timeout(1_000).emitWithAck("room:sync", { code: created.room.code });
  assert.deepEqual(ownerSync.room.lineups.map((entry) => entry.managerId), ["uid-owner"]);
  assert.deepEqual(ownerSync.room.lineups[0].tactics, ownerPlan);
  assert.deepEqual(secondSync.room.lineups.map((entry) => entry.managerId), ["uid-second"]);
  assert.deepEqual(secondSync.room.lineups[0].tactics, secondPlan);

  const internalRoom = await server.store.getRoom(created.room.code);
  assert.equal(internalRoom.lineups.length, 2);
  assert.deepEqual(
    internalRoom.lineups.map((entry) => entry.tactics.formationId).sort(),
    ["4-2-3-1", "5-4-1"],
  );

  owner.disconnect();
  const reconnected = await connect(url);
  context.after(() => reconnected.disconnect());
  const restored = await reconnected.timeout(1_000).emitWithAck("room:sync", {
    code: created.room.code,
  });
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.room.lineups.map((entry) => entry.managerId), ["uid-owner"]);
  assert.deepEqual(restored.room.lineups[0].tactics, ownerPlan);
});
