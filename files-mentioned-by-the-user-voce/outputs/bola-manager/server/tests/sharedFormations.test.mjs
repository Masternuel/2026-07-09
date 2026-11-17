import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FORMATION_ID, FORMATION_IDS, FORMATION_ROLES } from "../../shared/formations.mjs";
import { DEFAULT_TACTIC_PLAN, FORMATION_IDS as TACTIC_IDS, FORMATION_ROLES as TACTIC_ROLES } from "../game/tactics.mjs";

const POSITIONS = new Set(["GOL", "LE", "ZAG", "LD", "VOL", "MC", "MEI", "PE", "PD", "ATA"]);

test("Q-04: o motor usa exatamente a tabela compartilhada de formacoes", () => {
  assert.equal(TACTIC_ROLES, FORMATION_ROLES);
  assert.equal(TACTIC_IDS, FORMATION_IDS);
  assert.equal(DEFAULT_TACTIC_PLAN.formationId, DEFAULT_FORMATION_ID);
});

test("Q-04: cada formacao tem 11 papeis validos, um goleiro e e imutavel", () => {
  assert.deepEqual(FORMATION_IDS, Object.keys(FORMATION_ROLES));
  for (const [id, roles] of Object.entries(FORMATION_ROLES)) {
    assert.equal(roles.length, 11, id);
    assert.equal(roles[0], "GOL", id);
    assert.equal(roles.filter((role) => role === "GOL").length, 1, id);
    assert.ok(roles.every((role) => POSITIONS.has(role)), id);
    assert.ok(Object.isFrozen(roles), id);
  }
  assert.ok(Object.isFrozen(FORMATION_ROLES));
});
