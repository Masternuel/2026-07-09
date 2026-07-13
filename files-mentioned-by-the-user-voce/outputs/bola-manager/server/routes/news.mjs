import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  newsPostIdSchema,
  parseOrThrow,
  roomCodeSchema,
  socialAiFeedSchema,
  socialCommentCreateSchema,
  socialPostCreateSchema,
} from "../schemas.mjs";
import { buildCanonicalEditorials } from "../services/editorialCatalog.mjs";

function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

function routeError(message, code, status = 404) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function sameClub(left, right) {
  return Boolean(left && right && String(left).toUpperCase() === String(right).toUpperCase());
}

function fixtureHasClub(fixture, clubId) {
  return sameClub(fixture?.homeClubId, clubId) || sameClub(fixture?.awayClubId, clubId);
}

function matchHasClub(match, clubName) {
  return sameClub(match?.homeTeam, clubName) || sameClub(match?.awayTeam, clubName);
}

function clubContext(room, managerId) {
  const manager = room.managers.find((candidate) => candidate.id === managerId);
  const clubId = manager?.clubId ?? null;
  const schedule = Array.isArray(room.fixtureSchedule) ? room.fixtureSchedule : [];
  const relatedFixture = schedule.find((fixture) => fixtureHasClub(fixture, clubId));
  const clubName = relatedFixture
    ? sameClub(relatedFixture.homeClubId, clubId)
      ? relatedFixture.homeTeam
      : relatedFixture.awayTeam
    : clubId || "seu clube";
  const completedFixtureIds = new Set((room.completedFixtureIds ?? []).map((fixtureId) => (
    String(fixtureId).toLowerCase()
  )));
  const currentFixture = schedule.find((fixture) => (
    fixtureHasClub(fixture, clubId)
    && String(fixture.fixtureId).toLowerCase() === String(room.currentFixtureId ?? "").toLowerCase()
    && !completedFixtureIds.has(String(fixture.fixtureId).toLowerCase())
  ));
  const nextClubFixture = currentFixture ?? schedule.find((fixture) => (
    fixtureHasClub(fixture, clubId)
    && !completedFixtureIds.has(String(fixture.fixtureId).toLowerCase())
  ));
  const completedMatches = [
    ...(Array.isArray(room.completedMatches) ? room.completedMatches : []),
    room.lastCompletedMatch,
  ].filter(Boolean);
  const latestClubMatch = [...completedMatches].reverse().find((match) => matchHasClub(match, clubName));
  const lastMatch = latestClubMatch ? {
    homeTeam: latestClubMatch.homeTeam,
    awayTeam: latestClubMatch.awayTeam,
    score: latestClubMatch.score,
  } : null;
  const nextFixture = nextClubFixture ? {
    homeTeam: nextClubFixture.homeTeam,
    awayTeam: nextClubFixture.awayTeam,
    competition: nextClubFixture.competition,
    round: nextClubFixture.round,
  } : null;
  return { clubId, clubName, lastMatch, nextFixture };
}

function socialInput(room, managerId, posts) {
  const context = clubContext(room, managerId);
  return {
    clubName: context.clubName,
    lastMatch: context.lastMatch,
    nextFixture: context.nextFixture,
    posts,
  };
}

function enforceCooldown(entries, key, cooldownMs, timestamp, code, message) {
  if (cooldownMs <= 0) return;
  const previous = entries.get(key);
  if (previous !== undefined && timestamp - previous < cooldownMs) {
    const error = new Error(message);
    error.code = code;
    error.status = 429;
    throw error;
  }
  entries.set(key, timestamp);
  if (entries.size <= 2_000) return;
  for (const [entryKey, entryTimestamp] of entries) {
    if (timestamp - entryTimestamp >= cooldownMs) entries.delete(entryKey);
  }
  while (entries.size > 2_000) entries.delete(entries.keys().next().value);
}

function publicComment(comment) {
  if (!comment) return null;
  const {
    authorId: _authorId,
    generated: _generated,
    ...safe
  } = comment;
  return {
    ...safe,
    parentCommentId: comment.parentCommentId ?? null,
    createdAt: comment.createdAt ?? null,
  };
}

