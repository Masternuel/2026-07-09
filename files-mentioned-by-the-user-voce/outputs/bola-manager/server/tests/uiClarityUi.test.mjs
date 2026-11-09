import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { withTestAuth } from './helpers/withTestAuth.mjs';

let vite, HomeView, Header, CareerOverview, EditorAvailabilityPage, MultiplayerPage, InformationDisclosure;
before(async () => {
  vite = await createServer({ root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false,
    envDir: false, appType: 'custom', logLevel: 'silent', esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true } });
  ({ HomeView } = await vite.ssrLoadModule('/src/views/HomeView.tsx'));
  HomeView = await withTestAuth(vite, HomeView);
  ({ Header } = await vite.ssrLoadModule('/src/components/layout/Header.tsx'));
  ({ CareerOverview } = await vite.ssrLoadModule('/src/components/menu/CareerOverview.tsx'));
  ({ EditorAvailabilityPage } = await vite.ssrLoadModule('/src/components/menu/EditorAvailabilityPage.tsx'));
  ({ MultiplayerPage } = await vite.ssrLoadModule('/src/components/menu/MultiplayerPage.tsx'));
  ({ InformationDisclosure } = await vite.ssrLoadModule('/src/components/shared/InformationDisclosure.tsx'));
});
after(async () => { await vite?.close(); });

const identity = (mode = 'local') => ({ uid: 'clarity-manager', displayName: 'Manager', mode });
const club = { id: 'AUR', code: 'AUR', name: 'Aurora FC', color: '#c8ff3d', leagueId: 'BR-A' };
const emptySection = () => ({ items: [], empty: true, message: 'Nenhum registro pendente.' });
const central = () => ({ asOf: null, nextFixture: null, recentResults: emptySection(),
  finance: { status: 'empty', balance: null, income: null, expense: null, message: null },
  squad: { total: 12, available: 10, averageCondition: null, averageMorale: null, injured: [{}], suspended: [{}] },
  expiringContracts: emptySection(), negotiations: emptySection(), activeProjects: emptySection(),
  messages: emptySection(), administrativePending: emptySection(), staffAlerts: emptySection(),
  objectives: emptySection(), latestNews: emptySection(), emptyMessages: { nextFixture: 'Nenhuma partida agendada' } });
const room = (snapshot = central()) => ({ code: 'CLARITY', name: 'Temporada de teste', ownerId: 'clarity-manager',
  managers: [{ id: 'clarity-manager', name: 'Manager', clubId: 'AUR' }], status: 'active',
  currentSeason: 1, seasonYear: 2026, fixtureSchedule: [], completedFixtureIds: [], completedMatches: [],
  centralSnapshot: snapshot });
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const home = (changes = {}) => render(HomeView, { players: [], club, room: room(), managerId: 'clarity-manager',
  onlineMatch: null, onNavigate() {}, onToast() {}, ...changes });

test('disclosure is closed by default with native labelled keyboard semantics and intact content', () => {
  const html = render(InformationDisclosure, { title: 'Recursos e backup', children: 'Todos os recursos continuam aqui.' });
  assert.match(html, /<details class="information-disclosure"><summary><span>Recursos e backup<\/span>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen|role="button"/);
  assert.match(html, /Todos os recursos continuam aqui/);
  assert.match(html, /aria-hidden="true"/);
});

test('header removes unavailable search while preserving real actions and accurate club/season context', () => {
  const html = render(Header, { route: 'home', club, manager: identity(), nextFixture: null, seasonYear: 2026,
    onMenu() {}, onNavigate() {}, lightMode: false, onToggleTheme() {} });
  assert.doesNotMatch(html, /search-button|Busca global|lucide-search/);
  assert.match(html, /AURORA FC \/ TEMPORADA 2026/);
  for (const label of ['Abrir menu', 'Ativar tema claro', 'Abrir configurações de notificações', 'Abrir configurações da conta']) assert.match(html, new RegExp(label));
  assert.match(html, /title="Perfil local · seu computador"/);
  const peer = render(Header, { route: 'home', club, manager: identity('peer'), nextFixture: null,
    onMenu() {}, onNavigate() {}, lightMode: false, onToggleTheme() {} });
  assert.match(peer, /Convidado P2P · save no anfitrião/);
});

test('career uses functional titles and preserves save metadata and continue/create actions', () => {
  const html = render(CareerOverview, { identity: identity(), latest: { ...room(), createdAt: '2026-10-09T12:00:00Z' },
    clubs: [club], loading: false, pending: false, continueReason: '', onContinue() {}, onNavigate() {} });
  for (const text of ['Carreira', 'Temporada de teste', 'Em andamento', '2026', 'Continuar carreira', 'Novo Jogo', 'Multiplayer', 'Editor']) assert.match(html, new RegExp(text));
  assert.doesNotMatch(html, /O PRÓXIMO CAPÍTULO|Sua próxima decisão|Uma base com a sua assinatura|SEU CLUBE\. SUA VISÃO/);
});

test('demo and peer storage restrictions remain explicit in normal visible career content', () => {
  const props = { latest: null, clubs: [], loading: false, pending: false, continueReason: 'Nenhum save disponível.', onContinue() {}, onNavigate() {} };
  assert.match(render(CareerOverview, { ...props, identity: identity('demo') }), /não é um save persistido na conta/);
  const peer = render(CareerOverview, { ...props, identity: identity('peer') });
  assert.match(peer, /save permanece no computador dele/);
  assert.match(peer, /Conectar ao anfitrião/);
  assert.match(peer, /Nenhum save disponível/);
});

