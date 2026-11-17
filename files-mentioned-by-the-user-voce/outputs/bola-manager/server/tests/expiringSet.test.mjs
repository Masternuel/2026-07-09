import assert from "node:assert/strict";
import test from "node:test";
import { ExpiringSet } from "../sockets/expiringSet.mjs";

test("S-08: entradas expiram apos o TTL e somem do tamanho", () => {
  let clock = 0;
  const set = new ExpiringSet({ ttlMs: 1000, now: () => clock });
  set.add("AAA"); clock = 500; set.add("BBB");
  assert.equal(set.has("AAA"), true);
  clock = 1000;
  assert.equal(set.has("AAA"), false);
  assert.equal(set.has("BBB"), true);
  assert.equal(set.size, 1);
  clock = 1500;
  assert.equal(set.size, 0);
});

test("S-08: tamanho maximo descarta as entradas mais antigas", () => {
  const set = new ExpiringSet({ ttlMs: 60_000, maxSize: 3 });
  for (const code of ["A", "B", "C", "D"]) set.add(code);
  assert.deepEqual(["A", "B", "C", "D"].map((code) => set.has(code)), [false, true, true, true]);
  set.add("B"); set.add("E");
  assert.deepEqual(["B", "C", "D", "E"].map((code) => set.has(code)), [true, false, true, true]);
});

test("S-08: mantem a interface de Set usada pelos handlers", () => {
  const set = new ExpiringSet();
  assert.equal(set.add("X"), set);
  assert.equal(set.delete("X"), true);
  assert.equal(set.has("X"), false);
  set.add("Y"); set.clear();
  assert.equal(set.size, 0);
  assert.throws(() => new ExpiringSet({ ttlMs: 0 }), /positivos/);
});
