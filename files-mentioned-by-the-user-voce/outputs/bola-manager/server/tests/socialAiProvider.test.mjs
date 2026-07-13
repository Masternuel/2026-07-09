import assert from "node:assert/strict";
import test from "node:test";
import { createSocialAiService } from "../services/socialAi.mjs";

const input = {
  clubId: "AUR",
  clubName: "Aurora FC",
  lastMatch: null,
  nextFixture: { homeTeam: "Aurora FC", awayTeam: "Palmeiras", competition: "Brasileirao", round: 2 },
  posts: [{
    id: "player-1",
    source: "Felipe Rocha",
    sourceType: "jogador",
    headline: "Vamos por mais",
    body: "Confiamos no trabalho.",
  }],
};

function idFactory() {
  let index = 0;
  return () => `generated-${++index}`;
}

test("usa fallback deterministico sem chave e nao chama rede", async () => {
  let calls = 0;
  const service = createSocialAiService({
    apiKey: "",
    fetchImpl: async () => {
      calls += 1;
      throw new Error("network should not run");
    },
    idFactory: idFactory(),
  });

  const result = await service.generate(input);
  assert.equal(service.configured, false);
  assert.equal(calls, 0);
  assert.equal(result.source, "fallback");
  assert.equal(result.model, null);
  assert.equal(result.replies[0].postId, "player-1");
  assert.match(result.replies[0].comments[0].text, /Felipe Rocha/);
  assert.equal(result.teamComment.author, "Central da Rodada");
  assert.equal(result.replies[0].comments[0].author, "Arquibancada");
  assert.equal(result.newsArticle.publish, false);
});

test("chama Gemini no servidor, valida JSON e reutiliza cache", async () => {
  const calls = [];
  const service = createSocialAiService({
    apiKey: "test-key",
    model: "gemini-test",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            steps: [{
              type: "model_output",
              content: [{ type: "text", text: JSON.stringify({
                  teamComment: { author: "Bola IA", role: "ia", text: "Aurora cresce na rodada.", sentiment: "positivo" },
                  replies: [{
                    postId: "player-1",
                    comments: [{ author: "Arquibancada", role: "torcida", text: "Estamos juntos!", sentiment: "positivo" }],
                  }],
                }) }],
            }],
          };
        },
      };
    },
    idFactory: idFactory(),
  });

  const first = await service.generate(input);
  assert.equal(service.hasReusableResult(input), true);
  const second = await service.generate(input);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1beta\/interactions$/);
  assert.equal(calls[0].options.headers["x-goog-api-key"], "test-key");
  const request = JSON.parse(calls[0].options.body);
  assert.equal(request.model, "gemini-test");
  assert.equal(request.store, false);
  assert.equal(request.response_format.mime_type, "application/json");
  assert.ok(request.response_format.schema.required.includes("newsArticle"));
  assert.match(request.system_instruction, /newsArticle/);
  assert.match(request.system_instruction, /Nunca mencione IA.*Gemini.*bot.*modelo/);
  assert.equal(first.source, "gemini");
  assert.equal(first.teamComment.text, "Aurora cresce na rodada.");
  assert.equal(first.replies[0].comments[0].id, "generated-2");
  assert.equal(second.cached, true);
  service.clearCache();
  assert.equal(service.hasReusableResult(input), false);
});

test("falha do provedor nao vaza erro e retorna contrato de fallback", async () => {
  let warnings = 0;
  const service = createSocialAiService({
    apiKey: "test-key",
    fetchImpl: async () => ({ ok: false, async json() { return { secret: "provider-detail" }; } }),
    logger: { warn() { warnings += 1; } },
    idFactory: idFactory(),
  });

  const result = await service.generate(input);
  assert.equal(warnings, 1);
  assert.equal(result.source, "fallback");
  assert.equal(result.replies.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /provider-detail|test-key/);
});

