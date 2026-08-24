import assert from "node:assert/strict";
import test from "node:test";
import { calculateCoachResignationConsequences } from "../game/coachCareerConduct.mjs";

const NOW = "2026-07-21T12:00:00.000Z";

function consequences(coach) {
  return calculateCoachResignationConsequences({
    coach,
    appointment: { clubId: "A", startedAt: "2026-01-01T00:00:00.000Z" },
    contract: {
      endDate: "2027-12-31T23:59:59.999Z",
      objectives: [{ id: "top-four", status: "pending" }],
    },
    now: NOW,
    reasonCode: "new_challenge",
    seasonProgress: 0.5,
  });
}

test("cooldown trata reputacao legada 1-20 como escala equivalente 0-100", () => {
  const legacy = consequences({ reputation: 14 });
  const normalized = consequences({ reputation: 70 });
  const normalizedMarket = consequences({ reputation: 14, marketReputation: 70 });

  assert.equal(legacy.inactivityDays, normalized.inactivityDays);
  assert.equal(legacy.restrictionEndsAt, normalized.restrictionEndsAt);
  assert.equal(normalizedMarket.inactivityDays, normalized.inactivityDays);
});

test("marketReputation zero nao apaga reputacao legada valida", () => {
  const legacy = consequences({ reputation: 16, marketReputation: 0 });
  const normalized = consequences({ reputation: 80, marketReputation: 80 });

  assert.equal(legacy.inactivityDays, normalized.inactivityDays);
  assert.equal(legacy.restrictionEndsAt, normalized.restrictionEndsAt);
});
