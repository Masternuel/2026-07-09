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

let vite;
let MatchFeed;
let MatchView;
let PressConferenceView;
let RoundResultsPanel;
let validateAckResponse;
let validateMatchServerError;
let validateMatchSocketPayload;
let validateMatchSpeedPayload;
let toClientMatchEvent;
let buildAvailableLineupIds;
let persistedTacticPlanForLineup;

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
  ({ MatchFeed } = await vite.ssrLoadModule("/src/components/match/MatchFeed.tsx"));
  ({ RoundResultsPanel } = await vite.ssrLoadModule("/src/components/match/RoundResultsPanel.tsx"));
  ({ MatchView } = await vite.ssrLoadModule("/src/views/MatchView.tsx"));
  ({ PressConferenceView } = await vite.ssrLoadModule("/src/views/PressConferenceView.tsx"));
  ({ toClientMatchEvent } = await vite.ssrLoadModule("/src/utils/matchEventAdapter.ts"));
  ({ buildAvailableLineupIds } = await vite.ssrLoadModule("/src/utils/playerRoster.ts"));
  ({ persistedTacticPlanForLineup } = await vite.ssrLoadModule("/src/utils/teamPlan.ts"));
  ({
    validateAckResponse,
    validateMatchServerError,
    validateMatchSocketPayload,
    validateMatchSpeedPayload,
  } = await vite.ssrLoadModule("/src/hooks/useServerMatch.ts"));
});

after(async () => {
  await vite?.close();
});

test("feed usa evento informativo quando recebe kind futuro ou desconhecido", () => {
  const html = renderToStaticMarkup(React.createElement(MatchFeed, {
    events: [{ minute: 12, kind: "future-server-event", text: "Evento novo", score: [0, 0] }],
    finished: false,
  }));

  assert.match(html, /match-event--info/);
  assert.match(html, /Evento novo/);
});

test("feed normaliza texto, minuto e placar malformados", () => {
  const html = renderToStaticMarkup(React.createElement(MatchFeed, {
    events: [{
      minute: { legacy: true },
      kind: "goal-home",
      text: { legacy: true },
      score: [{ legacy: true }, 1],
    }],
    finished: true,
  }));

  assert.match(html, />00′</);
  assert.match(html, /Evento da partida/);
  assert.doesNotMatch(html, /<strong>/);
});

test("adapter preserva duracao estruturada da lesao", () => {
  const event = toClientMatchEvent({
    code: "BOLA-SAFE",
    matchId: "match-safe",
    fixtureId: "rodada-1",
    id: "evt-injury",
    minute: 64,
    type: "injury",
    text: "Jogador recebe atendimento.",
    score: [1, 0],
    statistics: { home: {}, away: {} },
    side: "home",
    playerId: "player-1",
    severity: "moderate",
    injuryMatches: 2,
    skipped: false,
  }, "Aurora FC");

  assert.equal(event.kind, "injury");
  assert.equal(event.playerId, "player-1");
  assert.equal(event.severity, "moderate");
  assert.equal(event.injuryMatches, 2);
});

test("adapter nao atribui gol a um lado quando o servidor omite lado e mandante", () => {
  const event = toClientMatchEvent({
    code: "BOLA-SAFE",
    matchId: "match-safe",
    fixtureId: "legacy",
    id: "evt-goal",
    minute: 19,
    type: "goal",
    text: "Gol sem metadados de equipe.",
    score: [1, 0],
    statistics: { home: {}, away: {} },
    skipped: false,
  });

  assert.equal(event.kind, "info");
  assert.equal(event.side, undefined);
});

test("intervalo remove indisponiveis da escalação preferida sem recoloca-los para completar", () => {
  const roster = Array.from({ length: 13 }, (_, index) => ({
    id: `player-${index + 1}`,
    status: "Disponível",
    injuryMatches: 0,
    suspensionMatches: 0,
  }));
  roster[0].status = "Lesionado";
  roster[1].suspensionMatches = 1;

  const lineupIds = buildAvailableLineupIds(roster, roster.map((player) => player.id));

  assert.equal(lineupIds.length, 11);
  assert.doesNotMatch(lineupIds.join("|"), /player-1(?:\||$)|player-2(?:\||$)/);
  assert.deepEqual(lineupIds, roster.slice(2).map((player) => player.id));
});

test("plano tatico ausente permanece desconhecido em vez de virar o padrao", () => {
  assert.equal(persistedTacticPlanForLineup(undefined), null);
  assert.equal(persistedTacticPlanForLineup({ lineupIds: [] }), null);
});

