import { useEffect } from 'react';
import type {
  BolaSocket,
  MarketUpdatedEvent,
  NewsPostDto,
  ServerHalftimeState,
  ServerMatchFinished,
  ServerMatchStarted,
} from '../types';
import { useNotifications } from './useNotifications';

interface RealtimeNotificationOptions {
  socket: BolaSocket | null;
  roomCode: string | null | undefined;
  managerId: string | null | undefined;
}

function textPreview(value: unknown, fallback: string, limit = 140) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function marketMessage(reason: string) {
  const messages: Record<string, string> = {
    offer: 'Uma proposta foi registrada no mercado.',
    'offer-response': 'Uma negociação recebeu uma nova resposta.',
    listing: 'Um jogador foi colocado no mercado.',
    bid: 'Um leilão recebeu um novo lance.',
    'listing-cancelled': 'Um anúncio do mercado foi encerrado.',
    'loan-option-exercised': 'Uma opção de compra de empréstimo foi exercida.',
    settlement: 'O mercado processou negociações pendentes.',
  };
  return messages[reason] ?? 'Há uma atualização nas negociações da temporada.';
}

export function useRealtimeNotifications({ socket, roomCode, managerId }: RealtimeNotificationOptions) {
  const { notify } = useNotifications();

  useEffect(() => {
    if (!socket || !roomCode) return;
    const emitted = new Set<string>();
    const once = (key: string, send: () => void) => {
      if (emitted.has(key)) return;
      emitted.add(key);
      send();
    };
    const background = { onlyWhenHidden: true } as const;

    const onMarketUpdated = (payload: MarketUpdatedEvent) => {
      if (!payload || payload.code !== roomCode) return;
      once(`market:${payload.revision}`, () => {
        notify('offers', 'Mercado atualizado', marketMessage(payload.reason), background);
      });
    };
    const onNewsPost = (payload: NewsPostDto) => {
      if (!payload || payload.roomCode !== roomCode || payload.authorId === managerId) return;
      once(`news:${payload.id ?? `${payload.createdAt ?? ''}:${payload.authorId ?? ''}`}`, () => {
        notify(
          'news',
          textPreview(payload.headline, 'Nova publicação no feed', 80),
          textPreview(payload.body, `${textPreview(payload.authorName, 'Alguém', 40)} publicou uma atualização.`),
          background,
        );
      });
    };
    const onMatchStarted = (payload: ServerMatchStarted) => {
      if (!payload || payload.code !== roomCode) return;
      once(`match-started:${payload.id}`, () => {
        notify('matches', 'Partida iniciada', `${payload.homeTeam} × ${payload.awayTeam}`, background);
      });
    };
    const onMatchHalftime = (payload: ServerHalftimeState) => {
      if (!payload || payload.code !== roomCode) return;
      once(`match-halftime:${payload.matchId}`, () => {
        notify('matches', 'Intervalo da partida', 'A partida está pausada para os ajustes dos managers.', background);
      });
    };
    const onMatchFinished = (payload: ServerMatchFinished) => {
      if (!payload || payload.code !== roomCode) return;
      once(`match-finished:${payload.id}`, () => {
        notify(
          'matches',
          'Resultado final',
          `${payload.homeTeam} ${payload.score[0]} × ${payload.score[1]} ${payload.awayTeam}`,
          background,
        );
      });
    };

    socket.on('market:updated', onMarketUpdated);
    socket.on('news:post', onNewsPost);
    socket.on('match:started', onMatchStarted);
    socket.on('match:halftime', onMatchHalftime);
    socket.on('match:finished', onMatchFinished);
    return () => {
      socket.off('market:updated', onMarketUpdated);
      socket.off('news:post', onNewsPost);
      socket.off('match:started', onMatchStarted);
      socket.off('match:halftime', onMatchHalftime);
      socket.off('match:finished', onMatchFinished);
    };
  }, [managerId, notify, roomCode, socket]);
}
