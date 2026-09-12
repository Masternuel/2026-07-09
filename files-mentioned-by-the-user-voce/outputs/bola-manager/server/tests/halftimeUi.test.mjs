import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const club = {
  id: "AUR",
  name: "Aurora FC",
  code: "AUR",
  city: "Sao Paulo, SP",
  stars: 4,
  budget: "R$ 72 mi",
  color: "#c8ff3d",
};

const players = Array.from({ length: 14 }, (_, index) => ({
  id: `aur-${index + 1}`,
  name: `Jogador ${index + 1}`,
  shortName: `J. ${index + 1}`,
  number: index + 1,
  position: index === 0 ? "GOL" : "MC",
  age: 24,
  nationality: "BRA",
  value: "R$ 1 mi",
  salary: "R$ 50 mil",
  condition: 100,
  morale: "Boa",
  status: "Disponivel",
  isStar: false,
}));

const room = {
  id: "room-halftime",
  code: "BOLA-HT45",
  name: "Intervalo multiplayer",
  ownerId: "manager-1",
  status: "active",
  activeLeagues: ["BR-A"],
  seasonLength: 1,
  unlimitedSeasons: false,
  currentSeason: 1,
  seasonYear: 2026,
  seasonHistory: [],
  careerCompleted: false,
  maxManagers: 3,
  createdAt: "2026-07-14T00:00:00.000Z",
  startedAt: "2026-07-14T00:00:00.000Z",
  revision: 3,
  currentFixtureId: "abertura",
  completedFixtureIds: [],
  completedMatches: [],
  matchReadiness: { fixtureId: "abertura", managerIds: ["manager-1", "manager-2", "spectator"] },
  lineups: [{ managerId: "manager-1", clubId: "AUR", lineupIds: players.slice(0, 11).map((player) => player.id) }],
  managers: [
    { id: "manager-1", name: "Emanuel", clubId: "AUR", ready: true, joinedAt: "2026-07-14T00:00:00.000Z" },
    { id: "manager-2", name: "Rival", clubId: "SAN", ready: true, joinedAt: "2026-07-14T00:00:00.000Z" },
    { id: "spectator", name: "Espectador", clubId: "PAL", ready: true, joinedAt: "2026-07-14T00:00:00.000Z" },
  ],
  fixtureSchedule: [{
    fixtureId: "abertura",
    round: 1,
    competition: "Brasileirao",
    homeClubId: "AUR",
    awayClubId: "SAN",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeManagerId: "manager-1",
    awayManagerId: "manager-2",
    managerIds: ["manager-1", "manager-2"],
  }],
};

function controllerFor(managerId, readyManagerIds = [], rate = 1) {
  const speed = {
    code: room.code,
    matchId: "match-halftime",
    rate,
    baseDelayMs: 800,
    effectiveDelayMs: 800 / rate,
    changedBy: rate === 1 ? null : "manager-1",
    changedAt: rate === 1 ? null : "2026-07-14T12:00:00.000Z",
  };
  return {
    connected: true,
    phase: "halftime",
    match: {
      code: room.code,
      id: "match-halftime",
      fixtureId: "abertura",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      eventCount: 12,
      delayMs: 0,
      speed,
    },
    events: [{ minute: 45, kind: "whistle", text: "Fim do primeiro tempo.", score: [0, 0] }],
    statistics: null,
    score: [0, 0],
    result: null,
    speed,
    halftime: {
      code: room.code,
      matchId: "match-halftime",
      fixtureId: "abertura",
      status: "paused",
      requiredManagerIds: ["manager-1", "manager-2"],
      readyManagerIds,
      readyCount: readyManagerIds.length,
      requiredCount: 2,
      allReady: false,
      plansSavedManagerIds: [],
      substitutionCounts: { "manager-1": 0, "manager-2": 0 },
      participant: managerId !== "spectator",
      ownPlan: null,
    },
    error: null,
    readyPending: false,
    halftimePending: null,
    speedPending: null,
    start: async () => {},
    setSpeed: async () => speed,
    setReady: async () => {},
    saveLineup: async () => {},
    saveHalftimePlan: async () => {},
    setHalftimeReady: async () => ({ halftime: null }),
    skip: async () => {},
    reset: () => {},
  };
}

