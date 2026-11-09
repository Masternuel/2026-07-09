import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import electron from "electron";
import { _electron, expect } from "@playwright/test";
import { png } from "../../server/tests/helpers/imageFixtures.mjs";

const root = resolve(".tmp/editor-electron-tests");
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

async function launch(directory) {
  const application = await _electron.launch({ executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
    args: [...(packagedExecutable ? [] : ["desktop/main.mjs"]), `--desktop-data-dir=${directory}`], env, timeout: 20000 });
  try {
    let page;
    await expect.poll(() => {
      page = application.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
      return Boolean(page);
    }, { timeout: 20000 }).toBe(true);
    const navigation = page.getByRole("navigation", { name: "Menu principal", exact: true });
    await navigation.getByRole("button", { name: "Editor", exact: true }).click();
    await page.getByRole("button", { name: "Abrir Editor", exact: true }).click();
    await expect(page.locator(".editor-screen")).toBeVisible();
    return { application, page };
  } catch (error) { await application.close(); throw error; }
}

async function request(page, path, options = {}) {
  return page.evaluate(async ({ path, options }) => {
    const session = await window.bolaDesktop.session();
    const response = await fetch(`/api/editor/${path}`, { method: options.method ?? "GET",
      headers: { Authorization: `Bearer ${session.token}`, ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.bytes ? { "Content-Type": "image/png" } : {}) },
      body: options.bytes ? new Uint8Array(options.bytes) : options.body ? JSON.stringify(options.body) : undefined });
    return { status: response.status, value: await response.json() };
  }, { path, options });
}

test("Electron Editor persists edits and local images across restart, including packaged runtime", { timeout: 60000 }, async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  let app;
  try {
    app = await launch(directory);
    assert.equal((await request(app.page, "leagues", { method: "POST", body: {
      id: "INSTALLER-QA", name: "Liga do instalador", country: "Brasil", division: "Serie A", legs: "single" } })).status, 201);
    assert.equal((await request(app.page, "leagues/INSTALLER-QA", { method: "PATCH", body: { legs: "double" } })).status, 200);
    const media = await request(app.page, "media?entity=clubs&id=AUR&kind=crest", { method: "POST", bytes: [...png] });
    assert.equal(media.status, 201);
    const mediaPath = new URL(media.value.record.crestImageUrl).pathname;
    const session = await request(app.page, "brasfoot-import/sessions", { method: "POST" });
    assert.equal(session.status, 201);
    assert.equal((await request(app.page, `brasfoot-import/sessions/${session.value.sessionId}`, { method: "DELETE" })).status, 200);
    assert.equal((await request(app.page, "database/export")).status, 200);
    await app.application.close(); app = null;

    app = await launch(directory);
    const saved = await request(app.page, "leagues?query=Liga%20do%20instalador");
    assert.equal(saved.status, 200);
    assert.equal(saved.value.records[0].legs, "double");
    const catalog = await request(app.page, "clubs?query=Aurora");
    assert.equal(new URL(catalog.value.records[0].crestImageUrl).pathname, mediaPath);
    const image = await app.page.evaluate(async (path) => {
      const response = await fetch(path);
      return { status: response.status, type: response.headers.get("content-type"), bytes: (await response.arrayBuffer()).byteLength };
    }, mediaPath);
    assert.equal(image.status, 200); assert.equal(image.type, "image/png"); assert.ok(image.bytes > 0);
    assert.equal((await request(app.page, "leagues/INSTALLER-QA", { method: "DELETE" })).status, 200);
    assert.equal((await request(app.page, "media?entity=clubs&id=AUR&kind=crest", { method: "DELETE" })).status, 200);
    assert.ok((await readdir(join(directory, "saves/backups"))).length > 0);
    assert.deepEqual(await readdir(join(directory, "saves/imports")), []);
  } finally {
    await app?.application.close();
    const inside = relative(root, resolve(directory));
    assert.ok(inside && !inside.startsWith("..") && !inside.includes(":"));
    await rm(directory, { recursive: true, force: true });
  }
});