test("painel da rodada tolera resumo legado sem matches", () => {
  const html = renderToStaticMarkup(React.createElement(RoundResultsPanel, {
    summary: {
      leagueId: "BR-A",
      competition: "Brasileirao",
      round: 2,
      seasonNumber: 1,
      seasonYear: 2026,
      complete: false,
    },
  }));

  assert.match(html, /Resultados da rodada 2/);
  assert.match(html, /Nenhum jogo encontrado nesta rodada/);
});

test("painel da rodada nao envia escalares malformados ao React", () => {
  const html = renderToStaticMarkup(React.createElement(RoundResultsPanel, {
    summary: {
      competition: { legacy: true },
      round: { legacy: true },
      seasonNumber: null,
      seasonYear: [],
      complete: false,
      matches: [],
    },
  }));

  assert.match(html, /Resultados da rodada 1/);
  assert.match(html, /Competi/);
  assert.match(html, /Temporada 1/);
});

test("coletiva tolera statistics, home e away ausentes", () => {
  const html = renderToStaticMarkup(React.createElement(PressConferenceView, {
    result: {
      code: "BOLA-SAFE",
      id: "legacy-result",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      score: [1, 0],
      statistics: { home: null },
      skipped: false,
    },
    club,
    onComplete: () => {},
  }));

  assert.match(html, /Sala de imprensa/);
  assert.match(html, /0 a 0 finaliza/);
  assert.match(html, /Pergunta 1 de 3/);
});

test("tela do intervalo tolera arrays e estatisticas ausentes", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    club,
    managerId: "manager-1",
    room: {
      code: "BOLA-SAFE",
      ownerId: "manager-1",
      currentFixtureId: "rodada-1",
      fixtureSchedule: [{
        fixtureId: "rodada-1",
        round: 1,
        competition: "Brasileirao",
        homeClubId: "AUR",
        awayClubId: "SAN",
        homeTeam: "Aurora FC",
        awayTeam: "Santos",
      }],
    },
    onlineMatch: {
      connected: true,
      phase: "halftime",
      match: {
        id: "match-safe",
        fixtureId: "rodada-1",
        homeTeam: "Aurora FC",
        awayTeam: "Santos",
      },
      statistics: {},
      result: null,
      halftime: { status: "paused" },
      error: null,
    },
  }));

  assert.match(html, /Partida pausada para ajustes/);
  assert.match(html, /Sincronizando os participantes do intervalo/);
  assert.match(html, /Estat[ií]sticas ainda n[aã]o dispon[ií]veis/);
  assert.doesNotMatch(html, /class="stat-row"/);
  assert.doesNotMatch(html, /MOMENTO DA PARTIDA|momentum-bars/);
});

test("partida renderiza somente estatisticas recebidas do servidor", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    club,
    managerId: "manager-1",
    room: {
      code: "BOLA-STATS",
      ownerId: "manager-1",
      currentFixtureId: "rodada-2",
      fixtureSchedule: [{
        fixtureId: "rodada-2",
        round: 2,
        competition: "Liga Nacional",
        homeClubId: "AUR",
        awayClubId: "RIV",
        homeTeam: "Aurora FC",
        awayTeam: "Rivais FC",
      }],
    },
    onlineMatch: {
      connected: true,
      phase: "running",
      match: {
        id: "match-stats",
        fixtureId: "rodada-2",
        homeTeam: "Aurora FC",
        awayTeam: "Rivais FC",
      },
      events: [],
      statistics: {
        home: { possession: 40, shots: 2, shotsOnTarget: 1, corners: 0, fouls: 5 },
        away: { possession: 60, shots: 6, shotsOnTarget: 3, corners: 4, fouls: 5 },
      },
      score: [0, 0],
      result: null,
      halftime: null,
      speed: { rate: 1 },
      speedPending: null,
      error: null,
    },
  }));

  assert.match(html, /<strong>40%<\/strong><span>Posse<\/span><strong>60%<\/strong>/);
  assert.match(html, /<strong>2<\/strong><span>Finaliza[cç][oõ]es<\/span><strong>6<\/strong>/);
  assert.match(html, /style="width:25%"/);
  assert.doesNotMatch(html, /Estat[ií]sticas ainda n[aã]o dispon[ií]veis|MOMENTO DA PARTIDA|momentum-bars/);
});

