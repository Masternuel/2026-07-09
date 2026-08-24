import assert from "node:assert/strict";
import test from "node:test";
import { NewsStore } from "../store/newsStore.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

const MATCH = {
  code: "BOLA-T3ST",
  id: "match-press-1",
  fixtureId: "fixture-press-1",
  homeClubId: "AUR",
  awayClubId: "BOT",
  homeManagerId: "uid-owner",
  awayManagerId: null,
  managerIds: ["uid-owner"],
  homeTeam: "Aurora FC",
  awayTeam: "Botafogo",
  score: [2, 1],
  statistics: {
    home: { possession: 57, shots: 14, shotsOnTarget: 6, fouls: 5, yellowCards: 0, redCards: 0, corners: 4 },
    away: { possession: 43, shots: 8, shotsOnTarget: 3, fouls: 12, yellowCards: 2, redCards: 0, corners: 2 },
  },
  events: [{ id: "evt-001", minute: 21, type: "goal", scorer: "Atacante", score: [1, 0] }],
  completedAt: "2026-07-16T20:00:00.000Z",
};

function compactMatch(match) {
  const compact = structuredClone(match);
  delete compact.events;
  return compact;
}

function baseRoom() {
  return {
    id: "room-press",
    code: "BOLA-T3ST",
    name: "Sala da coletiva",
    ownerId: "uid-owner",
    catalogOwnerId: "uid-owner",
    status: "active",
    activeLeagues: ["BR-A"],
    competitionCatalog: [{
      id: "BR-A",
      name: "Brasileirao",
      clubs: [
        { id: "AUR", name: "Aurora FC" },
        { id: "BOT", name: "Botafogo" },
        { id: "SAN", name: "Santos" },
      ],
    }],
    seasonLength: 1,
    unlimitedSeasons: false,
    currentSeason: 1,
    seasonYear: 2026,
    seasonStartedAt: "2026-01-01T00:00:00.000Z",
    seasonHistory: [],
    careerCompleted: false,
    careerCompletedAt: null,
    maxManagers: 6,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-16T20:00:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    revision: 5,
    version: 5,
    currentFixtureId: null,
    fixtureSchedule: [{
      fixtureId: "fixture-press-1",
      homeClubId: "AUR",
      awayClubId: "BOT",
      homeManagerId: "uid-owner",
      awayManagerId: null,
      managerIds: ["uid-owner"],
    }],
    leagueFixtureSchedule: [],
    leagueMatchResults: [],
    matchReadiness: { fixtureId: null, managerIds: [] },
    completedFixtureIds: ["fixture-press-1"],
    completedMatches: [compactMatch(MATCH)],
    lastCompletedMatch: structuredClone(MATCH),
    lastCompletedRound: null,
    lineups: [],
    clubMoraleStates: [],
    managerIds: ["uid-owner", "uid-second"],
    managers: [
      { id: "uid-owner", name: "Dona da Sala", clubId: "AUR", ready: true, joinedAt: "2026-01-01T00:00:00.000Z" },
      { id: "uid-second", name: "Segundo Manager", clubId: "SAN", ready: true, joinedAt: "2026-01-01T00:00:00.000Z" },
    ],
  };
}

function catalogStore() {
  const players = [
    { id: "aur-zag", clubId: "AUR", name: "Zagueiro", position: "ZAG", active: true },
    { id: "aur-mei", clubId: "AUR", name: "Meia", position: "MEI", active: true },
    { id: "aur-ata", clubId: "AUR", name: "Atacante", position: "ATA", active: true },
  ];
  return {
    source: "test",
    forOwner() { return this; },
    async ensureInitialized() {},
    async listPlayers(clubId) {
      const selected = players.filter((player) => player.clubId === clubId);
      return { players: structuredClone(selected), count: selected.length, source: "test" };
    },
    async listCompetitionCatalog() { return []; },
  };
}

function validPayload() {
  return {
    matchId: MATCH.id,
    answers: [
      { questionId: "result", answerId: "result-praise" },
      { questionId: "possession", answerId: "possession-confident" },
      { questionId: "performance", answerId: "attack-praise" },
    ],
  };
}

async function pressServer({ socialAi, room = baseRoom() } = {}) {
  const catalog = catalogStore();
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence([room]),
    now: () => new Date("2026-07-16T21:00:00.000Z"),
    catalogStore: catalog,
  });
  const newsStore = new NewsStore({ now: () => new Date("2026-07-16T21:00:01.000Z") });
  const started = await startTestServer({
    store,
    catalogStore: catalog,
    newsStore,
    socialAi: socialAi ?? {
      configured: false,
      async generate() { throw new Error("provedor indisponivel"); },
    },
  });
  return { ...started, newsStore };
}

