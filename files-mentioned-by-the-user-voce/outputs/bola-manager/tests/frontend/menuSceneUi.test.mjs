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
  assert.match(home, /class="main-menu main-menu--scene( main-menu--motion)?"/);
  assert.match(home, /class="menu-parallax menu-parallax--home( menu-parallax--motion)?" aria-hidden="true"/);
  assert.match(home, /src="\/assets\/menu\/player\.webp" alt=""/);
  for (const page of ['settings', 'new-game', 'editor']) {
    const other = layout({ page });
    assert.match(other, /class="menu-parallax( menu-parallax--motion)?" aria-hidden="true"/);
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

test('"Animações do menu" lives only in Configurações and forced motion beats the OS reduced-motion rule', async () => {
  const html = layout();
  assert.doesNotMatch(html, /Animações do menu|main-menu__motion|type="checkbox"/, 'the menu top bar has no motion switch');
  const config = await readFile(new URL('../../src/views/media/ConfigView.tsx', import.meta.url), 'utf8');
  assert.match(config, /<Toggle checked=\{menuMotion\.enabled\} onChange=\{menuMotion\.setEnabled\} label="Animações do menu" \/>/);
  const css = await readFile(new URL('../../src/styles/main-menu.css', import.meta.url), 'utf8');
  assert.match(css, /\.main-menu \.menu-parallax--motion \.menu-parallax__layer \{ transition: transform [^}]*!important; \}/);
  assert.match(css, /\.main-menu \.menu-parallax--motion \.menu-parallax__particles span \{[^}]*animation-delay: var\(--delay, 0s\) !important; \}/);
  assert.match(css, /\.menu-parallax:not\(\.menu-parallax--motion\) \*/);
  const hook = await readFile(new URL('../../src/components/menu/useMenuMotion.ts', import.meta.url), 'utf8');
  assert.match(hook, /getItem\(STORAGE_KEY\) !== 'off'/, 'motion starts on and only an explicit "off" disables it');
  assert.doesNotMatch(hook, /prefers-reduced-motion/, 'the Windows animation setting no longer turns the menu motion off');
  assert.match(hook, /dispatchEvent\(new Event\(CHANGE_EVENT\)\)/, 'changing it in Configurações updates the open menu');
});

test('no fixed lime left in the menu experience: Editor, save/club lists, music notice and toasts follow the purple accent', async () => {
  const read = (file) => readFile(new URL(`../../src/styles/${file}`, import.meta.url), 'utf8');
  for (const file of ['editor.css', 'entry.css', 'audio.css']) {
    assert.doesNotMatch(await read(file), /rgba\(\s*200\s*,\s*255\s*,\s*61/, `${file} still hard-codes the lime accent`);
  }
  assert.match(await read('editor.css'), /\.editor-screen \{ --accent: #8b5cf6;/);
  const menu = await read('main-menu.css');
  assert.match(menu, /--green: #c4b5fd;/);
  assert.match(menu, /body:has\(\.main-menu--scene, \.editor-screen\) \.toast \{ --accent: #8b5cf6;/);
  assert.match(await read('audio.css'), /body:has\(\.main-menu--scene, \.editor-screen\) \.music-notification \{ --accent: #8b5cf6; \}/);
});