function speedButton(html, ratePattern) {
  const button = html.match(new RegExp(
    `<button(?=[^>]*aria-label="[^"]*${ratePattern}[^"]*")[^>]*>`,
    "i",
  ))?.[0];
  assert.ok(button, `controle de velocidade ausente: ${ratePattern}`);
  return button;
}

function speedFieldset(html) {
  const fieldset = html.match(/<fieldset(?=[^>]*class="match-speed-control")[^>]*>/i)?.[0];
  assert.ok(fieldset, "grupo de velocidade ausente");
  return fieldset;
}

let vite;
let MatchView;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MatchView } = await vite.ssrLoadModule("/src/views/MatchView.tsx"));
});

after(async () => {
  await vite?.close();
});

test("painel de intervalo permanece no fluxo e opaco ao rolar a partida", async () => {
  const [matchCss, responsiveCss] = await Promise.all([
    readFile(path.join(projectRoot, "src/styles/match.css"), "utf8"),
    readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8"),
  ]);
  const panelRules = [matchCss, responsiveCss].flatMap((css) => (
    [...css.matchAll(/(?:^|\n)\s*\.halftime-panel\s*\{([^}]*)\}/g)].map((match) => match[1])
  ));

  assert.match(panelRules[0] ?? "", /position:\s*relative/);
  assert.match(panelRules[0] ?? "", /background-color:\s*var\(--panel\)/);
  for (const rule of panelRules) {
    assert.doesNotMatch(rule, /position:\s*(?:sticky|fixed|absolute)/);
    assert.doesNotMatch(rule, /(?:^|;)\s*(?:top|inset-block-start)\s*:/);
  }
});

test("manager da partida recebe painel de intervalo e controles de pronto", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players,
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: controllerFor("manager-1"),
    room,
    club,
    managerId: "manager-1",
    savedLineupIds: players.slice(0, 11).map((player) => player.id),
  }));

  assert.match(html, /INTERVALO · 45/);
  assert.match(html, /Partida pausada para ajustes/);
  assert.match(html, /Emanuel \(voc[eê]\)/i);
  assert.match(html, /Rival/);
  assert.match(html, /0\/2 prontos/);
  assert.match(html, /Fazer substitui[cç][aã]o/i);
  assert.match(html, /Ajustar t[aá]tica/i);
  assert.match(html, /Equilibrada/);
  assert.match(html, /Manter plano atual/);
  assert.match(html, /Estou pronto para o 2/);
});

test("manager espectador acompanha o intervalo sem bloquear ou editar", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players,
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: controllerFor("spectator", ["manager-1"]),
    room,
    club,
    managerId: "spectator",
  }));

  assert.match(html, /1\/2 prontos/);
  assert.match(html, /Voc[eê] est[aá] acompanhando esta partida/i);
  assert.match(html, /Somente os managers dos clubes em campo/i);
  assert.doesNotMatch(html, /Estou pronto para o 2/);
});

test("owner controla as quatro velocidades durante o intervalo", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players,
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: controllerFor("manager-1", [], 2),
    room,
    club,
    managerId: "manager-1",
    savedLineupIds: players.slice(0, 11).map((player) => player.id),
  }));

  assert.match(html, /INTERVALO[^0-9]*45/);
  assert.match(html, /<legend>Velocidade da simula/i);
  assert.doesNotMatch(speedFieldset(html), /disabled/i);
  const half = speedButton(html, "x0[,.]5");
  const normal = speedButton(html, "x1");
  const double = speedButton(html, "x2");
  const triple = speedButton(html, "x3");
  assert.match(half, /aria-pressed="false"/);
  assert.match(normal, /aria-pressed="false"/);
  assert.match(double, /aria-pressed="true"/);
  assert.match(triple, /aria-pressed="false"/);
  for (const button of [half, normal, double, triple]) assert.doesNotMatch(button, /disabled/);
});

test("manager nao-owner ve a velocidade mas nao pode altera-la", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players,
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: controllerFor("manager-2", [], 3),
    room,
    club,
    managerId: "manager-2",
    savedLineupIds: players.slice(0, 11).map((player) => player.id),
  }));

  const buttons = [
    speedButton(html, "x0[,.]5"),
    speedButton(html, "x1"),
    speedButton(html, "x2"),
    speedButton(html, "x3"),
  ];
  assert.match(speedFieldset(html), /disabled/i);
  assert.match(buttons[3], /aria-pressed="true"/);
  assert.match(html, /criador da sala/i);
});