test("partida sem identidade autoritativa usa rotulos indisponiveis, nunca clubes demo", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    club,
    room: { code: "BOLA-LEGACY", ownerId: "manager-1", fixtureSchedule: [] },
    onlineMatch: {
      connected: true,
      phase: "running",
      match: { id: "legacy-match" },
      events: [],
      statistics: null,
      score: [0, 0],
      result: null,
      halftime: null,
      speed: { rate: 1 },
      speedPending: null,
      error: null,
    },
  }));

  assert.match(html, /Mandante/);
  assert.match(html, /Visitante/);
  assert.match(html, /Competi[cç][aã]o a definir/i);
  assert.match(html, /Rodada a definir/i);
  assert.match(html, /Press[aã]o <strong>A confirmar<\/strong>/i);
  assert.match(html, /Ritmo <strong>A confirmar<\/strong>/i);
  assert.doesNotMatch(html, /Aurora FC|Santos|Brasileir[aã]o|Rodada 1|4-3-3|Press[aã]o intensa|R[aá]pido/);
});

test("simulacao local exige flag demo explicita", () => {
  const baseProps = {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    club,
    room: null,
    onlineMatch: null,
  };
  const productionHtml = renderToStaticMarkup(React.createElement(MatchView, baseProps));
  const demoHtml = renderToStaticMarkup(React.createElement(MatchView, { ...baseProps, demoMode: true }));

  assert.match(productionHtml, /Nenhuma partida autoritativa em andamento/);
  assert.doesNotMatch(productionHtml, /Demonstra[cç][aã]o determin[ií]stica|cad[eê]ncia: 800 ms|Aurora FC|Santos/);
  assert.match(demoHtml, /Demonstra[cç][aã]o determin[ií]stica em andamento/);
  assert.match(demoHtml, /modo demo expl[ií]cito/);
});

test("sincronizacao normaliza events ausente antes de mapear o feed", async () => {
  const source = await readFile(path.join(projectRoot, "src/hooks/useServerMatch.ts"), "utf8");
  assert.match(source, /setRawEvents\(safeServerEvents\(synced\.events\)\)/);
  assert.match(source, /Array\.isArray\(value\)/);
});

test("todos os callbacks Socket validam payload antes de acessar estado", async () => {
  const source = await readFile(path.join(projectRoot, "src/hooks/useServerMatch.ts"), "utf8");
  assert.equal((source.match(/validateMatchSocketPayload\(value, room\?\.code/g) ?? []).length, 5);
  assert.match(source, /validateMatchSpeedPayload\(value, room\?\.code, activeMatchId\)/);
  assert.match(source, /validateMatchServerError\(value\)/);
});

test("validadores descartam envelopes Socket incompletos sem lancar", () => {
  const invalidEnvelopes = [
    null,
    undefined,
    42,
    "payload",
    [],
    {},
    { code: "BOLA-SAFE" },
    { code: "OUTRA-SALA", id: "match-1" },
    { code: "BOLA-SAFE", id: { legacy: true } },
  ];

  for (const payload of invalidEnvelopes) {
    assert.doesNotThrow(() => validateMatchSocketPayload(payload, "BOLA-SAFE", ["id"]));
    assert.equal(validateMatchSocketPayload(payload, "BOLA-SAFE", ["id"]), null);
  }

  assert.equal(
    validateMatchSocketPayload({ code: "BOLA-SAFE", id: "match-1" }, "BOLA-SAFE", ["id"]).id,
    "match-1",
  );

  const invalidErrors = [
    null,
    {},
    { event: { legacy: true } },
    { event: "match:start", error: null },
    { event: "match:start", error: { message: { legacy: true } } },
  ];
  for (const payload of invalidErrors) {
    assert.doesNotThrow(() => validateMatchServerError(payload));
    assert.equal(validateMatchServerError(payload), null);
  }

  assert.deepEqual(
    validateMatchServerError({ event: "match:start", error: { message: "Falhou" } }),
    { event: "match:start", message: "Falhou" },
  );
  assert.equal(validateMatchSpeedPayload({
    code: "BOLA-SAFE",
    matchId: "match-1",
    rate: { legacy: true },
  }, "BOLA-SAFE", "match-1"), null);
  assert.equal(validateMatchSpeedPayload({
    code: "BOLA-SAFE",
    matchId: "match-antigo",
    rate: 2,
  }, "BOLA-SAFE", "match-1"), null);
});

test("ACK nulo ou malformado vira erro controlado", () => {
  for (const payload of [null, undefined, 12, {}, { ok: false }, { ok: false, error: null }]) {
    assert.doesNotThrow(() => validateAckResponse(payload));
    assert.deepEqual(validateAckResponse(payload), {
      ok: false,
      message: "O servidor enviou uma resposta inválida.",
    });
  }

  assert.deepEqual(validateAckResponse({ ok: false, error: { message: "Falha conhecida" } }), {
    ok: false,
    message: "Falha conhecida",
  });
  assert.deepEqual(validateAckResponse({ ok: true, matchId: "match-1" }), {
    ok: true,
    value: { ok: true, matchId: "match-1" },
  });
});
