import assert from "node:assert/strict";
import test from "node:test";
import { MAX_NEWS_COMMENTS, NewsStore, NewsStoreError } from "../store/newsStore.mjs";

test("Firestore ordena news antes de limitar o feed", async () => {
  const calls = [];
  const query = {
    where(...args) {
      calls.push(["where", ...args]);
      return this;
    },
    orderBy(...args) {
      calls.push(["orderBy", ...args]);
      return this;
    },
    limit(...args) {
      calls.push(["limit", ...args]);
      return this;
    },
    async get() {
      calls.push(["get"]);
      return {
        docs: [
          { id: "new", data: () => ({ roomCode: "BOLA-T3ST", createdAt: "2026-07-12T12:00:00.000Z" }) },
          { id: "old", data: () => ({ roomCode: "BOLA-T3ST", createdAt: "2026-07-11T12:00:00.000Z" }) },
        ],
      };
    },
  };
  const firestore = {
    collection(name) {
      assert.equal(name, "news");
      return query;
    },
  };
  const store = new NewsStore({ firestore });

  const posts = await store.list("BOLA-T3ST");

  assert.deepEqual(calls, [
    ["where", "roomCode", "==", "BOLA-T3ST"],
    ["orderBy", "createdAt", "desc"],
    ["limit", 50],
    ["get"],
  ]);
  assert.deepEqual(posts.map((post) => post.id), ["new", "old"]);
});

test("Firestore usa fallback sem indice composto e ainda devolve os mais novos", async () => {
  const calls = [];
  const documents = [
    { id: "old", data: () => ({ roomCode: "BOLA-T3ST", createdAt: "2026-07-10T12:00:00.000Z" }) },
    { id: "new", data: () => ({ roomCode: "BOLA-T3ST", createdAt: "2026-07-12T12:00:00.000Z" }) },
    { id: "middle", data: () => ({ roomCode: "BOLA-T3ST", createdAt: "2026-07-11T12:00:00.000Z" }) },
  ];
  const collection = {
    where(...args) {
      calls.push(["where", ...args]);
      return {
        orderBy(...orderArgs) {
          calls.push(["orderBy", ...orderArgs]);
          return {
            limit(...limitArgs) {
              calls.push(["limit", ...limitArgs]);
              return {
                async get() {
                  calls.push(["indexed-get"]);
                  const error = new Error("The query requires an index");
                  error.code = 9;
                  throw error;
                },
              };
            },
          };
        },
        async get() {
          calls.push(["fallback-get"]);
          return { docs: documents };
        },
      };
    },
  };
  const store = new NewsStore({
    firestore: {
      collection(name) {
        assert.equal(name, "news");
        return collection;
      },
    },
  });

  const posts = await store.list("BOLA-T3ST");

  assert.deepEqual(posts.map((post) => post.id), ["new", "middle", "old"]);
  assert.deepEqual(calls, [
    ["where", "roomCode", "==", "BOLA-T3ST"],
    ["orderBy", "createdAt", "desc"],
    ["limit", 50],
    ["indexed-get"],
    ["where", "roomCode", "==", "BOLA-T3ST"],
    ["fallback-get"],
  ]);
});

test("memoria cria, busca e isola noticias por sala", async () => {
  const ids = ["manager-1", "editorial-1", "other-room-1"];
  const store = new NewsStore({
    now: () => new Date("2026-07-12T12:00:00.000Z"),
    idFactory: () => ids.shift(),
  });

  const managerPost = await store.create({
    roomCode: "BOLA-AAAA",
    authorId: "manager-a",
    authorName: "Ana",
    clubId: "AUR",
    body: "Vamos buscar a vitoria.",
  });
  const editorial = await store.createEditorial({
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    article: {
      source: "Diario da Bola",
      sourceType: "imprensa",
      tag: "Vestiario",
      headline: "Declaracao repercute antes da rodada",
      body: "A fala da manager movimentou o clube.",
    },
    generatedFromPostId: managerPost.id,
    comments: [{ id: "comment-1", text: "Boa repercussao." }],
    aiSource: "gemini",
  });
  await store.create({
    roomCode: "BOLA-BBBB",
    authorId: "manager-b",
    authorName: "Bruno",
    clubId: "SAN",
    body: "Sala diferente.",
  });

  assert.equal((await store.get("BOLA-AAAA", managerPost.id)).body, "Vamos buscar a vitoria.");
  assert.equal(await store.get("BOLA-BBBB", managerPost.id), null);
  assert.equal(await store.get("BOLA-AAAA", "other-room-1"), null);
  assert.deepEqual(editorial, {
    id: "editorial-1",
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    source: "Diario da Bola",
    sourceType: "imprensa",
    headline: "Declaracao repercute antes da rodada",
    body: "A fala da manager movimentou o clube.",
    reactions: 0,
    tag: "Vestiario",
    createdAt: "2026-07-12T12:00:00.000Z",
    generatedFromPostId: "manager-1",
    comments: [{ id: "comment-1", text: "Boa repercussao." }],
    aiSource: "gemini",
  });
  assert.deepEqual((await store.list("BOLA-AAAA")).map((post) => post.id), ["editorial-1", "manager-1"]);
  assert.deepEqual((await store.list("BOLA-BBBB")).map((post) => post.id), ["other-room-1"]);
});