function publicPost(post) {
  if (!post) return null;
  const {
    aiSource: _aiSource,
    generatedFromPostId: _generatedFromPostId,
    ...safe
  } = post;
  return {
    ...safe,
    comments: (Array.isArray(post.comments) ? post.comments : [])
      .map(publicComment)
      .filter(Boolean),
  };
}

function publicBundle(generated) {
  return {
    teamComment: publicComment(generated.teamComment),
    replies: generated.replies.map((reply) => ({
      postId: reply.postId,
      comments: reply.comments.map(publicComment).filter(Boolean),
    })),
  };
}

function timestampIso(timestamp) {
  return new Date(timestamp).toISOString();
}

function generatedCommentsForPost(generated, postId, timestamp) {
  return (generated.replies.find((reply) => reply.postId === postId)?.comments ?? []).map((comment) => ({
    ...comment,
    parentCommentId: null,
    createdAt: timestampIso(timestamp),
    generated: true,
  }));
}

export function createNewsRouter(store, newsStore, socialAi, {
  broadcast = () => {},
  now = () => Date.now(),
  aiCooldownMs = 10_000,
  postCooldownMs = 5_000,
  commentCooldownMs = 3_000,
  commentIdFactory = randomUUID,
  logger = console,
} = {}) {
  const router = Router();
  const lastAiAt = new Map();
  const lastPostAt = new Map();
  const lastCommentAt = new Map();

  router.get("/:code", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    await store.requireMembership(code, request.user.uid);
    const posts = await newsStore.list(code);
    response.json({ posts: posts.map(publicPost), source: newsStore.source });
  }));

  router.post("/:code/ai", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    const payload = parseOrThrow(socialAiFeedSchema, request.body);
    const requestTime = Number(now());
    const context = clubContext(room, request.user.uid);
    const canonicalPosts = buildCanonicalEditorials(context, payload.posts);
    if (!canonicalPosts.length) {
      throw routeError("Editorial nao reconhecido", "SOCIAL_EDITORIAL_INVALID", 400);
    }
    const replyTargets = canonicalPosts.filter((post) => post.sourceType === "jogador");
    const input = socialInput(room, request.user.uid, replyTargets);
    const hasReusableResult = socialAi.hasReusableResult?.(input) ?? false;
    if (socialAi.configured && !hasReusableResult) {
      enforceCooldown(
        lastAiAt,
        `${code}:${request.user.uid}`,
        aiCooldownMs,
        requestTime,
        "SOCIAL_AI_RATE_LIMITED",
        "Aguarde alguns segundos antes de atualizar a analise novamente",
      );
    }
    const generated = await socialAi.generate(input);
    const commentsByPostId = new Map(canonicalPosts.map((post) => [
      post.id,
      generatedCommentsForPost(generated, post.id, requestTime).map((comment, index) => ({
        ...comment,
        id: `editorial:${post.id}:${index}`,
      })),
    ]));
    const syncedPosts = await newsStore.syncEditorials({
      roomCode: code,
      clubId: context.clubId,
      posts: canonicalPosts,
      commentsByPostId,
      aiSource: generated.source,
    });
    response.json({
      ...publicBundle(generated),
      posts: syncedPosts.map(publicPost),
    });
  }));

  router.post("/:code/posts", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    const payload = parseOrThrow(socialPostCreateSchema, request.body);
    const requestTime = Number(now());
    enforceCooldown(
      lastPostAt,
      `${code}:${request.user.uid}`,
      postCooldownMs,
      requestTime,
      "SOCIAL_RATE_LIMITED",
      "Aguarde alguns segundos antes de publicar novamente",
    );
    const context = clubContext(room, request.user.uid);
    const manager = room.managers.find((candidate) => candidate.id === request.user.uid);
    const draft = {
      id: "manager-post",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Declaracao do manager",
      body: payload.message,
    };
    const generated = await socialAi.generate(socialInput(room, request.user.uid, [draft]));
    const post = await newsStore.create({
      roomCode: code,
      authorId: request.user.uid,
      authorName: manager?.name || request.user.name,
      clubId: manager?.clubId ?? null,
      body: payload.message,
      comments: generatedCommentsForPost(generated, draft.id, requestTime),
      aiSource: generated.source,
    });
    let generatedPost = null;
    if (generated.newsArticle?.publish) {
      generatedPost = await newsStore.createEditorial({
        roomCode: code,
        clubId: context.clubId,
        article: generated.newsArticle,
        generatedFromPostId: post.id,
        aiSource: generated.source,
      });
    }
    const safePost = publicPost(post);
    const safeGeneratedPost = publicPost(generatedPost);
    broadcast(safePost);
    if (safeGeneratedPost) broadcast(safeGeneratedPost);
    response.status(201).json({
      post: safePost,
      generatedPost: safeGeneratedPost,
      teamComment: publicComment(generated.teamComment),
    });
  }));

  router.post("/:code/posts/:postId/comments", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const postId = parseOrThrow(newsPostIdSchema, request.params.postId);
    const payload = parseOrThrow(socialCommentCreateSchema, request.body);
    const room = await store.requireMembership(code, request.user.uid);
    const requestTime = Number(now());
    enforceCooldown(
      lastCommentAt,
      `${code}:${request.user.uid}`,
      commentCooldownMs,
      requestTime,
      "SOCIAL_COMMENT_RATE_LIMITED",
      "Aguarde alguns segundos antes de responder novamente",
    );
    const post = await newsStore.get(code, postId);
    if (!post) throw routeError("Publicacao nao encontrada", "NEWS_POST_NOT_FOUND");
    const target = (Array.isArray(post.comments) ? post.comments : [])
      .find((comment) => comment.id === payload.parentCommentId);
    if (!target) throw routeError("Comentario nao encontrado", "NEWS_COMMENT_NOT_FOUND");

    const manager = room.managers.find((candidate) => candidate.id === request.user.uid);
    const managerComment = {
      id: commentIdFactory(),
      author: manager?.name || request.user.name,
      authorId: request.user.uid,
      role: "manager",
      text: payload.message,
      sentiment: "neutro",
      parentCommentId: target.id,
      createdAt: timestampIso(requestTime),
      generated: false,
    };
    const draftId = "thread-reply";
    const threadInput = {
      ...socialInput(room, request.user.uid, [{
        id: draftId,
        source: "Manager do clube",
        sourceType: "manager",
        headline: post.headline,
        body: payload.message,
      }]),
      mode: "thread",
      thread: {
        post: { source: post.source, headline: post.headline, body: post.body },
        parent: { author: target.author, role: target.role, text: target.text },
        response: payload.message,
      },
    };
    let generated = null;
    try {
      generated = await socialAi.generate(threadInput);
    } catch {
      logger.warn?.("Repercussao automatica indisponivel para comentario.");
    }
    const generatedComment = generated?.replies
      .find((reply) => reply.postId === draftId)?.comments?.[0];
    const appended = [managerComment];
    if (generatedComment) {
      appended.push({
        ...generatedComment,
        id: commentIdFactory(),
        parentCommentId: managerComment.id,
        createdAt: timestampIso(requestTime),
        generated: true,
      });
    }
    const updatedPost = await newsStore.appendComments({
      roomCode: code,
      postId,
      comments: appended,
    });
    let generatedPost = null;
    if (generated?.newsArticle?.publish) {
      const context = clubContext(room, request.user.uid);
      generatedPost = await newsStore.createEditorial({
        roomCode: code,
        clubId: context.clubId,
        article: generated.newsArticle,
        generatedFromPostId: managerComment.id,
        aiSource: generated.source,
      });
    }
    const safeUpdatedPost = publicPost(updatedPost);
    const safeGeneratedPost = publicPost(generatedPost);
    broadcast(safeUpdatedPost);
    if (safeGeneratedPost) broadcast(safeGeneratedPost);
    response.status(201).json({
      post: safeUpdatedPost,
      comments: appended.map(publicComment),
      generatedPost: safeGeneratedPost,
    });
  }));

  return router;
}
