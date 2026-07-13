import { useMemo, useState } from 'react';
import {
  AtSign,
  Bookmark,
  Heart,
  MessageCircle,
  Newspaper,
  Radio,
  Repeat2,
  Search,
  Send,
  TrendingUp,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { useNewsFeed } from '../../hooks/useNewsFeed';
import type { BolaSocket, ClubChoice, NewsAiComment, NewsItem, NewsPost, Room } from '../../types';

interface NewsViewProps {
  onToast: (message: string) => void;
  room: Room | null;
  socket: BolaSocket | null;
  club: ClubChoice;
}

interface ReplyTarget {
  postId: string;
  commentId: string;
  author: string;
}

function buildClubNews(club: ClubChoice): NewsItem[] {
  return [
    {
      id: 'n1',
      source: 'Linha de Fundo',
      sourceType: 'imprensa',
      time: 'há 18 min',
      headline: `${club.name} chega à rodada com ataque em alta`,
      body: 'A equipe marcou 11 gols nas últimas cinco rodadas e ganhou força na disputa.',
      reactions: 284,
      tag: 'Análise',
    },
    {
      id: 'n2',
      source: club.name,
      sourceType: 'clube',
      time: 'há 42 min',
      headline: 'Torcida prepara casa cheia para o próximo duelo',
      body: `O ${club.name} confirmou programação especial antes da partida.`,
      reactions: 612,
      tag: 'Clube',
    },
    {
      id: 'n3',
      source: 'Capitão do elenco',
      sourceType: 'jogador',
      time: 'há 1 h',
      headline: '“É jogo para assumir responsabilidade.”',
      body: `O capitão falou com a imprensa após o treino do ${club.name}.`,
      reactions: 437,
      tag: 'Vestiário',
    },
    {
      id: 'n4',
      source: `Torcida ${club.code}`,
      sourceType: 'torcida',
      time: 'há 2 h',
      headline: `Apoio preparado para empurrar o ${club.name}`,
      body: 'A organizada promete uma recepção especial na entrada da equipe.',
      reactions: 793,
      tag: 'Torcida',
    },
  ];
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

export function NewsView({ onToast, room, socket, club }: NewsViewProps) {
  const clubNews = useMemo(() => buildClubNews(club), [club.id, club.name, club.code]);
  const feed = useNewsFeed(room, socket, clubNews);
  const [filter, setFilter] = useState('Tudo');
  const [liked, setLiked] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string[]>(['n3']);
  const [post, setPost] = useState('');
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [replyText, setReplyText] = useState('');
  const posts = useMemo(() => (
    [
      ...feed.posts,
      ...editorialPosts(clubNews, feed.replies).filter((editorial) => !feed.posts.some((post) => (
        post.editorialKey === editorial.editorialKey
        && post.headline === editorial.headline
        && post.body === editorial.body
      ))),
    ]
      .filter((item) => matchesFilter(item, filter))
  ), [feed.posts, feed.replies, clubNews, filter]);

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
    setExpanded((items) => items.includes(postId) ? items : [postId, ...items]);
    setReplyTarget({ postId, commentId: comment.id, author: comment.author });
    setReplyText('');
  }

  return (
    <main className="secondary-view news-view view-enter">
      <div className="view-heading">
        <div><p className="eyebrow">RADAR DO FUTEBOL</p><h1>Notícias</h1><p>Managers, jogadores, imprensa e torcida conversam em tempo real sobre a rodada.</p></div>
        <label className="global-search"><Search size={15} /><input placeholder="Buscar no feed" /></label>
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
                onChange={(event) => setPost(event.target.value)}
                placeholder="Diga algo à imprensa ou provoque seus rivais..."
              />
              <footer>
                <span><AtSign size={14} /> Todos os managers verão · {post.length}/500</span>
                <Button size="sm" variant="primary" icon={<Send size={13} />} onClick={() => void publish()} disabled={!post.trim() || feed.publishing}>
                  {feed.publishing ? 'Publicando…' : 'Publicar'}
                </Button>
              </footer>
              {feed.publishError && <p className="post-composer__error" role="alert">{feed.publishError} Mensagem mantida; tente novamente.</p>}
            </div>
          </div>

          <div className="feed-filters">
            {['Tudo', 'Clube', 'Imprensa', 'Jogadores', 'Sala'].map((item) => <button key={item} aria-selected={filter === item} onClick={() => setFilter(item)}>{item}</button>)}
          </div>

          {posts.map((item) => {
            const threadOpen = expanded.includes(item.id);
            const likedPost = liked.includes(item.id);
            return (
              <article className={item.id === 'n1' ? 'feed-post feed-post--lead' : 'feed-post'} key={item.id}>
                <header>
                  <span className={`source-avatar source-avatar--${item.sourceType}`}>{item.source.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{item.source}</strong><small>{item.sourceType} · {item.time}</small></span>
                  <Badge tone={sourceTone(item.sourceType)}>{item.tag}</Badge>
                </header>
                <div className="feed-post__body">
                  <h2>{item.headline}</h2>
                  <p>{item.body}</p>
                  {item.id === 'n1' && <div className="news-data-visual"><span><small>GOLS / 5 JOGOS</small><strong>11</strong></span><div>{[38, 58, 42, 76, 92].map((value, index) => <i key={index} style={{ height: `${value}%` }} />)}</div><span><small>xG MÉDIO</small><strong>2,04</strong></span></div>}
                </div>
                <footer>
                  <button className={likedPost ? 'liked' : ''} onClick={() => setLiked((items) => likedPost ? items.filter((id) => id !== item.id) : [...items, item.id])}><Heart size={15} fill={likedPost ? 'currentColor' : 'none'} /> {item.reactions + (likedPost ? 1 : 0)}</button>
                  <button className={threadOpen ? 'thread-open' : ''} onClick={() => toggleThread(item.id)}><MessageCircle size={15} /> {item.comments.length}</button>
                  <button onClick={() => onToast('Publicação repostada na sala.')}><Repeat2 size={15} /> Repostar</button>
                  <button className="bookmark" aria-label="Salvar publicação"><Bookmark size={15} /></button>
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
                              <button className="social-comment__reply" onClick={() => startReply(item.id, comment)}>Responder</button>
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
            <p>{feed.teamComment?.text ?? 'Aguardando contexto suficiente para analisar o clube.'}</p>
            <footer><Badge tone="positive" dot>Atualizado agora</Badge><button onClick={feed.retry}>Atualizar radar</button></footer>
          </section>
          <section className="sentiment-panel"><header><div><p className="eyebrow">SENTIMENTO DA TORCIDA</p><h2>Confiante</h2></div><TrendingUp size={18} /></header><div className="sentiment-gauge"><i style={{ width: '82%' }} /><span style={{ left: '82%' }} /></div><div><span>Frustrada</span><strong>82/100</strong><span>Eufórica</span></div><p>+9 pontos após a última atuação do clube.</p></section>
          <section><p className="eyebrow">ASSUNTOS DO MOMENTO</p>{[['#BolaManager', '2.486 posts'], [club.name, '1.204 posts'], ['PróximaRodada', '982 posts'], ['MercadoDaBola', '741 posts']].map(([topic, count], index) => <button className="trending-topic" key={topic}><span>0{index + 1}</span><span><strong>{topic}</strong><small>{count}</small></span></button>)}</section>
          <section className="press-alert"><Radio size={17} /><span><strong>Coletiva em 25 min</strong><small>4 jornalistas confirmados</small></span><Button variant="ghost" size="sm" onClick={() => onToast('Sala de imprensa preparada.')}>Preparar</Button></section>
          <section className="journalist-watch"><p className="eyebrow">JORNALISTA EM FOCO</p><span className="source-avatar source-avatar--imprensa">ML</span><h3>Marina Lopes</h3><Badge tone="warning"><Search size={11} /> Investigativa</Badge><p>Apura movimentações do clube e acompanha as discussões da sala.</p></section>
        </aside>
      </div>
    </main>
  );
}
