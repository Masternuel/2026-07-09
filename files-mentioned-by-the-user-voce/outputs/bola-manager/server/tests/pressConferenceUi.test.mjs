import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
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

const result = {
  code: "BOLA-TEST",
  id: "match-1",
  fixtureId: "abertura",
  homeTeam: "Aurora FC",
  awayTeam: "Palmeiras",
  score: [2, 1],
  statistics: {
    home: { possession: 57, shots: 12, shotsOnTarget: 6, fouls: 9, yellowCards: 1, redCards: 0, corners: 5 },
    away: { possession: 43, shots: 8, shotsOnTarget: 3, fouls: 12, yellowCards: 2, redCards: 0, corners: 3 },
  },
  events: [],
  skipped: false,
};

let vite;
let MatchView;
let PressConferenceView;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MatchView } = await vite.ssrLoadModule("/src/views/MatchView.tsx"));
  ({ PressConferenceView } = await vite.ssrLoadModule("/src/views/PressConferenceView.tsx"));
});

after(async () => {
  await vite?.close();
});

test("finished managed match exposes press-conference action", () => {
  const room = {
    id: "room-1",
    code: "BOLA-TEST",
    name: "Teste",
    ownerId: "manager-1",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 2,
    createdAt: "2026-07-12T00:00:00.000Z",
    startedAt: "2026-07-12T00:00:00.000Z",
    revision: 2,
    currentFixtureId: "rodada-2",
    completedFixtureIds: ["abertura"],
    managers: [{ id: "manager-1", name: "Emanuel", clubId: "AUR", ready: true, joinedAt: "2026-07-12T00:00:00.000Z" }],
    fixtureSchedule: [{
      fixtureId: "abertura",
      round: 1,
      competition: "Brasileirao",
      homeClubId: "AUR",
      awayClubId: "PAL",
      homeTeam: "Aurora FC",
      awayTeam: "Palmeiras",
      homeManagerId: "manager-1",
      awayManagerId: null,
      managerIds: ["manager-1"],
    }],
  };
  const onlineMatch = {
    connected: true,
    phase: "finished",
    match: { code: result.code, id: result.id, fixtureId: result.fixtureId, homeTeam: result.homeTeam, awayTeam: result.awayTeam, eventCount: 0, delayMs: 0 },
    events: [],
    statistics: result.statistics,
    score: result.score,
    result,
    error: null,
    readyPending: false,
    start: async () => {},
    setReady: async () => {},
    skip: async () => {},
    reset: () => {},
  };

  const html = renderToStaticMarkup(React.createElement(MatchView, {
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch,
    room,
    club,
  }));

  assert.match(html, /Ir para a coletiva/);
  assert.match(html, /A imprensa j[aá]+ prepara a coletiva p[oó]+s-jogo\./i);
});

test("press-conference view renders first interactive question from match result", () => {
  const html = renderToStaticMarkup(React.createElement(PressConferenceView, {
    result,
    club,
    onComplete: () => {},
  }));

  assert.match(html, /Sala de imprensa/);
  assert.match(html, /Pergunta 1 de [1-9][0-9]*/);
  assert.match(html, /Aurora FC/);
  assert.match(html, /Palmeiras/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.match(html, /Confirmar resposta/);
});