test("saida malformada da IA e descartada pelo validador", async () => {
  const service = createSocialAiService({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { steps: [{ type: "model_output", content: [{ type: "text", text: "{not-json" }] }] };
      },
    }),
    logger: { warn() {} },
    idFactory: idFactory(),
  });

  const result = await service.generate(input);
  assert.equal(result.source, "fallback");
  assert.equal(result.teamComment.author, "Central da Rodada");
});

test("completa respostas ausentes e remove duplicadas ou desconhecidas", async () => {
  const multiplePostsInput = {
    ...input,
    posts: [
      input.posts[0],
      { ...input.posts[0], id: "player-2", source: "Rafael Lima" },
      { ...input.posts[0], id: "player-3", source: "Caio Souza" },
    ],
  };
  const service = createSocialAiService({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            teamComment: { author: "Bola IA", role: "ia", text: "O clube segue em pauta.", sentiment: "neutro" },
            replies: [
              {
                postId: "player-1",
                comments: [{ author: "Torcida", role: "torcida", text: "Primeira resposta.", sentiment: "positivo" }],
              },
              {
                postId: "player-1",
                comments: [{ author: "Imprensa", role: "imprensa", text: "Duplicada.", sentiment: "neutro" }],
              },
              {
                postId: "unknown-post",
                comments: [{ author: "Torcida", role: "torcida", text: "Desconhecida.", sentiment: "neutro" }],
              },
            ],
          }),
        };
      },
    }),
    idFactory: idFactory(),
  });

  const result = await service.generate(multiplePostsInput);
  assert.equal(result.source, "gemini");
  assert.deepEqual(result.replies.map((reply) => reply.postId), ["player-1", "player-2", "player-3"]);
  assert.equal(result.replies[0].comments.length, 1);
  assert.equal(result.replies[0].comments[0].text, "Primeira resposta.");
  assert.match(result.replies[1].comments[0].text, /Rafael Lima/);
  assert.match(result.replies[2].comments[0].text, /Caio Souza/);
  assert.ok(result.replies.every((reply) => reply.comments.length >= 1 && reply.comments.length <= 2));
});

test("limita chamadas unicas concorrentes e usa fallback ao saturar", async () => {
  let calls = 0;
  let resolveFetch;
  const service = createSocialAiService({
    apiKey: "test-key",
    maxConcurrentRequests: 1,
    fetchImpl: async () => {
      calls += 1;
      return new Promise((resolve) => { resolveFetch = resolve; });
    },
    idFactory: idFactory(),
  });

  const firstRequest = service.generate(input);
  const saturated = await service.generate({ ...input, clubId: "SAN", clubName: "Santos" });
  assert.equal(calls, 1);
  assert.equal(saturated.source, "fallback");
  assert.match(saturated.teamComment.text, /Santos/);

  resolveFetch({
    ok: true,
    async json() {
      return {
        output_text: JSON.stringify({
          teamComment: { author: "Bola IA", role: "ia", text: "Aurora em foco.", sentiment: "neutro" },
          replies: [{
            postId: "player-1",
            comments: [{ author: "Torcida", role: "torcida", text: "Vamos!", sentiment: "positivo" }],
          }],
        }),
      };
    },
  });
  const first = await firstRequest;
  assert.equal(first.source, "gemini");
});

test("fallback nao publica materia para declaracao cotidiana do manager", async () => {
  const service = createSocialAiService({ apiKey: "", idFactory: idFactory() });
  const result = await service.generate({
    ...input,
    posts: [{
      id: "manager-post",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Declaracao do manager",
      body: "Vamos trabalhar forte durante toda a semana.",
    }],
  });

  assert.deepEqual(result.newsArticle, {
    publish: false,
    source: "",
    sourceType: "imprensa",
    headline: "",
    body: "",
    tag: "",
  });
});

