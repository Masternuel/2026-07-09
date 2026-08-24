import { createHash, randomUUID } from "node:crypto";

export const MAX_NEWS_COMMENTS = 200;

export class NewsStoreError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "NewsStoreError";
    this.code = code;
    this.status = status;
  }
}

function sortNewestFirst(posts) {
  return [...posts].sort((left, right) => (
    Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "")
  ));
}

function isMissingCompositeIndex(error) {
  const code = String(error?.code ?? "").toLowerCase();
  const message = String(error?.message ?? "").toLowerCase();
  return code === "9"
    || code === "failed-precondition"
    || message.includes("requires an index")
    || message.includes("missing index");
}

function cappedComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments.slice(-MAX_NEWS_COMMENTS).map((comment) => ({ ...comment }));
}

function commentKey(comment) {
  if (comment?.id != null) return `id:${comment.id}`;
  return JSON.stringify([
    comment?.author ?? "",
    comment?.role ?? "",
    comment?.text ?? "",
    comment?.parentCommentId ?? null,
  ]);
}

function mergeCommentsPreservingExisting(existing, incoming) {
  const preserved = cappedComments(existing);
  const seen = new Set(preserved.map(commentKey));
  for (const comment of cappedComments(incoming)) {
    if (preserved.length >= MAX_NEWS_COMMENTS) break;
    const key = commentKey(comment);
    if (seen.has(key)) continue;
    preserved.push(comment);
    seen.add(key);
  }
  return preserved;
}

function replaceGeneratedTopLevelComments(existing, incoming) {
  const replacements = cappedComments(incoming);
  if (!replacements.length) return cappedComments(existing);
  const replacedIds = new Set(cappedComments(existing)
    .filter((comment) => comment.generated === true && !comment.parentCommentId)
    .map((comment) => comment.id)
    .filter(Boolean));
  const replacementParentId = replacements[0]?.id ?? null;
  const preserved = cappedComments(existing)
    .filter((comment) => !(comment.generated === true && !comment.parentCommentId))
    .map((comment) => replacedIds.has(comment.parentCommentId)
      ? { ...comment, parentCommentId: replacementParentId }
      : comment);
  return cappedComments([...replacements, ...preserved]);
}

function editorialKeyFor(post) {
  return String(post?.editorialKey ?? post?.id ?? "editorial");
}

function editorialIdFor(roomCode, editorialKey, post) {
  const content = JSON.stringify([
    roomCode,
    editorialKey,
    post?.source ?? "",
    post?.sourceType ?? "",
    post?.tag ?? "",
    post?.headline ?? "",
    post?.body ?? "",
  ]);
  return `editorial-${createHash("sha256").update(content).digest("hex").slice(0, 32)}`;
}

function operationIdFor(roomCode, actorId, kind, requestId) {
  const digest = createHash("sha256")
    .update(JSON.stringify([roomCode, actorId, kind, requestId]))
    .digest("hex");
  return `news-operation-${digest}`;
}

