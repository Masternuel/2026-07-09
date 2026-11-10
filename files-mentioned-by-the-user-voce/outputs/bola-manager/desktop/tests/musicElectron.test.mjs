import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import electron from 'electron';
import { _electron, expect } from '@playwright/test';

const root = resolve('.tmp/music-electron-tests');
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
function wav() {
  const rate = 8000, bytes = rate * 30 * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write('RIFF'); buffer.writeUInt32LE(36 + bytes, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(bytes, 40);
  return buffer; // Silence: deterministic codec fixture, independent of private soundtrack assets.
}
async function launch(directory) {
  const application = await _electron.launch({ executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
    args: [...(packagedExecutable ? [] : ['desktop/main.mjs']), `--desktop-data-dir=${directory}`], env, timeout: 20000 });
  try {
    let page;
    await expect.poll(() => { page = application.windows().find((item) => item.url().startsWith('http://127.0.0.1:')); return Boolean(page); }, { timeout: 20000 }).toBe(true);
    await page.route('**/audio/tracks/*.mp3', (route) => route.fulfill({ contentType: 'audio/wav', body: wav() }));
    await page.addInitScript(() => {
      Math.random = () => 0; // Deterministic first track; subsequent changes use the real ended event.
      const NativeAudio = window.Audio;
      window.__musicPlayers = [];
      window.Audio = function (...args) { const audio = new NativeAudio(...args); window.__musicPlayers.push(audio); return audio; };
      window.Audio.prototype = NativeAudio.prototype;
    });
    // Menu readiness is independent of background media's network/load lifecycle.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('navigation', { name: 'Menu principal', exact: true })).toBeVisible();
    return { application, page };
  } catch (error) { await application.close(); throw error; }
}
const player = (page) => page.evaluate(() => ({ count: window.__musicPlayers.length,
  audible: window.__musicPlayers.filter((item) => !item.paused && item.volume > 0).length,
  players: window.__musicPlayers.map((item) => ({ src: item.currentSrc, time: item.currentTime, volume: item.volume, paused: item.paused })) }));

test('desktop audio shows only a timed popup, survives navigation and persists real local preferences', { timeout: 60000 }, async (context) => {
  await mkdir(root, { recursive: true }); const directory = await mkdtemp(join(root, 'run-'));
  let app;
  let phase = 'launch';
  context.signal.addEventListener('abort', () => {
    if (phase !== 'completed') console.error(`Audio test aborted during: ${phase}`);
  }, { once: true });
  try {
    app = await launch(directory); const page = app.page;
    phase = 'playback and navigation';
    const nav = page.getByRole('navigation', { name: 'Menu principal', exact: true });
    await expect(page.locator('.music-controls')).toHaveCount(0);
    await expect(page.locator('.app-music-stage')).toHaveCount(0);
    await expect.poll(async () => (await player(page)).audible).toBe(1);
    await expect(page.locator('.music-notification__copy strong')).toHaveText('Questions');
    const before = await player(page);
    await nav.getByRole('button', { name: 'Perfil', exact: true }).click();
    const after = await player(page); assert.equal(after.count, before.count);
    assert.equal(after.players.at(-1).src, before.players.at(-1).src);
    assert.ok(after.players.at(-1).time >= before.players.at(-1).time);
    await nav.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('button', { name: 'Áudio', exact: true }).click();
    phase = 'live preferences and track changes';
    const master = page.getByRole('slider', { name: 'Volume geral', exact: true });
    const music = page.getByRole('slider', { name: 'Volume da música', exact: true });
    await master.fill('50'); await music.fill('60');
    await expect.poll(async () => (await player(page)).players.at(-1).volume).toBe(0.3);
    await expect.poll(() => page.evaluate(async () => (await window.bolaDesktop.readPreferences())?.audio?.musicVolume)).toBe(60);
    await page.getByRole('switch', { name: 'Reprodução aleatória', exact: true }).click();
    await page.getByRole('switch', { name: 'Ativar música', exact: true }).click();
    await expect.poll(async () => (await player(page)).audible).toBe(0);
    await page.getByRole('switch', { name: 'Ativar música', exact: true }).click();
    await expect.poll(async () => (await player(page)).audible).toBe(1);
    await page.evaluate(() => {
      for (let index = 0; index < 3; index++) window.__musicPlayers.at(-1).dispatchEvent(new Event('ended'));
    });
    await expect(page.locator('.music-notification')).toHaveCount(1);
    await expect(page.locator('.music-notification__copy strong')).toHaveText('Monster');
    assert.ok((await player(page)).audible <= 1);
    await expect(page.locator('.music-notification')).toHaveCount(0, { timeout: 6000 });
    await nav.getByRole('button', { name: 'Créditos', exact: true }).click();
    await expect(page.locator('.music-notification')).toHaveCount(0);
    await page.evaluate(() => window.__musicPlayers.at(-1).dispatchEvent(new Event('ended')));
    await expect.poll(async () => (await player(page)).players.at(-1).src.endsWith('/holding-on.mp3')).toBe(true);
    await expect(page.locator('.music-notification')).toHaveCount(1);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    phase = 'responsive layout';
    await nav.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('button', { name: 'Áudio', exact: true }).click();
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const overflow = await page.evaluate(() => {
        const { scrollWidth, clientWidth } = document.documentElement;
        const widest = [...document.querySelectorAll('body *')]
          .map((element) => ({ element, right: element.getBoundingClientRect().right }))
          .filter((item) => item.right > clientWidth + 0.5)
          .sort((a, b) => b.right - a.right).slice(0, 3)
          .map(({ element, right }) => `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}@${Math.round(right)}`);
        return { scrollWidth, clientWidth, innerWidth: window.innerWidth, widest };
      });
      assert.ok(overflow.scrollWidth <= overflow.clientWidth, `horizontal overflow at ${width}px: ${JSON.stringify(overflow)}`);
      await expect(page.getByRole('slider', { name: 'Volume geral', exact: true })).toBeVisible();
      const previous = (await player(page)).players.at(-1).src;
      await page.evaluate(() => window.__musicPlayers.at(-1).dispatchEvent(new Event('ended')));
      await expect.poll(async () => (await player(page)).players.at(-1).src !== previous).toBe(true);
      await expect(page.locator('.music-notification')).toBeVisible();
      const notice = await page.locator('.music-notification').boundingBox();
      const viewport = page.viewportSize();
      assert.ok(notice.x >= 0 && notice.x + notice.width <= viewport.width && notice.y + notice.height <= viewport.height);
      await expect(page.locator('.music-controls, footer.music-overlay, .app-music-stage')).toHaveCount(0);
      if (width <= 760) {
        const close = await page.getByRole('button', { name: 'Fechar aviso de música', exact: true }).boundingBox();
        assert.ok(close.height >= 44);
      }
    }
    await page.getByRole('button', { name: 'Fechar aviso de música', exact: true }).click();
    await expect(page.locator('.music-notification')).toHaveCount(0);
    await expect.poll(async () => (await player(page)).audible).toBe(1);
    assert.deepEqual(errors, []);
    await expect.poll(() => page.evaluate(async () => (await window.bolaDesktop.readPreferences())?.audio?.musicEnabled)).toBe(true);
    phase = 'first shutdown';
    await app.application.close(); app = null;
    phase = 'restart';
    app = await launch(directory);
    phase = 'persisted preferences';
    await app.page.getByRole('navigation', { name: 'Menu principal', exact: true }).getByRole('button', { name: 'Configurações', exact: true }).click();
    await app.page.getByRole('button', { name: 'Áudio', exact: true }).click();
    await expect(app.page.getByRole('slider', { name: 'Volume geral', exact: true })).toHaveValue('50');
    await expect(app.page.getByRole('slider', { name: 'Volume da música', exact: true })).toHaveValue('60');
    await expect(app.page.getByRole('switch', { name: 'Reprodução aleatória', exact: true })).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await player(app.page)).players.at(-1).volume).toBe(0.3);
  } catch (error) {
    console.error(`Audio test failed during ${phase}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  } finally {
    phase = 'cleanup';
    await app?.application.close();
    const inside = relative(root, resolve(directory)); assert.ok(inside && !inside.startsWith('..') && !inside.includes(':'));
    await rm(directory, { recursive: true, force: true });
    phase = 'completed';
  }
});
