import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = fileURLToPath(new URL('../..', import.meta.url));
let vite, bindSearchShortcut, RankingTable, Header;
before(async () => {
  vite = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent',
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
  ({ bindSearchShortcut } = await vite.ssrLoadModule('/src/utils/searchShortcut.ts'));
  ({ RankingTable } = await vite.ssrLoadModule('/src/components/rankings/RankingTable.tsx'));
  ({ Header } = await vite.ssrLoadModule('/src/components/layout/Header.tsx'));
});
after(async () => { await vite?.close(); });

function shortcutFixture() {
  const listeners = new Set();
  const document = { activeElement: null, modal: false,
    querySelector: () => document.modal ? {} : null,
    addEventListener: (event, listener) => { assert.equal(event, 'keydown'); listeners.add(listener); },
    removeEventListener: (event, listener) => { assert.equal(event, 'keydown'); listeners.delete(listener); },
  };
  const input = { ownerDocument: document, isConnected: true, disabled: false, hidden: false,
    focused: 0, selected: 0, tagName: 'INPUT',
    focus() { input.focused += 1; document.activeElement = input; },
    select() { input.selected += 1; },
  };
  const dispose = bindSearchShortcut(input);
  function press(overrides = {}) {
    const event = { key: 'k', ctrlKey: true, metaKey: false, target: { tagName: 'BODY' },
      defaultPrevented: false, preventDefault() { event.defaultPrevented = true; }, ...overrides };
    for (const listener of listeners) listener(event);
    return event;
  }
  return { input, document, dispose, press, listeners };
}

test('Ctrl+K e Cmd+K focam e selecionam a busca; unmount remove o listener', () => {
  const f = shortcutFixture();
  assert.equal(f.press().defaultPrevented, true);
  assert.equal(f.press({ key: 'K', ctrlKey: false, metaKey: true }).defaultPrevented, true);
  assert.equal(f.press({ target: f.input }).defaultPrevented, true);
  assert.equal(f.input.focused, 3);
  assert.equal(f.input.selected, 3);
  f.dispose();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.press().defaultPrevented, false);
  assert.equal(f.input.focused, 3);
});

test('atalho respeita diálogos, edição, composição e modificadores', () => {
  for (const overrides of [
    { ctrlKey: false }, { key: 'j' }, { altKey: true }, { shiftKey: true }, { repeat: true },
    { isComposing: true }, { defaultPrevented: true }, { target: { tagName: 'INPUT' } },
    { target: { tagName: 'TEXTAREA' } }, { target: { tagName: 'SELECT' } },
    { target: { isContentEditable: true } },
  ]) {
    const f = shortcutFixture();
    f.press(overrides);
    assert.equal(f.input.focused, 0);
    f.dispose();
  }
  for (const update of [(f) => { f.document.modal = true; }, (f) => { f.input.disabled = true; },
    (f) => { f.input.hidden = true; }, (f) => { f.input.isConnected = false; },
    (f) => { f.input.focus = () => {}; }]) {
    const f = shortcutFixture(); update(f);
    assert.equal(f.press().defaultPrevented, false);
    assert.equal(f.input.selected, 0);
    f.dispose();
  }
});

const columns = [{ id: 'name', label: 'Nome', sortable: true, value: (item) => item.name, render: (item) => item.name }];
const tableProps = { caption: 'Tabela', columns, items: [{ id: '1', name: 'Zulu' }, { id: '2', name: 'Alfa' }],
  rowKey: (item) => item.id, sort: { column: 'name', direction: 'asc' } };

test('resumos têm cabeçalhos estáticos; tabelas completas mantêm ordenação acessível', () => {
  const summary = renderToStaticMarkup(createElement(RankingTable, tableProps));
  assert.doesNotMatch(summary.split('</thead>')[0], /<button/);
  assert.match(summary, /aria-sort="ascending"/);
  assert.ok(summary.indexOf('Alfa') < summary.indexOf('Zulu'));
  const sorted = renderToStaticMarkup(createElement(RankingTable, { ...tableProps, onSortChange() {} }));
  assert.match(sorted.split('</thead>')[0], /<button/);
});

test('cabeçalho interativo altera sentido e abertura do jogador continua funcional', () => {
  let selected, sort;
  const tree = RankingTable({ ...tableProps, onSortChange: (value) => { sort = value; },
    onRowClick: (item, trigger) => { selected = { item, trigger }; } });
  const buttons = [];
  function visit(node) {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node?.props) { if (node.type === 'button') buttons.push(node); visit(node.props.children); }
  }
  visit(tree);
  buttons[0].props.onClick();
  assert.deepEqual(sort, { column: 'name', direction: 'desc' });
  const trigger = {};
  buttons[1].props.onClick({ currentTarget: trigger });
  assert.deepEqual(selected, { item: tableProps.items[1], trigger });
});

test('serviços ainda ausentes não exibem ações falsas', async () => {
  const header = renderToStaticMarkup(createElement(Header, { route: 'squad', club: { name: 'Clube' },
    manager: { displayName: 'Teste', mode: 'demo' }, nextFixture: null, onMenu() {}, onNavigate() {}, lightMode: false, onToggleTheme() {} }));
  assert.match(header, /<button[^>]*aria-label="Busca global indisponível"[^>]*disabled/);
  const config = await readFile(new URL('../../src/views/media/ConfigView.tsx', import.meta.url), 'utf8');
  assert.match(config, /inventário confiável de dispositivos/);
  assert.match(config, /disabled title="Recurso ainda não disponível">Indisponível/);
  const squad = await readFile(new URL('../../src/views/SquadView.tsx', import.meta.url), 'utf8');
  assert.match(squad, /disabled title="Relatório do auxiliar ainda não possui serviço persistido"/);
  assert.match(squad, /aria-keyshortcuts="Control\+k Meta\+k"/);
  const ranking = await readFile(new URL('../../src/views/season/RankingsView.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(ranking, /onSortChange=\{\(\) => undefined\}/);
  const match = await readFile(new URL('../../src/views/MatchView.tsx', import.meta.url), 'utf8');
  assert.match(match, /if \(onlineMatch\) setTacticOpen\(true\); else onNavigate\('tactics'\)/);
  await assert.rejects(access(new URL('../../src/components/shared/StarRating.tsx', import.meta.url)), { code: 'ENOENT' });
});
