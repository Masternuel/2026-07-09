import assert from "node:assert/strict";
import { after, before, test } from "node:test";
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

const room = {
  id: "room-round-one",
  code: "BOLA-R001",
  name: "Temporada nova",
  ownerId: "manager-1",
  status: "active",
  activeLeagues: ["BR-A"],
  seasonLength: 1,
  unlimitedSeasons: false,
  currentSeason: 1,
  seasonYear: 2026,
  seasonStartedAt: "2026-07-13T00:00:00.000Z",
  seasonHistory: [],
  careerCompleted: false,
  maxManagers: 1,
  createdAt: "2026-07-13T00:00:00.000Z",
  startedAt: "2026-07-13T00:00:00.000Z",
  revision: 2,
  currentFixtureId: "abertura",
  completedFixtureIds: [],
  completedMatches: [],
  matchReadiness: { fixtureId: "abertura", managerIds: [] },
  managers: [{ id: "manager-1", name: "Emanuel", clubId: "AUR", ready: true, joinedAt: "2026-07-13T00:00:00.000Z" }],
  fixtureSchedule: [
    {
      fixtureId: "abertura",
      round: 1,
      competition: "Brasileirao",
      homeClubId: "AUR",
      awayClubId: "SAN",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      homeManagerId: "manager-1",
      awayManagerId: null,
      managerIds: ["manager-1"],
    },
    {
      fixtureId: "rodada-2",
      round: 2,
      competition: "Brasileirao",
      homeClubId: "FLU",
      awayClubId: "AUR",
      homeTeam: "Fluminense",
      awayTeam: "Aurora FC",
      homeManagerId: null,
      awayManagerId: "manager-1",
      managerIds: ["manager-1"],
    },
  ],
};

import { withTestAuth } from './helpers/withTestAuth.mjs';

let vite;
let Sidebar;
let HomeView;
let MatchView;
let CalendarView;
let CompetitionsView;
let findRoomLeagueForClub;
let getSeasonProgress;
let normalizePlayerCondition;

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
  ({ Sidebar } = await vite.ssrLoadModule("/src/components/layout/Sidebar.tsx"));
  Sidebar = await withTestAuth(vite, Sidebar);
  ({ HomeView } = await vite.ssrLoadModule("/src/views/HomeView.tsx"));
  HomeView = await withTestAuth(vite, HomeView);
  ({ MatchView } = await vite.ssrLoadModule("/src/views/MatchView.tsx"));
  MatchView = await withTestAuth(vite, MatchView);
  ({ CalendarView } = await vite.ssrLoadModule("/src/views/season/CalendarView.tsx"));
  ({ CompetitionsView } = await vite.ssrLoadModule("/src/views/season/CompetitionsView.tsx"));
  CompetitionsView = await withTestAuth(vite, CompetitionsView);
  ({ findRoomLeagueForClub } = await vite.ssrLoadModule("/src/utils/leagueStandings.ts"));
  ({ getSeasonProgress } = await vite.ssrLoadModule("/src/utils/seasonProgress.ts"));
  ({ normalizePlayerCondition } = await vite.ssrLoadModule("/src/hooks/usePlayerCatalog.ts"));
});

after(async () => {
  await vite?.close();
});

test("temporada nova calcula rodada 1 e progresso zero", () => {
  assert.deepEqual(getSeasonProgress(room), {
    currentRound: 1,
    totalRounds: 2,
    completedRounds: 0,
    percent: 0,
    hasSchedule: true,
    seasonNumber: 1,
    seasonYear: 2026,
  });
});

test("jogador sem condicao registrada inicia com 100 por cento", () => {
  assert.equal(normalizePlayerCondition(undefined), 100);
  assert.equal(normalizePlayerCondition(null), 100);
  assert.equal(normalizePlayerCondition(84), 84);
});

test("HUD de temporada nova mostra rodada 1", () => {
  const html = renderToStaticMarkup(React.createElement(Sidebar, {
    activeRoute: "home",
    club,
    room,
    onNavigate: () => {},
    open: false,
    onClose: () => {},
    onExit: () => {},
  }));
  assert.match(html, /Rodada 1 de 2/);
  assert.match(html, />0%<\/strong>/);
  assert.doesNotMatch(html, /Rodada 14/);
});

