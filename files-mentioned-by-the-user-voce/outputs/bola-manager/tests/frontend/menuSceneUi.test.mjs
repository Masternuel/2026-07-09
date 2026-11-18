// Menu v2: stadium scene with pointer parallax, purple menu theme and the save under "Continuar".
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let MainMenuLayout;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ MainMenuLayout } = await vite.ssrLoadModule('/src/components/menu/MainMenuLayout.tsx'));
});
after(async () => { await vite?.close(); });

const identity = { uid: 'manager-menu', displayName: 'Manager', email: null, photoURL: null, mode: 'local' };
const layout = (changes = {}) => renderToStaticMarkup(React.createElement(MainMenuLayout, {
  identity, page: 'career', connectionState: 'connected', canContinue: false, continueReason: 'Nenhum save disponível nesta identidade.',
  pending: false, sessionSelected: false, onNavigate() {}, onExit() {}, ...changes,
}, React.createElement('p', null, 'conteudo')));

test('the scenery is decorative and the player only appears on the career home', () => {
  const home = layout();
  assert.match(home, /class="main-menu main-menu--scene"/);
  assert.match(home, /class="menu-parallax menu-parallax--home" aria-hidden="true"/);
  assert.match(home, /src="\/assets\/menu\/player\.webp" alt=""/);
  for (const page of ['settings', 'new-game', 'editor']) {
    const other = layout({ page });
    assert.match(other, /class="menu-parallax" aria-hidden="true"/);
    assert.doesNotMatch(other, /player\.webp/);
  }
  assert.doesNotMatch(layout({ sessionSelected: true }), /player\.webp/);
});

test('"Continuar" shows the latest save only when it can be resumed', () => {
  const ready = layout({ canContinue: true, continueReason: '', continueDetail: 'Aurora FC · 15/08/2026' });
  assert.match(ready, /main-menu__nav-item--continue/);
  assert.match(ready, /class="main-menu__continue-detail">Aurora FC · 15\/08\/2026</);
  const blocked = layout({ continueDetail: 'Aurora FC · 15/08/2026' });
  assert.doesNotMatch(blocked, /main-menu__continue-detail/);
  assert.match(blocked, /Nenhum save disponível nesta identidade/);
});

test('purple theme, art and motion stay inside the menu and respect reduced motion', async () => {
  const css = await readFile(new URL('../../src/styles/main-menu.css', import.meta.url), 'utf8');
  assert.match(css, /\.main-menu\.main-menu--scene, \.theme-light \.main-menu\.main-menu--scene \{[^}]*--accent: #8b5cf6/);
  assert.match(css, /url\("\/assets\/menu\/stadium\.webp"\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.menu-parallax \*, \.menu-parallax__layer \{ animation: none !important; transition: none !important; \}/);
  assert.doesNotMatch(css, /https?:\/\//, 'the offline game loads no remote fonts or images');
  const appCss = await readFile(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(appCss, /--accent: #c8ff3d;/, 'outside the menu the accent (and club themes) are unchanged');
});
