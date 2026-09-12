import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let vite;
let fetchAllClubs;
let normalizeClub;
let normalizeCatalogPlayer;
let normalizeTeamsPage;
let Header;
let Sidebar;

before(async () => {
  globalThis.window ??= { location: { origin: 'http://localhost' } };
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true },
  });
  ({ fetchAllClubs, normalizeClub, normalizeTeamsPage } = await vite.ssrLoadModule('/src/hooks/useClubCatalog.ts'));
  ({ normalizeCatalogPlayer } = await vite.ssrLoadModule('/src/hooks/usePlayerCatalog.ts'));
  ({ Header } = await vite.ssrLoadModule('/src/components/layout/Header.tsx'));
  ({ Sidebar } = await vite.ssrLoadModule('/src/components/layout/Sidebar.tsx'));
});

after(async () => {
  await vite?.close();
});

test('normaliza linhas e campos parciais do catálogo sem lançar durante render', () => {
  const leagues = new Map([['BR-A', {
    id: 'BR-A',
    name: 'Brasileirão',
    country: 'Brasil',
    division: 'Série A',
    level: 1,
    clubCount: 1,
  }]]);

  assert.equal(normalizeClub(null, leagues), null);
  assert.equal(normalizeClub({ id: 'SEM-NOME', name: null }, leagues), null);

  const club = normalizeClub({
    id: 'SAFE',
    name: 'Clube Seguro',
    abbreviation: { legacy: true },
    city: { legacy: true },
    state: 42,
    country: ['Brasil'],
    colors: [null, 42, { legacy: true }, '#123ABC'],
    stadium: { legacy: true },
    stadiumCapacity: '40100',
    reputation: '18',
    division: { legacy: true },
    leagueId: 'BR-A',
  }, leagues);

  assert.equal(club.id, 'SAFE');
  assert.equal(club.code, 'CLUBESEG');
  assert.equal(club.color, '#123ABC');
  assert.equal(club.stadium, 'A definir');
  assert.equal(club.stadiumCapacity, 40_100);
  assert.equal(club.city, 'Local a definir');
  assert.equal(club.division, 'Série A');
  assert.equal(club.country, 'Brasil');

  const incomplete = normalizeClub({ id: 'UNKNOWN', name: 'Clube incompleto' }, leagues);
  assert.equal(incomplete.stars, 0);
  assert.equal(incomplete.color, '#6b7280');
});

test('valida o envelope e o cursor de cada página', () => {
  assert.throws(() => normalizeTeamsPage(null), /página inválida/);
  assert.throws(() => normalizeTeamsPage({ teams: {} }), /página inválida/);
  assert.throws(() => normalizeTeamsPage({ teams: [], nextCursor: 12 }), /cursor inválido/);
  assert.deepEqual(normalizeTeamsPage({ teams: [], nextCursor: '  ' }), { teams: [], nextCursor: null });
  assert.deepEqual(normalizeTeamsPage({ teams: [null, { id: 'A' }], nextCursor: ' proxima ' }), {
    teams: [null, { id: 'A' }],
    nextCursor: 'proxima',
  });
});

