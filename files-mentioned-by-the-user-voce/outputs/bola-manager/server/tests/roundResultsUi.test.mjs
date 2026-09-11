import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const statistics = {
  home: { possession: 54, shots: 10, shotsOnTarget: 5, fouls: 8, yellowCards: 1, redCards: 0, corners: 4 },
  away: { possession: 46, shots: 7, shotsOnTarget: 3, fouls: 10, yellowCards: 2, redCards: 0, corners: 2 },
};

function roundMatch(overrides) {
  return {
    id: "result-aur-san",
    fixtureId: "league-r3-aur-san",
    leagueFixtureId: "league-r3-aur-san",
    source: "manager",
    homeClubId: "AUR",
    awayClubId: "SAN",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeCode: "AUR",
    awayCode: "SAN",
    homeColor: "#c8ff3d",
    awayColor: "#eeeeee",
    homeDarkThemeColor: "#c8ff3d",
    homeLightThemeColor: "#557500",
    awayDarkThemeColor: "#eeeeee",
    awayLightThemeColor: "#222222",
    homeCrestImageUrl: "/assets/aurora.png",
    awayCrestImageUrl: null,
    score: [2, 1],
    completedAt: "2026-07-16T20:00:00.000Z",
    seasonNumber: 1,
    seasonYear: 2026,
    ...overrides,
  };
}

const roundSummary = {
  leagueId: "BR-A",
  competition: "Brasileirão Série A",
  round: 3,
  seasonNumber: 1,
  seasonYear: 2026,
  complete: false,
  matches: [
    roundMatch({}),
    roundMatch({
      id: "result-pal-fla",
      fixtureId: "league-r3-pal-fla",
      leagueFixtureId: "league-r3-pal-fla",
      source: "ai",
      homeClubId: "PAL",
      awayClubId: "FLA",
      homeTeam: "Palmeiras",
      awayTeam: "Flamengo",
      homeCode: "PAL",
      awayCode: "FLA",
      homeColor: "#159761",
      awayColor: "#c4122f",
      homeCrestImageUrl: null,
      awayCrestImageUrl: "/assets/flamengo.png",
      score: [0, 0],
    }),
    roundMatch({
      id: "result-cor-cru",
      fixtureId: "league-r3-cor-cru",
      leagueFixtureId: "league-r3-cor-cru",
      source: "ai",
      homeClubId: "COR",
      awayClubId: "CRU",
      homeTeam: "Corinthians",
      awayTeam: "Cruzeiro",
      homeCode: "COR",
      awayCode: "CRU",
      homeColor: "#f1f1f1",
      awayColor: "#1655a2",
      homeCrestImageUrl: null,
      awayCrestImageUrl: null,
      score: null,
      completedAt: null,
    }),
  ],
};

const club = {
  id: "AUR",
  name: "Aurora FC",
  code: "AUR",
  city: "São Paulo, SP",
  stars: 4,
  budget: "R$ 72 mi",
  color: "#c8ff3d",
};

const room = {
  id: "room-round-results",
  code: "BOLA-R003",
  name: "Rodada completa",
  ownerId: "manager-1",
  status: "active",
  activeLeagues: ["BR-A"],
  seasonLength: 1,
  unlimitedSeasons: false,
  currentSeason: 1,
  seasonYear: 2026,
  seasonStartedAt: "2026-07-16T00:00:00.000Z",
  seasonHistory: [],
  careerCompleted: false,
  maxManagers: 1,
  createdAt: "2026-07-16T00:00:00.000Z",
  startedAt: "2026-07-16T00:00:00.000Z",
  revision: 4,
  currentFixtureId: "rodada-4",
  completedFixtureIds: ["managed-r3"],
  managers: [{ id: "manager-1", name: "Emanuel", clubId: "AUR", ready: true, joinedAt: "2026-07-16T00:00:00.000Z" }],
  fixtureSchedule: [{
    fixtureId: "managed-r3",
    leagueFixtureId: "league-r3-aur-san",
    round: 3,
    competition: "Brasileirão Série A",
    leagueId: "BR-A",
    homeClubId: "AUR",
    awayClubId: "SAN",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeManagerId: "manager-1",
    awayManagerId: null,
    managerIds: ["manager-1"],
  }],
};

function finishedController(withSummary) {
  const result = {
    code: room.code,
    id: "managed-match-r3",
    fixtureId: "managed-r3",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    score: [2, 1],
    statistics,
    events: [],
    skipped: false,
    ...(withSummary ? { roundSummary } : {}),
  };
  return {
    connected: true,
    phase: "finished",
    match: null,
    events: [],
    statistics,
    score: result.score,
    result,
    halftime: null,
    speed: null,
    error: null,
    readyPending: false,
    halftimePending: null,
    speedPending: null,
    start: async () => {},
    setSpeed: async () => {},
    setReady: async () => {},
    saveLineup: async () => {},
    saveHalftimePlan: async () => {},
    setHalftimeReady: async () => {},
    skip: async () => {},
    reset: () => {},
  };
}

let vite;
let MatchView;
let RoundResultsPanel;
let buildSeasonTable;

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
  ({ RoundResultsPanel } = await vite.ssrLoadModule("/src/components/match/RoundResultsPanel.tsx"));
  ({ buildSeasonTable } = await vite.ssrLoadModule("/src/utils/leagueStandings.ts"));
});