test("memoria anexa comentarios, limita total e retorna 404 tipado", async () => {
  const store = new NewsStore({ idFactory: () => "post-1" });
  const initialComments = Array.from({ length: 199 }, (_, index) => ({ id: `old-${index}` }));
  await store.create({
    roomCode: "BOLA-AAAA",
    authorId: "manager-a",
    authorName: "Ana",
    clubId: "AUR",
    body: "Mensagem.",
    comments: initialComments,
  });

  const appended = await store.appendComments({
    roomCode: "BOLA-AAAA",
    postId: "post-1",
    comments: Array.from({ length: 5 }, (_, index) => ({ id: `new-${index}` })),
  });

  assert.equal(appended.comments.length, MAX_NEWS_COMMENTS);
  assert.equal(appended.comments[0].id, "old-4");
  assert.equal(appended.comments.at(-1).id, "new-4");
  assert.deepEqual((await store.get("BOLA-AAAA", "post-1")).comments, appended.comments);
  await assert.rejects(
    store.appendComments({ roomCode: "BOLA-BBBB", postId: "post-1", comments: [] }),
    (error) => error instanceof NewsStoreError
      && error.code === "NEWS_POST_NOT_FOUND"
      && error.status === 404,
  );
  await assert.rejects(
    store.appendComments({ roomCode: "BOLA-AAAA", postId: "missing", comments: [] }),
    { code: "NEWS_POST_NOT_FOUND", status: 404 },
  );
});

test("substitui fallback gerado e preserva encadeamento humano", async () => {
  const store = new NewsStore({ idFactory: () => "manager-fallback" });
  await store.create({
    roomCode: "BOLA-AAAA",
    authorId: "manager-1",
    authorName: "Manager",
    clubId: "AUR",
    body: "Vamos time!",
    aiSource: "fallback",
    comments: [
      { id: "fallback-1", text: "Resposta generica.", generated: true, parentCommentId: null },
      { id: "human-1", text: "Resposta humana.", generated: false, parentCommentId: "fallback-1" },
      { id: "thread-1", text: "Continuidade.", generated: true, parentCommentId: "human-1" },
    ],
  });

  const recovered = await store.replaceGeneratedComments({
    roomCode: "BOLA-AAAA",
    postId: "manager-fallback",
    aiSource: "gemini",
    comments: [{ id: "gemini-1", text: "Resposta recuperada.", generated: true, parentCommentId: null }],
  });

  assert.equal(recovered.aiSource, "gemini");
  assert.deepEqual(recovered.comments.map((comment) => comment.id), ["gemini-1", "human-1", "thread-1"]);
  assert.equal(recovered.comments[1].parentCommentId, "gemini-1");
  assert.equal(recovered.comments[2].parentCommentId, "human-1");
});

test("Firestore usa transacao atomica e protege o escopo da sala", async () => {
  const documents = new Map();
  let transactionCount = 0;
  const documentReference = (id) => ({
    id,
    async set(value) {
      documents.set(id, structuredClone(value));
    },
    async get() {
      return {
        id,
        exists: documents.has(id),
        data: () => structuredClone(documents.get(id)),
      };
    },
  });
  const firestore = {
    collection(name) {
      assert.equal(name, "news");
      return { doc: documentReference };
    },
    async runTransaction(operation) {
      transactionCount += 1;
      return operation({
        async get(reference) {
          return reference.get();
        },
        update(reference, changes) {
          documents.set(reference.id, { ...documents.get(reference.id), ...structuredClone(changes) });
        },
      });
    },
  };
  const store = new NewsStore({ firestore, idFactory: () => "editorial-firestore" });
  await store.createEditorial({
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    article: { sourceType: "clube", tag: "Clube", headline: "Treino encerrado", body: "Time pronto." },
    generatedFromPostId: "manager-1",
  });

  const loaded = await store.get("BOLA-AAAA", "editorial-firestore");
  assert.equal(loaded.headline, "Treino encerrado");
  assert.equal(await store.get("BOLA-BBBB", "editorial-firestore"), null);
  const updated = await store.appendComments({
    roomCode: "BOLA-AAAA",
    postId: "editorial-firestore",
    comments: [{ id: "reply-1", text: "Boa noticia." }],
  });
  assert.equal(transactionCount, 1);
  assert.deepEqual(updated.comments, [{ id: "reply-1", text: "Boa noticia." }]);
  assert.deepEqual(documents.get("editorial-firestore").comments, updated.comments);

  await assert.rejects(
    store.appendComments({ roomCode: "BOLA-BBBB", postId: "editorial-firestore", comments: [] }),
    { code: "NEWS_POST_NOT_FOUND", status: 404 },
  );
  assert.equal(transactionCount, 2);
});

