import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("regras negam acesso direto do cliente a tournaments", async () => {
  const rules = await readFile(new URL("../../firestore.rules", import.meta.url), "utf8");
  const tournamentBlock = rules.match(/match \/tournaments\/\{documentId\} \{([\s\S]*?)\n\s*\}/)?.[1] ?? "";

  assert.match(tournamentBlock, /allow read, write: if false;/);
  assert.doesNotMatch(tournamentBlock, /allow read: if signedIn\(\);/);
});
