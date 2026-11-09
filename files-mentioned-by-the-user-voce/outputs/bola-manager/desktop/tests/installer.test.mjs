import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import config from "../installer.config.mjs";

test("Windows installer is per-user, non-elevated and preserves local saves", () => {
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.nsis.deleteAppDataOnUninstall, false);
  assert.equal(config.nsis.runAfterFinish, false);
  assert.equal(config.win.requestedExecutionLevel, "asInvoker");
  assert.equal(config.publish, null);
  assert.equal(config.win.signExecutable, false);
  assert.deepEqual(config.win.target, [{ target: "nsis", arch: ["x64"] }]);
});

test("Package uses a runtime allowlist and excludes credentials, fixtures and saves", () => {
  const includes = config.files.filter((entry) => !entry.startsWith("!"));
  assert.ok(!includes.includes("**/*"));
  assert.ok(includes.includes("dist-desktop/**"));
  assert.ok(includes.includes("scripts/lib/*.mjs"));
  for (const entry of ["!**/.env*", "!**/.tmp/**", "!**/*.bolasave", "!**/*.log", "!desktop/tests/**", "!server/tests/**", "!**/*service-account*.json", "!**/*firebase-adminsdk*.json"]) {
    assert.ok(config.files.includes(entry), entry);
  }
});

test("Portable build reuses guarded packaging without creating an installer", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const script = await readFile(new URL("../../scripts/package-desktop.mjs", import.meta.url), "utf8");
  assert.equal(manifest.scripts["portable:windows"], "npm run build:desktop && node scripts/package-desktop.mjs --dir");
  assert.ok(script.includes('directoryOnly ? "dir" : "nsis"'));
  assert.ok(script.includes('publish: "never"'));
  assert.ok(script.includes("Portable folder already exists"));
  assert.ok(script.includes("Unsafe package entries"));
});
