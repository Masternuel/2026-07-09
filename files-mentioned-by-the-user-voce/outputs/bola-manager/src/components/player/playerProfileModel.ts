import type {
  ClubChoice,
  MarketListing,
  MarketOfferInput,
  MarketPlayerSummary,
  MarketSnapshot,
  Player,
} from '../../types';
import { localPlayerRanking, type RankingPlayer } from '../../utils/rankings';
import type {
  RankingOfferType,
  RankingPlayerOfferState,
  RankingProfilePlayer,
} from '../rankings/RankingEntityProfiles';

export function canonicalPlayerId(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

export function enrichRankingPlayer(
  player: RankingPlayer,
  localPlayers: Player[],
): RankingProfilePlayer {
  const playerKey = canonicalPlayerId(player.id);
  const local = localPlayers.find((candidate) => canonicalPlayerId(candidate.id) === playerKey);
  const unknownFields = new Set(local?.catalogUnknownFields ?? []);
  const unknownAttributes = new Set(local?.catalogUnknownAttributes ?? []);
  const knownAttributes = local
    ? Object.fromEntries(Object.entries(local.attributes).filter(([key]) => !unknownAttributes.has(key as keyof Player['attributes'])))
    : null;
  const publishedAttributes = knownAttributes && Object.keys(knownAttributes).length
    ? knownAttributes as Partial<Player['attributes']>
    : null;
  return {
    ...player,
    shirtNumber: unknownFields.has('shirtNumber') ? null : local?.number ?? player.shirtNumber,
    potential: unknownFields.has('potential') ? null : local?.potential ?? player.potential,
    value: local?.value ?? player.marketValue ?? null,
    wage: unknownFields.has('contract') ? null : local?.wage ?? player.wage,
    condition: unknownFields.has('condition') ? null : local?.condition ?? player.condition,
    morale: unknownFields.has('morale') ? null : local?.morale ?? player.morale,
    status: local?.status ?? player.status,
    negotiability: player.negotiability,
    loanAvailable: player.loanAvailable,
    attributes: unknownFields.has('attributes') ? publishedAttributes : local?.attributes ?? player.attributes,
    contract: unknownFields.has('contract') ? null : local?.contract ? {
      startSeason: local.contract.startSeason,
      endSeason: local.contract.endSeason,
      wage: local.contract.wage,
      status: local.contract.status,
    } : player.contract,
  };
}

export function enrichRankingPlayers(
  players: RankingPlayer[],
  localPlayers: Player[],
): RankingProfilePlayer[] {
  return players.map((player) => enrichRankingPlayer(player, localPlayers));
}

export function profilePlayersFromLocalRoster(
  players: Player[],
  club: ClubChoice,
): RankingProfilePlayer[] {
  return enrichRankingPlayers(localPlayerRanking(players, club), players);
}

export function profilePlayerFromMarketSummary(
  player: MarketPlayerSummary,
  localPlayers: Player[],
  fallbackClub: ClubChoice,
): RankingProfilePlayer {
  const playerKey = canonicalPlayerId(player.id);
  const local = localPlayers.find((candidate) => canonicalPlayerId(candidate.id) === playerKey);
  const localProfile = local
    ? profilePlayersFromLocalRoster([local], fallbackClub)[0] ?? null
    : null;

  return {
    id: player.id,
    name: player.name,
    clubId: player.clubId,
    clubName: player.clubName,
    clubCode: localProfile?.clubCode ?? player.clubId,
    clubCrestImageUrl: localProfile?.clubCrestImageUrl ?? null,
    shirtNumber: localProfile?.shirtNumber ?? null,
    position: player.position,
    age: player.age,
    nationality: localProfile?.nationality ?? null,
    isStar: player.isStar,
    avatarImageUrl: player.avatarImageUrl ?? localProfile?.avatarImageUrl ?? null,
    statisticsAvailable: localProfile?.statisticsAvailable ?? false,
    statisticsComplete: localProfile?.statisticsComplete ?? false,
    statisticsScope: localProfile?.statisticsScope ?? 'unavailable',
    goals: localProfile?.goals ?? 0,
    penaltyGoals: localProfile?.penaltyGoals ?? null,
    nonPenaltyGoals: localProfile?.nonPenaltyGoals ?? null,
    ownGoals: localProfile?.ownGoals ?? null,
    assists: localProfile?.assists ?? 0,
    goalContributions: localProfile?.goalContributions ?? 0,
    appearances: localProfile?.appearances ?? 0,
    starts: localProfile?.starts ?? 0,
    minutes: localProfile?.minutes ?? 0,
    yellowCards: localProfile?.yellowCards ?? 0,
    redCards: localProfile?.redCards ?? 0,
    keyPasses: localProfile?.keyPasses ?? null,
    bigChancesCreated: localProfile?.bigChancesCreated ?? null,
    tackles: localProfile?.tackles ?? null,
    saves: localProfile?.saves ?? null,
    cleanSheets: localProfile?.cleanSheets ?? null,
    shots: localProfile?.shots ?? null,
    shotsOnTarget: localProfile?.shotsOnTarget ?? null,
    overall: player.overall,
    rating: localProfile?.rating ?? player.overall,
    averageRating: localProfile?.averageRating ?? null,
    minutesPerGoal: localProfile?.minutesPerGoal ?? null,
    minutesPerAssist: localProfile?.minutesPerAssist ?? null,
    minutesPerContribution: localProfile?.minutesPerContribution ?? null,
    contributionsPerGame: localProfile?.contributionsPerGame ?? null,
    clubGoalParticipationPercent: localProfile?.clubGoalParticipationPercent ?? null,
    marketValue: player.value,
    wage: localProfile?.wage ?? null,
    condition: localProfile?.condition ?? null,
    morale: localProfile?.morale ?? null,
    potential: localProfile?.potential ?? null,
    status: localProfile?.status ?? null,
    negotiability: localProfile?.negotiability ?? null,
    loanAvailable: localProfile?.loanAvailable ?? null,
    attributes: localProfile?.attributes ?? null,
    contract: localProfile?.contract ?? null,
    injuries: localProfile?.injuries ?? 0,
    goalsConceded: localProfile?.goalsConceded ?? null,
    rank: null,
    previousRank: null,
    rankChange: null,
    value: player.value,
  };
}

export function mergeProfilePlayers(
  ...groups: RankingProfilePlayer[][]
): RankingProfilePlayer[] {
  const players = new Map<string, RankingProfilePlayer>();
  for (const group of groups) {
    for (const player of group) {
      const playerId = canonicalPlayerId(player.id);
      if (playerId && !players.has(playerId)) players.set(playerId, player);
    }
  }
  return [...players.values()];
}

export function resolveRankingProfilePlayer(
  playerId: string | null,
  players: RankingProfilePlayer[],
): RankingProfilePlayer | null {
  const targetId = canonicalPlayerId(playerId);
  if (!targetId) return null;
  return players.find((candidate) => canonicalPlayerId(candidate.id) === targetId) ?? null;
}

export function openListingForPlayer(
  snapshot: MarketSnapshot | null,
  playerId: string | null,
): MarketListing | null {
  const targetId = canonicalPlayerId(playerId);
  if (!targetId) return null;
  return snapshot?.listings.find((listing) => (
    listing.status === 'open' && canonicalPlayerId(listing.player.id) === targetId
  )) ?? null;
}

export function buildPlayerProfileOfferState({
  marketConfigured,
  snapshotAvailable,
  loading,
  syncing,
  pending,
  marketError,
  actionError,
  blockedReason,
  listing,
}: {
  marketConfigured: boolean;
  snapshotAvailable: boolean;
  loading: boolean;
  syncing: boolean;
  pending: boolean;
  marketError: string | null;
  actionError: string | null;
  blockedReason: string | null;
  listing: MarketListing | null;
}): RankingPlayerOfferState {
  return {
    available: marketConfigured
      && snapshotAvailable
      && !loading
      && !marketError
      && !blockedReason,
    loading,
    syncing,
    pending,
    error: marketError ?? actionError,
    blockedReason,
    listingId: listing?.id ?? null,
    listingMode: listing?.mode ?? null,
    dealType: listing?.mode === 'direct' ? listing.dealType : null,
    suggestedAmount: listing?.mode === 'direct'
      ? listing.askingPrice ?? listing.player.value
      : null,
  };
}

export function buildPlayerProfileOfferInput({
  playerId,
  requestedType,
  amount,
  purchaseOption,
  listing,
  durationRounds = 10,
}: {
  playerId: string;
  requestedType: RankingOfferType;
  amount: number;
  purchaseOption: number | null;
  listing: MarketListing | null;
  durationRounds?: number;
}): MarketOfferInput {
  const dealType = listing?.mode === 'direct' ? listing.dealType : requestedType;
  const listedLoanTerms = listing?.mode === 'direct' ? listing.loanTerms : null;
  const purchaseObligation = listedLoanTerms?.purchaseObligation ?? null;

  return {
    playerId,
    ...(listing?.mode === 'direct' ? { listingId: listing.id } : {}),
    dealType,
    amount,
    noticeApproval: true,
    ...(dealType === 'loan' ? {
      loanTerms: {
        fee: amount,
        wageSharePercent: listedLoanTerms?.wageSharePercent ?? 50,
        durationRounds: listedLoanTerms?.durationRounds
          ?? Math.max(6, Math.min(20, durationRounds)),
        purchaseOption: purchaseObligation ? null : listedLoanTerms?.purchaseOption ?? purchaseOption,
        ...(purchaseObligation ? { purchaseObligation } : {}),
      },
    } : {}),
  };
}
