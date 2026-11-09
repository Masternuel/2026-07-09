import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createServer, transformWithEsbuild } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { test, expect } from '@playwright/test';
import { buildBuiltinCatalog } from '../scripts/lib/builtin-catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const records = buildBuiltinCatalog().clubs.filter((club) => ['FLA', 'CRU'].includes(club.id));
const moduleId = '\0club-theme-regression.tsx';
const source = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '/src/components/layout/AppShell';
import { normalizeClub } from '/src/hooks/useClubCatalog';
import { UserPreferencesContext } from '/src/preferences/UserPreferencesContext';
import { DEFAULT_USER_PREFERENCES } from '/src/preferences/userPreferences';
import '/src/styles.css';
import '/src/styles/layout.css';
import '/src/styles/dashboard.css';
import '/src/styles/responsive.css';
import '/src/styles/brand.css';
const clubs = ${JSON.stringify(records)}.map((record) => normalizeClub(record, new Map()));
function Fixture() {
  const [index, setIndex] = useState(0), [light, setLight] = useState(false), [route, setRoute] = useState('home');
  useEffect(() => {
    const root = document.documentElement;
    const previousLight = root.classList.contains('theme-light'), previousTheme = root.dataset.theme;
    root.classList.toggle('theme-light', light);
    root.dataset.theme = light ? 'light' : 'dark';
    return () => {
      root.classList.toggle('theme-light', previousLight);
      if (previousTheme === undefined) delete root.dataset.theme;
      else root.dataset.theme = previousTheme;
    };
  }, [light]);
  const value = { preferences: { ...DEFAULT_USER_PREFERENCES, theme: light ? 'light' : 'dark' }, resolvedTheme: light ? 'light' : 'dark', status: 'saved', updatePreferences: async () => { setLight(!light); return true; }, error: null, savedAt: null, reloadPreferences: async () => {} };
  return <UserPreferencesContext.Provider value={value}><AppShell route={route} club={clubs[index]} manager={{ uid: 'fixture', displayName: 'Manager', mode: 'demo' }} room={null} nextFixture={null} onNavigate={setRoute} onExit={() => {}}>
    <main className="secondary-view"><h1>{clubs[index].name}</h1><button data-testid="switch-club" onClick={() => setIndex(1-index)}>Trocar clube</button><button data-testid="switch-theme" onClick={() => setLight(!light)}>Trocar tema</button><p>Fixture sem rede externa ou dados persistidos.</p></main>
  </AppShell></UserPreferencesContext.Provider>;
}
createRoot(document.getElementById('root')).render(<Fixture />);`;

test('menu, fundo e barra movel atualizam juntos ao trocar clube/tema sem vazamento global', async ({ page }) => {
  const temporaryRoot = resolve(root, '.tmp');
  await mkdir(temporaryRoot, { recursive: true });
  const cacheDir = await mkdtemp(join(temporaryRoot, 'club-theme-client-'));
  const server = await createServer({ root, configFile: false, envFile: false, envDir: false, cacheDir,
    plugins: [react(), tailwind(), {
      name: 'club-theme-regression-fixture',
      resolveId(id) { if (id === 'virtual:club-theme-regression') return moduleId; },
      async load(id) { if (id === moduleId) return (await transformWithEsbuild(source, 'fixture.tsx', { loader: 'tsx', jsx: 'automatic' })).code; },
      configureServer(vite) { vite.middlewares.use('/club-theme-regression', async (_req, res, next) => {
        try {
          const html = await vite.transformIndexHtml('/club-theme-regression', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/virtual:club-theme-regression"></script></body></html>');
          res.setHeader('Content-Type', 'text/html'); res.end(html);
        } catch (error) { next(error); }
      }); },
    }], logLevel: 'silent', server: { host: '127.0.0.1', port: 0 }, appType: 'custom',
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${address.port}/club-theme-regression`);
    await page.locator('.app-shell').waitFor();
    const read = () => page.evaluate(() => {
      const style = (selector) => getComputedStyle(document.querySelector(selector));
      return {
        pigment: style('.app-shell').getPropertyValue('--club-color').trim(),
        accent: style('.app-shell').getPropertyValue('--accent').trim(),
        canvas: style('.app-shell').backgroundColor,
        menu: style('.sidebar').backgroundColor,
        topbar: style('.topbar').backgroundColor,
        active: style('.nav-group > button.active').backgroundColor,
        atmosphere: style('.club-backdrop__atmosphere').backgroundImage,
        bottom: style('.bottom-bar').backgroundColor,
        bottomActive: style('.bottom-bar button.active').backgroundColor,
        light: document.querySelector('.app-shell').classList.contains('theme-light'),
        heading: style('main h1').color,
        rootPigment: getComputedStyle(document.documentElement).getPropertyValue('--club-color'),
        rootAccent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const red = await read();
    assert.equal(red.pigment, '#c92d35');
    assert.equal(red.active, 'rgb(201, 45, 53)');
    assert.equal(red.heading, 'rgb(240, 240, 240)');
    await page.getByTestId('switch-club').click();
    await expect(page.locator('.nav-group > button.active')).toHaveCSS('background-color', 'rgb(45, 97, 202)');
    const blue = await read();
    assert.equal(blue.pigment, '#2d61ca');
    assert.equal(blue.active, 'rgb(45, 97, 202)');
    for (const field of ['canvas', 'menu', 'topbar', 'atmosphere']) assert.notEqual(blue[field], red[field], field);
    await page.locator('.sidebar').getByRole('button', { name: 'Táticas', exact: true }).click();
    await expect(page.locator('.nav-group > button.active')).toHaveCSS('background-color', 'rgb(45, 97, 202)');
    assert.equal((await read()).menu, blue.menu);
    await page.getByTestId('switch-theme').click();
    await expect(page.locator('html')).toHaveClass(/theme-light/);
    const light = await read();
    assert.equal(light.light, true);
    assert.equal(light.heading, 'rgb(23, 26, 23)');
    assert.equal(light.pigment, '#2d61ca');
    assert.notEqual(light.canvas, blue.canvas);
    assert.notEqual(light.menu, blue.menu);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await read();
    assert.equal(mobile.bottom, light.menu);
    assert.equal(mobile.bottomActive, light.active);
    assert.equal(mobile.overflow, false);
    await page.getByTestId('switch-club').click();
    await expect(page.locator('.bottom-bar button.active')).toHaveCSS('background-color', 'rgb(201, 45, 53)');
    const mobileRed = await read();
    assert.equal(mobileRed.pigment, '#c92d35');
    assert.notEqual(mobileRed.bottom, mobile.bottom);
    assert.equal(mobileRed.rootPigment, '');
    assert.equal(mobileRed.rootAccent, '#c8ff3d');
    assert.deepEqual(errors, []);
  } finally {
    await server.close();
    assert.equal(dirname(cacheDir), temporaryRoot);
    await rm(cacheDir, { recursive: true, force: true });
  }
});