test("central e partida usam a primeira rodada do save", () => {
  const homeHtml = renderToStaticMarkup(React.createElement(HomeView, {
    players: [],
    onNavigate: () => {},
    onToast: () => {},
    club,
    room,
    managerId: "manager-1",
    onlineMatch: null,
  }));
  const matchHtml = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: null,
    room,
    club,
  }));
  assert.match(homeHtml, /RODADA 1/);
  assert.doesNotMatch(homeHtml, /PRÓXIMO JOGO|fixture-command__rail/);
  assert.match(matchHtml, /Rodada 1/i);
  assert.doesNotMatch(`${homeHtml}${matchHtml}`, /Rodada 14|RODADA 14/);
});

test("HUD propaga liga e escudos do snapshot da temporada", () => {
  const crestImageUrl = "/assets/chelsea.png";
  const chelsea = {
    ...club,
    id: "CHE",
    name: "Chelsea",
    code: "CHE",
    color: "#034694",
    darkThemeColor: "#66a3ff",
    lightThemeColor: "#034694",
    crestImageUrl,
    leagueId: "ENG-1",
    leagueName: "Liga Inglesa",
    division: "Premier League",
    country: "Inglaterra",
  };
  const englishRoom = {
    ...room,
    activeLeagues: ["ENG-1"],
    competitionCatalog: [{
      id: "ENG-1",
      name: "Liga Inglesa",
      country: "Inglaterra",
      division: "Premier League",
      clubs: [{ id: "CHE", name: "Chelsea", code: "CHE", color: "#034694", darkThemeColor: "#66a3ff", lightThemeColor: "#034694", reputation: 10, crestImageUrl, leagueId: "ENG-1" }],
    }],
    managers: [{ ...room.managers[0], clubId: "CHE" }],
    fixtureSchedule: [{
      ...room.fixtureSchedule[0],
      competition: "Liga Inglesa",
      leagueId: "ENG-1",
      homeClubId: "CHE",
      homeTeam: "Chelsea",
      homeCode: "CHE",
      homeColor: "#034694",
      homeDarkThemeColor: "#66a3ff",
      homeLightThemeColor: "#034694",
      homeCrestImageUrl: crestImageUrl,
      awayCode: "SAN",
      awayColor: "#dedede",
      awayDarkThemeColor: "#f0f0f0",
      awayLightThemeColor: "#171a17",
      awayCrestImageUrl: null,
    }],
  };

  const sidebarHtml = renderToStaticMarkup(React.createElement(Sidebar, {
    activeRoute: "home",
    club: chelsea,
    room: englishRoom,
    onNavigate: () => {},
    open: false,
    onClose: () => {},
    onExit: () => {},
  }));
  const homeHtml = renderToStaticMarkup(React.createElement(HomeView, {
    players: [],
    onNavigate: () => {},
    onToast: () => {},
    club: chelsea,
    room: englishRoom,
    managerId: "manager-1",
    onlineMatch: null,
  }));
  const matchHtml = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: null,
    room: englishRoom,
    club: chelsea,
    demoMode: true,
  }));
  const calendarHtml = renderToStaticMarkup(React.createElement(CalendarView, {
    room: englishRoom,
    managerClubId: "CHE",
    onNavigate() {},
  }));
  const competitionsHtml = renderToStaticMarkup(React.createElement(CompetitionsView, {
    club: chelsea,
    room: englishRoom,
    tournaments: [],
    loadingTournaments: false,
    tournamentError: null,
  }));
  const hud = `${sidebarHtml}${homeHtml}${matchHtml}${calendarHtml}${competitionsHtml}`;

  assert.match(sidebarHtml, /Liga Inglesa · Premier League/);
  assert.match(homeHtml, /Liga Inglesa · RODADA 1/i);
  assert.match(matchHtml, /Liga Inglesa · Rodada 1/i);
  assert.match(hud, /club-mark--image/);
  assert.match(hud, /assets\/chelsea\.png/);
  assert.match(homeHtml, /--club-color-dark:#66a3ff;--club-color-light:#034694/);
  assert.match(matchHtml, /--club-color-dark:#f0f0f0;--club-color-light:#171a17/);
  assert.match(calendarHtml, /--club-color-dark:#f0f0f0;--club-color-light:#171a17/);
  assert.match(competitionsHtml, /--club-color-dark:#f0f0f0;--club-color-light:#171a17/);
});

test("liga atual do clube prevalece sobre associacao brasileira antiga do save", () => {
  const chelsea = {
    ...club,
    id: "CHE",
    name: "Chelsea",
    code: "CHE",
    leagueId: "ENG-1",
    leagueName: "Premier League",
    division: "1",
    country: "Inglaterra",
  };
  const staleRoom = {
    ...room,
    activeLeagues: ["BR-A", "ENG-1"],
    competitionCatalog: [
      {
        id: "BR-A",
        name: "Brasileirao Serie A",
        country: "Brasil",
        division: "Serie A",
        clubs: [
          { id: "CHE", name: "Chelsea", code: "CHE", color: "#034694", reputation: 18, crestImageUrl: null, leagueId: "BR-A" },
          { id: "PAL", name: "Palmeiras", code: "PAL", color: "#159761", reputation: 17, crestImageUrl: null, leagueId: "BR-A" },
        ],
      },
      {
        id: "ENG-1",
        name: "Premier League",
        country: "Inglaterra",
        division: "1",
        clubs: [
          { id: "CHE", name: "Chelsea", code: "CHE", color: "#034694", reputation: 18, crestImageUrl: null, leagueId: "ENG-1" },
          { id: "ARS", name: "Arsenal", code: "ARS", color: "#db0007", reputation: 18, crestImageUrl: null, leagueId: "ENG-1" },
        ],
      },
    ],
    managers: [{ ...room.managers[0], clubId: "CHE" }],
    fixtureSchedule: [{
      ...room.fixtureSchedule[0],
      competition: "Brasileirao Serie A",
      leagueId: "BR-A",
      homeClubId: "CHE",
      homeTeam: "Chelsea",
      awayClubId: "PAL",
      awayTeam: "Palmeiras",
    }],
  };

  assert.equal(findRoomLeagueForClub(staleRoom, chelsea)?.id, "ENG-1");
  assert.equal(findRoomLeagueForClub(staleRoom, { ...chelsea, leagueId: null })?.id, "BR-A");
  assert.equal(findRoomLeagueForClub({ ...staleRoom, competitionCatalog: staleRoom.competitionCatalog.slice(0, 1) }, chelsea), null);

  const sidebarHtml = renderToStaticMarkup(React.createElement(Sidebar, {
    activeRoute: "home",
    club: chelsea,
    room: staleRoom,
    onNavigate: () => {},
    open: false,
    onClose: () => {},
    onExit: () => {},
  }));
  const homeHtml = renderToStaticMarkup(React.createElement(HomeView, {
    players: [],
    onNavigate: () => {},
    onToast: () => {},
    club: chelsea,
    room: staleRoom,
    managerId: "manager-1",
    onlineMatch: null,
  }));
  const competitionsHtml = renderToStaticMarkup(React.createElement(CompetitionsView, {
    club: chelsea,
    room: staleRoom,
    tournaments: [],
    loadingTournaments: false,
    tournamentError: null,
  }));

  assert.match(sidebarHtml, /Premier League/);
  assert.doesNotMatch(sidebarHtml, /Brasileirao Serie A/);
  assert.match(homeHtml, /Brasileirao Serie A · RODADA 1/);
  assert.match(homeHtml, /Premier League · INÍCIO DA TEMPORADA/);
  assert.match(competitionsHtml, /Inglaterra · CALENDÁRIO/);
  assert.match(competitionsHtml, /Premier League/);
});

test("liga incompleta exibe aviso sem inventar uma partida brasileira", () => {
  const issueRoom = {
    ...room,
    currentFixtureId: null,
    fixtureSchedule: [],
    scheduleIssue: {
      code: "LEAGUE_NEEDS_CLUBS",
      message: "A liga do clube escolhido precisa ter pelo menos dois clubes ativos no Editor",
    },
  };
  const homeHtml = renderToStaticMarkup(React.createElement(HomeView, {
    players: [],
    onNavigate: () => {},
    onToast: () => {},
    club,
    room: issueRoom,
    managerId: "manager-1",
    onlineMatch: null,
  }));
  const matchHtml = renderToStaticMarkup(React.createElement(MatchView, {
    players: [],
    onToast: () => {},
    onNavigate: () => {},
    onlineMatch: null,
    room: issueRoom,
    club,
  }));

  assert.match(homeHtml, /pelo menos dois clubes ativos/);
  assert.match(matchHtml, /Partida ainda não disponível/);
  assert.doesNotMatch(matchHtml, /Palmeiras|Santos/);
});
