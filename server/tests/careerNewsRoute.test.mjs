import assert from "node:assert/strict";
import test from "node:test";
import { NewsStore } from "../store/newsStore.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

function careerRoom() {
  return {
    code: "BOLA-T3ST",
    managers: [
      { id: "uid-owner", name: "Dona da Sala", clubId: "AUR" },
      { id: "uid-second", name: "Segundo Manager", clubId: "SAN" },
    ],
    fixtureSchedule: [{
      fixtureId: "round-1",
      homeClubId: "AUR",
      awayClubId: "SAN",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      competition: "Liga Nacional",
      round: 1,
    }],
    completedFixtureIds: [],
    clubCareerState: {
      news: [
        {
          id: "career-news:transfer:1",
          eventId: "transfer:1",
          title: "Aurora FC anuncia Joao Silva",
          summary: "Joao Silva foi transferido pelo Santos para o Aurora FC.",
          content: "Joao Silva foi transferido pelo Santos para o Aurora FC por R$ 12 mi.",
          category: "mercado",
          clubIds: ["AUR"],
          playerIds: ["player-1"],
          publishedAt: "2026-08-01T12:00:00.000Z",
        },
        {
          id: "career-news:santos-private:1",
          eventId: "santos-private:1",
          title: "Santos conclui decisao interna",
          summary: "Decisao registrada no save do Santos.",
          content: "Decisao registrada no save do Santos.",
          category: "clube",
          clubIds: ["SAN"],
          publishedAt: "2026-08-01T13:00:00.000Z",
        },
        {
          id: "career-news:match:1",
          eventId: "match:1",
          title: "Aurora FC 2 x 1 Santos",
          summary: "Aurora FC 2 x 1 Santos, pela Liga Nacional.",
          content: "Aurora FC 2 x 1 Santos, pela Liga Nacional.",
          category: "resultados",
          clubIds: ["AUR", "SAN"],
          publishedAt: "2026-08-02T22:00:00.000Z",
        },
      ],
    },
  };
}

function memberStore(room) {
  return {
    async requireMembership(_code, uid) {
      if (!room.managers.some((manager) => manager.id === uid)) {
        const error = new Error("Sala nao encontrada");
        error.status = 404;
        throw error;
      }
      return room;
    },
  };
}

function socialAiSpy(calls) {
  return {
    configured: true,
    hasReusableResult() { return false; },
    async generate(input) {
      calls.push(input);
      return {
        source: "gemini",
        model: "gemini-test",
        cached: false,
        teamComment: null,
        replies: input.posts.map((post) => ({
          postId: post.id,
          comments: [{
            id: `reply:${post.id}`,
            author: "Arquibancada",
            role: "torcida",
            text: `Comentario sobre ${post.headline}.`,
            sentiment: "neutro",
          }],
        })),
        newsArticle: {
          publish: false,
          source: "",
          sourceType: "imprensa",
          headline: "",
          body: "",
          tag: "",
        },
      };
    },
  };
}

function requestedPost(id, overrides = {}) {
  return {
    id,
    source: "Fonte forjada",
    sourceType: "jogador",
    headline: "Manchete forjada pelo cliente",
    body: "Texto forjado pelo cliente.",
    tag: "Forjado",
    reactions: 999,
    ...overrides,
  };
}

test("IA usa noticia factual persistida e ignora conteudo forjado pelo cliente", async (context) => {
  const calls = [];
  const room = careerRoom();
  const newsStore = new NewsStore();
  const { server, url } = await startTestServer({
    store: memberStore(room),
    newsStore,
    socialAi: socialAiSpy(calls),
  });
  context.after(() => server.close());

  const response = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [requestedPost("career-news:transfer:1")] },
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].posts, [{
    id: "career-news:transfer:1",
    clubId: "AUR",
    source: "Aurora FC",
    sourceType: "clube",
    headline: "Aurora FC anuncia Joao Silva",
    body: "Joao Silva foi transferido pelo Santos para o Aurora FC por R$ 12 mi.",
    reactions: 0,
    tag: "mercado",
  }]);
  assert.doesNotMatch(JSON.stringify(calls[0]), /forjad/i);

  const payload = await response.json();
  assert.equal(payload.replies[0].postId, "career-news:transfer:1");
  assert.equal(payload.posts[0].editorialKey, "career-news:transfer:1");
  assert.equal(payload.posts[0].headline, "Aurora FC anuncia Joao Silva");
  assert.equal(payload.posts[0].comments.length, 1);
  assert.doesNotMatch(JSON.stringify(payload), /forjad|gemini/i);

  const persisted = await newsStore.list(room.code);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].clubId, "AUR");
  assert.equal(persisted[0].body, "Joao Silva foi transferido pelo Santos para o Aurora FC por R$ 12 mi.");
});

test("manager nao pode solicitar analise de noticia privada de outro clube", async (context) => {
  const calls = [];
  const room = careerRoom();
  const { server, url } = await startTestServer({
    store: memberStore(room),
    newsStore: new NewsStore(),
    socialAi: socialAiSpy(calls),
  });
  context.after(() => server.close());

  const response = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [requestedPost("career-news:santos-private:1")] },
  });

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "SOCIAL_EDITORIAL_INVALID");
  assert.equal(calls.length, 0);
});

test("noticia com os dois clubes fica disponivel aos dois managers", async (context) => {
  const calls = [];
  const room = careerRoom();
  const { server, url } = await startTestServer({
    store: memberStore(room),
    newsStore: new NewsStore(),
    socialAi: socialAiSpy(calls),
  });
  context.after(() => server.close());

  const response = await jsonRequest(`${url}/api/news/${room.code}/ai`, "second-token", {
    method: "POST",
    body: { posts: [requestedPost("career-news:match:1")] },
  });

  assert.equal(response.status, 200);
  assert.equal(calls[0].clubName, "Santos");
  assert.equal(calls[0].posts[0].source, "Santos");
  assert.equal(calls[0].posts[0].headline, "Aurora FC 2 x 1 Santos");
});
