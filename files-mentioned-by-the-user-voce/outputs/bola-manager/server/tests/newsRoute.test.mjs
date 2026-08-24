import assert from "node:assert/strict";
import test from "node:test";
import { io as createClient } from "socket.io-client";
import { NewsStore } from "../store/newsStore.mjs";
import { jsonRequest, startTestServer } from "./testHarness.mjs";

function fakeSocialAi(calls) {
  return {
    configured: true,
    model: "gemini-test",
    hasReusableResult(input) {
      const serialized = JSON.stringify(input);
      return calls.some((call) => JSON.stringify(call) === serialized);
    },
    async generate(input) {
      calls.push(input);
      const managerStatement = input.posts.find((post) => post.sourceType === "manager");
      const shouldPublishNews = input.mode !== "thread"
        && /contrata[cç][aã]o|anunciamos|confirmamos/i.test(managerStatement?.body ?? "");
      return {
        source: "gemini",
        model: "gemini-test",
        cached: false,
        teamComment: { id: "team-radar", author: "Central da Rodada", role: "imprensa", text: "Radar do " + input.clubName + ".", sentiment: "neutro" },
        replies: input.posts.map((post) => ({
          postId: post.id,
          comments: [{ id: `reply-${post.id}`, author: "Arquibancada", role: "torcida", text: `Resposta para ${post.source}.`, sentiment: "positivo" }],
        })),
        newsArticle: shouldPublishNews ? {
          publish: true,
          source: "Central da Rodada",
          sourceType: "imprensa",
          headline: input.clubName + " confirma novidade no elenco",
          body: "A declaracao do manager movimentou os bastidores do clube.",
          tag: "Mercado",
        } : {
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

async function createRoom(url) {
  const response = await jsonRequest(`${url}/api/rooms`, "owner-token", {
    method: "POST",
    body: { name: "Sala social", clubId: "AUR" },
  });
  assert.equal(response.status, 201);
  return (await response.json()).room;
}

test("gera radar, publica post autenticado e hidrata feed da sala", async (context) => {
  const calls = [];
  const newsStore = new NewsStore({
    now: () => new Date("2026-07-12T12:00:00.000Z"),
    idFactory: () => "post-1",
  });
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);

  const aiResponse = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [{ id: "n3", source: "Fonte forjada", sourceType: "jogador", headline: "Manchete forjada", body: "Texto forjado." }] },
  });
  assert.equal(aiResponse.status, 200);
  const radar = await aiResponse.json();
  assert.equal(radar.source, undefined);
  assert.equal(radar.replies[0].postId, "n3");
  assert.equal(radar.posts.length, 1);
  assert.equal(radar.posts[0].editorialKey, "n3");
  assert.equal(radar.posts[0].comments.length, 1);
  assert.equal(radar.posts[0].source, "Capitão do elenco");
  assert.equal(radar.posts[0].headline, "“É jogo para assumir responsabilidade.”");
  assert.doesNotMatch(radar.posts[0].body, /forjado/i);
  assert.doesNotMatch(JSON.stringify(radar), /gemini|bola ia/i);
  assert.equal(calls[0].clubId, undefined);

  const cachedAiResponse = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [{ id: "n3", source: "Felipe", sourceType: "jogador", headline: "Vamos vencer", body: "Foco total." }] },
  });
  assert.equal(cachedAiResponse.status, 200);

  const repeatedAiResponse = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [{ id: "n1", source: "Felipe", sourceType: "imprensa", headline: "Novo texto", body: "Outro contexto." }] },
  });
  assert.equal(repeatedAiResponse.status, 429);
  assert.equal((await repeatedAiResponse.json()).error.code, "SOCIAL_AI_RATE_LIMITED");
  assert.equal(calls.length, 2);

  const publishResponse = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Confio no elenco para a proxima rodada." },
  });
  assert.equal(publishResponse.status, 201);
  const published = await publishResponse.json();
  assert.equal(published.post.authorId, "uid-owner");
  assert.equal(published.post.authorName, "Dona da Sala");
  assert.equal(published.post.comments.length, 1);
  assert.equal(published.post.aiSource, undefined);
  assert.equal(published.generatedPost, null);

  const feedResponse = await jsonRequest(`${url}/api/news/${room.code}`, "owner-token");
  assert.equal(feedResponse.status, 200);
  const feed = await feedResponse.json();
  assert.equal(feed.source, "memory");
  assert.deepEqual(
    new Set(feed.posts.map((post) => post.id)),
    new Set(["post-1", radar.posts[0].id]),
  );

  const callsBeforeIntruder = calls.length;
  const hidden = await jsonRequest(`${url}/api/news/${room.code}/posts`, "intruder-token", {
    method: "POST",
    body: { message: "Nao pertenço a sala." },
  });
  assert.equal(hidden.status, 404);
  assert.equal(calls.length, callsBeforeIntruder);

  const throttled = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Segunda mensagem imediata." },
  });
  assert.equal(throttled.status, 429);
  assert.equal((await throttled.json()).error.code, "SOCIAL_RATE_LIMITED");

  const invalid = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "ok", authorId: "spoofed" },
  });
  assert.equal(invalid.status, 400);
});