test('Editor keeps access/safety before disclosures and preserves import confirmations without false actions', () => {
  const html = render(EditorAvailabilityPage, { identity: identity(), onOpen() {} });
  assert.ok(html.indexOf('Abrir Editor') < html.indexOf('<details'));
  assert.ok(html.indexOf('saves existentes mantêm sua base') < html.indexOf('<details'));
  assert.match(html, /<summary><span>Importar uma base existente/);
  assert.match(html, /Recursos e backup|Expansões planejadas/);
  assert.match(html, /Jogadores e atributos|Ligas e torneios|backup JSON/);
  for (const mode of ['demo', 'peer']) {
    const unavailable = render(EditorAvailabilityPage, { identity: identity(mode), onOpen() {} });
    assert.match(unavailable, /Indisponível neste modo/);
    assert.doesNotMatch(unavailable, />Abrir Editor</);
  }
});

test('Multiplayer retains the actual create action and host save warning before optional instructions', () => {
  const html = render(MultiplayerPage, { identity: identity(), pending: false, onCreate() {} });
  assert.ok(html.indexOf('Criar carreira compartilhada') < html.indexOf('<details'));
  assert.ok(html.indexOf('save fica no computador do anfitrião') < html.indexOf('<details'));
  assert.match(html, /4, 6 ou 8 managers/);
  assert.match(html, /Matchmaking, descoberta pública e integração Steam\. Ainda não disponíveis/);
  assert.doesNotMatch(render(MultiplayerPage, { identity: identity('peer'), pending: false, onCreate() {} }), />Criar carreira compartilhada</);
});

test('pending operational alerts remain outside closed details and empty categories move inside', () => {
  const snapshot = central();
  snapshot.expiringContracts = { items: [{ message: 'Contrato de Aurora termina em 10 dias' }, { message: 'Contrato de Silva termina em 20 dias' }], empty: false, message: null };
  snapshot.staffAlerts = { items: [{ message: 'Comissão precisa de atenção' }], empty: false, message: null };
  const html = home({ room: room(snapshot) });
  const operations = html.slice(html.indexOf('<section class="panel central-operations-panel"'));
  const visible = operations.split('<details')[0];
  assert.match(visible, /Contrato de Aurora termina em 10 dias|Comissão precisa de atenção/);
  assert.match(visible, /Contrato de Silva termina em 20 dias/);
  assert.doesNotMatch(visible, /Negociações ativas|Obras em andamento/);
  assert.match(operations, /Áreas sem pendências/);
  assert.match(operations, /Negociações ativas|Obras em andamento/);
  assert.doesNotMatch(operations, />OK</);
});

test('empty and unknown operational data are not confused with a healthy measured status', () => {
  assert.match(home(), /Nenhuma pendência registrada/);
  const missing = home({ room: { ...room(), centralSnapshot: undefined } });
  assert.match(missing, /Pendências ainda não carregadas/);
  assert.match(missing, /6 ainda não carregadas/);
  assert.doesNotMatch(missing, /Nenhuma pendência registrada|>OK</);
});

test('zero badges and empty charts do not reserve space or imply measured healthy data', () => {
  const snapshot = central();
  snapshot.squad.injured = [];
  snapshot.squad.suspended = [];
  snapshot.finance.income = 0;
  snapshot.finance.expense = 0;
  const html = home({ room: room(snapshot) });
  assert.doesNotMatch(html, /class="availability-row"|0 lesionados|0 suspensos|Sem lesões ou suspensões/);
  assert.doesNotMatch(html, /class="cashflow-chart"|class="trend/);
  assert.match(html, /Sem movimentações financeiras registradas/);
  assert.match(html, /Receita|Despesa/);
});

test('dashboard retains real injuries, finances, objectives and unknown moral without technical decoration', () => {
  const snapshot = central();
  snapshot.objectives.items = [{ title: 'Classificar para a Libertadores', detail: 'Terminar entre os seis primeiros' }];
  const before = JSON.stringify(snapshot);
  const html = home({ room: room(snapshot) });
  assert.match(html, /1 lesionado|1 suspenso/);
  assert.match(html, /Moral não informada/);
  assert.doesNotMatch(html, /Vestiário sob pressão|DADOS PERSISTIDOS|DADOS FACTUAIS|MORAL E DISPONIBILIDADE|RADAR DO CLUBE|Bom jogo/);
  assert.match(html, /Não disponível/);
  assert.match(html, /Classificar para a Libertadores|Terminar entre os seis primeiros/);
  assert.match(html, /Ver agenda|Ir para a partida|Revisar plano|Editar|Ver elenco|Detalhes|Ver feed/);
  assert.equal(JSON.stringify(snapshot), before);
});

test('intro-only changes preserve tactical instructions and do not hide alerts with CSS', async () => {
  const [squad, tactics, market, layout, dashboard] = await Promise.all([
    readFile(new URL('../../src/views/SquadView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/views/TacticsView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/views/club/MarketView.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/layout.css', import.meta.url), 'utf8'),
    readFile(new URL('../../src/styles/dashboard.css', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(tactics, /PLANO DE JOGO · VERSÃO/);
  assert.doesNotMatch(market, /persistidos no save|MERCADO DA SALA · BASE COMPARTILHADA/);
  assert.match(squad, /rosterPlayers.length/);
  assert.match(tactics, /[Aa]rrast|[Dd]ois cliques/);
  assert.match(layout, /summary:focus-visible/);
  assert.match(layout, /prefers-reduced-motion/);
  assert.doesNotMatch(layout, /(?:\.form-error|\[role=["']?alert).*display:\s*none/);
  assert.match(dashboard, /\.central-operation-row \.central-operation-row__details small\s*\{[^}]*overflow: visible;[^}]*white-space: normal/);
});
