import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import electron from "electron";
import { _electron, expect } from "@playwright/test";

const root = resolve(".tmp/gemini-electron-tests");
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
async function launch(directory) {
  const application = await _electron.launch({ executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
    args: [...(packagedExecutable ? [] : ["desktop/main.mjs"]), `--desktop-data-dir=${directory}`], env, timeout: 20_000 });
  try {
    let page;
    const deadline = Date.now() + 20_000;
    while (!(page = application.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:")))) {
      assert.ok(Date.now() < deadline, "Desktop main window did not start");
      await new Promise((done) => setTimeout(done, 100));
    }
    await page.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("button", { name: "Configurações", exact: true }).click();
    await page.getByRole("button", { name: "Inteligência artificial", exact: true }).click();
    await expect(page.locator("#settings-ai")).toContainText("Configuração carregada.");
    return { application, page };
  } catch (error) { await application.close(); throw error; }
}
test("Electron Gemini encrypts with OS, hides key, survives restart and can disable/remove without provider calls", { timeout: 90_000 }, async () => {
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, "run-"));
  let app; let restarted;
  const fakeKey = "test-only-gemini-key-000000000000";
  try {
    app = await launch(directory);
    const { page } = app;
    const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const field = page.getByLabel("Sua chave da API Gemini", { exact: true });
    await field.fill(fakeKey);
    await page.getByRole("button", { name: "Salvar e ativar", exact: true }).click();
    await expect(field).toHaveValue("");
    await expect(page.locator("#settings-ai")).toContainText("Chave salva e Gemini ativado.");
    const status = await page.evaluate(() => window.bolaDesktop.readAiSettings());
    assert.equal(status.enabled, true); assert.equal(status.configured, true); assert.equal(status.lastResult, "none");
    assert.ok(!JSON.stringify(status).includes(fakeKey));
    const encrypted = await readFile(join(directory, "ai-settings.json"), "utf8");
    assert.ok(!encrypted.includes(fakeKey)); assert.ok(!encrypted.includes("apiKey"));
    assert.deepEqual(errors, []);
    await app.application.close(); app = null;
    restarted = await launch(directory);
    assert.equal((await restarted.page.evaluate(() => window.bolaDesktop.readAiSettings())).enabled, true);
    await restarted.page.getByRole("button", { name: "Desativar, manter chave", exact: true }).click();
    await expect(restarted.page.locator("#settings-ai")).toContainText("Gemini desativado.");
    await expect(restarted.page.getByRole("button", { name: "Testar conexão", exact: true })).toBeDisabled();
    const disabled = await restarted.page.evaluate(() => window.bolaDesktop.readAiSettings());
    assert.equal(disabled.enabled, false); assert.equal(disabled.configured, true);
    await restarted.page.getByRole("button", { name: "Remover chave", exact: true }).click();
    await expect(restarted.page.locator("#settings-ai")).toContainText("Chave removida deste computador.");
    assert.equal((await restarted.page.evaluate(() => window.bolaDesktop.readAiSettings())).configured, false);
  } finally {
    await app?.application.close(); await restarted?.application.close();
    const inside = relative(root, resolve(directory)); assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(directory, { recursive: true, force: true });
  }
});
