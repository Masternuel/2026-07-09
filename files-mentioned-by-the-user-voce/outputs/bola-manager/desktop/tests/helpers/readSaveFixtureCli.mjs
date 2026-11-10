// Runs inside Electron (ELECTRON_RUN_AS_NODE=1) so the fixture is decoded by the shipped V8.
import { readSaveFixture } from "./saveFixture.mjs";

try {
  process.stdout.write(`${JSON.stringify(await readSaveFixture(process.argv[2]))}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ error: { code: error.code ?? null, message: error.message } })}\n`);
  process.exitCode = 1;
}
