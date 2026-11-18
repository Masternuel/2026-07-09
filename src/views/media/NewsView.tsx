import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AtSign,
  Heart,
  MessageCircle,
  Newspaper,
  Search,
  Send,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { useNewsFeed } from '../../hooks/useNewsFeed';
import { useClubCareer } from '../../hooks/useClubCareer';
import type { BolaSocket, ClubChoice, NewsAiComment, NewsItem, NewsPost, Room } from '../../types';

interface NewsViewProps {
  onToast: (message: string) => void;
  room: Room | null;
  socket: BolaSocket | null;
  club: ClubChoice;
  managerId: string;
}

interface ReplyTarget {
  postId: string;
  commentId: string;
  author: string;
}

function sameId(left: unknown, right: unknown) {
  return String(left ?? '').trim().toLocaleUpperCase('pt-BR')
    === String(right ?? '').trim().toLocaleUpperCase('pt-BR');
}

function relativeTime(value: string) {
  const elapsed = Date.now() - Date.parse(value);
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return 'agora';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

function categoryLabel(value: string) {
  const normalized = value.replace(/[_-]+/g, ' ').trim();
  if (!normalized) return 'Carreira';
  return normalized.charAt(0).toLocaleUpperCase('pt-BR') + normalized.slice(1);
}

function buildCareerNews(room: Room | null, club: ClubChoice): NewsItem[] {
  return [...(room?.clubCareerState?.news ?? [])]
    .filter((item) => (
      (item.clubIds ?? []).length === 0
      || item.clubIds.some((clubId) => sameId(clubId, club.id))
    ))
    .sort((left, right) => Date.parse(right.publishedAt ?? right.date) - Date.parse(left.publishedAt ?? left.date))
    .map((item) => ({
      id: item.id,
      source: (item.clubIds ?? []).length ? club.name : 'Carreira',
      sourceType: 'clube',
      time: relativeTime(item.publishedAt ?? item.date),
      headline: item.title,
      body: item.content || item.summary,
      reactions: 0,
      tag: categoryLabel(item.category),
    }));
}

function isLegacyDemoEditorial(post: NewsPost) {
  return ['n1', 'n2', 'n3', 'n4'].includes(post.editorialKey ?? post.id);
}

function editorialPosts(
  items: NewsItem[],
  replies: ReturnType<typeof useNewsFeed>['replies'],
): NewsPost[] {
  return items.map((item) => ({
    ...item,
    roomCode: null,
    editorialKey: item.id,
    authorId: null,
    authorName: item.source,
    clubId: null,
    createdAt: null,
    comments: replies[item.id] ?? [],
  }));
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'MG';
}

function matchesFilter(post: NewsPost, filter: string) {
  if (filter === 'Tudo') return true;
  if (filter === 'Clube') return post.sourceType === 'clube';
  if (filter === 'Imprensa') return post.sourceType === 'imprensa';
  if (filter === 'Jogadores') return post.sourceType === 'jogador';
  return post.sourceType === 'manager';
}

function normalizedSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();
}

function matchesSearch(post: NewsPost, search: string) {
  const query = normalizedSearch(search);
  if (!query) return true;
  return normalizedSearch([
    post.source,
    post.headline,
    post.body,
    post.tag,
  ].join(' ')).includes(query);
}

function sourceTone(sourceType: NewsPost['sourceType']) {
  if (sourceType === 'imprensa') return 'info' as const;
  if (sourceType === 'clube' || sourceType === 'jogador') return 'positive' as const;
  if (sourceType === 'manager') return 'warning' as const;
  return 'neutral' as const;
}

function roleLabel(role: NewsAiComment['role']) {
  if (role === 'torcida') return 'Torcida';
  if (role === 'imprensa') return 'Imprensa';
  if (role === 'jogador') return 'Jogador';
  if (role === 'clube') return 'Clube';
  return 'Manager';
}

