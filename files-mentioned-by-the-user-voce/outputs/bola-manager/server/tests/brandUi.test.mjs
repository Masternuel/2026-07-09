import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

let vite;
let BrandLogo;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  ({ BrandLogo } = await vite.ssrLoadModule('/src/components/shared/BrandLogo.tsx'));
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

test('every app wordmark surface reuses the shared logo without replacing club marks', async () => {
  const files = ['components/menu/MainMenuLayout.tsx', 'components/layout/Sidebar.tsx', 'views/EntryView.tsx',
    'views/LobbyView.tsx', 'views/editor/EditorView.tsx', 'views/DesktopExportView.tsx'];
  for (const file of files) {
    const source = await readFile(new URL(`../../src/${file}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ BrandLogo \}/, file);
    assert.match(source, /<BrandLogo(?:\s|\s*\/)/, file);
    assert.doesNotMatch(source, /className="wordmark-glyph"/, file);
  }
  const sidebar = await readFile(new URL('../../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /<ClubMark[^>]*imageUrl=/);
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
