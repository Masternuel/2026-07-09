import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiRequest } from '../lib/apiClient';
import type {
  BolaSocket,
  NewsAiApiResponse,
  NewsAiComment,
  NewsAiCommentDto,
  NewsAiReplyDto,
  NewsAiRequestPost,
  NewsCommentReplyApiResponse,
  NewsFeedApiResponse,
  NewsItem,
  NewsPost,
  NewsPostDto,
  NewsPublishApiResponse,
  Room,
} from '../types';
import { useAuth } from './useAuth';

const validRoles = new Set(['torcida', 'imprensa', 'jogador', 'clube', 'manager']);
const validSentiments = new Set(['positivo', 'neutro', 'critico']);
const validSourceTypes = new Set(['imprensa', 'clube', 'jogador', 'torcida', 'manager']);
const hiddenPersonaPattern = /\b(?:bola\s*ia|arquibancada\s*ia|gemini|intelig[eê]ncia artificial|assistente virtual|chatbot)\b/i;
const hiddenTextPattern = /\b(?:como (?:uma? )?ia|sou uma? ia|gemini|modelo de linguagem|intelig[eê]ncia artificial|chatbot)\b/i;

function stableId(prefix: string, ...parts: Array<string | null | undefined>) {
  const value = parts.filter(Boolean).join('-').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  return `${prefix}-${value || 'item'}`;
}

function personaForRole(role: NewsAiComment['role']) {
  if (role === 'torcida') return 'Arquibancada';
  if (role === 'jogador') return 'Vestiário';
  if (role === 'clube') return 'Comunicação do Clube';
  if (role === 'manager') return 'Manager';
  return 'Central da Rodada';
}

function normalizeRole(value: unknown): NewsAiComment['role'] {
  const raw = String(value ?? '').toLowerCase();
  if (validRoles.has(raw)) return raw as NewsAiComment['role'];
  if (raw === 'ia') return 'imprensa';
  return 'torcida';
}

function normalizeComment(value: NewsAiCommentDto | null | undefined, index = 0): NewsAiComment | null {
  const role = normalizeRole(value?.role);
  const rawAuthor = String(value?.author ?? '').trim();
  const rawText = String(value?.text ?? '').trim();
  if (!rawText) return null;
  const author = !rawAuthor || hiddenPersonaPattern.test(rawAuthor) ? personaForRole(role) : rawAuthor;
  const text = hiddenTextPattern.test(rawText)
    ? 'O assunto ganhou repercussão e segue movimentando a rodada.'
    : rawText;
  return {
    id: String(value?.id ?? '').trim() || stableId('comment', author, text, String(index)),
    author,
    role,
    text,
    sentiment: validSentiments.has(String(value?.sentiment))
      ? String(value?.sentiment) as NewsAiComment['sentiment']
      : 'neutro',
    parentCommentId: String(value?.parentCommentId ?? '').trim() || null,
    createdAt: String(value?.createdAt ?? '').trim() || null,
  };
}

