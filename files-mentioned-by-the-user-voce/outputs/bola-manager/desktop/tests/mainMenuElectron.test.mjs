import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import electron from 'electron';
import { _electron, expect } from '@playwright/test';

const root = resolve('.tmp/menu-electron-tests');
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));

async function launch(directory) {
  const application = await _electron.launch({ executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
    args: [...(packagedExecutable ? [] : ['desktop/main.mjs']), `--desktop-data-dir=${directory}`], env, timeout: 20000 });
  try {
    const quiesced = [];
    const shutdownErrors = [];
    let output = '';
    application.process().stdout.on('data', (chunk) => {
      output += chunk.toString();
      const lines = output.split(/\r?\n/);
      output = lines.pop();
      for (const line of lines) if (line.startsWith('TEST_RENDERER_QUIESCED:')) {
        quiesced.push(line === 'TEST_RENDERER_QUIESCED:true');
      }
    });
    application.process().stderr.on('data', (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.startsWith('LOCAL_SHUTDOWN:')) shutdownErrors.push(line);
    });
    let page;
    const deadline = Date.now() + 20000;
    while (!(page = application.windows().find((candidate) => candidate.url().startsWith('http://127.0.0.1:')))) {
      assert.ok(Date.now() < deadline, 'Main menu window did not become available');
      await new Promise((done) => setTimeout(done, 25));
    }
    await page.getByRole('navigation', { name: 'Menu principal', exact: true }).waitFor();
    await page.waitForLoadState('load');
    await expect.poll(() => application.evaluate(({ app }) => app.listenerCount('before-quit'))).toBeGreaterThan(0);
    await application.evaluate(({ app, BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows().filter((window) => window.webContents.getURL().startsWith('http://127.0.0.1:'));
      if (windows.length !== 1) throw new Error('Expected one test game window');
      // Runs after the application handler. A broken build still fails the assertion,
      // but its test-owned renderer is released instead of leaving a native dialog.
      app.on('before-quit', () => {
        const stopped = windows.every((window) => window.isDestroyed());
        process.stdout.write(`TEST_RENDERER_QUIESCED:${stopped}\n`);
        if (!stopped) for (const window of windows) if (!window.isDestroyed()) window.destroy();
      });
    });
    return { application, page, quiesced, shutdownErrors };
  } catch (error) { await application.close(); throw error; }
}

