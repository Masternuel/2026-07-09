import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  goalProbabilityAgainstGoalkeeper,
  simulateMatch,
} from "../game/matchSimulator.mjs";

const input = {
  homeTeam: "Aurora FC",
  awayTeam: "Santos",
  homeStrength: 14,
  awayStrength: 12,
  seed: "rodada-14",
};

function throughHalftime(match) {
  const index = match.events.findIndex((event) => event.type === "halftime");
  return match.events.slice(0, index + 1);
}

test("simulacao legada permanece byte-a-byte identica", () => {
  const match = simulateMatch(input);
  const digest = createHash("sha256").update(JSON.stringify(match)).digest("hex");
  assert.equal(digest, "3ab4242c02fe6c364eb075e110c5299d2e3508c93e940bf4e7edf2a1bb5be95f");
});

test("goleiro ajusta probabilidade em no maximo doze pontos e muda a seed", () => {
  assert.equal(goalProbabilityAgainstGoalkeeper(0.5, 20), 0.38);
  assert.equal(goalProbabilityAgainstGoalkeeper(0.5, 10), 0.5);
  assert.equal(goalProbabilityAgainstGoalkeeper(0.5, 1), 0.608);
  assert.equal(goalProbabilityAgainstGoalkeeper(0.02, 20), 0);

  const elite = simulateMatch({ ...input, homeGoalkeeperRating: 20, awayGoalkeeperRating: 10 });
  const repeated = simulateMatch({ ...input, homeGoalkeeperRating: 20, awayGoalkeeperRating: 10 });
  const weak = simulateMatch({ ...input, homeGoalkeeperRating: 1, awayGoalkeeperRating: 10 });
  assert.deepEqual(elite, repeated);
  assert.notEqual(elite.id, weak.id);
});

test("fisico altera somente o segundo tempo", () => {
  const strongHome = simulateMatch({
    ...input,
    homePhysicalSecondHalfModifier: 0.4,
    awayPhysicalSecondHalfModifier: -0.4,
  });
  const tiredHome = simulateMatch({
    ...input,
    homePhysicalSecondHalfModifier: -0.4,
    awayPhysicalSecondHalfModifier: 0.4,
  });

  assert.equal(strongHome.id, tiredHome.id);
  assert.deepEqual(throughHalftime(strongHome), throughHalftime(tiredHome));
  assert.notDeepEqual(strongHome.events.slice(8), tiredHome.events.slice(8));
  assert.notEqual(strongHome.statistics.home.possession, tiredHome.statistics.home.possession);
});
