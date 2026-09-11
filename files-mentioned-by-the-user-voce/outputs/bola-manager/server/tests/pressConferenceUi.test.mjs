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
let buildPressConferenceQuestions;
let questionBank;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ MatchView } = await vite.ssrLoadModule("/src/views/MatchView.tsx"));
  ({ PressConferenceView, buildPressConferenceQuestions } = await vite.ssrLoadModule("/src/views/PressConferenceView.tsx"));
  questionBank = await vite.ssrLoadModule("/src/data/pressConferenceQuestionBank.ts");
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

test("coletiva sem resultado real exibe estado vazio e nunca inventa partida", () => {
  const html = renderToStaticMarkup(React.createElement(PressConferenceView, {
    result: null,
    club,
    onComplete: () => {},
  }));

  assert.match(html, /Nenhuma coletiva pendente/);
  assert.doesNotMatch(html, /Aurora FC|demo-match|Resultado final/);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 0);
});

test("coletiva gera as tres perguntas e IDs de resposta aceitos pelo servidor", () => {
  const questions = buildPressConferenceQuestions(result, club);
  assert.deepEqual(questions.map((question) => question.id), ["result", "possession", "performance"]);
  assert.equal(questions.length, 3);
  assert.equal(questions.every((question) => question.answers.length === 3), true);
  assert.equal(questions.flatMap((question) => question.answers).every((answer) => Boolean(answer.id)), true);
});

test("coletiva possui pelo menos cem perguntas locais distintas", () => {
  const prompts = Object.values(questionBank.PRESS_CONFERENCE_PROMPT_BANK).flat();
  assert.equal(questionBank.PRESS_CONFERENCE_PROMPT_COUNT, prompts.length);
  assert.equal(prompts.length >= 100, true);
  assert.equal(new Set(prompts).size, prompts.length);
  for (const category of ["result", "possession", "performance"]) {
    const rendered = questionBank.selectPressConferencePrompt(category, "partida-segura", {
      scoreline: "vitoria por 2 a 1",
      rival: "Rival FC",
      club: "Bola FC",
      possession: 55,
      rivalPossession: 45,
      shots: 12,
      shotsOnTarget: 6,
      fouls: 10,
      cards: 2,
    });
    assert.doesNotMatch(rendered, /\{[a-zA-Z]+\}/);
    assert.doesNotMatch(rendered, /(?:Ã.|Â.)/u);
  }
});

test("coletiva acumula respostas, bloqueia envio duplo e preserva erro para tentar novamente", async () => {
  const source = await readFile(path.join(projectRoot, "src/views/PressConferenceView.tsx"), "utf8");
  assert.match(source, /confirmedAnswers/);
  assert.match(source, /const answers = \[\.\.\.confirmedAnswers, answer\]/);
  assert.match(source, /submitLock\.current/);
  assert.match(source, /await onSubmit\?\.\(answers\)/);
  assert.match(source, /setSubmitError\(error instanceof Error/);
  assert.match(source, /role="alert"/);
  assert.match(source, /loading=\{submitting\}/);
});

test("App envia match e respostas autenticadas e atualiza o elenco apos sucesso", async () => {
  const source = await readFile(path.join(projectRoot, "src/App.tsx"), "utf8");
  assert.match(source, /\/api\/news\/\$\{encodeURIComponent\(roomCode\)\}\/press-conferences/);
  assert.match(source, /body: \{ matchId: onlineMatch\.result\.id, answers \}/);
  assert.match(source, /playerCatalog\.refresh\(\);/);
  assert.match(source, /pressConferenceToast\(response\)/);
  assert.match(source, /pressConferenceAlreadySubmitted/);
  assert.match(source, /submission\.managerId === auth\.identity\?\.uid/);
});

test("pulso e perfis exibem moraleScore sem confundir moral com condicao", async () => {
  const [homeSource, squadSource, profileSource] = await Promise.all([
    readFile(path.join(projectRoot, "src/views/HomeView.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/views/SquadView.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/components/rankings/RankingEntityProfiles.tsx"), "utf8"),
  ]);
  assert.match(homeSource, /averageMorale/);
  assert.match(homeSource, /pulse-score[^]*\{averageMorale \?\? ['"]—['"]\}/);
  assert.match(squadSource, /playerMoraleScore\(player\)/);
  assert.match(profileSource, /<dt>Condição<\/dt><dd>{displayNumber\(player\.condition, '%'\)}<\/dd>/);
  assert.match(profileSource, /<dt>Moral<\/dt><dd>{player\.morale/);
});