test("syncEditorials e idempotente, deterministico e preserva comentarios em memoria", async () => {
  const store = new NewsStore({ now: () => new Date("2026-07-12T15:00:00.000Z") });
  const editorial = {
    id: "client-n1",
    source: "Linha de Fundo",
    sourceType: "imprensa",
    tag: "Analise",
    headline: "Aurora chega forte para a rodada",
    body: "O clube vem de boa sequencia.",
    reactions: 12,
  };

  const [first] = await store.syncEditorials({
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    posts: [editorial],
    commentsByPostId: { "client-n1": [{ id: "seed-1", text: "Primeira leitura." }] },
    aiSource: "gemini",
  });
  await store.appendComments({
    roomCode: "BOLA-AAAA",
    postId: first.id,
    comments: [{ id: "user-1", text: "Comentario persistido." }],
  });
  const [repeated] = await store.ensureEditorials({
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    posts: [{ ...editorial, comments: [
      { id: "seed-1", text: "Tentativa de sobrescrever." },
      { id: "seed-2", text: "Nova resposta." },
    ] }],
  });

  assert.equal(first.id, repeated.id);
  assert.match(first.id, /^editorial-[a-f0-9]{32}$/);
  assert.equal(repeated.editorialKey, "client-n1");
  assert.deepEqual(repeated.comments, [
    { id: "seed-1", text: "Primeira leitura." },
    { id: "user-1", text: "Comentario persistido." },
    { id: "seed-2", text: "Nova resposta." },
  ]);
  assert.equal((await store.list("BOLA-AAAA")).length, 1);

  const [otherRoom] = await store.syncEditorials({
    roomCode: "BOLA-BBBB",
    clubId: "AUR",
    posts: [editorial],
  });
  assert.notEqual(otherRoom.id, first.id);
  assert.equal(await store.get("BOLA-BBBB", first.id), null);

  const [changedContent] = await store.syncEditorials({
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    posts: [{ ...editorial, body: "Conteudo atualizado." }],
  });
  assert.notEqual(changedContent.id, first.id);
});

test("syncEditorials limita comentarios sem remover os ja persistidos", async () => {
  const store = new NewsStore();
  const existing = Array.from({ length: 199 }, (_, index) => ({ id: `old-${index}` }));
  const [post] = await store.syncEditorials({
    roomCode: "BOLA-AAAA",
    posts: [{ id: "n1", headline: "Noticia", body: "Corpo", comments: existing }],
  });
  const [repeated] = await store.syncEditorials({
    roomCode: "BOLA-AAAA",
    posts: [{
      id: "n1",
      headline: "Noticia",
      body: "Corpo",
      comments: Array.from({ length: 5 }, (_, index) => ({ id: `new-${index}` })),
    }],
  });

  assert.equal(repeated.id, post.id);
  assert.equal(repeated.comments.length, MAX_NEWS_COMMENTS);
  assert.equal(repeated.comments[0].id, "old-0");
  assert.equal(repeated.comments[198].id, "old-198");
  assert.equal(repeated.comments[199].id, "new-0");
});

test("syncEditorials usa transacao no Firestore e nao sobrescreve comentarios", async () => {
  const documents = new Map();
  let transactionCount = 0;
  const referenceFor = (id) => ({ id });
  const snapshotFor = (reference) => ({
    id: reference.id,
    exists: documents.has(reference.id),
    data: () => structuredClone(documents.get(reference.id)),
  });
  const firestore = {
    collection(name) {
      assert.equal(name, "news");
      return { doc: referenceFor };
    },
    async runTransaction(operation) {
      transactionCount += 1;
      return operation({
        async get(reference) {
          return snapshotFor(reference);
        },
        set(reference, value) {
          documents.set(reference.id, structuredClone(value));
        },
        update(reference, changes) {
          documents.set(reference.id, { ...documents.get(reference.id), ...structuredClone(changes) });
        },
      });
    },
  };
  const store = new NewsStore({ firestore, now: () => new Date("2026-07-12T16:00:00.000Z") });
  const input = {
    roomCode: "BOLA-AAAA",
    clubId: "AUR",
    posts: [{ id: "n1", source: "Clube", sourceType: "clube", headline: "Treino", body: "Encerrado." }],
    commentsByPostId: new Map([["n1", [{ id: "initial", text: "Publicado." }]]]),
  };

  const [created] = await store.syncEditorials(input);
  documents.get(created.id).comments.push({ id: "persisted", text: "Torcida comentou." });
  const [repeated] = await store.syncEditorials({
    ...input,
    commentsByPostId: { n1: [
      { id: "initial", text: "Texto alterado." },
      { id: "new", text: "Nova resposta." },
    ] },
  });

  assert.equal(transactionCount, 2);
  assert.equal(repeated.id, created.id);
  assert.deepEqual(repeated.comments, [
    { id: "initial", text: "Publicado." },
    { id: "persisted", text: "Torcida comentou." },
    { id: "new", text: "Nova resposta." },
  ]);
  assert.deepEqual(documents.get(created.id).comments, repeated.comments);
});

