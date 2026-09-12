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
  id: "club-santos",
  name: "Santos",
  code: "SAN",
  city: "Santos, SP",
  stars: 5,
  budget: "R$ 72 mi",
  color: "#ffffff",
};

const leagueFixtureSchedule = [
  { leagueFixtureId: "r4", leagueId: "BR-A", round: 4, homeClubId: "BAH", awayClubId: "club-santos" },
  { leagueFixtureId: "outro", leagueId: "BR-A", round: 1, homeClubId: "PAL", awayClubId: "FLU" },
  { leagueFixtureId: "r2", leagueId: "BR-A", round: 2, homeClubId: "FLU", awayClubId: "SAN" },
  { leagueFixtureId: "r1", leagueId: "BR-A", round: 1, homeClubId: "club-santos", awayClubId: "BOT" },
  { leagueFixtureId: "r3", leagueId: "BR-A", round: 3, homeClubId: "Santos", awayClubId: "COR" },
];

const leagueMatchResults = [
  { leagueFixtureId: "r3", score: [0, 1] },
  { leagueFixtureId: "outro", score: [9, 9] },
  { leagueFixtureId: "r1", score: [2, 0] },
  { leagueFixtureId: "r4", score: [0, 3] },
  { leagueFixtureId: "r2", score: [1, 1] },
];

const room = {
  id: "room-reports",
  code: "BOLA-REPORT",
  name: "Temporada Santos",
  ownerId: "manager-1",
  status: "active",
  activeLeagues: ["BR-A"],
  seasonLength: 1,
  unlimitedSeasons: false,
  currentSeason: 1,
  seasonYear: 2026,
  seasonStartedAt: "2026-01-01T00:00:00.000Z",
  seasonHistory: [],
  careerCompleted: false,
  maxManagers: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  startedAt: "2026-01-01T00:00:00.000Z",
  revision: 1,
  leagueFixtureSchedule,
  leagueMatchResults,
  fixtureSchedule: [],
  completedFixtureIds: [],
  completedMatches: [],
  managers: [{ id: "manager-1", name: "Emanuel", clubId: "club-santos", ready: true, joinedAt: "2026-01-01T00:00:00.000Z" }],
};

const baseAttributes = {
  velocidade: 7,
  chute: 7,
  drible: 7,
  nocao: 7,
  defesa: 7,
  passe: 7,
  peBom: 7,
  peRuim: 6,
  forca: 7,
  resistencia: 7,
  impulsao: 7,
  reflexos: 7,
  posicionamentoGol: 7,
  saidaGol: 7,
  penaltis: 7,
};

function player(id, name, position, condition, value, bonus) {
  return {
    id,
    name,
    shortName: name,
    isStar: false,
    number: bonus,
    position,
    role: position,
    age: 24,
    nationality: "Brasil",
    value,
    wage: 100_000,
    condition,
    morale: "Boa",
    status: "Disponível",
    foot: "Direito",
    personality: "Profissional",
    worldStar: 0,
    attributes: { ...baseAttributes, passe: 7 + bonus / 10, resistencia: 7 + bonus / 10 },
  };
}

const players = [
  player("jp", "João Paulo", "GOL", 94, 13_000_000, 1),
  player("gb", "Gabriel Brazão", "GOL", 97, 16_500_000, 2),
  player("lv", "Lucas Veríssimo", "ZAG", 91, 18_200_000, 3),
  player("ze", "Zé Ivaldo", "ZAG", 96, 18_200_000, 4),
];

let vite;
let buildClubReport;
let ReportsView;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ buildClubReport } = await vite.ssrLoadModule("/src/utils/clubReport.ts"));
  ({ ReportsView } = await vite.ssrLoadModule("/src/views/season/ReportsView.tsx"));
});

after(async () => {
  await vite?.close();
});

test("calculo da campanha respeita clube, mando e ordem das rodadas", () => {
  const report = buildClubReport(room, club);

  assert.deepEqual(report.matches.map((match) => match.round), [1, 2, 3, 4]);
  assert.deepEqual({
    played: report.played,
    wins: report.wins,
    draws: report.draws,
    losses: report.losses,
    goalsFor: report.goalsFor,
    goalsAgainst: report.goalsAgainst,
    goalDifference: report.goalDifference,
    points: report.points,
    cleanSheets: report.cleanSheets,
  }, {
    played: 4,
    wins: 2,
    draws: 1,
    losses: 1,
    goalsFor: 6,
    goalsAgainst: 2,
    goalDifference: 4,
    points: 7,
    cleanSheets: 2,
  });
});

test("fallback usa somente partidas concluidas da temporada atual", () => {
  const fallbackRoom = {
    ...room,
    currentSeason: 2,
    seasonYear: 2027,
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
    completedFixtureIds: ["managed-1", "managed-2"],
    fixtureSchedule: [
      { fixtureId: "managed-2", round: 2, homeClubId: "FLU", awayClubId: "SAN", homeTeam: "Fluminense", awayTeam: "Santos" },
      { fixtureId: "managed-1", round: 1, homeClubId: "club-santos", awayClubId: "BOT", homeTeam: "Santos", awayTeam: "Botafogo" },
    ],
    completedMatches: [
      { id: "old", fixtureId: "managed-1", seasonNumber: 1, seasonYear: 2026, score: [9, 0] },
      { id: "current-2", fixtureId: "managed-2", seasonNumber: 2, seasonYear: 2027, score: [0, 2] },
      { id: "current-1", fixtureId: "managed-1", seasonNumber: 2, seasonYear: 2027, score: [1, 2] },
    ],
  };
  const report = buildClubReport(fallbackRoom, club);

  assert.deepEqual(report.matches.map((match) => match.round), [1, 2]);
  assert.deepEqual({ played: report.played, wins: report.wins, losses: report.losses, goalsFor: report.goalsFor, goalsAgainst: report.goalsAgainst, points: report.points, cleanSheets: report.cleanSheets }, {
    played: 2,
    wins: 1,
    losses: 1,
    goalsFor: 3,
    goalsAgainst: 2,
    points: 3,
    cleanSheets: 1,
  });
});

test("relatorios renderiza clube e elenco reais sem estatisticas ficticias", () => {
  const html = renderToStaticMarkup(React.createElement(ReportsView, { room, club, players }));

  assert.match(html, /Campanha do Santos/);
  for (const currentPlayer of players) assert.match(html, new RegExp(currentPlayer.name));
  assert.doesNotMatch(html, /Aurora|Felipe Rocha|Igor Sampaio|xG|Distância \/ jogo|Mapa de origem/i);
});

test("antes da estreia mostra campanha zerada e estado vazio honesto", () => {
  const html = renderToStaticMarkup(React.createElement(ReportsView, {
    room: { ...room, leagueMatchResults: [{ leagueFixtureId: "outro", score: [8, 7] }] },
    club,
    players,
  }));

  assert.match(html, /Aguardando estreia/);
  assert.match(html, /Nenhum jogo concluído/);
  assert.match(html, /Campanha ainda sem partidas concluídas/);
  assert.doesNotMatch(html, /8 jogos analisados|7 jogos analisados/);
});
