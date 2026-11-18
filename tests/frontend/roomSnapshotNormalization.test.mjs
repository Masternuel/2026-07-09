import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let vite;
let normalizeRoomSnapshot;
let normalizeRoomSnapshots;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ normalizeRoomSnapshot, normalizeRoomSnapshots } = await vite.ssrLoadModule("/src/utils/normalizeRoom.ts"));
});

after(async () => {
  await vite?.close();
});

test("rejeita valores sem identidade de sala", () => {
  assert.equal(normalizeRoomSnapshot(null), null);
  assert.equal(normalizeRoomSnapshot([]), null);
  assert.equal(normalizeRoomSnapshot({}), null);
});

test("torna save legado parcial seguro para renderizacao", () => {
  const room = normalizeRoomSnapshot({
    id: " bola-l3g4 ",
    name: " Save legado ",
    status: "desconhecido",
    revision: "3",
    maxManagers: "0",
    managers: null,
    activeLeagues: ["BR-A", null, "BR-A", 12],
    competitionCatalog: [{
      id: "BR-A",
      name: "Brasileirão",
      clubs: [null, { id: 7, name: "Clube Sete", code: null }],
    }],
    fixtureSchedule: [
      null,
      { fixtureId: null },
      {
        fixtureId: 42,
        round: "2",
        managerIds: ["manager-1", null, "manager-1", 9],
        homeCode: 7,
        awayCode: " VIS ",
        homeColor: {},
        awayColor: " #ffffff ",
        homeDarkThemeColor: 99,
        homeLightThemeColor: " #123456 ",
        awayDarkThemeColor: null,
        awayLightThemeColor: [],
        homeCrestImageUrl: 123,
        awayCrestImageUrl: " https://cdn.example.com/away.png ",
        homeStadium: 42,
        homeStadiumCapacity: Number.POSITIVE_INFINITY,
      },
    ],
    leagueFixtureSchedule: {},
    matchReadiness: { fixtureId: 42, managerIds: null },
    lineups: [null, { managerId: "manager-1", clubId: 7, lineupIds: [1, "p2", "p2", null] }],
    completedFixtureIds: [null, "rodada-1", "rodada-1", 42],
    completedMatches: [null, { code: null }, {
      id: 9,
      score: ["2", Number.NaN],
      statistics: null,
      events: null,
      pressConferenceSubmissions: {},
    }],
    leagueMatchResults: [{ leagueFixtureId: null }, { leagueFixtureId: 5, score: [1, "3"] }],
    lastCompletedRound: { matches: [null, { id: "r1", fixtureId: 42, score: [1, 0] }] },
    seasonHistory: null,
  });

  assert.ok(room);
  assert.equal(room.code, "BOLA-L3G4");
  assert.equal(room.id, "bola-l3g4");
  assert.equal(room.status, "waiting");
  assert.equal(room.revision, 3);
  assert.equal(room.maxManagers, 1);
  assert.deepEqual(room.managers, []);
  assert.deepEqual(room.activeLeagues, ["BR-A", "12"]);
  assert.deepEqual(room.seasonHistory, []);
  assert.equal(room.competitionCatalog.length, 1);
  assert.equal(room.competitionCatalog[0].clubs[0].id, "7");
  assert.deepEqual(room.leagueFixtureSchedule, []);
  assert.equal(room.fixtureSchedule.length, 1);
  assert.equal(room.fixtureSchedule[0].fixtureId, "42");
  assert.deepEqual(room.fixtureSchedule[0].managerIds, ["manager-1", "9"]);
  assert.equal(room.fixtureSchedule[0].homeCode, undefined);
  assert.equal(room.fixtureSchedule[0].awayCode, "VIS");
  assert.equal(room.fixtureSchedule[0].homeColor, undefined);
  assert.equal(room.fixtureSchedule[0].awayColor, "#ffffff");
  assert.equal(room.fixtureSchedule[0].homeDarkThemeColor, null);
  assert.equal(room.fixtureSchedule[0].homeLightThemeColor, "#123456");
  assert.equal(room.fixtureSchedule[0].awayDarkThemeColor, null);
  assert.equal(room.fixtureSchedule[0].awayLightThemeColor, null);
  assert.equal(room.fixtureSchedule[0].homeCrestImageUrl, null);
  assert.equal(room.fixtureSchedule[0].awayCrestImageUrl, "https://cdn.example.com/away.png");
  assert.equal(room.fixtureSchedule[0].homeStadium, undefined);
  assert.equal(room.fixtureSchedule[0].homeStadiumCapacity, undefined);
  assert.deepEqual(room.matchReadiness, { fixtureId: "42", managerIds: [] });
  assert.equal(room.lineups.length, 1);
  assert.equal(room.lineups[0].clubId, "7");
  assert.deepEqual(room.lineups[0].lineupIds, ["1", "p2"]);
  assert.deepEqual(room.completedFixtureIds, ["rodada-1", "42"]);
  assert.equal(room.completedMatches.length, 1);
  assert.deepEqual(room.completedMatches[0].score, [2, 0]);
  assert.deepEqual(room.completedMatches[0].events, []);
  assert.deepEqual(room.completedMatches[0].pressConferenceSubmissions, []);
  assert.equal(room.leagueMatchResults.length, 1);
  assert.deepEqual(room.leagueMatchResults[0].score, [1, 3]);
  assert.equal(room.lastCompletedRound.matches[0].fixtureId, "42");
});