function commentDepth(comments: NewsAiComment[], comment: NewsAiComment) {
  const byId = new Map(comments.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let current = comment;
  let depth = 0;
  while (current.parentCommentId && depth < 3 && !visited.has(current.id)) {
    visited.add(current.id);
    const parent = byId.get(current.parentCommentId);
    if (!parent) break;
    depth += 1;
    current = parent;
  }
  return depth;
}

export function NewsView({ onToast, room, socket, club, managerId }: NewsViewProps) {
  const clubNews = useMemo(() => buildCareerNews(room, club), [room?.clubCareerState?.news, club.id, club.name]);
  const feed = useNewsFeed(room, socket, clubNews);
  const career = useClubCareer(room, socket, club.id, managerId);
  const attemptedReadIds = useRef(new Set<string>());
  const [filter, setFilter] = useState('Tudo');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [post, setPost] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyText, setReplyText] = useState('');
  const socialPosts = useMemo(() => feed.posts.filter((item) => !isLegacyDemoEditorial(item)), [feed.posts]);
  const posts = useMemo(() => (
    [
      ...socialPosts,
      ...editorialPosts(clubNews, feed.replies).filter((editorial) => !socialPosts.some((post) => (
        post.id === editorial.id
        || (post.editorialKey === editorial.editorialKey
          && post.headline === editorial.headline
          && post.body === editorial.body)
      ))),
    ]
      .filter((item) => matchesFilter(item, filter) && matchesSearch(item, search))
  ), [socialPosts, feed.replies, clubNews, filter, search]);
  const socialPostCount = useMemo(() => socialPosts.filter((item) => item.sourceType === 'manager').length, [socialPosts]);

  useEffect(() => {
    attemptedReadIds.current.clear();
  }, [managerId, room?.code]);

  useEffect(() => {
    const pendingIds = career.unreadNews
      .map((item) => item.id)
      .filter((id) => !attemptedReadIds.current.has(id));
    if (!pendingIds.length || !managerId || !socket?.connected) return;
    pendingIds.forEach((id) => attemptedReadIds.current.add(id));
    const batches = Array.from(
      { length: Math.ceil(pendingIds.length / 100) },
      (_, index) => pendingIds.slice(index * 100, (index + 1) * 100),
    );
    void (async () => {
      for (const batch of batches) await career.markNewsRead(batch);
    })().catch(() => {
      pendingIds.forEach((id) => attemptedReadIds.current.delete(id));
    });
  }, [career.markNewsRead, career.unreadNews, managerId, socket?.connected]);

  async function publish() {
    if (!post.trim() || feed.publishing) return;
    try {
      const published = await feed.publish(post);
      setExpanded((items) => items.includes(published.id) ? items : [published.id, ...items]);
      setPost('');
      onToast('Publicação enviada. A conversa já começou.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível publicar.');
    }
  }

  async function sendReply() {
    if (!replyTarget || !replyText.trim() || feed.replyingTo) return;
    try {
      await feed.reply(replyTarget.postId, replyTarget.commentId, replyText);
      setExpanded((items) => items.includes(replyTarget.postId) ? items : [replyTarget.postId, ...items]);
      setReplyTarget(null);
      setReplyText('');
      onToast('Resposta publicada na conversa.');
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível responder.');
    }
  }

  function toggleThread(postId: string) {
    setExpanded((items) => items.includes(postId)
      ? items.filter((item) => item !== postId)
      : [...items, postId]);
  }

  function startReply(postId: string, comment: NewsAiComment) {
    const selectedPost = posts.find((item) => item.id === postId);
    if (!feed.persistenceAvailable || !selectedPost?.roomCode) return;
    setExpanded((items) => items.includes(postId) ? items : [postId, ...items]);
    setReplyTarget({ postId, commentId: comment.id, author: comment.author });
    setReplyText('');
  }

  return (
    <main className="secondary-view news-view view-enter">
      <div className="view-heading">
        <div><p className="eyebrow">RADAR DO FUTEBOL</p><h1>Notícias</h1><p>Managers, jogadores, imprensa e torcida conversam em tempo real sobre a rodada.</p></div>
        <label className="global-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar no feed" /></label>
      </div>

      {feed.error && <div className="social-ai-status social-ai-status--error" role="alert"><span>{feed.error}</span><button onClick={feed.retry}>Tentar novamente</button></div>}
      {feed.loading && <div className="social-ai-status" aria-live="polite"><span className="button-spinner" /> Atualizando a repercussão do clube…</div>}

      <div className="news-layout">
        <section className="feed-column" aria-busy={feed.loading}>
          <div className="post-composer">
            <span className="avatar">{initials(feed.authorName)}</span>
            <div>
              <textarea
                value={post}
                maxLength={500}
                disabled={!feed.persistenceAvailable}
                onChange={(event) => setPost(event.target.value)}
                placeholder={feed.persistenceAvailable
                  ? 'Diga algo à imprensa ou provoque seus rivais...'
                  : 'Entre com uma conta autenticada para publicar.'}
              />
              <footer>
                <span><AtSign size={14} /> {feed.persistenceAvailable
                  ? `Todos os managers verão · ${post.length}/500`
                  : 'Modo demonstração não grava publicações'}</span>
                <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => void publish()} disabled={!feed.persistenceAvailable || !post.trim() || feed.publishing}>
                  {feed.publishing ? 'Publicando…' : 'Publicar'}
                </Button>
              </footer>
              {feed.publishError && <p className="post-composer__error" role="alert">{feed.publishError} Mensagem mantida; tente novamente.</p>}
            </div>
          </div>

          <div className="feed-filters">
            {['Tudo', 'Clube', 'Imprensa', 'Jogadores', 'Sala'].map((item) => <button key={item} aria-selected={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
          </div>

          {posts.length === 0 && !feed.loading && (
            <div className="social-ai-status" role="status">
              <Newspaper size={17} />
              {filter === 'Tudo'
                ? 'Nenhuma notícia factual ou publicação da sala ainda. Novos acontecimentos da carreira aparecerão aqui.'
                : 'Nenhuma publicação encontrada neste filtro.'}
            </div>
          )}

          {posts.map((item, index) => {
            const threadOpen = expanded.includes(item.id);
            return (
              <article className={index === 0 ? 'feed-post feed-post--lead' : 'feed-post'} key={item.id}>
                <header>
                  <span className={`source-avatar source-avatar--${item.sourceType}`}>{item.source.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{item.source}</strong><small>{item.sourceType} · {item.time}</small></span>
                  <Badge tone={sourceTone(item.sourceType)}>{item.tag}</Badge>
                </header>
                <div className="feed-post__body">
                  <h2>{item.headline}</h2>
                  <p>{item.body}</p>
                </div>
                <footer>
                  <span><Heart size={15} /> {item.reactions}</span>
                  <button className={threadOpen ? 'thread-open' : ''} onClick={() => toggleThread(item.id)}><MessageCircle size={15} /> {item.comments.length}</button>
                </footer>
                {threadOpen && (
                  <div className="social-thread" aria-label={`Comentários em ${item.headline}`}>
                    {item.comments.length ? item.comments.map((comment) => {
                      const selected = replyTarget?.postId === item.id && replyTarget.commentId === comment.id;
                      const depth = commentDepth(item.comments, comment);
                      return (
                        <div className="social-comment-wrap" key={comment.id} style={{ marginLeft: `${depth * 22}px` }}>
                          <div className={`social-comment social-comment--${comment.sentiment}`}>
                            <span className="social-comment__avatar">{initials(comment.author)}</span>
                            <div>
                              <header><strong>{comment.author}</strong><Badge tone={comment.role === 'manager' ? 'warning' : 'info'}>{roleLabel(comment.role)}</Badge></header>
                              <p>{comment.text}</p>
                              <button className="social-comment__reply" disabled={!feed.persistenceAvailable || !item.roomCode} onClick={() => startReply(item.id, comment)}>{item.roomCode ? 'Responder' : 'Aguardando sincronização'}</button>
                            </div>
                          </div>
                          {selected && (
                            <div className="social-reply-composer">
                              <span>Respondendo a <strong>@{replyTarget.author}</strong></span>
                              <textarea
                                autoFocus
                                maxLength={320}
                                value={replyText}
                                onChange={(event) => setReplyText(event.target.value)}
                                placeholder="Escreva sua resposta..."
                              />
                              <footer>
                                <small>{replyText.length}/320</small>
                                <button onClick={() => { setReplyTarget(null); setReplyText(''); }}>Cancelar</button>
                                <Button size="sm" variant="primary" onClick={() => void sendReply()} disabled={!replyText.trim() || Boolean(feed.replyingTo)}>
                                  {feed.replyingTo === comment.id ? 'Enviando…' : 'Responder'}
                                </Button>
                              </footer>
                              {feed.replyError && <p role="alert">{feed.replyError}</p>}
                            </div>
                          )}
                        </div>
                      );
                    }) : <p className="social-thread__empty">Nenhuma resposta ainda.</p>}
                  </div>
                )}
              </article>
            );
          })}
        </section>

        <aside className="news-sidebar">
          <section className="ai-team-radar">
            <header><span><Newspaper size={18} /></span><div><p className="eyebrow">RADAR DO CLUBE</p><h2>{club.name} nas redes</h2></div></header>
            <p>{feed.teamComment?.text ?? 'Sem análise disponível. O radar será atualizado quando houver contexto factual suficiente.'}</p>
            <footer><Badge tone={feed.teamComment ? 'positive' : 'neutral'} dot={Boolean(feed.teamComment)}>{feed.teamComment ? 'Análise disponível' : 'Sem análise'}</Badge><button onClick={feed.retry}>Atualizar radar</button></footer>
          </section>
          <section>
            <p className="eyebrow">REGISTRO DA CARREIRA</p>
            <h2>{clubNews.length ? `${clubNews.length} ${clubNews.length === 1 ? 'notícia factual' : 'notícias factuais'}` : 'Nenhuma notícia registrada'}</h2>
            <p>{clubNews.length
              ? 'Conteúdo criado somente a partir de eventos persistidos neste save.'
              : 'Resultados, transferências, contratos e outros eventos reais aparecerão aqui.'}</p>
          </section>
          <section>
            <p className="eyebrow">CONVERSA DA SALA</p>
            <h2>{socialPostCount ? `${socialPostCount} publicaç${socialPostCount === 1 ? 'ão' : 'ões'}` : 'Nenhuma publicação'}</h2>
            <p>Este total considera somente mensagens reais publicadas por managers.</p>
          </section>
        </aside>
      </div>
    </main>
  );
}