test('paginação detecta ciclos de cursor antes de repetir indefinidamente', async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const pages = [
    { teams: [], nextCursor: 'A' },
    { teams: [], nextCursor: 'B' },
    { teams: [], nextCursor: 'A' },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(pages.shift()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  await assert.rejects(fetchAllClubs({
    identity: { uid: 'test', displayName: 'Teste', email: null, photoURL: null, mode: 'demo' },
    getIdToken: async () => null,
  }, new AbortController().signal), /cursor repetido/);
});

test('falha da API em conta Firebase não ativa catálogos de demonstração', async () => {
  const [clubSource, leagueSource, playerSource, lobbySource, appSource] = await Promise.all([
    readFile(path.join(projectRoot, 'src/hooks/useClubCatalog.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'src/hooks/useLeagueCatalog.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'src/hooks/usePlayerCatalog.ts'), 'utf8'),
    readFile(path.join(projectRoot, 'src/views/LobbyView.tsx'), 'utf8'),
    readFile(path.join(projectRoot, 'src/App.tsx'), 'utf8'),
  ]);

  for (const source of [clubSource, leagueSource]) {
    assert.match(source, /const useFallback = auth\.identity\?\.mode === 'demo'/);
    assert.doesNotMatch(source, /\|\|\s*\(!roomCode\s*&&\s*Boolean\(error\)\)/);
  }
  assert.doesNotMatch(clubSource, /Exibindo clubes de demonstração/iu);
  assert.doesNotMatch(leagueSource, /Exibindo a liga de demonstração/iu);
  assert.equal(playerSource.includes('clubId}-player-'), false);
  assert.doesNotMatch(playerSource, /`Jogador \$\{index/u);
  assert.doesNotMatch(lobbySource, /clubByCode\(/u);
  assert.doesNotMatch(lobbySource, /roomClubs\[0\]/u);
  assert.match(lobbySource, /onRefreshCatalog/u);
  assert.doesNotMatch(appSource, /defaultClub/u);
  assert.match(appSource, /setClub\(unavailableClub\)/u);
  assert.match(appSource, /nextFixture=\{managerFixture\}/u);
  assert.doesNotMatch(playerSource, /players:\s*auth\.status === 'authenticated' \? \[\] : fallback/u);
});

test('jogador real incompleto nao recebe dados plausiveis inventados', () => {
  assert.equal(normalizeCatalogPlayer({ id: 'P1', name: 'Sem dados' }), null);
  assert.equal(normalizeCatalogPlayer({ id: 'P2', name: 'Sem idade', position: 'ATA', overall: 15 }), null);

  const player = normalizeCatalogPlayer({
    id: 'P3',
    name: 'Registro legado valido',
    position: 'ZAG',
    overall: 14,
    age: 26,
    attributes: { defesa: 14, passe: 12 },
  });
  assert.equal(player.number, 0);
  assert.equal(player.nationality, 'Não informada');
  assert.equal(player.value, 0);
  assert.equal(player.wage, 0);
  assert.equal(player.morale, 'Não informada');
  assert.equal(player.personality, 'Não informada');
  assert.equal(player.worldStar, undefined);
  assert.equal(player.potential, undefined);
  assert.equal(player.foot, 'Não informado');
  assert.deepEqual(player.catalogUnknownFields, [
    'shirtNumber',
    'condition',
    'attributes',
    'foot',
    'morale',
    'contract',
    'potential',
    'worldStar',
  ]);
  assert.equal(player.attributes.chute, 0);
  assert.equal(player.attributes.drible, 0);
  assert.deepEqual(player.catalogUnknownAttributes.sort(), [
    'velocidade', 'chute', 'drible', 'nocao', 'peBom', 'peRuim',
    'forca', 'resistencia', 'impulsao', 'reflexos', 'posicionamentoGol', 'saidaGol', 'penaltis',
  ].sort());
});

test('header e sidebar usam textos seguros quando o contexto chega parcial', () => {
  const club = {
    id: 'SAFE',
    name: { legacy: true },
    code: { legacy: true },
    city: '',
    stars: 1,
    budget: '',
    color: '#123ABC',
    leagueName: { legacy: true },
    division: [],
  };
  const header = renderToStaticMarkup(React.createElement(Header, {
    route: 'home',
    club,
    manager: { uid: 'test', displayName: null, email: null, photoURL: null, mode: 'demo' },
    nextFixture: null,
    onMenu() {},
    onNavigate() {},
    lightMode: false,
    onToggleTheme() {},
  }));
  const sidebar = renderToStaticMarkup(React.createElement(Sidebar, {
    activeRoute: 'home',
    club,
    room: null,
    onNavigate() {},
    open: false,
    onClose() {},
    onExit() {},
  }));

  assert.match(header, /CLUBE/);
  assert.match(header, /Manager/);
  assert.doesNotMatch(header, /2026|Rodada 1/u);
  assert.match(sidebar, />Clube</);
});
