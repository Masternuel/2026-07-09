import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { compile } from '@tailwindcss/node';
import theme from '../../tailwind.config.js';

const source = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const compilation = await compile(source, {
  base: fileURLToPath(new URL('../../src/', import.meta.url)),
  onDependency() {},
});
const colors = ['canvas', 'panel', 'raised', 'ink', 'muted', 'line', 'accent'];
const candidates = [...colors.flatMap(color => [`bg-${color}`, `text-${color}`, `border-${color}`]), 'rounded-card', 'rounded-control', 'duration-fast'];
const output = compilation.build(candidates);

test('Tailwind v4 mantém todas as cores CSS do tema legado', () => {
  assert.deepEqual(Object.keys(theme.theme.extend.colors), colors);
  for (const color of colors) {
    for (const [prefix, property] of [['bg', 'background-color'], ['text', 'color'], ['border', 'border-color']]) {
      assert.match(output, new RegExp(`\\.${prefix}-${color} \\{\\s*${property}: var\\(--${color}\\);`));
    }
  }
});

test('Tailwind v4 preserva raios e duração personalizados', () => {
  assert.match(output, /\.rounded-card \{\s*border-radius: 4px;/);
  assert.match(output, /\.rounded-control \{\s*border-radius: 2px;/);
  assert.match(output, /\.duration-fast \{[^}]*transition-duration: 160ms;/);
});

test('scanner permanece limitado ao index e fontes reais da aplicação', () => {
  assert.equal(compilation.root, 'none');
  assert.ok(compilation.sources.some(({ pattern }) => pattern === '../index.html'));
  assert.ok(compilation.sources.some(({ pattern }) => pattern === './'));
  assert.deepEqual(theme.content, ['./index.html', './src/**/*.{js,ts,jsx,tsx}']);
  assert.ok(!compilation.sources.some(({ pattern }) => /\.tmp|\.env|server|scripts|e2e/.test(pattern)));
});

test('compatibilidade do reset mantém bordas, placeholders e controles desabilitados', () => {
  assert.match(output, /border-color: #e5e7eb;/);
  assert.match(output, /input::placeholder, textarea::placeholder \{\s*color: #9ca3af;\s*opacity: 1;/);
  assert.match(output, /select:disabled[^}]*opacity: revert-layer;/);
  assert.match(output, /button:disabled \{[^}]*opacity: \.48;/);
});

test('tema claro, foco e animações existentes continuam no CSS', () => {
  assert.match(output, /\.theme-light \{/);
  assert.match(output, /:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/);
  for (const animation of ['fade-in', 'modal-in', 'toast-in', 'view-in']) {
    assert.match(output, new RegExp(`@keyframes ${animation} \\{`));
  }
});

test('builds de produção e E2E usam o mesmo plugin oficial Vite', () => {
  for (const file of ['vite.config.ts', 'e2e/server.mjs']) {
    const config = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
    assert.match(config, /import tailwindcss from '@tailwindcss\/vite';/);
    assert.match(config, /plugins: \[[^\]]*tailwindcss\(\)/);
  }
  const { packages } = JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'));
  assert.match(packages['node_modules/tailwindcss'].version, /^4\./);
  assert.ok(!Object.keys(packages).some(path => /(?:^|\/)node_modules\/braces$/.test(path)));
});
