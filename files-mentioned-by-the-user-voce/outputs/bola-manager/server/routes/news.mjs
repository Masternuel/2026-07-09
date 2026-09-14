import { randomUUID } from "node:crypto";
import { Router } from "express";
import {
  newsPostIdSchema,
  parseOrThrow,
  pressConferenceCreateSchema,
  roomCodeSchema,
  socialAiFeedSchema,
  socialCommentCreateSchema,
  socialPostCreateSchema,
} from "../schemas.mjs";
import { buildCanonicalEditorials } from "../services/editorialCatalog.mjs";
import {
  buildPressConferenceEditorial,
  fallbackPressComment,
} from "../services/pressConference.mjs";

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

function compactText(value, maxLength, fallback = "") {
  const normalized = String(value ?? "").trim();
  const safe = normalized || fallback;
  return safe.length <= maxLength ? safe : `${safe.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function careerNewsVisibleToClub(news, clubId) {
  const clubIds = Array.isArray(news?.clubIds) ? news.clubIds.filter(Boolean) : [];
  if (!clubIds.length) return true;
  return clubIds.some((candidate) => sameClub(candidate, clubId));
}

function buildCanonicalCareerEditorials(room, managerId, requestedPosts = []) {
  const manager = room.managers.find((candidate) => candidate.id === managerId);
  const context = clubContext(room, managerId);
  const persistedNews = Array.isArray(room?.clubCareerState?.news)
    ? room.clubCareerState.news
    : [];
  const persistedById = new Map(persistedNews.map((news) => [String(news?.id ?? ""), news]));
  const seen = new Set();

  return requestedPosts.flatMap((requested) => {
    const id = String(requested?.id ?? "").trim();
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const news = persistedById.get(id);
    if (!news || !careerNewsVisibleToClub(news, manager?.clubId)) return [];

    const headline = compactText(news.title, 180);
    const body = compactText(news.content || news.summary, 800);
    if (!headline || !body) return [];
    const clubIds = Array.isArray(news.clubIds) ? news.clubIds.filter(Boolean) : [];
    const source = clubIds.some((clubId) => sameClub(clubId, manager?.clubId))
      ? context.clubName
      : "Central da carreira";

    return [{
      id,
      clubId: manager?.clubId ?? null,
      source: compactText(source, 80, "Central da carreira"),
      sourceType: "clube",
      headline,
      body,
      reactions: 0,
      tag: compactText(news.category, 40, "Carreira"),
    }];
  });
}

function canonicalRequestedEditorials(room, managerId, requestedPosts) {
  const context = clubContext(room, managerId);
  const careerPosts = buildCanonicalCareerEditorials(room, managerId, requestedPosts);
  const legacyPosts = buildCanonicalEditorials(context, requestedPosts);
  const byId = new Map([...legacyPosts, ...careerPosts].map((post) => [post.id, post]));
  return requestedPosts.flatMap((requested) => {
    const post = byId.get(String(requested?.id ?? "").trim());
    if (!post) return [];
    byId.delete(post.id);
    return [post];
  });
}

function enforceCooldown(entries, key, cooldownMs, timestamp, code, message, requestId = null) {
  if (cooldownMs <= 0) return;
  const previous = entries.get(key);
  const previousTimestamp = typeof previous === "object" ? previous.timestamp : previous;
  if (requestId && typeof previous === "object" && previous.requestId === requestId) return;
  if (previousTimestamp !== undefined && timestamp - previousTimestamp < cooldownMs) {
    const error = new Error(message);
    error.code = code;
    error.status = 429;
    throw error;
  }
  entries.set(key, requestId ? { timestamp, requestId } : timestamp);
  if (entries.size <= 2_000) return;
  for (const [entryKey, entryTimestamp] of entries) {
    const recordedAt = typeof entryTimestamp === "object" ? entryTimestamp.timestamp : entryTimestamp;
    if (timestamp - recordedAt >= cooldownMs) entries.delete(entryKey);
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

function publicBundle(generated, allowedPostIds = null) {
  return {
    teamComment: publicComment(generated.teamComment),
    replies: generated.replies
      .filter((reply) => !allowedPostIds || allowedPostIds.has(reply.postId))
      .map((reply) => ({
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
  broadcastRoom = () => {},
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

  async function listWithRecoveredPressConferences(room) {
    const existingPosts = await newsStore.list(room.code);
    const existingKeys = new Set(existingPosts.map((post) => post.editorialKey).filter(Boolean));
    const recentMatches = [
      ...(Array.isArray(room.completedMatches) ? room.completedMatches.slice(-5) : []),
      room.lastCompletedMatch,
    ].filter(Boolean);
    const uniqueMatches = [...new Map(recentMatches.map((match) => [String(match.id), match])).values()];
    const recoverable = [];
    const commentsByPostId = new Map();

    for (const match of uniqueMatches) {
      for (const submission of match.pressConferenceSubmissions ?? []) {
        const manager = room.managers.find((candidate) => candidate.id === submission.managerId);
        const editorial = buildPressConferenceEditorial({ room, match, manager, submission });
        if (existingKeys.has(editorial.editorialKey)) continue;
        const createdAt = submission.submittedAt || timestampIso(Number(now()));
        recoverable.push(editorial);
        commentsByPostId.set(editorial.editorialKey, [{
          ...fallbackPressComment(submission),
          id: `press:${submission.matchId}:${submission.managerId}:comment:0`,
          parentCommentId: null,
          createdAt,
          generated: true,
        }]);
      }
    }
    if (!recoverable.length) return existingPosts;

    try {
      const recovered = await newsStore.syncEditorials({
        roomCode: room.code,
        posts: recoverable,
        commentsByPostId,
        aiSource: "fallback",
      });
      recovered.forEach((post) => broadcast(publicPost(post)));
      return newsStore.list(room.code);
    } catch {
      logger.warn?.("Nao foi possivel recuperar imediatamente a repercussao de uma coletiva.");
      return existingPosts;
    }
  }

  router.get("/:code", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    const posts = await listWithRecoveredPressConferences(room);
    response.json({ posts: posts.map(publicPost), source: newsStore.source });
  }));

  router.post("/:code/ai", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    const payload = parseOrThrow(socialAiFeedSchema, request.body);
    const requestTime = Number(now());
    const context = clubContext(room, request.user.uid);
    const canonicalPosts = canonicalRequestedEditorials(room, request.user.uid, payload.posts);
    if (!canonicalPosts.length) {
      throw routeError("Editorial nao reconhecido", "SOCIAL_EDITORIAL_INVALID", 400);
    }
    const careerPostIds = new Set(buildCanonicalCareerEditorials(
      room,
      request.user.uid,
      payload.posts,
    ).map((post) => post.id));
    const replyTargets = canonicalPosts.filter((post) => (
      post.sourceType === "jogador" || careerPostIds.has(post.id)
    ));
    const existingPosts = await newsStore.list(code);
    const recoveryCapacity = Math.max(0, 8 - replyTargets.length);
    const recoveryEntries = existingPosts
      .filter((post) => post.sourceType === "manager"
        && post.aiSource === "fallback"
        && (post.authorId === request.user.uid || sameClub(post.clubId, context.clubId)))
      .slice(0, recoveryCapacity)
      .map((post, index) => ({
        post,
        target: {
          id: `recover-manager-${index}`,
          source: post.authorName || post.source || "Manager do clube",
          sourceType: "manager",
          headline: post.headline || "Declaracao do manager",
          body: post.body || "",
        },
      }));
    const input = socialInput(
      room,
      request.user.uid,
      [...replyTargets, ...recoveryEntries.map((entry) => entry.target)],
    );
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
    const generated = await socialAi.generate(input, { uid: request.user.uid, operation: "feed" });
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
    const recoveredPosts = [];
    if (generated.source === "gemini") {
      for (const { post, target } of recoveryEntries) {
        const comments = generatedCommentsForPost(generated, target.id, requestTime);
        if (!comments.length) continue;
        const recovered = await newsStore.replaceGeneratedComments({
          roomCode: code,
          postId: post.id,
          comments,
          aiSource: generated.source,
        });
        if (!recovered) continue;
        recoveredPosts.push(recovered);
        broadcast(publicPost(recovered));
      }
    }
    response.json({
      ...publicBundle(generated, new Set(canonicalPosts.map((post) => post.id))),
      posts: [...syncedPosts, ...recoveredPosts].map(publicPost),
    });
  }));

  router.post("/:code/press-conferences", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const payload = parseOrThrow(pressConferenceCreateSchema, request.body);
    if (typeof store.submitPressConference !== "function") {
      throw routeError("Coletiva indisponivel nesta sala", "PRESS_CONFERENCE_UNAVAILABLE", 503);
    }
    const result = await store.submitPressConference(code, request.user.uid, payload);
    const { room, submission, alreadySubmitted } = result;

    const match = (room.completedMatches ?? []).find(
      (candidate) => String(candidate?.id ?? "") === submission.matchId,
    ) ?? room.lastCompletedMatch;
    const manager = room.managers.find((candidate) => candidate.id === request.user.uid);
    const editorial = buildPressConferenceEditorial({ room, match, manager, submission });
    const existing = (await newsStore.list(code)).find(
      (post) => post.editorialKey === editorial.editorialKey,
    );

    let post = existing ?? null;
    if (!post) {
      const requestTime = Number(now());
      const draft = {
        id: editorial.editorialKey,
        source: manager?.name || request.user.name,
        sourceType: "manager",
        headline: editorial.headline,
        body: editorial.body,
      };
      let comments = [fallbackPressComment(submission)];
      let aiSource = "fallback";
      try {
        const generated = await socialAi.generate(socialInput(room, request.user.uid, [draft]), { uid: request.user.uid, operation: "press" });
        const generatedComments = generatedCommentsForPost(
          generated,
          editorial.editorialKey,
          requestTime,
        );
        if (generatedComments.length) comments = generatedComments;
        aiSource = generated.source ?? aiSource;
      } catch {
        logger.warn?.("Repercussao automatica indisponivel para a coletiva.");
      }
      comments = comments.slice(0, 2).map((comment, index) => ({
        ...comment,
        id: `press:${submission.matchId}:${submission.managerId}:comment:${index}`,
        parentCommentId: null,
        createdAt: comment.createdAt ?? timestampIso(requestTime),
        generated: true,
      }));
      [post] = await newsStore.syncEditorials({
        roomCode: code,
        clubId: submission.clubId,
        posts: [editorial],
        commentsByPostId: new Map([[editorial.editorialKey, comments]]),
        aiSource,
      });
      broadcast(publicPost(post));
    }
    response.status(alreadySubmitted ? 200 : 201).json({
      submission,
      alreadySubmitted,
      effects: submission.effects,
      post: publicPost(post),
    });
    setImmediate(() => {
      Promise.resolve(broadcastRoom(room)).catch((error) => {
        logger.error?.("room.broadcast_failed", { code: room.code, error });
      });
    });
  }));

  router.post("/:code/posts", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const room = await store.requireMembership(code, request.user.uid);
    const payload = parseOrThrow(socialPostCreateSchema, request.body);
    const requestPayload = { message: payload.message };
    const previous = await newsStore.getOperationResult({
      roomCode: code,
      actorId: request.user.uid,
      kind: "publish",
      requestId: payload.requestId,
      payload: requestPayload,
    });
    if (previous) {
      response.status(200).json({
        post: publicPost(previous.post),
        generatedPost: publicPost(previous.generatedPost),
        teamComment: publicComment(previous.teamComment),
      });
      return;
    }
    const requestTime = Number(now());
    enforceCooldown(
      lastPostAt,
      `${code}:${request.user.uid}`,
      postCooldownMs,
      requestTime,
      "SOCIAL_RATE_LIMITED",
      "Aguarde alguns segundos antes de publicar novamente",
      payload.requestId,
    );
    const manager = room.managers.find((candidate) => candidate.id === request.user.uid);
    const draft = {
      id: "manager-post",
      source: "Manager do clube",
      sourceType: "manager",
      headline: "Declaracao do manager",
      body: payload.message,
    };
    const generated = await socialAi.generate(socialInput(room, request.user.uid, [draft]), { uid: request.user.uid, operation: "post" });
    const result = await newsStore.createManagerPostWithOperation({
      roomCode: code,
      actorId: request.user.uid,
      requestId: payload.requestId,
      requestPayload,
      authorName: manager?.name || request.user.name,
      clubId: manager?.clubId ?? null,
      body: payload.message,
      comments: generatedCommentsForPost(generated, draft.id, requestTime),
      aiSource: generated.source,
      teamComment: generated.teamComment,
      generatedArticle: generated.newsArticle,
    });
    const safePost = publicPost(result.post);
    const safeGeneratedPost = publicPost(result.generatedPost);
    if (!result.replayed) {
      broadcast(safePost);
      if (safeGeneratedPost) broadcast(safeGeneratedPost);
    }
    response.status(result.replayed ? 200 : 201).json({
      post: safePost,
      generatedPost: safeGeneratedPost,
      teamComment: publicComment(result.teamComment),
    });
  }));

  router.post("/:code/posts/:postId/comments", asyncRoute(async (request, response) => {
    const code = parseOrThrow(roomCodeSchema, request.params.code);
    const postId = parseOrThrow(newsPostIdSchema, request.params.postId);
    const payload = parseOrThrow(socialCommentCreateSchema, request.body);
    const room = await store.requireMembership(code, request.user.uid);
    const requestPayload = {
      postId,
      parentCommentId: payload.parentCommentId,
      message: payload.message,
    };
    const previous = await newsStore.getOperationResult({
      roomCode: code,
      actorId: request.user.uid,
      kind: "reply",
      requestId: payload.requestId,
      payload: requestPayload,
    });
    if (previous) {
      response.status(200).json({
        post: publicPost(previous.post),
        comments: previous.comments.map(publicComment),
        generatedPost: publicPost(previous.generatedPost),
      });
      return;
    }
    const requestTime = Number(now());
    enforceCooldown(
      lastCommentAt,
      `${code}:${request.user.uid}`,
      commentCooldownMs,
      requestTime,
      "SOCIAL_COMMENT_RATE_LIMITED",
      "Aguarde alguns segundos antes de responder novamente",
      payload.requestId,
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
      generated = await socialAi.generate(threadInput, { uid: request.user.uid, operation: "comment" });
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
    const context = clubContext(room, request.user.uid);
    const result = await newsStore.appendCommentsWithOperation({
      roomCode: code,
      postId,
      actorId: request.user.uid,
      requestId: payload.requestId,
      requestPayload,
      comments: appended,
      clubId: context.clubId,
      generatedArticle: generated?.newsArticle,
      generatedFromPostId: managerComment.id,
      aiSource: generated?.source,
    });
    const safeUpdatedPost = publicPost(result.post);
    const safeGeneratedPost = publicPost(result.generatedPost);
    if (!result.replayed) {
      broadcast(safeUpdatedPost);
      if (safeGeneratedPost) broadcast(safeGeneratedPost);
    }
    response.status(result.replayed ? 200 : 201).json({
      post: safeUpdatedPost,
      comments: result.comments.map(publicComment),
      generatedPost: safeGeneratedPost,
    });
  }));

  return router;
}
