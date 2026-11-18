import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import electron from 'electron';
import { _electron, expect } from '@playwright/test';

const root = resolve('.tmp/branding-electron-tests');
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

test('desktop loads the official brand in menu and Editor at desktop and narrow widths', { timeout: 60000 }, async () => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  const executable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
  let application;
  try {
    application = await _electron.launch({ executablePath: executable ? resolve(executable) : electron,
      args: [...(executable ? [] : ['desktop/main.mjs']), `--desktop-data-dir=${directory}`], env, timeout: 20000 });
    let page;
    await expect.poll(() => {
      page = application.windows().find((candidate) => candidate.url().startsWith('http://127.0.0.1:'));
      return Boolean(page);
    }, { timeout: 20000 }).toBe(true);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // The retained menu is intentionally hidden while the Editor is open.
    const logo = page.locator('img[src="/assets/brand/bola-manager-logo-512.png"]:visible');
    const assertLogo = async () => {
      await expect(logo.first()).toBeVisible();
      await expect.poll(() => logo.first().evaluate((image) => image.complete && image.naturalWidth === 512)).toBe(true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      const bounds = await logo.first().boundingBox();
      assert.ok(bounds.width > 0 && Math.abs(bounds.width - bounds.height) < 1);
    };
    await page.setViewportSize({ width: 1366, height: 900 });
    await assertLogo();
    const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
    assert.equal(favicon, '/assets/brand/bola-manager-favicon.png');
    assert.equal(await page.evaluate(async (path) => (await fetch(path)).status, favicon), 200);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 812 });
      await assertLogo();
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    const navigation = page.getByRole('navigation', { name: 'Menu principal', exact: true });
    await navigation.getByRole('button', { name: 'Editor', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir Editor', exact: true }).click();
    await expect(page.locator('.editor-screen')).toBeVisible();
    await assertLogo();
    assert.deepEqual(errors, []);
  } finally {
    await application?.close();
    const inside = relative(root, directory);
    if (!inside || inside.startsWith('..') || inside.includes(':')) throw new Error('Unsafe branding test cleanup target');
    await rm(directory, { recursive: true, force: true });
  }
});