test("provedor nao transforma declaracao cotidiana em materia", async () => {
  const service = createSocialAiService({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            teamComment: {
              author: "Central da Rodada",
              role: "imprensa",
              text: "O clube segue em preparacao.",
              sentiment: "neutro",
            },
            replies: [],
            newsArticle: {
              publish: true,
              source: "Central da Rodada",
              sourceType: "imprensa",
              headline: "Treino vira manchete",
              body: "O manager falou sobre a semana.",
              tag: "CLUBE",
            },
          }),
        };
      },
    }),
    idFactory: idFactory(),
  });
  const result = await service.generate({
    ...input,
    posts: [{
      id: "manager-post",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Declaracao do manager",
      body: "Vamos trabalhar forte durante toda a semana.",
    }],
  });

  assert.equal(result.newsArticle.publish, false);
});

test("fallback publica materia para declaracao claramente noticiavel", async () => {
  const service = createSocialAiService({ apiKey: "", idFactory: idFactory() });
  const result = await service.generate({
    ...input,
    posts: [{
      id: "manager-post",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Declaracao do manager",
      body: "Confirmamos a contratação do atacante Pedro até 2029.",
    }],
  });

  assert.equal(result.newsArticle.publish, true);
  assert.equal(result.newsArticle.source, "Central da Rodada");
  assert.equal(result.newsArticle.sourceType, "imprensa");
  assert.equal(result.newsArticle.tag, "MERCADO");
  assert.match(result.newsArticle.headline, /Aurora FC/);
  assert.match(result.newsArticle.body, /contratação do atacante Pedro/);
});

test("sanitiza personas e referencias visiveis ao provedor", async () => {
  const service = createSocialAiService({
    apiKey: "test-key",
    model: "gemini-test",
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          output_text: JSON.stringify({
            teamComment: {
              author: "Bola IA",
              role: "ia",
              text: "Como modelo Gemini, vejo o Aurora em alta.",
              sentiment: "positivo",
            },
            replies: [{
              postId: "player-1",
              comments: [{
                author: "Gemini Bot",
                role: "ia",
                text: "Sou uma IA e concordo com o jogador.",
                sentiment: "positivo",
              }],
            }],
            newsArticle: {
              publish: true,
              source: "Gemini News",
              sourceType: "clube",
              headline: "Modelo aponta grande fase",
              body: "Texto criado pelo bot para o torcedor.",
              tag: "IA",
            },
          }),
        };
      },
    }),
    idFactory: idFactory(),
  });

  const result = await service.generate({
    ...input,
    posts: [{
      ...input.posts[0],
      source: "Manager do clube",
      sourceType: "manager",
      body: "Confirmamos a contratação de um novo atacante.",
    }],
  });
  const visible = {
    teamComment: result.teamComment,
    replies: result.replies,
    newsArticle: result.newsArticle,
  };
  assert.equal(result.source, "gemini");
  assert.equal(result.model, "gemini-test");
  assert.equal(result.teamComment.author, "Central da Rodada");
  assert.equal(result.teamComment.role, "imprensa");
  assert.equal(result.replies[0].comments[0].author, "Arquibancada");
  assert.equal(result.replies[0].comments[0].role, "torcida");
  assert.equal(result.newsArticle.source, "Central da Rodada");
  assert.equal(result.newsArticle.sourceType, "imprensa");
  assert.doesNotMatch(JSON.stringify(visible), /\b(?:IA|Gemini|bot|model(?:o)?)\b/iu);
});

test("modo thread usa resposta fallback conversacional e nunca cria materia", async () => {
  const service = createSocialAiService({ apiKey: "", idFactory: idFactory() });
  const result = await service.generate({
    ...input,
    mode: "thread",
    posts: [{
      id: "thread-reply",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Resposta",
      body: "Confirmamos a contratação do atacante Pedro.",
    }],
  });

  assert.equal(result.newsArticle.publish, false);
  assert.equal(result.replies[0].comments[0].author, "Arquibancada");
  assert.match(result.replies[0].comments[0].text, /Esse ponto faz sentido/);
});