test("reprocessa comentario fallback de post do manager quando o provedor volta", async (context) => {
  let providerSource = "fallback";
  const calls = [];
  const socialAi = {
    configured: true,
    model: "gemini-test",
    hasReusableResult() { return false; },
    async generate(input) {
      calls.push(input);
      return {
        source: providerSource,
        model: providerSource === "gemini" ? "gemini-backup" : null,
        cached: false,
        teamComment: { id: "team", author: "Central da Rodada", role: "imprensa", text: "Radar da rodada.", sentiment: "neutro" },
        replies: input.posts.map((post) => ({
          postId: post.id,
          comments: [{
            id: `${providerSource}-${post.id}`,
            author: "Arquibancada",
            role: "torcida",
            text: providerSource === "gemini" ? "Resposta recuperada pelo provedor." : "Resposta generica.",
            sentiment: "neutro",
          }],
        })),
        newsArticle: { publish: false, source: "", sourceType: "imprensa", headline: "", body: "", tag: "" },
      };
    },
  };
  const newsStore = new NewsStore({ idFactory: () => "manager-fallback" });
  const { server, url } = await startTestServer({ newsStore, socialAi });
  context.after(() => server.close());
  const room = await createRoom(url);

  const publishResponse = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Vamos time!" },
  });
  assert.equal(publishResponse.status, 201);
  const published = await publishResponse.json();
  assert.equal(published.post.comments[0].text, "Resposta generica.");
  assert.equal((await newsStore.get(room.code, "manager-fallback")).aiSource, "fallback");

  providerSource = "gemini";
  const analysisResponse = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [{ id: "n3", source: "Fonte", sourceType: "jogador", headline: "Foco", body: "Vamos." }] },
  });
  assert.equal(analysisResponse.status, 200);
  const analysis = await analysisResponse.json();
  const recovered = analysis.posts.find((post) => post.id === "manager-fallback");
  assert.equal(recovered.comments[0].text, "Resposta recuperada pelo provedor.");
  assert.equal(analysis.replies.some((reply) => reply.postId.startsWith("recover-manager-")), false);
  assert.equal(calls.at(-1).posts.some((post) => post.id.startsWith("recover-manager-") && post.sourceType === "manager"), true);

  const persisted = await newsStore.get(room.code, "manager-fallback");
  assert.equal(persisted.aiSource, "gemini");
  assert.equal(persisted.comments[0].text, "Resposta recuperada pelo provedor.");
});

test("novo post e transmitido em tempo real aos membros da sala", async (context) => {
  const calls = [];
  const newsStore = new NewsStore({ idFactory: () => "post-live" });
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);
  const socket = createClient(url, { auth: { token: "owner-token" }, transports: ["websocket"] });
  context.after(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const resumed = await socket.timeout(1_000).emitWithAck("room:resume", { code: room.code });
  assert.equal(resumed.ok, true);

  const received = new Promise((resolve) => socket.once("news:post", resolve));
  const response = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Mensagem para todos." },
  });
  assert.equal(response.status, 201);
  const event = await received;
  assert.equal(event.id, "post-live");
  assert.equal(event.body, "Mensagem para todos.");
});

