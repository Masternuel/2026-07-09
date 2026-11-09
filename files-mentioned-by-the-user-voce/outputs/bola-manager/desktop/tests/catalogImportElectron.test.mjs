import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import electron from "electron";
import { _electron, expect } from "@playwright/test";
import { createStarterCatalog } from "../localCatalog.mjs";
import { createCatalogDatabasePackage } from "../../server/services/catalogDatabase.mjs";

const root = resolve(".tmp/catalog-import-electron");
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

test("Electron import: native chooser, cancel, confirmation, engine reload and pinned career", { timeout: 60000 }, async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  let application;
  try {
    const source = createCatalogDatabasePackage(createStarterCatalog());
    source.records.players[0].name = "Importacao nativa confirmada";
    const file = join(directory, "base-exportada.json");
    await writeFile(file, JSON.stringify(source));
    application = await _electron.launch({ executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
      args: [...(packagedExecutable ? [] : ["desktop/main.mjs"]), `--desktop-data-dir=${directory}`], env, timeout: 20000 });
    let page;
    await expect.poll(() => {
      page = application.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
      return Boolean(page);
    }).toBe(true);
    const nav = page.getByRole("navigation", { name: "Menu principal", exact: true });
    await nav.waitFor();
    async function openImportDisclosure() {
      const summary = page.locator("summary").filter({ hasText: /^Importar uma base existente$/ });
      const disclosure = summary.locator("..");
      await expect(summary).toBeVisible();
      await expect(disclosure).not.toHaveAttribute("open", "");
      await summary.click();
      await expect(disclosure).toHaveAttribute("open", "");
    }
    const room = await page.evaluate(async () => {
      const session = await window.bolaDesktop.session();
      const response = await fetch("/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Carreira preservada", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 1 }) });
      if (response.status !== 201) throw new Error("Fixture career creation failed");
      return (await response.json()).room;
    });
    await application.evaluate(({ dialog }, filePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] }); }, file);
    await nav.getByRole("button", { name: "Editor", exact: true }).click();
    await openImportDisclosure();
    await expect(page.getByRole("button", { name: "Selecionar base exportada", exact: true })).toBeEnabled();
    const before = await readFile(join(directory, "saves/career.bolasave"));
    await page.getByRole("button", { name: "Selecionar base exportada", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Confirmar importação da base", exact: true });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "Confirmar importação", exact: true })).toBeDisabled();
    await page.screenshot({ path: join(root, "confirmation-desktop.png") });
    await page.setViewportSize({ width: 940, height: 700 });
    await page.screenshot({ path: join(root, "confirmation-narrow.png") });
    await page.setViewportSize({ width: 1440, height: 960 });
    assert.deepEqual(await readFile(join(directory, "saves/career.bolasave")), before);
    await confirmation.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    assert.deepEqual(await readFile(join(directory, "saves/career.bolasave")), before);
    await page.getByRole("button", { name: "Selecionar base exportada", exact: true }).click();
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("checkbox").check();
    const oldOrigin = new URL(page.url()).origin;
    await confirmation.getByRole("button", { name: "Confirmar importação", exact: true }).click();
    await page.waitForURL((url) => url.origin !== oldOrigin && url.hostname === "127.0.0.1");
    await page.getByRole("navigation", { name: "Menu principal", exact: true }).waitFor();
    const checked = await page.evaluate(async (code) => {
      const session = await window.bolaDesktop.session();
      const status = await window.bolaDesktop.catalogStatus();
      const response = await fetch(`/api/teams/AUR/players?roomCode=${code}`, { headers: { Authorization: `Bearer ${session.token}` } });
      const body = await response.json();
      return { status, http: response.status, name: body.players.find((item) => item.id === "AUR-p01").name };
    }, room.code);
    assert.equal(checked.status.source, "local-import");
    assert.equal(checked.status.preservedCareers, 1);
    assert.equal(checked.http, 200);
    assert.notEqual(checked.name, source.records.players[0].name);
    const backups = await readdir(join(directory, "saves/backups"));
    assert.equal(backups.length, 1);
    assert.deepEqual(await readFile(join(directory, "saves/backups", backups[0])), before);
    await page.getByRole("navigation", { name: "Menu principal", exact: true }).getByRole("button", { name: "Editor", exact: true }).click();
    await openImportDisclosure();
    await expect(page.getByText("Base importada", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir Editor", exact: true })).toBeEnabled();
    await assert.rejects(page.evaluate(() => window.bolaDesktop.catalogCommit("stale-preview")));
  } finally {
    await application?.close();
    const inside = relative(root, resolve(directory));
    assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(directory, { recursive: true, force: true });
  }
});