test("coletiva aplica moral por sala, cria noticia garantida e retry nao reaplica", async (context) => {
  let aiCalls = 0;
  const setup = await pressServer({
    socialAi: {
      configured: true,
      async generate(input) {
        aiCalls += 1;
        return {
          source: "test-ai",
          replies: input.posts.map((post) => ({
            postId: post.id,
            comments: [{ author: "Torcida", role: "torcida", text: "Boa coletiva.", sentiment: "positivo" }],
          })),
          teamComment: { author: "Central", role: "imprensa", text: "Repercussao.", sentiment: "neutro" },
        };
      },
    },
  });
  context.after(() => setup.server.close());

  const firstResponse = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: validPayload() },
  );
  assert.equal(firstResponse.status, 201);
  const first = await firstResponse.json();
  assert.equal(first.alreadySubmitted, false);
  assert.equal(first.effects.squadMoraleDelta, 5);
  assert.equal(first.effects.squadMoraleScore, 75);
  assert.match(first.submission.answers[1].text, /A posse teve propósito/i);
  assert.deepEqual(first.effects.sectorDeltas, { defense: 0, midfield: 0, attack: 2 });
  assert.deepEqual(first.effects.playerMoraleChanges, [{ playerId: "aur-ata", delta: 2, moraleScore: 82 }]);
  assert.equal(first.post.editorialKey, "press:match-press-1:uid-owner");
  assert.equal(first.post.comments.length, 1);
  assert.match(first.post.headline, /Aurora FC.*coletiva/i);

  const repeatedResponse = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: validPayload() },
  );
  assert.equal(repeatedResponse.status, 200);
  const repeated = await repeatedResponse.json();
  assert.equal(repeated.alreadySubmitted, true);
  assert.equal(repeated.effects.squadMoraleScore, 75);
  assert.equal(aiCalls, 1);
  assert.equal((await setup.newsStore.list("BOLA-T3ST")).length, 1);

  const persisted = await setup.store.getRoom("BOLA-T3ST");
  assert.equal(persisted.clubMoraleStates[0].score, 75);
  assert.equal(persisted.completedMatches[0].pressConferenceSubmissions.length, 1);
  assert.equal(persisted.lastCompletedMatch.pressConferenceSubmissions.length, 1);
  assert.deepEqual(persisted.lastCompletedMatch.events, MATCH.events);
});

test("coletiva rejeita resposta contextual invalida, nao participante e mudanca apos envio", async (context) => {
  const setup = await pressServer();
  context.after(() => setup.server.close());

  const invalidResponse = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    {
      method: "POST",
      body: {
        ...validPayload(),
        answers: [
          { questionId: "result", answerId: "result-praise" },
          { questionId: "possession", answerId: "possession-neutral" },
          { questionId: "performance", answerId: "attack-praise" },
        ],
      },
    },
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error.code, "PRESS_CONFERENCE_ANSWER_INVALID");

  const otherManager = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "second-token",
    { method: "POST", body: validPayload() },
  );
  assert.equal(otherManager.status, 403);
  assert.equal((await otherManager.json()).error.code, "PRESS_CONFERENCE_NOT_PARTICIPANT");

  assert.equal((await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: validPayload() },
  )).status, 201);
  const changed = validPayload();
  changed.answers[0].answerId = "result-neutral";
  const conflict = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: changed },
  );
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).error.code, "PRESS_CONFERENCE_SUBMISSION_CONFLICT");
  assert.equal((await setup.store.getRoom("BOLA-T3ST")).clubMoraleStates[0].score, 75);
});

test("coletiva usa comentario fallback e elenco recebe overlay apenas com roomCode", async (context) => {
  const setup = await pressServer();
  context.after(() => setup.server.close());

  const before = await jsonRequest(
    `${setup.url}/api/teams/AUR/players?roomCode=BOLA-T3ST`,
    "owner-token",
  );
  assert.equal(before.status, 200);
  assert.deepEqual((await before.json()).players.map((player) => player.moraleScore), [75, 75, 75]);

  const submitted = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: validPayload() },
  );
  assert.equal(submitted.status, 201);
  const post = (await submitted.json()).post;
  assert.equal(post.comments.length, 1);
  assert.match(post.comments[0].text, /bem recebida/i);

  const unscoped = await jsonRequest(`${setup.url}/api/teams/AUR/players`, "owner-token");
  assert.equal(unscoped.status, 200);
  assert.equal((await unscoped.json()).players[0].moraleScore, undefined);

  const scoped = await jsonRequest(
    `${setup.url}/api/teams/AUR/players?roomCode=BOLA-T3ST`,
    "owner-token",
  );
  assert.equal(scoped.status, 200);
  const players = (await scoped.json()).players;
  assert.deepEqual(players
    .map(({ id, moraleScore, morale }) => ({ id, moraleScore, morale }))
    .sort((left, right) => left.id.localeCompare(right.id)), [
    { id: "aur-ata", moraleScore: 82, morale: "Boa" },
    { id: "aur-mei", moraleScore: 80, morale: "Boa" },
    { id: "aur-zag", moraleScore: 80, morale: "Boa" },
  ]);
});

test("nao permite aplicar efeitos retroativos em uma partida anterior", async (context) => {
  const room = baseRoom();
  const older = {
    ...structuredClone(MATCH),
    id: "match-press-old",
    fixtureId: "fixture-press-old",
    completedAt: "2026-07-10T20:00:00.000Z",
  };
  room.completedMatches = [older, structuredClone(MATCH)];
  room.completedFixtureIds = [older.fixtureId, MATCH.fixtureId];
  const setup = await pressServer({ room });
  context.after(() => setup.server.close());

  const response = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST/press-conferences`,
    "owner-token",
    { method: "POST", body: { ...validPayload(), matchId: older.id } },
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "PRESS_CONFERENCE_NOT_LATEST_MATCH");
  assert.deepEqual((await setup.store.getRoom("BOLA-T3ST")).clubMoraleStates, []);
});

test("feed recupera noticia se o servidor parar depois de salvar a coletiva", async (context) => {
  const setup = await pressServer();
  context.after(() => setup.server.close());

  await setup.store.submitPressConference(
    "BOLA-T3ST",
    "uid-owner",
    validPayload(),
  );
  assert.equal((await setup.newsStore.list("BOLA-T3ST")).length, 0);

  const response = await jsonRequest(
    `${setup.url}/api/news/BOLA-T3ST`,
    "owner-token",
  );
  assert.equal(response.status, 200);
  const feed = await response.json();
  assert.equal(feed.posts.length, 1);
  assert.equal(feed.posts[0].editorialKey, "press:match-press-1:uid-owner");
  assert.match(feed.posts[0].body, /A posse teve propósito/i);
  assert.equal((await setup.newsStore.list("BOLA-T3ST")).length, 1);
});