test('Electron menu preserves forms, profile/theme preferences and confirms native exit', { timeout: 90000 }, async () => {
  const phase = (name) => console.info(JSON.stringify({ testDiagnostic: 'menu', phase: name, pid: process.pid }));
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'run-'));
  let app;
  let reopened;
  try {
    phase('launch');
    app = await launch(directory);
    phase('launched');
    const { page } = app;
    const errors = [];
    const editorRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/editor')) editorRequests.push(request.method()); });
    const nav = page.getByRole('navigation', { name: 'Menu principal', exact: true });
    await expect(nav.getByRole('button', { name: 'Continuar', exact: true })).toBeDisabled();
    await nav.getByRole('button', { name: 'Novo Jogo', exact: true }).click();
    const name = page.getByRole('textbox', { name: 'Nome da temporada', exact: true });
    await name.fill('Configuração mantida');
    await nav.getByRole('button', { name: 'Editor', exact: true }).click();
    await expect(page.locator('.menu-editor > .menu-page-heading > .badge')).toHaveText('Local');
    await expect(page.locator('.menu-editor')).toContainText('Catálogo salvo neste computador, sem sincronização com a nuvem.');
    await expect(page.getByRole('button', { name: 'Abrir Editor', exact: true })).toBeVisible();
    assert.deepEqual(editorRequests, [], 'The availability page must not load or mutate the Editor automatically');
    await page.getByRole('button', { name: 'Abrir Editor', exact: true }).click();
    await expect(page.locator('.editor-screen')).toBeVisible();
    await expect(page.locator('.editor-summary')).toContainText('Base local');
    await expect(page.getByRole('button', { name: 'Adicionar', exact: true })).toBeEnabled();
    phase('editor-opened');
    await page.locator('.editor-global-header').getByRole('button', { name: 'Voltar aos saves', exact: true }).click();
    await nav.getByRole('button', { name: 'Multiplayer', exact: true }).click();
    await expect(page.locator('.desktop-peer-panel')).toBeVisible();
    await nav.getByRole('button', { name: 'Novo Jogo', exact: true }).click();
    await expect(name).toHaveValue('Configuração mantida');
    phase('editor-left');
    await nav.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nome de exibição', exact: true }).fill('Manager Menu QA');
    await page.getByRole('button', { name: 'Salvar nome', exact: true }).click();
    await expect(page.locator('.main-menu__identity')).toContainText('Manager Menu QA');
    phase('profile-saved');
    await page.getByRole('button', { name: 'Interface', exact: true }).click();
    await page.getByRole('button', { name: 'Claro', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const lightChoice = page.getByRole('button', { name: 'Claro', exact: true });
    await expect(lightChoice).toHaveAttribute('aria-pressed', 'true');
    phase('theme-saved');
    const themeGeometry = await lightChoice.evaluate((button) => {
      const bounds = button.getBoundingClientRect();
      const icon = button.querySelector('span').getBoundingClientRect();
      const name = button.querySelector('strong').getBoundingClientRect();
      const checked = button.querySelector(':scope > svg').getBoundingClientRect();
      const contained = [icon, name, checked].every((rect) => rect.width > 0 && rect.height > 0
        && rect.left >= bounds.left && rect.right <= bounds.right
        && rect.top >= bounds.top && rect.bottom <= bounds.bottom);
      return { contained,
        separated: icon.right <= checked.left && Math.max(icon.bottom, checked.bottom) <= name.top,
        aligned: Math.abs(icon.left - name.left) < 1
          && Math.abs(icon.y + icon.height / 2 - checked.y - checked.height / 2) < 1 };
    });
    assert.deepEqual(themeGeometry, { contained: true, separated: true, aligned: true });
    await nav.getByRole('button', { name: 'Novo Jogo', exact: true }).click();
    const leagueGeometry = await page.locator('.league-division-row').first().evaluate((row) => {
      const checkbox = row.querySelector('input').getBoundingClientRect();
      const label = row.querySelector('.league-division-row__identity').getBoundingClientRect();
      return { ordered: checkbox.right < label.left, compact: checkbox.height >= 16 && checkbox.height <= 24 };
    });
    assert.deepEqual(leagueGeometry, { ordered: true, compact: true });
    await expect(name).toHaveValue('Configuração mantida');
    await nav.getByRole('button', { name: 'Perfil', exact: true }).click();
    await expect(page.getByRole('main')).toContainText('Manager Menu QA');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    assert.ok(editorRequests.length > 0, 'Opening the Editor must load the local catalog');
    assert.deepEqual([...new Set(editorRequests)], ['GET'], 'Browsing the Editor must not mutate its catalog');
    assert.deepEqual(errors, []);
    phase('exit-dialog-tested');
    const closed = app.application.waitForEvent('close');
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    phase('exit-requested');
    await page.getByRole('button', { name: 'Fechar jogo', exact: true }).click();
    phase('exit-click-completed');
    await closed;
    phase('exit-closed');
    assert.ok(app.quiesced.length > 0 && app.quiesced.every(Boolean), 'Renderer must stop before backend shutdown');
    assert.deepEqual(app.shutdownErrors, []);
    app = null;

    reopened = await launch(directory);
    phase('reopened');
    await expect(reopened.page.locator('.main-menu__identity')).toContainText('Manager Menu QA');
    await expect(reopened.page.locator('html')).toHaveAttribute('data-theme', 'light');
    await reopened.application.close();
    assert.ok(reopened.quiesced.length > 0 && reopened.quiesced.every(Boolean), 'Programmatic quit must stop renderer before draining HTTP');
    assert.deepEqual(reopened.shutdownErrors, []);
    reopened = null;
  } finally {
    phase('cleanup-start');
    await app?.application.close();
    await reopened?.application.close();
    const inside = relative(root, resolve(directory));
    assert.ok(inside && !inside.startsWith('..') && !inside.includes(':'));
    await rm(directory, { recursive: true, force: true });
    phase('cleanup-complete');
  }
});
