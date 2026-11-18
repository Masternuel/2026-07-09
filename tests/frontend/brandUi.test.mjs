import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let BrandLogo;
let Sidebar;
let MainMenuLayout;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ BrandLogo } = await vite.ssrLoadModule('/src/components/shared/BrandLogo.tsx'));
  ({ Sidebar } = await vite.ssrLoadModule('/src/components/layout/Sidebar.tsx'));
  ({ MainMenuLayout } = await vite.ssrLoadModule('/src/components/menu/MainMenuLayout.tsx'));
});
after(async () => { await vite?.close(); });

test('official brand has one accessible name without duplicate image/text announcements', () => {
  const html = renderToStaticMarkup(React.createElement(BrandLogo));
  assert.match(html, /class="brand-logo brand-logo--compact" role="img" aria-label="Bola Manager"/);
  assert.equal((html.match(/aria-label="Bola Manager"/g) ?? []).length, 1);
  assert.match(html, /<img[^>]*alt="" aria-hidden="true"/);
  assert.match(html, /class="brand-logo__name" aria-hidden="true"/);
});

test('both brand variants use the complete official local artwork and reserved square dimensions', () => {
  for (const variant of ['compact', 'menu']) {
    const html = renderToStaticMarkup(React.createElement(BrandLogo, { variant }));
    assert.match(html, new RegExp(`brand-logo--${variant}`));
    assert.match(html, /src="\/assets\/brand\/bola-manager-logo-512\.png"/);
    assert.match(html, /width="512" height="512"/);
    assert.doesNotMatch(html, /https?:\/\//);
  }
});

test('branding supports integration classes without changing artwork or accessible label', () => {
  const html = renderToStaticMarkup(React.createElement(BrandLogo, { className: 'test-brand' }));
  assert.match(html, /brand-logo--compact test-brand/);
  assert.match(html, /aria-label="Bola Manager"/);
});

const brandCount = (html) => (html.match(/class="brand-logo brand-logo--[a-z]+" role="img" aria-label="Bola Manager"/g) ?? []).length;

test('sidebar and main menu render the shared logo once, and the sidebar keeps the club mark', () => {
  const noop = () => {};
  const club = { id: 'AUR', code: 'AUR', name: 'Aurora FC', color: '#123456', leagueName: 'Liga', division: 'Série A' };
  const sidebar = renderToStaticMarkup(React.createElement(Sidebar, {
    activeRoute: 'home', club, room: null, onNavigate: noop, open: false, onClose: noop, onExit: noop,
  }));
  assert.equal(brandCount(sidebar), 1);
  assert.match(sidebar, /brand-logo--compact/);
  assert.match(sidebar, /class="club-mark[^"]*"[^>]*aria-label="AUR"/);
  assert.doesNotMatch(sidebar, /wordmark-glyph/);

  const menu = renderToStaticMarkup(React.createElement(MainMenuLayout, {
    identity: { uid: 'u', displayName: 'Manager', email: null, photoURL: null, mode: 'local' },
    page: 'career', connectionState: 'connected', canContinue: true, continueReason: '', pending: false,
    sessionSelected: false, onNavigate: noop, onExit: noop, children: null,
  }));
  assert.equal(brandCount(menu), 1);
  assert.match(menu, /brand-logo--menu/);
  assert.doesNotMatch(menu, /wordmark-glyph/);
});

// These views need the auth context or data hooks to render, so they are still
// checked at source level until a render harness with providers exists.
test('views that need app context still import the shared logo', async () => {
  const files = ['views/EntryView.tsx', 'views/LobbyView.tsx', 'views/editor/EditorView.tsx', 'views/DesktopExportView.tsx'];
  for (const file of files) {
    const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ BrandLogo \}/, file);
    assert.match(source, /<BrandLogo(?:\s|\s*\/)/, file);
    assert.doesNotMatch(source, /className="wordmark-glyph"/, file);
  }
});

test('shared branding retains aspect ratio and explicitly adapts menu/entry branding for narrow screens', async () => {
  const css = await readFile(new URL('../../src/styles/brand.css', import.meta.url), 'utf8');
  const entry = await readFile(new URL('../../src/main.tsx', import.meta.url), 'utf8');
  assert.match(css, /object-fit: contain/);
  assert.doesNotMatch(css, /filter:|object-fit:\s*cover|background(?:-image)?:/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 380px\)/);
  assert.match(entry, /import '\.\/styles\/brand\.css'/);
});