after(async () => {
  await vite?.close();
});

test("painel mostra jogos de managers e IA, pendencia, escudos e destaque do clube", () => {
  const html = renderToStaticMarkup(React.createElement(RoundResultsPanel, {
    summary: roundSummary,
    managedClubIds: ["AUR"],
  }));

  assert.match(html, /Resultados da rodada 3/);
  assert.match(html, /Brasileir[aã]o S[eé]rie A/);
  assert.match(html, /Em andamento/);
  assert.match(html, /> Managers</);
  assert.match(html, /> IA</);
  assert.match(html, /Pendente/);
  assert.match(html, /Seu jogo/);
  assert.match(html, /round-result--managed/);
  assert.match(html, /club-mark--image/);
  assert.match(html, /assets\/aurora\.png/);
  assert.match(html, /assets\/flamengo\.png/);
  assert.equal((html.match(/class="round-result(?: |")/g) ?? []).length, 3);

  const completeHtml = renderToStaticMarkup(React.createElement(RoundResultsPanel, {
    summary: { ...roundSummary, complete: true, matches: roundSummary.matches.slice(0, 2) },
  }));
  assert.match(completeHtml, /Rodada conclu[ií]da/);
});

test("partida encerrada exibe resumo antes da coletiva e legado continua funcional", () => {
  const html = renderToStaticMarkup(React.createElement(MatchView, {
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: finishedController(true),
    room,
    club,
    managerId: "manager-1",
  }));
  assert.match(html, /Resultados da rodada 3/);
  assert.match(html, /Ir para a coletiva/);
  assert.ok(html.indexOf("Resultados da rodada 3") < html.indexOf("APITO FINAL"));

  const legacyHtml = renderToStaticMarkup(React.createElement(MatchView, {
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: finishedController(false),
    room,
    club,
    managerId: "manager-1",
  }));
  assert.match(legacyHtml, /APITO FINAL/);
  assert.match(legacyHtml, /Ir para a coletiva/);
  assert.doesNotMatch(legacyHtml, /Resultados da rodada/);
});

test("classificacao usa resultados completos da liga, inclui IA e nao duplica jogo humano", () => {
  const clubs = [
    { id: "AUR", name: "Aurora FC", code: "AUR", color: "#c8ff3d", reputation: 15, crestImageUrl: null, leagueId: "BR-A" },
    { id: "SAN", name: "Santos", code: "SAN", color: "#eeeeee", reputation: 15, crestImageUrl: null, leagueId: "BR-A" },
    { id: "PAL", name: "Palmeiras", code: "PAL", color: "#159761", reputation: 15, crestImageUrl: null, leagueId: "BR-A" },
    { id: "FLA", name: "Flamengo", code: "FLA", color: "#c4122f", reputation: 15, crestImageUrl: null, leagueId: "BR-A" },
  ];
  const leagueFixtureSchedule = [
    { leagueFixtureId: "league-r3-aur-san", leagueId: "BR-A", round: 3, homeClubId: "AUR", awayClubId: "SAN" },
    {
      leagueFixtureId: "league-r3-pal-fla",
      leagueId: "BR-A",
      round: 3,
      homeClubId: "PAL",
      awayClubId: "FLA",
    },
  ];
  const standingsRoom = {
    ...room,
    competitionCatalog: [{ id: "BR-A", name: "Brasileirão Série A", country: "Brasil", division: "Série A", clubs }],
    leagueFixtureSchedule,
    leagueMatchResults: [
      { leagueFixtureId: "league-r3-aur-san", score: [2, 1] },
      { leagueFixtureId: "league-r3-pal-fla", score: [0, 0] },
    ],
    completedMatches: [{
      code: room.code,
      id: "legacy-duplicate",
      fixtureId: "managed-r3",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      score: [2, 1],
      statistics,
      skipped: false,
    }],
  };

  const table = buildSeasonTable(standingsRoom, "BR-A");
  const aurora = table.find((team) => team.clubId === "AUR");
  const santos = table.find((team) => team.clubId === "SAN");
  const palmeiras = table.find((team) => team.clubId === "PAL");
  const flamengo = table.find((team) => team.clubId === "FLA");

  assert.deepEqual({ played: aurora.played, wins: aurora.wins, points: aurora.points }, { played: 1, wins: 1, points: 3 });
  assert.deepEqual({ played: santos.played, losses: santos.losses, points: santos.points }, { played: 1, losses: 1, points: 0 });
  assert.deepEqual({ played: palmeiras.played, draws: palmeiras.draws, points: palmeiras.points }, { played: 1, draws: 1, points: 1 });
  assert.deepEqual({ played: flamengo.played, draws: flamengo.draws, points: flamengo.points }, { played: 1, draws: 1, points: 1 });

  const fallbackTable = buildSeasonTable({
    ...standingsRoom,
    leagueFixtureSchedule: undefined,
    leagueMatchResults: [{ leagueFixtureId: "league-r3-aur-san", score: [2, 1] }],
  }, "BR-A");
  assert.equal(fallbackTable.find((team) => team.clubId === "AUR").played, 1);
  assert.equal(fallbackTable.find((team) => team.clubId === "PAL").played, 0);
});
