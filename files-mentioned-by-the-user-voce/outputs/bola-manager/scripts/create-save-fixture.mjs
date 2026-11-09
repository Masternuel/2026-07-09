// Creates a frozen desktop save fixture with the installed Electron runtime (audit S-09).
// Run once per Electron major upgrade, BEFORE upgrading:  npm run fixture:save
// Existing fixtures are never overwritten; commit the new pair with the upgrade PR.
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openLocalDatabase } from "../desktop/localDatabase.mjs";
import { buildFixtureState, fileDigest, stateDigest } from "../desktop/tests/helpers/saveFixture.mjs";

const self = fileURLToPath(import.meta.url);
const output = resolve(dirname(self), "../desktop/tests/fixtures/saves");

if (!process.versions.electron) {
  const electron = createRequire(import.meta.url)("electron");
  const result = spawnSync(electron, [self], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  process.exit(result.status ?? 1);
}

const name = `career-v1-electron-${process.versions.electron}`;
const directory = await mkdtemp(join(tmpdir(), "bola-save-fixture-create-"));
try {
  const state = buildFixtureState();
  const database = await openLocalDatabase(directory, state);
  await database.close();
  const bytes = await readFile(join(directory, "career.bolasave"));
  await mkdir(output, { recursive: true });
  const metadata = await open(join(output, `${name}.json`), "wx");
  try {
    await metadata.writeFile(`${JSON.stringify({
      format: "BOLASV01/v1",
      createdWith: { electron: process.versions.electron, node: process.versions.node, v8: process.versions.v8 },
      stateSha256: stateDigest(state),
      fileSha256: fileDigest(bytes),
      profileUid: state.profile.uid,
    }, null, 2)}\n`);
  } finally { await metadata.close(); }
  await copyFile(join(directory, "career.bolasave"), join(output, `${name}.bolasave`), 1 /* COPYFILE_EXCL */);
  console.log(`Fixture criado: ${name}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
