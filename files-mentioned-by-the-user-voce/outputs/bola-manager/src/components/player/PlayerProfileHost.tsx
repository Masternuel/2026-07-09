import { CircleAlert } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useMarket, type MarketController } from '../../hooks/useMarket';
import type { BolaSocket, Room } from '../../types';
import {
  RankingPlayerProfile,
  type RankingOfferType,
  type RankingProfilePlayer,
  type RankingPlayerOfferState,
} from '../rankings/RankingEntityProfiles';
import { Modal } from '../shared/Modal';
import {
  buildPlayerProfileOfferInput,
  buildPlayerProfileOfferState,
  canonicalPlayerId,
  openListingForPlayer,
  resolveRankingProfilePlayer,
} from './playerProfileModel';

export {
  buildPlayerProfileOfferInput,
  buildPlayerProfileOfferState,
  canonicalPlayerId,
  enrichRankingPlayer,
  enrichRankingPlayers,
  mergeProfilePlayers,
  openListingForPlayer,
  profilePlayerFromMarketSummary,
  profilePlayersFromLocalRoster,
  resolveRankingProfilePlayer,
} from './playerProfileModel';

interface PlayerProfileHostProps {
  playerId: string | null;
  players: RankingProfilePlayer[];
  room: Room | null;
  socket?: BolaSocket | null;
  managerId?: string;
  currentClubId?: string | null;
  onRosterChanged?: () => void;
  onClose: () => void;
  onToast?: (message: string) => void;
  additionalContent?: ReactNode;
  marketState?: MarketController;
}

export function PlayerProfileHost({
  playerId,
  players,
  room,
  socket = null,
  managerId = '',
  currentClubId = null,
  onRosterChanged = () => undefined,
  onClose,
  onToast = () => undefined,
  additionalContent = null,
  marketState,
}: PlayerProfileHostProps) {
  const ownedMarket = useMarket(room, socket, managerId, onRosterChanged, Boolean(playerId) && !marketState);
  const market = marketState ?? ownedMarket;
  const player = useMemo(
    () => resolveRankingProfilePlayer(playerId, players),
    [playerId, players],
  );
  const listing = useMemo(
    () => openListingForPlayer(market.snapshot, player?.id ?? playerId),
    [market.snapshot, player?.id, playerId],
  );
  const activeOffer = useMemo(() => {
    const targetId = canonicalPlayerId(player?.id ?? playerId);
    if (!targetId) return null;
    return market.snapshot?.offers.find((offer) => (
      offer.direction === 'outgoing'
      && ['pending', 'countered'].includes(offer.status)
      && canonicalPlayerId(offer.player.id) === targetId
    )) ?? null;
  }, [market.snapshot, player?.id, playerId]);
  const scheduledTransfer = useMemo(() => {
    const targetId = canonicalPlayerId(player?.id ?? playerId);
    if (!targetId) return null;
    return market.snapshot?.scheduledTransfers.find((transfer) => (
      transfer.status === 'scheduled' && canonicalPlayerId(transfer.playerId) === targetId
    )) ?? null;
  }, [market.snapshot, player?.id, playerId]);

  if (!playerId) return null;

  if (!player) {
    return (
      <Modal open onClose={onClose} title="Perfil indisponível" eyebrow="JOGADOR NÃO ENCONTRADO" size="md">
        <div className="rankings-empty-state" role="status">
          <CircleAlert size={22} aria-hidden="true" />
          <strong>O jogador não está no snapshot atual</strong>
          <span>O perfil só é aberto por playerId canônico; nomes e clubes não são usados como fallback.</span>
        </div>
      </Modal>
    );
  }

  const marketConfigured = Boolean(room?.code && socket && managerId);
  const initialLoading = market.loading && !market.snapshot;
  const listingBlocksOffer = listing?.mode === 'auction'
    ? 'Este jogador está em leilão. Abra o Mercado para registrar um lance.'
    : listing && !listing.canOffer
      ? 'O anúncio atual não aceita ofertas deste clube.'
      : null;
  const blockedReason = activeOffer
    ? 'Já existe uma proposta ativa do seu clube por este jogador.'
    : scheduledTransfer
      ? 'Este jogador já possui uma transferência agendada.'
      : listingBlocksOffer;
  const offerState: RankingPlayerOfferState = buildPlayerProfileOfferState({
    marketConfigured,
    snapshotAvailable: market.snapshot != null,
    loading: initialLoading,
    syncing: market.syncing,
    pending: market.pendingAction === `offer:${player.id}`,
    marketError: market.error,
    actionError: market.actionError,
    blockedReason,
    listing,
  });

  async function submitOffer(
    selectedPlayer: RankingProfilePlayer,
    requestedType: RankingOfferType,
    amount: number,
    purchaseOption: number | null,
  ) {
    await market.offer(buildPlayerProfileOfferInput({
      playerId: selectedPlayer.id,
      requestedType,
      amount,
      purchaseOption,
      listing,
    }));
    onToast(`Oferta por ${selectedPlayer.name} enviada ao ${selectedPlayer.clubName}.`);
  }

  return (
    <RankingPlayerProfile
      player={player}
      currentClubId={currentClubId}
      comparisonPlayers={players}
      offerState={offerState}
      onClose={onClose}
      onOffer={submitOffer}
      additionalContent={additionalContent}
    />
  );
}