test("preserva campos validos e normaliza arrays aninhados", () => {
  const input = {
    id: "room-1",
    code: "BOLA-0001",
    name: "Temporada",
    ownerId: "manager-1",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    unlimitedSeasons: true,
    currentSeason: 2,
    seasonYear: 2027,
    seasonStartedAt: "2026-01-01T00:00:00.000Z",
    seasonHistory: [{ season: 1 }],
    careerCompleted: false,
    maxManagers: 4,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: "2026-01-02T00:00:00.000Z",
    revision: 8,
    managers: [{ id: "manager-1", name: "Emanuel", clubId: "CHE", ready: true, joinedAt: "2026-01-01T00:00:00.000Z" }],
    fixtureSchedule: [{
      fixtureId: "round-1",
      round: 1,
      competition: "Liga",
      homeClubId: "CHE",
      awayClubId: "ARS",
      homeTeam: "Chelsea",
      awayTeam: "Arsenal",
      homeCode: "CHE",
      homeColor: "#034694",
      homeDarkThemeColor: "#66a3ff",
      homeCrestImageUrl: "https://cdn.example.com/chelsea.png",
      homeStadium: "Stamford Bridge",
      homeStadiumCapacity: 40_341,
      homeManagerId: "manager-1",
      awayManagerId: null,
      managerIds: ["manager-1"],
    }],
    completedFixtureIds: [],
    customMetadata: { preserved: true },
  };
  const room = normalizeRoomSnapshot(input);

  assert.ok(room);
  assert.equal(room.status, "active");
  assert.equal(room.currentSeason, 2);
  assert.equal(room.managers[0].ready, true);
  assert.equal(room.fixtureSchedule[0].homeTeam, "Chelsea");
  assert.equal(room.fixtureSchedule[0].homeColor, "#034694");
  assert.equal(room.fixtureSchedule[0].homeDarkThemeColor, "#66a3ff");
  assert.equal(room.fixtureSchedule[0].homeCrestImageUrl, "https://cdn.example.com/chelsea.png");
  assert.equal(room.fixtureSchedule[0].homeStadium, "Stamford Bridge");
  assert.equal(room.fixtureSchedule[0].homeStadiumCapacity, 40_341);
  assert.deepEqual(room.customMetadata, { preserved: true });
  for (const value of [
    room.activeLeagues,
    room.competitionCatalog,
    room.seasonHistory,
    room.fixtureSchedule,
    room.leagueFixtureSchedule,
    room.lineups,
    room.completedFixtureIds,
    room.completedMatches,
    room.leagueMatchResults,
    room.managers,
  ]) assert.equal(Array.isArray(value), true);
});

test("lista ignora entradas invalidas e codigos duplicados", () => {
  const rooms = normalizeRoomSnapshots([
    null,
    {},
    { code: "bola-1", managers: [] },
    { code: " BOLA-1 ", name: "duplicado", managers: [] },
    { id: 2, managers: [] },
  ]);
  assert.deepEqual(rooms.map((room) => room.code), ["BOLA-1", "2"]);
});
