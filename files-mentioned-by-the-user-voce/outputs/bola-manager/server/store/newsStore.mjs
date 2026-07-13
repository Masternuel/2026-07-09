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

  async #persist(post) {
    if (this.firestore) {
      await this.firestore.collection("news").doc(post.id).set(post);
      return;
    }
    const current = this.memory.get(post.roomCode) ?? [];
    this.memory.set(post.roomCode, [post, ...current].slice(0, 100));
  }
}