test("resposta em editorial sincronizado persiste e chega em tempo real", async (context) => {
  const calls = [];
  const newsStore = new NewsStore();
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);
  const analysisResponse = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: {
      posts: [{
        id: "n3",
        source: "Felipe",
        sourceType: "jogador",
        headline: "Vamos vencer",
        body: "Foco total.",
        tag: "Vestiario",
        reactions: 17,
      }],
    },
  });
  assert.equal(analysisResponse.status, 200);
  const editorial = (await analysisResponse.json()).posts[0];
  const socket = createClient(url, { auth: { token: "owner-token" }, transports: ["websocket"] });
  context.after(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const resumed = await socket.timeout(1_000).emitWithAck("room:resume", { code: room.code });
  assert.equal(resumed.ok, true);
  const received = new Promise((resolve) => socket.once("news:post", resolve));

  const replyResponse = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${editorial.id}/comments`,
    "owner-token",
    {
      method: "POST",
      body: {
        message: "A torcida espera essa postura dentro de campo.",
        parentCommentId: editorial.comments[0].id,
      },
    },
  );
  assert.equal(replyResponse.status, 201);
  const conversation = await replyResponse.json();
  assert.equal(conversation.post.editorialKey, "n3");
  assert.equal(conversation.post.comments.length, 3);
  assert.equal(conversation.post.tag, "Vestiário");
  assert.equal(conversation.post.reactions, 437);
  assert.equal((await received).id, editorial.id);

  const feedResponse = await jsonRequest(`${url}/api/news/${room.code}`, "owner-token");
  const persisted = (await feedResponse.json()).posts.find((post) => post.id === editorial.id);
  assert.equal(persisted.comments.length, 3);
});

test("radar usa somente partidas do clube do manager", async (context) => {
  const calls = [];
  const room = {
    code: "BOLA-T3ST",
    currentFixtureId: "san-next",
    completedFixtureIds: ["aur-old", "san-old"],
    managers: [
      { id: "uid-owner", name: "Dona da Sala", clubId: "AUR" },
      { id: "uid-second", name: "Segundo Manager", clubId: "SAN" },
    ],
    fixtureSchedule: [
      { fixtureId: "aur-old", homeClubId: "AUR", awayClubId: "BOT", homeTeam: "Aurora FC", awayTeam: "Botafogo", competition: "Liga", round: 1 },
      { fixtureId: "san-old", homeClubId: "SAN", awayClubId: "FLU", homeTeam: "Santos", awayTeam: "Fluminense", competition: "Liga", round: 1 },
      { fixtureId: "san-next", homeClubId: "SAN", awayClubId: "PAL", homeTeam: "Santos", awayTeam: "Palmeiras", competition: "Liga", round: 2 },
      { fixtureId: "aur-next", homeClubId: "GRE", awayClubId: "AUR", homeTeam: "Gremio", awayTeam: "Aurora FC", competition: "Liga", round: 2 },
    ],
    completedMatches: [
      { homeTeam: "Aurora FC", awayTeam: "Botafogo", score: [2, 0] },
      { homeTeam: "Santos", awayTeam: "Fluminense", score: [0, 1] },
    ],
    lastCompletedMatch: { homeTeam: "Santos", awayTeam: "Fluminense", score: [0, 1] },
  };
  const store = {
    async requireMembership(_code, uid) {
      if (!room.managers.some((manager) => manager.id === uid)) {
        const error = new Error("Sala nao encontrada");
        error.status = 404;
        throw error;
      }
      return room;
    },
  };
  const { server, url } = await startTestServer({
    store,
    newsStore: new NewsStore(),
    socialAi: fakeSocialAi(calls),
  });
  context.after(() => server.close());

  const response = await jsonRequest(`${url}/api/news/${room.code}/ai`, "owner-token", {
    method: "POST",
    body: { posts: [{ id: "n3", source: "Felipe", sourceType: "jogador", headline: "Foco", body: "Vamos." }] },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].lastMatch, { homeTeam: "Aurora FC", awayTeam: "Botafogo", score: [2, 0] });
  assert.deepEqual(calls[0].nextFixture, {
    homeTeam: "Gremio",
    awayTeam: "Aurora FC",
    competition: "Liga",
    round: 2,
  });
});

test("declaracao relevante gera e transmite noticia sem expor o provedor", async (context) => {
  const calls = [];
  const ids = ["manager-news", "editorial-news"];
  const newsStore = new NewsStore({ idFactory: () => ids.shift() });
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);
  const socket = createClient(url, { auth: { token: "owner-token" }, transports: ["websocket"] });
  context.after(() => socket.disconnect());
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const resumed = await socket.timeout(1_000).emitWithAck("room:resume", { code: room.code });
  assert.equal(resumed.ok, true);
  const received = [];
  const bothPosts = new Promise((resolve) => {
    socket.on("news:post", (post) => {
      received.push(post);
      if (received.length === 2) resolve();
    });
  });

  const response = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Confirmamos a contratação de um novo atacante para a temporada." },
  });
  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.post.id, "manager-news");
  assert.equal(payload.generatedPost.id, "editorial-news");
  assert.equal(payload.generatedPost.sourceType, "imprensa");
  assert.match(payload.generatedPost.headline, /confirma novidade/i);
  assert.equal(payload.generatedPost.aiSource, undefined);
  assert.equal(payload.generatedPost.generatedFromPostId, undefined);
  assert.doesNotMatch(JSON.stringify(payload), /gemini|bola ia/i);
  await bothPosts;
  assert.deepEqual(received.map((post) => post.id), ["manager-news", "editorial-news"]);

  const feedResponse = await jsonRequest(`${url}/api/news/${room.code}`, "owner-token");
  const feed = await feedResponse.json();
  assert.deepEqual(new Set(feed.posts.map((post) => post.id)), new Set(["manager-news", "editorial-news"]));
});

test("manager responde comentario e conversa fica persistida", async (context) => {
  const calls = [];
  const newsStore = new NewsStore({ idFactory: () => "thread-post" });
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);
  const publishResponse = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Seguimos focados para a proxima rodada." },
  });
  assert.equal(publishResponse.status, 201);
  const published = await publishResponse.json();
  const parentCommentId = published.post.comments[0].id;

  const replyResponse = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${published.post.id}/comments`,
    "owner-token",
    {
      method: "POST",
      body: { message: "Concordo, mas precisamos melhorar a marcacao.", parentCommentId },
    },
  );
  assert.equal(replyResponse.status, 201);
  const conversation = await replyResponse.json();
  assert.equal(conversation.post.comments.length, 3);
  const managerReply = conversation.post.comments[1];
  const followUp = conversation.post.comments[2];
  assert.equal(managerReply.role, "manager");
  assert.equal(managerReply.parentCommentId, parentCommentId);
  assert.equal(followUp.parentCommentId, managerReply.id);
  assert.equal(managerReply.authorId, undefined);
  assert.equal(managerReply.generated, undefined);
  assert.equal(conversation.generatedPost, null);
  assert.doesNotMatch(JSON.stringify(conversation), /gemini|bola ia/i);
  assert.equal(calls.at(-1).mode, "thread");

  const feedResponse = await jsonRequest(`${url}/api/news/${room.code}`, "owner-token");
  const feed = await feedResponse.json();
  assert.equal(feed.posts[0].comments.length, 3);

  const callsBeforeIntruder = calls.length;
  const hidden = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${published.post.id}/comments`,
    "intruder-token",
    {
      method: "POST",
      body: { message: "Tentativa externa.", parentCommentId },
    },
  );
  assert.equal(hidden.status, 404);
  assert.equal(calls.length, callsBeforeIntruder);
});

test("requestId torna publicacao e resposta idempotentes sem bloquear payload legado", async (context) => {
  const calls = [];
  const ids = ["idempotent-post", "legacy-post"];
  const newsStore = new NewsStore({ idFactory: () => ids.shift() });
  const { server, url } = await startTestServer({ newsStore, socialAi: fakeSocialAi(calls) });
  context.after(() => server.close());
  const room = await createRoom(url);

  const publishBody = {
    message: "Seguimos focados para vencer.",
    requestId: "publish-request-01",
  };
  const firstPublish = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: publishBody,
  });
  assert.equal(firstPublish.status, 201);
  const firstPayload = await firstPublish.json();
  const callsAfterPublish = calls.length;

  const repeatedPublish = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: publishBody,
  });
  assert.equal(repeatedPublish.status, 200);
  assert.equal((await repeatedPublish.json()).post.id, firstPayload.post.id);
  assert.equal(calls.length, callsAfterPublish);
  assert.equal((await newsStore.list(room.code)).filter((post) => post.sourceType === "manager").length, 1);

  const publishConflict = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { ...publishBody, message: "Conteudo diferente." },
  });
  assert.equal(publishConflict.status, 409);
  assert.equal((await publishConflict.json()).error.code, "NEWS_REQUEST_CONFLICT");

  const parentCommentId = firstPayload.post.comments[0].id;
  const replyBody = {
    message: "Vamos transformar foco em resultado.",
    parentCommentId,
    requestId: "reply-request-0001",
  };
  const firstReply = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${firstPayload.post.id}/comments`,
    "owner-token",
    { method: "POST", body: replyBody },
  );
  assert.equal(firstReply.status, 201);
  const firstConversation = await firstReply.json();
  const callsAfterReply = calls.length;

  const repeatedReply = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${firstPayload.post.id}/comments`,
    "owner-token",
    { method: "POST", body: replyBody },
  );
  assert.equal(repeatedReply.status, 200);
  const repeatedConversation = await repeatedReply.json();
  assert.equal(repeatedConversation.post.comments.length, firstConversation.post.comments.length);
  assert.deepEqual(repeatedConversation.comments, firstConversation.comments);
  assert.equal(calls.length, callsAfterReply);

  const replyConflict = await jsonRequest(
    `${url}/api/news/${room.code}/posts/${firstPayload.post.id}/comments`,
    "owner-token",
    { method: "POST", body: { ...replyBody, message: "Outra resposta." } },
  );
  assert.equal(replyConflict.status, 409);
  assert.equal((await replyConflict.json()).error.code, "NEWS_REQUEST_CONFLICT");

  const legacyPublish = await jsonRequest(`${url}/api/news/${room.code}/posts`, "owner-token", {
    method: "POST",
    body: { message: "Payload antigo continua valido." },
  });
  assert.equal(legacyPublish.status, 429);
  assert.equal((await legacyPublish.json()).error.code, "SOCIAL_RATE_LIMITED");
});