function relativeTime(createdAt: string | null) {
  if (!createdAt) return 'agora';
  const elapsed = Date.now() - Date.parse(createdAt);
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'agora';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

function normalizePost(value: NewsPostDto | null | undefined): NewsPost | null {
  const source = String(value?.source ?? value?.authorName ?? '').trim();
  const body = String(value?.body ?? '').trim();
  if (!source || !body) return null;
  const sourceType = validSourceTypes.has(String(value?.sourceType))
    ? String(value?.sourceType) as NewsPost['sourceType']
    : 'manager';
  const createdAt = String(value?.createdAt ?? '').trim() || null;
  return {
    id: String(value?.id ?? '').trim() || stableId('post', source, createdAt, body),
    roomCode: String(value?.roomCode ?? '').trim() || null,
    editorialKey: String(value?.editorialKey ?? '').trim() || null,
    authorId: String(value?.authorId ?? '').trim() || null,
    authorName: String(value?.authorName ?? '').trim() || null,
    clubId: String(value?.clubId ?? '').trim() || null,
    source,
    sourceType,
    time: String(value?.time ?? '').trim() || relativeTime(createdAt),
    createdAt,
    headline: String(value?.headline ?? '').trim() || `Declaração de ${source}`,
    body,
    reactions: Number.isFinite(value?.reactions) ? Math.max(0, Number(value?.reactions)) : 0,
    tag: String(value?.tag ?? '').trim() || (sourceType === 'manager' ? 'Sala' : 'Clube'),
    comments: (value?.comments ?? []).flatMap((comment, index) => normalizeComment(comment, index) ?? []),
  };
}

function normalizeReplies(replies: NewsAiReplyDto[] | undefined) {
  const result: Record<string, NewsAiComment[]> = {};
  for (const reply of replies ?? []) {
    const postId = String(reply?.postId ?? '').trim();
    if (!postId) continue;
    result[postId] = (reply.comments ?? []).flatMap((comment, index) => normalizeComment(comment, index) ?? []);
  }
  return result;
}

function mergePost(current: NewsPost[], incoming: NewsPost) {
  return [incoming, ...current.filter((post) => post.id !== incoming.id)];
}

function mergeHydratedPosts(current: NewsPost[], fetched: NewsPost[]) {
  const currentById = new Map(current.map((post) => [post.id, post]));
  const hydrated = fetched.map((post) => {
    const live = currentById.get(post.id);
    if (!live) return post;
    const commentsById = new Map(post.comments.map((comment) => [comment.id, comment]));
    for (const comment of live.comments) commentsById.set(comment.id, comment);
    return {
      ...post,
      ...live,
      comments: [...commentsById.values()].sort((left, right) => (
        Date.parse(left.createdAt ?? '') - Date.parse(right.createdAt ?? '')
      )),
    };
  });
  const fetchedIds = new Set(hydrated.map((post) => post.id));
  return [
    ...current.filter((post) => !fetchedIds.has(post.id)),
    ...hydrated,
  ];
}

function demoConversation(editorialPosts: NewsItem[]) {
  const player = editorialPosts.find((item) => item.sourceType === 'jogador');
  return {
    teamComment: normalizeComment({
      id: 'demo-team-radar',
      author: 'Central da Rodada',
      role: 'imprensa',
      text: 'O clube está no centro das conversas da rodada. Foco no próximo jogo e equilíbrio fora de campo.',
      sentiment: 'neutro',
    }),
    replies: player ? normalizeReplies([{
      postId: player.id,
      comments: [{
        id: 'demo-player-reply',
        author: 'Arquibancada',
        role: 'torcida',
        text: `A declaração de ${player.source} aumentou a confiança da torcida para a próxima partida.`,
        sentiment: 'positivo',
      }],
    }]) : {},
  };
}

function localFollowUp(parent: NewsAiComment, managerCommentId: string): NewsAiComment {
  const role = parent.role === 'manager' ? 'torcida' : parent.role;
  return {
    id: crypto.randomUUID(),
    author: parent.role === 'manager' ? 'Arquibancada' : parent.author,
    role,
    text: 'Entendo seu ponto. A repercussão vai continuar até a bola rolar.',
    sentiment: 'neutro',
    parentCommentId: managerCommentId,
    createdAt: new Date().toISOString(),
  };
}

function demoNewsArticle(message: string, roomCode: string, clubName: string): NewsPost | null {
  const normalized = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const newsworthy = /\b(contratacao|contratamos|anunciamos|confirmamos|lesao|lesionado|vencemos|perdemos|empatamos|criticamos|arbitragem|demissao|renovacao)\b/.test(normalized);
  if (!newsworthy) return null;
  return normalizePost({
    id: crypto.randomUUID(),
    roomCode,
    source: 'Central da Rodada',
    sourceType: 'imprensa',
    headline: `${clubName} vira assunto nos bastidores`,
    body: `Uma declaração do manager ganhou repercussão: “${message}”`,
    reactions: 0,
    tag: 'Notícia',
    createdAt: new Date().toISOString(),
    comments: [],
  });
}

export interface NewsFeedController {
  posts: NewsPost[];
  replies: Record<string, NewsAiComment[]>;
  teamComment: NewsAiComment | null;
  authorName: string;
  loading: boolean;
  publishing: boolean;
  replyingTo: string | null;
  error: string | null;
  publishError: string | null;
  replyError: string | null;
  publish: (message: string) => Promise<NewsPost>;
  reply: (postId: string, parentCommentId: string, message: string) => Promise<void>;
  retry: () => void;
}

export function useNewsFeed(
  room: Room | null,
  socket: BolaSocket | null,
  editorialPosts: NewsItem[],
): NewsFeedController {
  const auth = useAuth();
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [replies, setReplies] = useState<Record<string, NewsAiComment[]>>({});
  const [teamComment, setTeamComment] = useState<NewsAiComment | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestGeneration = useRef(0);
  const activeRoomCode = useRef<string | null>(null);
  const roomCodeRef = useRef<string | null>(room?.code ?? null);
  const postsRef = useRef(posts);
  const repliesRef = useRef(replies);
  roomCodeRef.current = room?.code ?? null;
  postsRef.current = posts;
  repliesRef.current = replies;

  const credentials = useMemo(() => auth.identity ? ({
    identity: auth.identity,
    getIdToken: auth.getIdToken,
  }) : null, [auth.identity, auth.getIdToken]);

  useEffect(() => {
    if (!room || !credentials) {
      activeRoomCode.current = null;
      setPosts([]);
      setReplies({});
      setTeamComment(null);
      setError(null);
      setPublishError(null);
      setReplyError(null);
      setLoading(false);
      return;
    }
    if (activeRoomCode.current !== room.code) {
      activeRoomCode.current = room.code;
      setPosts([]);
      setReplies({});
      setTeamComment(null);
      setPublishError(null);
      setReplyError(null);
    }
    if (credentials.identity.mode === 'demo') {
      const demo = demoConversation(editorialPosts);
      setPosts([]);
      setReplies(demo.replies);
      setTeamComment(demo.teamComment);
      setError(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const generation = ++requestGeneration.current;
    const aiPosts: NewsAiRequestPost[] = editorialPosts.map(({
      id,
      source: postSource,
      sourceType,
      headline,
      body,
      tag,
      reactions,
    }) => ({
      id,
      source: postSource,
      sourceType,
      headline,
      body,
      tag,
      reactions,
    }));
    setLoading(true);
    setError(null);
    void Promise.allSettled([
      apiRequest<NewsFeedApiResponse>(`/api/news/${room.code}`, credentials, { signal: controller.signal }),
      apiRequest<NewsAiApiResponse>(`/api/news/${room.code}/ai`, credentials, {
        method: 'POST',
        body: { posts: aiPosts },
        signal: controller.signal,
      }),
    ]).then(([feedResult, analysisResult]) => {
      if (controller.signal.aborted || generation !== requestGeneration.current) return;
      let failures = 0;
      if (feedResult.status === 'fulfilled') {
        const fetchedPosts = (feedResult.value.posts ?? []).flatMap((post) => normalizePost(post) ?? []);
        setPosts((current) => mergeHydratedPosts(current, fetchedPosts));
      } else failures += 1;
      if (analysisResult.status === 'fulfilled') {
        setReplies(normalizeReplies(analysisResult.value.replies));
        setTeamComment(normalizeComment(analysisResult.value.teamComment));
        const syncedPosts = (analysisResult.value.posts ?? []).flatMap((post) => normalizePost(post) ?? []);
        if (syncedPosts.length) setPosts((current) => mergeHydratedPosts(current, syncedPosts));
      } else failures += 1;
      if (failures === 2) setError('Não foi possível atualizar a rede social.');
      else if (failures === 1) setError('Parte do feed está temporariamente indisponível.');
    }).finally(() => {
      if (!controller.signal.aborted && generation === requestGeneration.current) setLoading(false);
    });
    return () => controller.abort();
  }, [room?.code, credentials, editorialPosts, reloadToken]);

  useEffect(() => {
    if (!socket || !room || !credentials) return;
    const controller = new AbortController();
    const onPost = (value: NewsPostDto) => {
      const post = normalizePost(value);
      if (!post || post.roomCode !== room.code) return;
      setPosts((current) => mergePost(current, post));
    };
    let shouldBackfill = false;
    const onDisconnect = () => {
      shouldBackfill = true;
    };
    const onConnect = () => {
      if (!shouldBackfill) return;
      shouldBackfill = false;
      void apiRequest<NewsFeedApiResponse>(
        `/api/news/${room.code}`,
        credentials,
        { signal: controller.signal },
      ).then((value) => {
        const fetchedPosts = (value.posts ?? []).flatMap((post) => normalizePost(post) ?? []);
        setPosts((current) => mergeHydratedPosts(current, fetchedPosts));
      }).catch((nextError) => {
        if (controller.signal.aborted) return;
        setError(nextError instanceof Error ? nextError.message : 'Não foi possível recuperar o feed.');
      });
    };
    socket.on('news:post', onPost);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    return () => {
      controller.abort();
      socket.off('news:post', onPost);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [socket, room?.code, credentials]);

  const publish = useCallback(async (message: string) => {
    const normalized = message.trim();
    if (!normalized) throw new Error('Escreva uma mensagem antes de publicar.');
    if (normalized.length > 500) throw new Error('A publicação pode ter no máximo 500 caracteres.');
    if (!room || !credentials) throw new Error('Entre em uma temporada antes de publicar.');
    const publishRoomCode = room.code;
    setPublishing(true);
    setPublishError(null);
    try {
      if (credentials.identity.mode === 'demo') {
        const createdAt = new Date().toISOString();
        const post = normalizePost({
          id: crypto.randomUUID(),
          roomCode: publishRoomCode,
          authorId: credentials.identity.uid,
          authorName: credentials.identity.displayName,
          source: credentials.identity.displayName,
          sourceType: 'manager',
          headline: `Declaração de ${credentials.identity.displayName}`,
          body: normalized,
          reactions: 0,
          tag: 'Sala',
          createdAt,
          comments: [{
            author: 'Central da Rodada',
            role: 'imprensa',
            text: 'A declaração movimentou a torcida e já repercute antes da próxima partida.',
            sentiment: 'neutro',
            parentCommentId: null,
            createdAt,
          }],
        });
        if (!post) throw new Error('Não foi possível montar a publicação.');
        const clubName = editorialPosts.find((item) => item.sourceType === 'clube')?.source ?? 'O clube';
        const generatedPost = demoNewsArticle(normalized, publishRoomCode, clubName);
        setPosts((current) => {
          const next = mergePost(current, post);
          return generatedPost ? mergePost(next, generatedPost) : next;
        });
        return post;
      }
      const response = await apiRequest<NewsPublishApiResponse>(
        `/api/news/${publishRoomCode}/posts`,
        credentials,
        {
          method: 'POST',
          body: { message: normalized },
        },
      );
      if (roomCodeRef.current !== publishRoomCode) {
        throw new Error('Publicação enviada na sala anterior. Abra o save anterior para conferir.');
      }
      const post = normalizePost(response.post);
      if (!post) throw new Error('O servidor retornou uma publicação inválida.');
      setPosts((current) => {
        let next = mergePost(current, post);
        const generatedPost = normalizePost(response.generatedPost);
        if (generatedPost) next = mergePost(next, generatedPost);
        return next;
      });
      const nextTeamComment = normalizeComment(response.teamComment);
      if (nextTeamComment) setTeamComment(nextTeamComment);
      return post;
    } catch (nextError) {
      const staleRoom = roomCodeRef.current !== publishRoomCode;
      const messageText = staleRoom
        ? 'Publicação processada na sala anterior. Abra o save anterior para conferir.'
        : nextError instanceof ApiError || nextError instanceof Error
          ? nextError.message
          : 'Não foi possível publicar agora.';
      if (!staleRoom) setPublishError(messageText);
      throw new Error(messageText);
    } finally {
      setPublishing(false);
    }
  }, [room, credentials, editorialPosts]);

  const reply = useCallback(async (postId: string, parentCommentId: string, message: string) => {
    const normalized = message.trim();
    if (!normalized) throw new Error('Escreva uma resposta antes de enviar.');
    if (normalized.length > 320) throw new Error('A resposta pode ter no máximo 320 caracteres.');
    if (!room || !credentials) throw new Error('Entre em uma temporada antes de responder.');
    const storedPost = postsRef.current.find((candidate) => candidate.id === postId) ?? null;
    const comments = storedPost?.comments ?? repliesRef.current[postId] ?? [];
    const parent = comments.find((comment) => comment.id === parentCommentId);
    if (!parent) throw new Error('Comentário não encontrado.');
    const replyRoomCode = room.code;
    setReplyingTo(parentCommentId);
    setReplyError(null);
    try {
      if (credentials.identity.mode === 'demo' || !storedPost?.roomCode) {
        const createdAt = new Date().toISOString();
        const managerComment: NewsAiComment = {
          id: crypto.randomUUID(),
          author: credentials.identity.displayName,
          role: 'manager',
          text: normalized,
          sentiment: 'neutro',
          parentCommentId,
          createdAt,
        };
        const added = [managerComment, localFollowUp(parent, managerComment.id)];
        if (storedPost) {
          setPosts((current) => current.map((post) => (
            post.id === postId ? { ...post, comments: [...post.comments, ...added] } : post
          )));
        } else {
          setReplies((current) => ({
            ...current,
            [postId]: [...(current[postId] ?? []), ...added],
          }));
        }
        return;
      }
      const response = await apiRequest<NewsCommentReplyApiResponse>(
        `/api/news/${replyRoomCode}/posts/${encodeURIComponent(postId)}/comments`,
        credentials,
        {
          method: 'POST',
          body: { message: normalized, parentCommentId },
        },
      );
      if (roomCodeRef.current !== replyRoomCode) {
        throw new Error('Resposta processada na sala anterior.');
      }
      const updatedPost = normalizePost(response.post);
      if (!updatedPost) throw new Error('O servidor retornou uma conversa inválida.');
      setPosts((current) => {
        let next = mergePost(current, updatedPost);
        const generatedPost = normalizePost(response.generatedPost);
        if (generatedPost) next = mergePost(next, generatedPost);
        return next;
      });
    } catch (nextError) {
      const staleRoom = roomCodeRef.current !== replyRoomCode;
      const messageText = staleRoom
        ? 'Resposta processada na sala anterior.'
        : nextError instanceof ApiError || nextError instanceof Error
          ? nextError.message
          : 'Não foi possível responder agora.';
      if (!staleRoom) setReplyError(messageText);
      throw new Error(messageText);
    } finally {
      setReplyingTo((current) => current === parentCommentId ? null : current);
    }
  }, [room, credentials]);

  return {
    posts,
    replies,
    teamComment,
    authorName: credentials?.identity.displayName ?? 'Manager',
    loading,
    publishing,
    replyingTo,
    error,
    publishError,
    replyError,
    publish,
    reply,
    retry: () => setReloadToken((value) => value + 1),
  };
}
