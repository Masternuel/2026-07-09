import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("infraestrutura consome somente cotacao canonica enviada pelo servidor", async () => {
  const source = await readFile(path.join(projectRoot, "src/views/club/StadiumView.tsx"), "utf8");

  assert.match(source, /area\.nextUpgradeQuote/);
  assert.match(source, /selectedQuote\.benefitLabel/);
  assert.match(source, /area\.upgradeStatus === 'active'/);
  assert.match(source, /area\.upgradeStatus === 'max'/);
  assert.doesNotMatch(source, /facilityUpgradeQuote/);
  assert.doesNotMatch(source, /facilityDefinitions/);
  assert.doesNotMatch(source, /baseCost|baseDays/);
});

test("frontend nao mantem copia das regras de infraestrutura", async () => {
  await assert.rejects(
    readFile(path.join(projectRoot, "src/constants/facilityDefinitions.ts"), "utf8"),
    (error) => error?.code === "ENOENT",
  );
});
