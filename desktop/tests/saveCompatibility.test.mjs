import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { buildFixtureState, canonical, fileDigest, stateDigest } from "./helpers/saveFixture.mjs";

// Audit S-09: saves written by earlier Electron versions must stay readable by the shipped runtime.
const fixtures = resolve("desktop/tests/fixtures/saves");
const reader = resolve("desktop/tests/helpers/readSaveFixtureCli.mjs");
const electron = createRequire(import.meta.url)("electron");
const run = promisify(execFile);
const names = (await readdir(fixtures)).filter((name) => name.endsWith(".bolasave")).sort();

test("existe ao menos um save fixture versionado", () => {
  assert.ok(names.length >= 1, "Nenhum fixture em desktop/tests/fixtures/saves; rode npm run fixture:save");
});

test("canonical distingue tipos que JSON perderia", () => {
  assert.notEqual(stateDigest({ a: undefined }), stateDigest({}));
  assert.notEqual(stateDigest({ a: -0 }), stateDigest({ a: 0 }));
  assert.notEqual(stateDigest({ a: new Date(0) }), stateDigest({ a: new Date(0).toISOString() }));
  assert.equal(stateDigest({ b: 1, a: 2 }), stateDigest({ a: 2, b: 1 }));
  assert.throws(() => canonical(new Map()), /nao suportado/);
  assert.doesNotThrow(() => stateDigest(buildFixtureState()));
});

for (const name of names) {
  test(`Electron atual le ${name} sem perda e sem regravar`, { timeout: 60_000 }, async () => {
    const path = join(fixtures, name);
    const metadata = JSON.parse(await readFile(path.replace(/\.bolasave$/, ".json"), "utf8"));
    assert.equal(metadata.format, "BOLASV01/v1");
    assert.equal(fileDigest(await readFile(path)), metadata.fileSha256, "fixture binario alterado; fixtures sao congelados");
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: "1" };
    delete env.NODE_OPTIONS;
    const { stdout } = await run(electron, [reader, path], { env, windowsHide: true, timeout: 45_000 })
      .catch((error) => { throw new Error(`Leitura falhou: ${error.stdout || error.message}`); });
    const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
    assert.ok(result.runtime.electron, "o leitor precisa rodar dentro do Electron");
    assert.equal(result.uid, metadata.profileUid);
    assert.equal(result.digest, metadata.stateSha256, "estado lido difere do gravado");
    assert.equal(result.unchanged, true, "abrir o save nao pode regravar o arquivo");
  });
}