test("Firestore preserva dedupe de publicacao e resposta entre instancias", async () => {
  const collections = new Map([
    ["news", new Map()],
    ["newsOperations", new Map()],
  ]);
  const referenceFor = (collectionName, id) => ({
    collectionName,
    id,
    async get() {
      const documents = collections.get(collectionName);
      return {
        id,
        exists: documents.has(id),
        data: () => structuredClone(documents.get(id)),
      };
    },
    async set(value) {
      collections.get(collectionName).set(id, structuredClone(value));
    },
  });
  const firestore = {
    collection(name) {
      return { doc: (id) => referenceFor(name, id) };
    },
    async runTransaction(operation) {
      return operation({
        async get(reference) {
          return reference.get();
        },
        set(reference, value) {
          collections.get(reference.collectionName).set(reference.id, structuredClone(value));
        },
        update(reference, changes) {
          const documents = collections.get(reference.collectionName);
          documents.set(reference.id, {
            ...documents.get(reference.id),
            ...structuredClone(changes),
          });
        },
      });
    },
  };
  const ids = ["manager-persisted", "article-persisted"];
  const firstStore = new NewsStore({
    firestore,
    now: () => new Date("2026-07-12T17:00:00.000Z"),
    idFactory: () => ids.shift(),
  });
  const publishInput = {
    roomCode: "BOLA-AAAA",
    actorId: "manager-a",
    requestId: "publish-request-01",
    requestPayload: { message: "Anunciamos um reforco." },
    authorName: "Ana",
    clubId: "AUR",
    body: "Anunciamos um reforco.",
    comments: [{ id: "generated-comment", text: "Boa contratacao." }],
    teamComment: { id: "team-comment", text: "Mercado movimentado." },
    generatedArticle: {
      publish: true,
      source: "Jornal",
      sourceType: "imprensa",
      headline: "Aurora anuncia reforco",
      body: "Clube confirmou a chegada.",
      tag: "Mercado",
    },
    aiSource: "gemini",
  };

  const created = await firstStore.createManagerPostWithOperation(publishInput);
  assert.equal(created.replayed, false);
  assert.equal(created.post.id, "manager-persisted");
  assert.equal(created.generatedPost.id, "article-persisted");

  const reloadedStore = new NewsStore({
    firestore,
    idFactory: () => { throw new Error("retry nao pode gerar novo id"); },
  });
  const repeated = await reloadedStore.createManagerPostWithOperation(publishInput);
  assert.equal(repeated.replayed, true);
  assert.equal(repeated.post.id, created.post.id);
  assert.equal(repeated.generatedPost.id, created.generatedPost.id);
  assert.deepEqual(repeated.teamComment, created.teamComment);
  assert.equal(collections.get("news").size, 2);

  const replyInput = {
    roomCode: "BOLA-AAAA",
    postId: created.post.id,
    actorId: "manager-a",
    requestId: "reply-request-0001",
    requestPayload: {
      postId: created.post.id,
      parentCommentId: "generated-comment",
      message: "Seguimos trabalhando.",
    },
    comments: [{
      id: "manager-reply",
      author: "Ana",
      text: "Seguimos trabalhando.",
      parentCommentId: "generated-comment",
    }],
    clubId: "AUR",
  };
  const reply = await reloadedStore.appendCommentsWithOperation(replyInput);
  assert.equal(reply.replayed, false);
  assert.equal(reply.comments.length, 1);

  const afterReplyReload = new NewsStore({ firestore });
  const repeatedReply = await afterReplyReload.appendCommentsWithOperation(replyInput);
  assert.equal(repeatedReply.replayed, true);
  assert.equal(repeatedReply.comments.length, 1);
  assert.equal(repeatedReply.post.comments.filter((comment) => comment.id === "manager-reply").length, 1);

  await assert.rejects(
    afterReplyReload.appendCommentsWithOperation({
      ...replyInput,
      requestPayload: { ...replyInput.requestPayload, message: "Conteudo alterado." },
    }),
    { code: "NEWS_REQUEST_CONFLICT", status: 409 },
  );
});
