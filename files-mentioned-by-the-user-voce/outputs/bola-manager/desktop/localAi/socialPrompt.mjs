// Turns a social-feed request into a SHORT task a small local model handles well: the game
// picks every author, role and tone; the model only writes the texts (and one headline).
// Measured on Qwen3 1.7B: asking it for the full Gemini JSON (authors, roles, ids) made it
// copy the posts and mix up authors; slot texts with a JSON grammar read naturally.
import { createHash } from "node:crypto";

export const LOCAL_MAX_REPLIES = 3;
const TEXT_LIMIT = 200;

const FANS = ["Fiel da Arquibancada", "Sócio-torcedor", "Torcida Organizada", "Arquibancada Norte", "Fanático de Carteirinha", "Velha Guarda", "Geral do Estádio"];
const PRESS = ["Central da Rodada", "Rádio Esporte Já", "Jornal da Bola", "Lance a Lance", "Placar Diário"];

const pick = (list, seed) => list[createHash("sha256").update(String(seed)).digest()[0] % list.length];
const clean = (value, max = 160) => String(value ?? "").replace(/\s+/gu, " ").trim().slice(0, max);

function matchMood(input) {
  const match = input.lastMatch;
  const score = Array.isArray(match?.score) ? match.score.map(Number) : null;
  if (!match || !score || score.some((value) => !Number.isFinite(value))) return { text: "", sentiment: "neutro" };
  const home = clean(match.homeTeam, 60);
  const away = clean(match.awayTeam, 60);
  const club = clean(input.clubName, 60).toLocaleLowerCase("pt-BR");
  const ours = home.toLocaleLowerCase("pt-BR") === club ? score[0] - score[1] : away.toLocaleLowerCase("pt-BR") === club ? score[1] - score[0] : 0;
  return {
    text: `Último jogo: ${home} ${score[0]} x ${score[1]} ${away}.`,
    sentiment: ours > 0 ? "positivo" : ours < 0 ? "critico" : "neutro",
  };
}

export function buildLocalSocialTask(input) {
  const clubName = clean(input?.clubName, 60) || "o clube";
  const mood = matchMood(input ?? {});
  const next = input?.nextFixture ? `Próximo jogo: ${clean(input.nextFixture.homeTeam, 60)} x ${clean(input.nextFixture.awayTeam, 60)}.` : "";
  const tone = { positivo: "animado", critico: "cobrando o time", neutro: "equilibrado" }[mood.sentiment];
  const posts = (Array.isArray(input?.posts) ? input.posts : []).slice(0, LOCAL_MAX_REPLIES);
  const lines = [`Clube: ${clubName}.`, mood.text, next].filter(Boolean);
  if (input?.mode === "thread") {
    lines.push(`Post original: "${clean(input.thread?.post?.body)}"`,
      `Comentário de ${clean(input.thread?.parent?.author, 40) || "um torcedor"}: "${clean(input.thread?.parent?.text)}"`,
      `O manager respondeu: "${clean(input.thread?.response)}"`,
      "geral: a réplica do torcedor, em primeira pessoa, falando direto com o manager (sem narrar, sem aspas).",
      "respostas: deixe a lista vazia.", "manchete: deixe vazio.");
  } else {
    lines.push(`geral: um torcedor do ${clubName} comenta a fase do time, em primeira pessoa e em tom ${tone}.`);
    posts.forEach((post, index) => {
      lines.push(`respostas[${index}]: um torcedor responde ao post de ${clean(post.source, 40) || "um perfil"}: "${clean(post.body || post.headline)}"`);
    });
    lines.push("manchete: manchete de jornal esportivo com até 10 palavras sobre o momento do clube, sem inventar fatos.");
  }
  return {
    system: "Você escreve comentários curtos de rede social sobre futebol brasileiro, em português do Brasil informal, como torcedores reais. Cada texto tem no máximo 2 frases, com emoção, e nunca repete o post original. Use só os fatos dados. Nunca fale de inteligência artificial.",
    prompt: `${lines.join("\n")} /no_think`,
    schema: {
      type: "object",
      properties: {
        geral: { type: "string", maxLength: TEXT_LIMIT },
        respostas: { type: "array", items: { type: "string", maxLength: TEXT_LIMIT }, minItems: input?.mode === "thread" ? 0 : posts.length, maxItems: input?.mode === "thread" ? 0 : posts.length },
        manchete: { type: "string", maxLength: 90 },
      },
      required: ["geral", "respostas", "manchete"],
    },
    maxTokens: 70 + posts.length * 60 + 40,
  };
}

// Model texts -> the bundle shape the social service validates and normalizes.
export function bundleFromLocalTexts(input, texts) {
  const clubName = clean(input?.clubName, 60) || "o clube";
  const mood = matchMood(input ?? {});
  const posts = (Array.isArray(input?.posts) ? input.posts : []).slice(0, LOCAL_MAX_REPLIES);
  const text = (value) => clean(value, 320);
  const general = text(texts?.geral);
  if (!general) throw Object.assign(new Error("Resposta local vazia"), { code: "INVALID_RESPONSE" });
  const replies = input?.mode === "thread" ? [] : posts.map((post, index) => ({
    postId: post.id,
    comments: [{ author: pick(FANS, `${post.id}|fan`), role: "torcida", text: text(texts?.respostas?.[index]) || general, sentiment: mood.sentiment }],
  }));
  const headline = clean(texts?.manchete, 180);
  const managerPost = posts.find((post) => post.sourceType === "manager");
  return {
    teamComment: { author: pick(FANS, `${clubName}|${general.length}`), role: "torcida", text: general, sentiment: mood.sentiment },
    replies: input?.mode === "thread"
      ? (posts[0] ? [{ postId: posts[0].id, comments: [{ author: pick(FANS, `${posts[0].id}|thread`), role: "torcida", text: general, sentiment: "neutro" }] }] : [])
      : replies,
    // The service publishes it only for a newsworthy manager statement (same rule as Gemini).
    newsArticle: headline && managerPost ? {
      publish: true, source: pick(PRESS, managerPost.id), sourceType: "imprensa", headline,
      body: `Em declaração pública, o manager do ${clubName} afirmou: “${clean(managerPost.body, 600)}”`, tag: "NOTÍCIAS",
    } : { publish: false, source: "", sourceType: "imprensa", headline: "", body: "", tag: "" },
  };
}