function operationFingerprint(payload) {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

function operationConflict() {
  return new NewsStoreError(
    "requestId ja utilizado por outra solicitacao",
    "NEWS_REQUEST_CONFLICT",
    409,
  );
}

function mappedComments(commentsByPostId, editorialKey) {
  if (commentsByPostId instanceof Map) return commentsByPostId.get(editorialKey);
  return commentsByPostId?.[editorialKey];
}

function snapshotPost(post) {
  if (!post) return null;
  return {
    ...post,
    comments: cappedComments(post.comments),
  };
}

function postNotFound() {
  return new NewsStoreError("Noticia nao encontrada", "NEWS_POST_NOT_FOUND", 404);
}

export class NewsStore {
  constructor({ firestore = null, now = () => new Date(), idFactory = randomUUID } = {}) {
    this.firestore = firestore;
    this.now = now;
    this.idFactory = idFactory;
    this.memory = new Map();
    this.operations = new Map();
  }

  get source() {
    return this.firestore ? "firestore" : "memory";
  }

  async list(roomCode) {
    if (!this.firestore) {
      return sortNewestFirst(this.memory.get(roomCode) ?? [])
        .slice(0, 50)
        .map(snapshotPost);
    }
    const collection = this.firestore.collection("news");
    let snapshot;
    try {
      snapshot = await collection
        .where("roomCode", "==", roomCode)
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
    } catch (error) {
      if (!isMissingCompositeIndex(error)) throw error;
      snapshot = await collection.where("roomCode", "==", roomCode).get();
    }
    return sortNewestFirst(snapshot.docs.map((document) => ({
      ...document.data(),
      id: document.id,
    }))).slice(0, 50).map(snapshotPost);
  }

  async get(roomCode, postId) {
    if (!this.firestore) {
      const post = (this.memory.get(roomCode) ?? []).find((candidate) => candidate.id === postId);
      return snapshotPost(post);
    }

    const document = await this.firestore.collection("news").doc(postId).get();
    if (!document.exists) return null;
    const post = { ...document.data(), id: document.id };
    return post.roomCode === roomCode ? snapshotPost(post) : null;
  }

  async create({ roomCode, authorId, authorName, clubId, body, comments = [], aiSource = "fallback" }) {
    const createdAt = this.now().toISOString();
    const post = {
      id: this.idFactory(),
      roomCode,
      authorId,
      authorName,
      clubId,
      source: authorName,
      sourceType: "manager",
      headline: `Declaração de ${authorName}`,
      body,
      reactions: 0,
      tag: "Sala",
      createdAt,
      comments: cappedComments(comments),
      aiSource,
    };
    await this.#persist(post);
    return snapshotPost(post);
  }

  async createEditorial({
    roomCode,
    clubId,
    article,
    generatedFromPostId,
    comments = [],
    aiSource = "fallback",
  }) {
    const post = {
      id: this.idFactory(),
      roomCode,
      clubId,
      source: article?.source ?? "Central da Bola",
      sourceType: article?.sourceType ?? "imprensa",
      headline: article?.headline ?? "Noticia da rodada",
      body: article?.body ?? "",
      reactions: Number.isFinite(article?.reactions) ? Math.max(0, article.reactions) : 0,
      tag: article?.tag ?? "Noticia",
      createdAt: this.now().toISOString(),
      generatedFromPostId: generatedFromPostId ?? null,
      comments: cappedComments(comments),
      aiSource,
    };
    await this.#persist(post);
    return snapshotPost(post);
  }

  async syncEditorials({
    roomCode,
    clubId,
    posts = [],
    commentsByPostId = {},
    aiSource = "fallback",
  }) {
    const createdAt = this.now().toISOString();
    const candidates = posts.map((article) => {
      const editorialKey = editorialKeyFor(article);
      const comments = mappedComments(commentsByPostId, editorialKey) ?? article?.comments ?? [];
      return {
        id: editorialIdFor(roomCode, editorialKey, article),
        roomCode,
        clubId: article?.clubId ?? clubId ?? null,
        source: article?.source ?? "Central da Bola",
        sourceType: article?.sourceType ?? "imprensa",
        headline: article?.headline ?? "Noticia da rodada",
        body: article?.body ?? "",
        reactions: Number.isFinite(article?.reactions) ? Math.max(0, article.reactions) : 0,
        tag: article?.tag ?? "Noticia",
        createdAt,
        editorialKey,
        comments: cappedComments(comments),
        aiSource: article?.aiSource ?? aiSource,
      };
    });

    if (!this.firestore) {
      const current = this.memory.get(roomCode) ?? [];
      const synchronized = candidates.map((candidate) => {
        const index = current.findIndex((post) => post.id === candidate.id);
        if (index === -1) {
          current.unshift(candidate);
          return candidate;
        }
        const existing = current[index];
        const merged = {
          ...existing,
          comments: mergeCommentsPreservingExisting(existing.comments, candidate.comments),
        };
        current[index] = merged;
        return merged;
      });
      this.memory.set(roomCode, current.slice(0, 100));
      return synchronized.map(snapshotPost);
    }

    const references = candidates.map((candidate) => (
      this.firestore.collection("news").doc(candidate.id)
    ));
    let synchronized = [];
    await this.firestore.runTransaction(async (transaction) => {
      const documents = [];
      for (const reference of references) documents.push(await transaction.get(reference));

      synchronized = candidates.map((candidate, index) => {
        const document = documents[index];
        if (!document.exists) {
          transaction.set(references[index], candidate);
          return candidate;
        }
        const existing = { ...document.data(), id: document.id };
        if (existing.roomCode !== roomCode) {
          throw new NewsStoreError("Conflito ao sincronizar noticia", "NEWS_EDITORIAL_CONFLICT", 409);
        }
        const comments = mergeCommentsPreservingExisting(existing.comments, candidate.comments);
        if (JSON.stringify(comments) !== JSON.stringify(existing.comments ?? [])) {
          transaction.update(references[index], { comments });
        }
        return { ...existing, comments };
      });
    });
    return synchronized.map(snapshotPost);
  }

  async ensureEditorials(options) {
    return this.syncEditorials(options);
  }

  async appendComments({ roomCode, postId, comments }) {
    const additions = cappedComments(comments);

    if (!this.firestore) {
      const posts = this.memory.get(roomCode) ?? [];
      const index = posts.findIndex((post) => post.id === postId);
      if (index === -1) throw postNotFound();
      const updated = {
        ...posts[index],
        comments: cappedComments([...(posts[index].comments ?? []), ...additions]),
      };
      posts[index] = updated;
      return snapshotPost(updated);
    }

    const reference = this.firestore.collection("news").doc(postId);
    let updated = null;
    await this.firestore.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) throw postNotFound();
      const current = document.data();
      if (current.roomCode !== roomCode) throw postNotFound();
      const mergedComments = cappedComments([...(current.comments ?? []), ...additions]);
      transaction.update(reference, { comments: mergedComments });
      updated = { ...current, id: document.id, comments: mergedComments };
    });
    return snapshotPost(updated);
  }

  async replaceGeneratedComments({ roomCode, postId, comments, aiSource = "gemini" }) {
    const replacements = cappedComments(comments);
    if (!replacements.length) return this.get(roomCode, postId);

    if (!this.firestore) {
      const posts = this.memory.get(roomCode) ?? [];
      const index = posts.findIndex((post) => post.id === postId);
      if (index === -1) throw postNotFound();
      const updated = {
        ...posts[index],
        comments: replaceGeneratedTopLevelComments(posts[index].comments, replacements),
        aiSource,
      };
      posts[index] = updated;
      return snapshotPost(updated);
    }

    const reference = this.firestore.collection("news").doc(postId);
    let updated = null;
    await this.firestore.runTransaction(async (transaction) => {
      const document = await transaction.get(reference);
      if (!document.exists) throw postNotFound();
      const current = document.data();
      if (current.roomCode !== roomCode) throw postNotFound();
      const mergedComments = replaceGeneratedTopLevelComments(current.comments, replacements);
      transaction.update(reference, { comments: mergedComments, aiSource });
      updated = { ...current, id: document.id, comments: mergedComments, aiSource };
    });
    return snapshotPost(updated);
  }

  async getOperationResult({ roomCode, actorId, kind, requestId, payload }) {
    if (!requestId) return null;
    const id = operationIdFor(roomCode, actorId, kind, requestId);
    const expectedFingerprint = operationFingerprint(payload);
    let operation = null;
    if (!this.firestore) {
      operation = this.operations.get(id) ?? null;
    } else {
      const document = await this.firestore.collection("newsOperations").doc(id).get();
      operation = document.exists ? document.data() : null;
    }
    if (!operation) return null;
    if (operation.fingerprint !== expectedFingerprint) throw operationConflict();
    return this.#materializeOperation(operation);
  }

  async createManagerPostWithOperation({
    roomCode,
    actorId,
    requestId,
    requestPayload,
    authorName,
    clubId,
    body,
    comments = [],
    aiSource = "fallback",
    teamComment = null,
    generatedArticle = null,
  }) {
    if (!requestId) {
      const post = await this.create({
        roomCode,
        authorId: actorId,
        authorName,
        clubId,
        body,
        comments,
        aiSource,
      });
      const generatedPost = generatedArticle?.publish
        ? await this.createEditorial({
          roomCode,
          clubId,
          article: generatedArticle,
          generatedFromPostId: post.id,
          aiSource,
        })
        : null;
      return { post, generatedPost, teamComment, comments: [], replayed: false };
    }

    const existing = await this.getOperationResult({
      roomCode,
      actorId,
      kind: "publish",
      requestId,
      payload: requestPayload,
    });
    if (existing) return { ...existing, replayed: true };

    const createdAt = this.now().toISOString();
    const post = {
      id: this.idFactory(),
      roomCode,
      authorId: actorId,
      authorName,
      clubId,
      source: authorName,
      sourceType: "manager",
      headline: `Declaração de ${authorName}`,
      body,
      reactions: 0,
      tag: "Sala",
      createdAt,
      comments: cappedComments(comments),
      aiSource,
    };
    const generatedPost = generatedArticle?.publish ? {
      id: this.idFactory(),
      roomCode,
      clubId,
      source: generatedArticle.source ?? "Central da Bola",
      sourceType: generatedArticle.sourceType ?? "imprensa",
      headline: generatedArticle.headline ?? "Noticia da rodada",
      body: generatedArticle.body ?? "",
      reactions: Number.isFinite(generatedArticle.reactions)
        ? Math.max(0, generatedArticle.reactions)
        : 0,
      tag: generatedArticle.tag ?? "Noticia",
      createdAt,
      generatedFromPostId: post.id,
      comments: [],
      aiSource,
    } : null;
    const operation = {
      roomCode,
      actorId,
      kind: "publish",
      fingerprint: operationFingerprint(requestPayload),
      postId: post.id,
      generatedPostId: generatedPost?.id ?? null,
      commentIds: [],
      teamComment,
      createdAt,
    };
    const operationId = operationIdFor(roomCode, actorId, "publish", requestId);

    if (!this.firestore) {
      const raced = this.operations.get(operationId);
      if (raced) {
        if (raced.fingerprint !== operation.fingerprint) throw operationConflict();
        return { ...(await this.#materializeOperation(raced)), replayed: true };
      }
      const current = this.memory.get(roomCode) ?? [];
      this.memory.set(roomCode, [
        ...(generatedPost ? [generatedPost] : []),
        post,
        ...current,
      ].slice(0, 100));
      this.operations.set(operationId, operation);
      return { ...(await this.#materializeOperation(operation)), replayed: false };
    }

    const operationReference = this.firestore.collection("newsOperations").doc(operationId);
    const postReference = this.firestore.collection("news").doc(post.id);
    const generatedReference = generatedPost
      ? this.firestore.collection("news").doc(generatedPost.id)
      : null;
    let committedOperation = operation;
    let replayed = false;
    await this.firestore.runTransaction(async (transaction) => {
      const operationDocument = await transaction.get(operationReference);
      if (operationDocument.exists) {
        committedOperation = operationDocument.data();
        if (committedOperation.fingerprint !== operation.fingerprint) throw operationConflict();
        replayed = true;
        return;
      }
      transaction.set(postReference, post);
      if (generatedReference) transaction.set(generatedReference, generatedPost);
      transaction.set(operationReference, operation);
    });
    return { ...(await this.#materializeOperation(committedOperation)), replayed };
  }

  async appendCommentsWithOperation({
    roomCode,
    postId,
    actorId,
    requestId,
    requestPayload,
    comments,
    clubId,
    generatedArticle = null,
    generatedFromPostId = null,
    aiSource = "fallback",
    teamComment = null,
  }) {
    if (!requestId) {
      const post = await this.appendComments({ roomCode, postId, comments });
      const generatedPost = generatedArticle?.publish
        ? await this.createEditorial({
          roomCode,
          clubId,
          article: generatedArticle,
          generatedFromPostId,
          aiSource,
        })
        : null;
      return { post, generatedPost, teamComment, comments, replayed: false };
    }

    const existing = await this.getOperationResult({
      roomCode,
      actorId,
      kind: "reply",
      requestId,
      payload: requestPayload,
    });
    if (existing) return { ...existing, replayed: true };

    const createdAt = this.now().toISOString();
    const additions = cappedComments(comments);
    const generatedPost = generatedArticle?.publish ? {
      id: this.idFactory(),
      roomCode,
      clubId,
      source: generatedArticle.source ?? "Central da Bola",
      sourceType: generatedArticle.sourceType ?? "imprensa",
      headline: generatedArticle.headline ?? "Noticia da rodada",
      body: generatedArticle.body ?? "",
      reactions: Number.isFinite(generatedArticle.reactions)
        ? Math.max(0, generatedArticle.reactions)
        : 0,
      tag: generatedArticle.tag ?? "Noticia",
      createdAt,
      generatedFromPostId,
      comments: [],
      aiSource,
    } : null;
    const operation = {
      roomCode,
      actorId,
      kind: "reply",
      fingerprint: operationFingerprint(requestPayload),
      postId,
      generatedPostId: generatedPost?.id ?? null,
      commentIds: additions.map((comment) => comment.id).filter(Boolean),
      teamComment,
      createdAt,
    };
    const operationId = operationIdFor(roomCode, actorId, "reply", requestId);

    if (!this.firestore) {
      const raced = this.operations.get(operationId);
      if (raced) {
        if (raced.fingerprint !== operation.fingerprint) throw operationConflict();
        return { ...(await this.#materializeOperation(raced)), replayed: true };
      }
      const posts = this.memory.get(roomCode) ?? [];
      const index = posts.findIndex((post) => post.id === postId);
      if (index === -1) throw postNotFound();
      posts[index] = {
        ...posts[index],
        comments: cappedComments([...(posts[index].comments ?? []), ...additions]),
      };
      if (generatedPost) posts.unshift(generatedPost);
      this.memory.set(roomCode, posts.slice(0, 100));
      this.operations.set(operationId, operation);
      return { ...(await this.#materializeOperation(operation)), replayed: false };
    }

    const operationReference = this.firestore.collection("newsOperations").doc(operationId);
    const postReference = this.firestore.collection("news").doc(postId);
    const generatedReference = generatedPost
      ? this.firestore.collection("news").doc(generatedPost.id)
      : null;
    let committedOperation = operation;
    let replayed = false;
    await this.firestore.runTransaction(async (transaction) => {
      const operationDocument = await transaction.get(operationReference);
      if (operationDocument.exists) {
        committedOperation = operationDocument.data();
        if (committedOperation.fingerprint !== operation.fingerprint) throw operationConflict();
        replayed = true;
        return;
      }
      const postDocument = await transaction.get(postReference);
      if (!postDocument.exists || postDocument.data().roomCode !== roomCode) throw postNotFound();
      const current = postDocument.data();
      transaction.update(postReference, {
        comments: cappedComments([...(current.comments ?? []), ...additions]),
      });
      if (generatedReference) transaction.set(generatedReference, generatedPost);
      transaction.set(operationReference, operation);
    });
    return { ...(await this.#materializeOperation(committedOperation)), replayed };
  }

  async #materializeOperation(operation) {
    const post = await this.get(operation.roomCode, operation.postId);
    if (!post) throw postNotFound();
    const generatedPost = operation.generatedPostId
      ? await this.get(operation.roomCode, operation.generatedPostId)
      : null;
    const commentIds = new Set(operation.commentIds ?? []);
    return {
      post,
      generatedPost,
      teamComment: operation.teamComment ?? null,
      comments: (post.comments ?? []).filter((comment) => commentIds.has(comment.id)),
    };
  }

  async #persist(post) {
    if (this.firestore) {
      await this.firestore.collection("news").doc(post.id).set(post);
      return;
    }
    const current = this.memory.get(post.roomCode) ?? [];
    this.memory.set(post.roomCode, [post, ...current].slice(0, 100));
  }
}
