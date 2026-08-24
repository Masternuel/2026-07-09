import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Banknote,
  Clock3,
  Gavel,
  HandCoins,
  History,
  MessageSquareText,
  PackagePlus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { Modal } from '../../components/shared/Modal';
import {
  mergeProfilePlayers,
  PlayerProfileHost,
  profilePlayerFromMarketSummary,
  profilePlayersFromLocalRoster,
} from '../../components/player/PlayerProfileHost';
import { useMarket } from '../../hooks/useMarket';
import type {
  BolaSocket,
  ClubChoice,
  MarketDealType,
  MarketListing,
  MarketListingMode,
  MarketOffer,
  MarketPlayerSummary,
  MarketResponseAction,
  MarketTransaction,
  Player,
  Room,
} from '../../types';
import { formatCurrency } from '../../utils/formatters';

interface MarketViewProps {
  room: Room | null;
  club: ClubChoice;
  players: Player[];
  socket: BolaSocket | null;
  managerId: string;
  onRosterChanged: () => void;
  onToast: (message: string) => void;
}

type MarketTab = 'opportunities' | 'negotiations' | 'squad' | 'history';
type PurchaseClause = 'none' | 'option' | 'obligation';
type ContractStart = 'current' | 'next';
type MarketDialog =
  | { kind: 'deal'; listing: MarketListing; unlisted?: boolean }
  | { kind: 'list'; player: MarketPlayerSummary }
  | { kind: 'respond'; offer: MarketOffer }
  | { kind: 'cancel-listing'; listing: MarketListing }
  | null;

interface MarketFormState {
  amount: string;
  message: string;
  mode: MarketListingMode;
  dealType: MarketDealType;
  expiresInHours: string;
  wageSharePercent: string;
  durationRounds: string;
  contractWage: string;
  contractDurationSeasons: string;
  contractStart: ContractStart;
  purchaseClause: PurchaseClause;
  purchaseOption: string;
  counterAmount: string;
}

const initialForm: MarketFormState = {
  amount: '',
  message: '',
  mode: 'direct',
  dealType: 'transfer',
  expiresInHours: '24',
  wageSharePercent: '50',
  durationRounds: '10',
  contractWage: '100000',
  contractDurationSeasons: '3',
  contractStart: 'current',
  purchaseClause: 'none',
  purchaseOption: '',
  counterAmount: '',
};

const offerStatus: Record<MarketOffer['status'], string> = {
  pending: 'Pendente',
  accepted: 'Aceita',
  rejected: 'Recusada',
  countered: 'Contraproposta',
  cancelled: 'Cancelada',
  expired: 'Expirada',
};

function searchable(value: unknown) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');
}

function matchesSearch(player: MarketPlayerSummary, query: string, ...extra: unknown[]) {
  if (!query) return true;
  return searchable([player.name, player.position, player.clubName, ...extra].join(' ')).includes(query);
}

function safeMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.trunc(amount) : 0;
}

function countdown(expiresAt: string | null | undefined, now: number) {
  if (!expiresAt) return 'Sem prazo';
  const remaining = Date.parse(expiresAt) - now;
  if (!Number.isFinite(remaining) || remaining <= 0) return 'Encerrado';
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const rest = seconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

function relativeTime(createdAt: string, now: number) {
  const elapsed = Math.max(0, now - Date.parse(createdAt));
  if (!Number.isFinite(elapsed)) return '';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return `há ${Math.floor(hours / 24)} d`;
}

function catalogOverall(player: Player) {
  const overall = Number(player.overall);
  return Number.isFinite(overall) ? Math.max(1, Math.min(20, overall)) : 0;
}

function dealLabel(dealType: MarketDealType) {
  return dealType === 'loan' ? 'Empréstimo' : 'Transferência';
}

function transactionDealLabel(transaction: MarketTransaction) {
  switch (transaction.eventType) {
    case 'free-agent-signing': return 'Contratação livre';
    case 'loan-option': return 'Compra após empréstimo';
    case 'loan-obligation': return 'Compra obrigatória';
    case 'loan-return': return 'Retorno de empréstimo';
    case 'transfer-agreement': return 'Transferência futura';
    default: return dealLabel(transaction.dealType);
  }
}

function transactionStatusLabel(transaction: MarketTransaction) {
  const status = String(transaction.status ?? (transaction.eventType === 'transfer-agreement' ? 'scheduled' : 'completed'))
    .toLocaleLowerCase('pt-BR');
  if (status === 'scheduled') return 'Agendada';
  if (status === 'cancelled') return 'Cancelada';
  if (status === 'failed') return 'Falhou';
  return 'Concluída';
}

function transactionSeasonLabel(transaction: MarketTransaction) {
  const season = Number(transaction.effectiveSeason);
  return Number.isFinite(season) && season > 0
    ? `Temporada ${Math.trunc(season)}`
    : 'Temporada não informada';
}

function transactionDateLabel(transaction: MarketTransaction) {
  const date = new Date(transaction.completedAt);
  if (!Number.isFinite(date.getTime())) return 'Data não informada';
  const status = String(transaction.status ?? (transaction.eventType === 'transfer-agreement' ? 'scheduled' : 'completed'))
    .toLocaleLowerCase('pt-BR');
  const prefix = status === 'scheduled'
    ? 'Acordo em'
    : 'Atualizada em';
  return `${prefix} ${date.toLocaleDateString('pt-BR')}`;
}

function MarketPlayerIdentity({
  player,
  detail,
  onOpen,
}: {
  player: MarketPlayerSummary;
  detail: string;
  onOpen: (playerId: string) => void;
}) {
  return <button type="button" className="market-player__identity market-player__identity--link" onClick={() => onOpen(player.id)} aria-label={`Abrir perfil de ${player.name}`}>
    <span className="market-shirt">{player.position}<i>{player.age}</i></span>
    <span><strong>{player.name}{player.isStar && <Star className="market-star" size={11} fill="currentColor" />}</strong><small>{detail}</small></span>
  </button>;
}

export function MarketView({
  room,
  club,
  players,
  socket,
  managerId,
  onRosterChanged,
  onToast,
}: MarketViewProps) {
  const market = useMarket(room, socket, managerId, onRosterChanged);
  const [tab, setTab] = useState<MarketTab>('opportunities');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<MarketDialog>(null);
  const [form, setForm] = useState<MarketFormState>(initialForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [profilePlayerId, setProfilePlayerId] = useState<string | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [clockOrigin, setClockOrigin] = useState(() => ({ server: Date.now(), local: Date.now() }));
  const snapshot = market.snapshot;

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const server = Date.parse(snapshot?.serverTime ?? '');
    const local = Date.now();
    setClockOrigin({ server: Number.isFinite(server) ? server : local, local });
  }, [snapshot?.serverTime]);

  const now = clockOrigin.server + (tick - clockOrigin.local);
  const normalizedQuery = searchable(query.trim());
  const localPlayers = useMemo(() => new Map(players.map((player) => [player.id, player])), [players]);
  const candidates = useMemo(() => (snapshot?.candidates ?? []).map((candidate) => ({
    ...candidate,
    avatarImageUrl: candidate.avatarImageUrl ?? localPlayers.get(candidate.id)?.avatarImageUrl ?? null,
  })), [localPlayers, snapshot?.candidates]);
  const ownPlayers = useMemo<MarketPlayerSummary[]>(() => (
    players.map((player) => ({
      id: player.id,
      name: player.name,
      position: player.position,
      age: player.age,
      overall: catalogOverall(player),
      value: player.value,
      clubId: club.id,
      clubName: club.name,
      isStar: player.isStar,
      avatarImageUrl: player.avatarImageUrl ?? null,
    }))
  ), [club.id, club.name, players]);
  const profilePlayers = useMemo(() => {
    const summaries = [
      ...ownPlayers,
      ...(snapshot?.candidates ?? []),
      ...(snapshot?.listings ?? []).map((listing) => listing.player),
      ...(snapshot?.offers ?? []).map((offer) => offer.player),
      ...(snapshot?.activeLoans ?? []).map((loan) => loan.player),
      ...(snapshot?.transactions ?? []).map((transaction) => transaction.player),
    ];
    return mergeProfilePlayers(
      profilePlayersFromLocalRoster(players, club),
      summaries.map((player) => profilePlayerFromMarketSummary(player, players, club)),
    );
  }, [club, ownPlayers, players, snapshot]);
  const openListings = (snapshot?.listings ?? []).filter((listing) => listing.status === 'open');
  const ownListingByPlayer = new Map(openListings.filter((listing) => listing.ownListing).map((listing) => [listing.player.id, listing]));
  const listedPlayerIds = new Set(openListings.map((listing) => listing.player.id));
  const directCandidates = candidates.filter((candidate) => !listedPlayerIds.has(candidate.id));
  const filteredListings = openListings.filter((listing) => matchesSearch(
    listing.player,
    normalizedQuery,
    listing.sellerClubName,
    listing.mode,
    listing.dealType,
  ));
  const filteredOffers = (snapshot?.offers ?? []).filter((offer) => matchesSearch(
    offer.player,
    normalizedQuery,
    offer.buyerClubName,
    offer.sellerClubName,
    offer.status,
  ));
  const filteredCandidates = directCandidates.filter((player) => matchesSearch(player, normalizedQuery));
  const filteredOwnPlayers = ownPlayers.filter((player) => matchesSearch(player, normalizedQuery));
  const borrowedPlayerIds = new Set(
    (snapshot?.activeLoans ?? [])
      .filter((loan) => loan.borrowerClubId === club.id)
      .map((loan) => loan.player.id),
  );
  const pending = Boolean(market.pendingAction);

  function updateForm<K extends keyof MarketFormState>(key: K, value: MarketFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openDeal(listing: MarketListing) {
    const base = listing.mode === 'auction'
      ? Math.max(safeMoney(listing.minimumBid), safeMoney(listing.currentBid) + 500_000)
      : safeMoney(listing.askingPrice) || safeMoney(listing.player.value);
    setForm({
      ...initialForm,
      amount: String(base),
      dealType: listing.dealType,
      wageSharePercent: String(listing.loanTerms?.wageSharePercent ?? 50),
      durationRounds: String(listing.loanTerms?.durationRounds ?? 10),
      purchaseClause: listing.loanTerms?.purchaseObligation
        ? 'obligation'
        : listing.loanTerms?.purchaseOption
          ? 'option'
          : 'none',
      purchaseOption: listing.loanTerms?.purchaseObligation
        ? String(listing.loanTerms.purchaseObligation)
        : listing.loanTerms?.purchaseOption
          ? String(listing.loanTerms.purchaseOption)
          : '',
    });
    setFormError(null);
    market.clearActionError();
    setDialog({ kind: 'deal', listing });
  }

  function openCandidateOffer(player: MarketPlayerSummary) {
    const listing: MarketListing = {
      id: `candidate:${player.id}`,
      mode: 'direct',
      dealType: 'transfer',
      status: 'open',
      player,
      sellerClubId: player.clubId,
      sellerClubName: player.clubName,
      askingPrice: player.value,
      minimumBid: null,
      currentBid: null,
      bidCount: 0,
      expiresAt: null,
      ownListing: false,
      canBid: false,
      canOffer: true,
    };
    setForm({ ...initialForm, amount: String(safeMoney(player.value)), dealType: 'transfer' });
    setFormError(null);
    market.clearActionError();
    setDialog({ kind: 'deal', listing, unlisted: true });
  }

  function openListing(player: MarketPlayerSummary) {
    setForm({ ...initialForm, amount: String(safeMoney(player.value)) });
    setFormError(null);
    market.clearActionError();
    setDialog({ kind: 'list', player });
  }

  function openResponse(offer: MarketOffer) {
    setForm({
      ...initialForm,
      counterAmount: String(safeMoney(offer.counterAmount ?? offer.amount)),
      dealType: offer.dealType,
    });
    setFormError(null);
    market.clearActionError();
    setDialog({ kind: 'respond', offer });
  }

  function positiveInteger(value: string, label: string) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} deve ser maior que zero.`);
    return parsed;
  }

  function loanTerms(amount: number) {
    const wageSharePercent = Math.trunc(Number(form.wageSharePercent));
    const durationRounds = Math.trunc(Number(form.durationRounds));
    if (!Number.isFinite(wageSharePercent) || wageSharePercent < 0 || wageSharePercent > 100) {
      throw new Error('Percentual do salário deve ficar entre 0% e 100%.');
    }
    if (!Number.isFinite(durationRounds) || durationRounds < 1 || durationRounds > 76) {
      throw new Error('Duração deve ficar entre 1 e 76 rodadas.');
    }
    const purchaseOption = form.purchaseOption.trim()
      ? positiveInteger(form.purchaseOption, 'Opção de compra')
      : null;
    if (form.purchaseClause !== 'none' && purchaseOption === null) {
      throw new Error('Informe o valor da clausula de compra.');
    }
    return {
      fee: amount,
      wageSharePercent,
      durationRounds,
      purchaseOption: form.purchaseClause === 'option' ? purchaseOption : null,
      purchaseObligation: form.purchaseClause === 'obligation' ? purchaseOption : null,
    };
  }

  function contractTerms(dealType: MarketDealType) {
    const wage = positiveInteger(form.contractWage, 'Salario');
    const durationSeasons = positiveInteger(form.contractDurationSeasons, 'Duracao do contrato');
    if (wage < 1_000) throw new Error('Salario deve ser de pelo menos R$ 1.000.');
    if (durationSeasons > 8) throw new Error('Contrato deve durar entre 1 e 8 temporadas.');
    const season = Math.max(1, Math.trunc(Number(room?.currentSeason) || 1));
    const effectiveSeason = dealType === 'transfer' && form.contractStart === 'next'
      ? season + 1
      : season;
    return { wage, durationSeasons, effectiveSeason };
  }

  async function submitDeal() {
    if (dialog?.kind !== 'deal') return;
    try {
      const amount = positiveInteger(form.amount, dialog.listing.mode === 'auction' ? 'Lance' : 'Oferta');
      const selectedDealType = dialog.unlisted ? form.dealType : dialog.listing.dealType;
      const selectedLoanTerms = dialog.listing.mode === 'direct' && selectedDealType === 'loan'
        ? loanTerms(amount)
        : null;
      const purchaseCommitment = selectedLoanTerms?.purchaseObligation
        ?? safeMoney(dialog.listing.loanTerms?.purchaseObligation);
      if (amount + purchaseCommitment > (snapshot?.finance.available ?? 0)) {
        throw new Error('Orçamento disponível insuficiente para a proposta e suas obrigações.');
      }
      if (dialog.listing.mode === 'auction') {
        await market.bid(dialog.listing.id, amount, true);
        onToast(`Lance de ${formatCurrency(amount)} registrado por ${dialog.listing.player.name}.`);
      } else {
        await market.offer({
          playerId: dialog.listing.player.id,
          ...(!dialog.unlisted ? { listingId: dialog.listing.id } : {}),
          dealType: selectedDealType,
          amount,
          contractTerms: contractTerms(selectedDealType),
          ...(form.message.trim() ? { message: form.message.trim() } : {}),
          ...(selectedLoanTerms ? { loanTerms: selectedLoanTerms } : {}),
          noticeApproval: true,
        });
        onToast(`Oferta por ${dialog.listing.player.name} enviada.`);
      }
      setDialog(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível enviar a proposta.');
    }
  }

  async function submitListing() {
    if (dialog?.kind !== 'list') return;
    try {
      const amount = positiveInteger(form.amount, form.mode === 'auction' ? 'Lance mínimo' : 'Valor pedido');
      const expiresInHours = positiveInteger(form.expiresInHours, 'Prazo');
      if (expiresInHours > 168) throw new Error('Prazo máximo do anúncio é 168 horas.');
      await market.list({
        playerId: dialog.player.id,
        mode: form.mode,
        dealType: form.dealType,
        ...(form.mode === 'auction' ? { minimumBid: amount } : { askingPrice: amount }),
        expiresInHours,
        ...(form.dealType === 'loan' ? { loanTerms: loanTerms(amount) } : {}),
        noticeApproval: true,
      });
      onToast(`${dialog.player.name} colocado no mercado.`);
      setDialog(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível criar o anúncio.');
    }
  }

  async function submitResponse(action: MarketResponseAction) {
    if (dialog?.kind !== 'respond') return;
    try {
      const counterAmount = action === 'counter'
        ? positiveInteger(form.counterAmount, 'Contraproposta')
        : undefined;
      await market.respond(dialog.offer.id, action, counterAmount, true);
      const feedback = action === 'accept'
        ? 'Oferta aceita e transação processada.'
        : action === 'reject'
          ? 'Oferta recusada.'
          : action === 'cancel'
            ? 'Oferta cancelada.'
            : 'Contraproposta enviada.';
      onToast(feedback);
      setDialog(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível responder à oferta.');
    }
  }

  async function submitCancelListing() {
    if (dialog?.kind !== 'cancel-listing') return;
    try {
      await market.cancelListing(dialog.listing.id);
      onToast(`Anúncio de ${dialog.listing.player.name} cancelado.`);
      setDialog(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Não foi possível cancelar o anúncio.');
    }
  }

  async function submitLoanOption(loanId: string, playerName: string) {
    try {
      await market.exerciseLoanOption(loanId, true);
      onToast(`Opcao de compra de ${playerName} exercida.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Nao foi possivel exercer a opcao de compra.');
    }
  }

  function renderListing(listing: MarketListing) {
    const asking = listing.mode === 'auction'
      ? listing.currentBid ?? listing.minimumBid ?? listing.player.value
      : listing.askingPrice ?? listing.player.value;
    const actionLoading = market.pendingAction?.endsWith(listing.id) ?? false;
    return <article className="market-player market-listing" key={listing.id}>
      <MarketPlayerIdentity player={listing.player} detail={`${listing.sellerClubName} · ${dealLabel(listing.dealType)}`} onOpen={setProfilePlayerId} />
      <div className="market-player__metric"><small>OVERALL</small><strong>{listing.player.overall}/20</strong></div>
      <div className="market-player__metric"><small>{listing.mode === 'auction' ? 'MAIOR LANCE' : 'VALOR PEDIDO'}</small><strong>{formatCurrency(safeMoney(asking))}</strong></div>
      <div className="auction-clock"><small>{listing.mode === 'auction' ? 'ENCERRA EM' : 'MODALIDADE'}</small><strong><Clock3 size={13} /> {listing.mode === 'auction' ? countdown(listing.expiresAt, now) : 'Direta'}</strong></div>
      <div className="market-actions">
        {listing.ownListing
          ? <Button variant="danger" size="sm" loading={actionLoading} onClick={() => { setFormError(null); setDialog({ kind: 'cancel-listing', listing }); }}>Cancelar</Button>
          : listing.mode === 'auction'
            ? <Button variant="primary" size="sm" disabled={!listing.canBid} loading={actionLoading} onClick={() => openDeal(listing)} icon={<Gavel size={14} />}>Dar lance · {listing.bidCount}</Button>
            : <Button variant="secondary" size="sm" disabled={!listing.canOffer} loading={actionLoading} onClick={() => openDeal(listing)} icon={<MessageSquareText size={14} />}>Fazer oferta</Button>}
      </div>
    </article>;
  }

  function renderOffer(offer: MarketOffer) {
    const effectiveAmount = offer.counterAmount ?? offer.amount;
    const actionable = offer.status === 'pending' || offer.status === 'countered';
    const canRespond = actionable && Object.values(offer.permissions).some(Boolean);
    return <article className="market-offer" key={offer.id}>
      <MarketPlayerIdentity player={offer.player} detail={offer.direction === 'incoming' ? `Recebida de ${offer.buyerClubName}` : `Enviada para ${offer.sellerClubName}`} onOpen={setProfilePlayerId} />
      <span className="market-offer__route"><small>{dealLabel(offer.dealType)}</small><strong>{offer.buyerClubName} <ArrowRightLeft size={12} /> {offer.sellerClubName}</strong></span>
      <span><small>VALOR</small><strong>{formatCurrency(safeMoney(effectiveAmount))}</strong></span>
      <Badge tone={offer.status === 'accepted' ? 'positive' : offer.status === 'rejected' || offer.status === 'cancelled' ? 'danger' : 'warning'}>{offerStatus[offer.status]}</Badge>
      <Button size="sm" variant="secondary" disabled={!canRespond} onClick={() => openResponse(offer)}>Ver negociação</Button>
    </article>;
  }

  const boardTitle = tab === 'opportunities'
    ? 'Leilões, transferências e empréstimos'
    : tab === 'negotiations'
      ? 'Ofertas enviadas e recebidas'
      : tab === 'squad'
        ? 'Jogadores disponíveis para anunciar'
        : 'Empréstimos ativos e transferências concluídas';
  const actionError = formError ?? market.actionError;
  const modalTitle = dialog?.kind === 'deal'
      ? dialog.listing.mode === 'auction' ? 'Fazer lance' : `Propor ${dealLabel(dialog.unlisted ? form.dealType : dialog.listing.dealType).toLocaleLowerCase('pt-BR')}`
    : dialog?.kind === 'list'
      ? 'Criar anúncio'
      : dialog?.kind === 'respond'
        ? 'Responder negociação'
        : 'Cancelar anúncio';
  const modalEyebrow = dialog?.kind === 'deal' || dialog?.kind === 'cancel-listing'
    ? `${dialog.listing.player.name} · ${dialog.listing.sellerClubName}`
    : dialog?.kind === 'list'
      ? `${dialog.player.name} · ${club.name}`
      : dialog?.kind === 'respond'
        ? `${dialog.offer.player.name} · ${offerStatus[dialog.offer.status]}`
        : '';

  return <main className="secondary-view view-enter">
    <div className="view-heading">
      <div><p className="eyebrow">MERCADO DA SALA · BASE COMPARTILHADA</p><h1>Mercado</h1><p>Ofertas, leilões, empréstimos e transferências persistidos no save.</p></div>
      <div className="market-budget"><small>ORÇAMENTO DISPONÍVEL</small><strong>{snapshot ? formatCurrency(snapshot.finance.available) : '—'}</strong><span>{snapshot ? `${formatCurrency(snapshot.finance.committed)} comprometidos` : 'Sincronizando finanças'}</span></div>
    </div>

    <div className="market-tabs" role="tablist" aria-label="Áreas do mercado">
      <button aria-selected={tab === 'opportunities'} onClick={() => setTab('opportunities')}>Oportunidades <span>{openListings.length + directCandidates.length}</span></button>
      <button aria-selected={tab === 'negotiations'} onClick={() => setTab('negotiations')}>Negociações <span>{snapshot?.offers.length ?? 0}</span></button>
      <button aria-selected={tab === 'squad'} onClick={() => setTab('squad')}>Meus jogadores <span>{ownPlayers.length}</span></button>
      <button aria-selected={tab === 'history'} onClick={() => setTab('history')}>Empréstimos / Histórico <span>{(snapshot?.activeLoans.length ?? 0) + (snapshot?.transactions.length ?? 0)}</span></button>
      <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jogador, clube ou posição" /></label>
    </div>

    {market.error && <div className="market-error" role="alert"><span>{market.error}</span><Button size="sm" variant="secondary" onClick={() => void market.refresh()} icon={<RefreshCw size={14} />}>Tentar novamente</Button></div>}

    <div className="market-layout">
      <section className="auction-board">
        <header><div><p className="eyebrow">REDE DA SALA</p><h2>{boardTitle}</h2></div><Badge tone={market.error ? 'danger' : 'positive'} dot>{market.syncing ? 'Sincronizando' : market.error ? 'Indisponível' : 'Mercado ao vivo'}</Badge></header>
        {market.loading && !snapshot
          ? <div className="market-empty market-empty--loading"><RefreshCw className="spin" size={20} /><strong>Sincronizando mercado…</strong><small>Buscando anúncios, finanças e negociações.</small></div>
          : tab === 'opportunities'
            ? filteredListings.length || filteredCandidates.length
              ? <>{filteredListings.map(renderListing)}{filteredCandidates.map((player) => <article className="market-player market-listing" key={`candidate-${player.id}`}>
                  <MarketPlayerIdentity player={player} detail={`${player.clubName} · Negociação direta`} onOpen={setProfilePlayerId} />
                  <div className="market-player__metric"><small>OVERALL</small><strong>{player.overall}/20</strong></div>
                  <div className="market-player__metric"><small>VALOR ESTIMADO</small><strong>{formatCurrency(player.value)}</strong></div>
                  <div className="auction-clock"><small>MODALIDADE</small><strong><MessageSquareText size={13} /> Direta</strong></div>
                  <div className="market-actions"><Button variant="secondary" size="sm" onClick={() => openCandidateOffer(player)} icon={<MessageSquareText size={14} />}>Fazer oferta</Button></div>
                </article>)}</>
              : <div className="market-empty"><Gavel size={21} /><strong>Nenhuma oportunidade encontrada</strong><small>Altere a busca ou aguarde novos anúncios.</small></div>
            : tab === 'negotiations'
              ? filteredOffers.length ? filteredOffers.map(renderOffer) : <div className="market-empty"><HandCoins size={21} /><strong>Nenhuma negociação</strong><small>Suas ofertas enviadas e recebidas aparecerão aqui.</small></div>
              : tab === 'squad'
                ? filteredOwnPlayers.length ? filteredOwnPlayers.map((player) => {
                    const activeListing = ownListingByPlayer.get(player.id);
                    const isBorrowed = borrowedPlayerIds.has(player.id);
                    return <article className="market-player market-candidate" key={player.id}>
                      <MarketPlayerIdentity player={player} detail={`${player.clubName} · ${player.age} anos`} onOpen={setProfilePlayerId} />
                      <div className="market-player__metric"><small>OVERALL</small><strong>{player.overall}/20</strong></div>
                      <div className="market-player__metric"><small>VALOR ESTIMADO</small><strong>{formatCurrency(player.value)}</strong></div>
                      <div className="market-player__metric"><small>STATUS</small><strong>{activeListing ? 'Anunciado' : isBorrowed ? 'Emprestado ao clube' : 'Disponível'}</strong></div>
                      <div className="market-actions"><Button size="sm" variant={activeListing || isBorrowed ? 'ghost' : 'primary'} disabled={Boolean(activeListing || isBorrowed)} onClick={() => openListing(player)} icon={<PackagePlus size={14} />}>{activeListing ? 'Já anunciado' : isBorrowed ? 'Não pode anunciar' : 'Criar anúncio'}</Button></div>
                    </article>;
                  }) : <div className="market-empty"><PackagePlus size={21} /><strong>Nenhum jogador disponível</strong><small>Jogadores já negociados ou emprestados não podem ser anunciados.</small></div>
                : <div className="market-history">
                    {(snapshot?.activeLoans?.length ?? 0) > 0 && <section><h3><HandCoins size={15} /> Empréstimos ativos</h3>{snapshot?.activeLoans.filter((loan) => matchesSearch(loan.player, normalizedQuery, loan.lenderClubName, loan.borrowerClubName)).map((loan) => <article key={loan.id}>
                      <MarketPlayerIdentity player={loan.player} detail={`${loan.lenderClubName} → ${loan.borrowerClubName}`} onOpen={setProfilePlayerId} />
                      <span><small>SALÁRIO</small><strong>{loan.wageSharePercent}% pelo destino</strong></span>
                      <span><small>RESTANTE</small><strong>{loan.remainingRounds} rodadas</strong></span>
                      <span><small>CLÁUSULA DE COMPRA</small><strong>{loan.purchaseObligation
                        ? `Obrigação · ${formatCurrency(loan.purchaseObligation)}`
                        : loan.purchaseOption
                          ? `Opção · ${formatCurrency(loan.purchaseOption)}`
                          : 'Sem cláusula'}</strong></span>
                      {loan.canExerciseOption && <Button
                        size="sm"
                        variant="primary"
                        loading={market.pendingAction === `exercise-option:${loan.id}`}
                        onClick={() => void submitLoanOption(loan.id, loan.player.name)}
                      >Exercer opção</Button>}
                    </article>)}</section>}
                    {(snapshot?.transactions?.length ?? 0) > 0 && <section><h3><History size={15} /> Movimentações do mercado</h3>{snapshot?.transactions.filter((transaction) => matchesSearch(
                      transaction.player,
                      normalizedQuery,
                      transaction.fromClubName,
                      transaction.toClubName,
                      transaction.status,
                      transaction.effectiveSeason,
                    )).map((transaction) => <article key={transaction.id}>
                      <MarketPlayerIdentity player={transaction.player} detail={`${transaction.fromClubName} → ${transaction.toClubName}`} onOpen={setProfilePlayerId} />
                      <span><small>TIPO</small><strong>{transactionDealLabel(transaction)}</strong></span>
                      <span><small>VALOR</small><strong>{formatCurrency(transaction.amount)}</strong></span>
                      <span><small>STATUS</small><strong>{transactionStatusLabel(transaction)} · {transactionSeasonLabel(transaction)}</strong><small>{transactionDateLabel(transaction)}</small></span>
                    </article>)}</section>}
                    {!((snapshot?.activeLoans?.length ?? 0) || (snapshot?.transactions?.length ?? 0)) && <div className="market-empty"><History size={21} /><strong>Histórico vazio</strong><small>Movimentações do mercado aparecerão aqui.</small></div>}
                  </div>}
      </section>

      <aside className="market-sidebar">
        <section><p className="eyebrow">FINANÇAS DO CLUBE</p><h3>{club.name}</h3><dl className="market-finance"><div><dt>Saldo</dt><dd>{snapshot ? formatCurrency(snapshot.finance.balance) : '—'}</dd></div><div><dt>Orçamento de transferências</dt><dd>{snapshot ? formatCurrency(snapshot.finance.transferBudget ?? snapshot.finance.available) : '—'}</dd></div><div><dt>Comprometido</dt><dd>{snapshot ? formatCurrency(snapshot.finance.committed) : '—'}</dd></div><div><dt>Disponível no mercado</dt><dd>{snapshot ? formatCurrency(snapshot.finance.available) : '—'}</dd></div><div><dt>Folha dos jogadores</dt><dd>{snapshot ? `${formatCurrency(snapshot.finance.monthlyPayroll ?? 0)} / ${formatCurrency(snapshot.finance.wageBudget ?? 0)}` : '—'}</dd></div></dl></section>
        <section><p className="eyebrow">MOVIMENTO DA SALA</p>{snapshot?.activity.length
          ? snapshot.activity.slice(0, 6).map((activity) => <div className="market-activity" key={activity.id}><span className="avatar">{(activity.actorName ?? 'BM').slice(0, 2).toUpperCase()}</span><p>{activity.actorName && <strong>{activity.actorName} </strong>}{activity.message}<small>{relativeTime(activity.createdAt, now)}</small></p></div>)
          : <div className="market-sidebar-empty">Nenhuma movimentação registrada.</div>}</section>
        <section className="fair-play"><ShieldCheck size={17} /><span><strong>Controle financeiro</strong><small>{snapshot && snapshot.finance.available >= 0 ? 'Orçamento dentro do limite' : 'Aguardando sincronização'}</small></span><Badge tone={snapshot && snapshot.finance.available >= 0 ? 'positive' : 'warning'}>{snapshot && snapshot.finance.available >= 0 ? 'Regular' : 'Pendente'}</Badge></section>
      </aside>
    </div>

    <Modal
      open={Boolean(dialog)}
      onClose={() => !pending && setDialog(null)}
      title={modalTitle}
      eyebrow={modalEyebrow}
      footer={dialog?.kind === 'deal'
        ? <><Button variant="ghost" disabled={pending} onClick={() => setDialog(null)}>Cancelar</Button><Button variant="primary" loading={pending} onClick={() => void submitDeal()}>{dialog.listing.mode === 'auction' ? 'Confirmar lance' : 'Enviar oferta'}</Button></>
        : dialog?.kind === 'list'
          ? <><Button variant="ghost" disabled={pending} onClick={() => setDialog(null)}>Cancelar</Button><Button variant="primary" loading={pending} onClick={() => void submitListing()}>Publicar anúncio</Button></>
          : dialog?.kind === 'cancel-listing'
            ? <><Button variant="ghost" disabled={pending} onClick={() => setDialog(null)}>Voltar</Button><Button variant="danger" loading={pending} onClick={() => void submitCancelListing()}>Cancelar anúncio</Button></>
            : dialog?.kind === 'respond'
              ? <><Button variant="ghost" disabled={pending} onClick={() => setDialog(null)}>Fechar</Button>{dialog.offer.permissions.cancel && <Button variant="danger" loading={pending} onClick={() => void submitResponse('cancel')}>Cancelar oferta</Button>}{dialog.offer.permissions.reject && <Button variant="danger" loading={pending} onClick={() => void submitResponse('reject')}>Recusar</Button>}{dialog.offer.permissions.accept && <Button variant="primary" loading={pending} onClick={() => void submitResponse('accept')}>Aceitar</Button>}</>
              : null}
    >
      {dialog?.kind === 'deal' && <div className="bid-form">
        <div className="bid-summary"><span><small>VALOR ESTIMADO</small><strong>{formatCurrency(dialog.listing.player.value)}</strong></span><span><small>{dialog.listing.mode === 'auction' ? 'LANCE ATUAL' : 'VALOR PEDIDO'}</small><strong>{formatCurrency(safeMoney(dialog.listing.currentBid ?? dialog.listing.minimumBid ?? dialog.listing.askingPrice))}</strong></span></div>
        {dialog.unlisted && <div className="market-form-grid"><label><span>TIPO DA PROPOSTA</span><select value={form.dealType} onChange={(event) => {
          const dealType = event.target.value as MarketDealType;
          updateForm('dealType', dealType);
          if (dealType === 'loan') updateForm('contractStart', 'current');
        }}><option value="transfer">Transferência</option><option value="loan">Empréstimo</option></select></label></div>}
        <label><span>{dialog.listing.mode === 'auction' ? 'SEU LANCE' : (dialog.unlisted ? form.dealType : dialog.listing.dealType) === 'loan' ? 'TAXA DO EMPRÉSTIMO' : 'SUA OFERTA'}</span><input type="number" min="1" step="500000" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} /><small>Disponível: {formatCurrency(snapshot?.finance.available ?? 0)}</small></label>
        {dialog.listing.mode === 'direct' && <label><span>MENSAGEM OPCIONAL</span><textarea maxLength={500} value={form.message} onChange={(event) => updateForm('message', event.target.value)} placeholder="Detalhes da proposta" /></label>}
        {dialog.listing.mode === 'direct' && <ContractFields
          form={form}
          updateForm={updateForm}
          currentSeason={Math.max(1, Number(room?.currentSeason) || 1)}
          allowNextSeason={(dialog.unlisted ? form.dealType : dialog.listing.dealType) === 'transfer'}
        />}
        {(dialog.unlisted ? form.dealType : dialog.listing.dealType) === 'loan' && <LoanFields form={form} updateForm={updateForm} />}
        {dialog.listing.mode === 'auction' && <div className="bid-alert"><Gavel size={15} /> Lance só será aceito se superar o valor atual e houver orçamento.</div>}
        {actionError && <div className="market-form-error" role="alert">{actionError}</div>}
      </div>}
      {dialog?.kind === 'list' && <div className="bid-form">
        <div className="market-form-grid"><label><span>TIPO DO NEGÓCIO</span><select value={form.dealType} onChange={(event) => updateForm('dealType', event.target.value as MarketDealType)}><option value="transfer">Transferência</option><option value="loan">Empréstimo</option></select></label><label><span>MODALIDADE</span><select value={form.mode} onChange={(event) => updateForm('mode', event.target.value as MarketListingMode)}><option value="direct">Negociação direta</option><option value="auction">Leilão</option></select></label></div>
        <label><span>{form.mode === 'auction' ? 'LANCE MÍNIMO' : form.dealType === 'loan' ? 'TAXA PEDIDA' : 'VALOR PEDIDO'}</span><input type="number" min="1" step="500000" value={form.amount} onChange={(event) => updateForm('amount', event.target.value)} /><small>Valor estimado: {formatCurrency(dialog.player.value)}</small></label>
        <label><span>PRAZO DO ANÚNCIO</span><select value={form.expiresInHours} onChange={(event) => updateForm('expiresInHours', event.target.value)}><option value="6">6 horas</option><option value="12">12 horas</option><option value="24">24 horas</option><option value="48">48 horas</option><option value="72">3 dias</option><option value="168">7 dias</option></select></label>
        {form.dealType === 'loan' && <LoanFields form={form} updateForm={updateForm} />}
        {actionError && <div className="market-form-error" role="alert">{actionError}</div>}
      </div>}
      {dialog?.kind === 'respond' && <div className="bid-form">
        <div className="bid-summary"><span><small>{dialog.offer.direction === 'incoming' ? 'CLUBE COMPRADOR' : 'CLUBE VENDEDOR'}</small><strong>{dialog.offer.direction === 'incoming' ? dialog.offer.buyerClubName : dialog.offer.sellerClubName}</strong></span><span><small>VALOR ATUAL</small><strong>{formatCurrency(dialog.offer.counterAmount ?? dialog.offer.amount)}</strong></span></div>
        {dialog.offer.permissions.counter && <><label><span>CONTRAPROPOSTA</span><input type="number" min="1" step="500000" value={form.counterAmount} onChange={(event) => updateForm('counterAmount', event.target.value)} /></label><Button variant="secondary" loading={pending} onClick={() => void submitResponse('counter')} icon={<Banknote size={14} />}>Enviar contraproposta</Button></>}
        {dialog.offer.contractTerms && <div className="market-loan-summary"><span>Novo salário: {formatCurrency(dialog.offer.contractTerms.wage)}</span><span>Contrato: {dialog.offer.contractTerms.durationSeasons} temporadas</span></div>}
        {dialog.offer.loanTerms && <div className="market-loan-summary"><span>Salário pago pelo destino: {dialog.offer.loanTerms.wageSharePercent}%</span><span>Duração: {dialog.offer.loanTerms.durationRounds} rodadas</span><span>Cláusula: {dialog.offer.loanTerms.purchaseObligation
          ? `obrigação de ${formatCurrency(dialog.offer.loanTerms.purchaseObligation)}`
          : dialog.offer.loanTerms.purchaseOption
            ? `opção de ${formatCurrency(dialog.offer.loanTerms.purchaseOption)}`
            : 'não'}</span></div>}
        {actionError && <div className="market-form-error" role="alert">{actionError}</div>}
      </div>}
      {dialog?.kind === 'cancel-listing' && <div className="market-confirm"><Gavel size={25} /><p>Cancelar anúncio de <strong>{dialog.listing.player.name}</strong>? Ofertas pendentes ligadas ao anúncio também poderão ser encerradas.</p>{actionError && <div className="market-form-error" role="alert">{actionError}</div>}</div>}
    </Modal>
    <PlayerProfileHost
      playerId={profilePlayerId}
      players={profilePlayers}
      room={room}
      socket={socket}
      managerId={managerId}
      currentClubId={club.id}
      onRosterChanged={onRosterChanged}
      marketState={market}
      onClose={() => setProfilePlayerId(null)}
      onToast={onToast}
    />
  </main>;
}

interface LoanFieldsProps {
  form: MarketFormState;
  updateForm: <K extends keyof MarketFormState>(key: K, value: MarketFormState[K]) => void;
}

interface ContractFieldsProps extends LoanFieldsProps {
  currentSeason: number;
  allowNextSeason: boolean;
}

function LoanFields({ form, updateForm }: LoanFieldsProps) {
  return <div className="market-form-grid market-loan-fields">
    <label><span>SALÁRIO PAGO PELO DESTINO</span><select value={form.wageSharePercent} onChange={(event) => updateForm('wageSharePercent', event.target.value)}><option value="0">0%</option><option value="25">25%</option><option value="50">50%</option><option value="75">75%</option><option value="100">100%</option></select></label>
    <label><span>DURAÇÃO</span><input type="number" min="1" max="76" value={form.durationRounds} onChange={(event) => updateForm('durationRounds', event.target.value)} /><small>Rodadas</small></label>
    <label><span>CLÁUSULA DE COMPRA</span><select value={form.purchaseClause} onChange={(event) => {
      const value = event.target.value as PurchaseClause;
      updateForm('purchaseClause', value);
      if (value === 'none') updateForm('purchaseOption', '');
    }}><option value="none">Sem cláusula</option><option value="option">Opção de compra</option><option value="obligation">Obrigação de compra</option></select></label>
    {form.purchaseClause !== 'none' && <label><span>VALOR DA {form.purchaseClause === 'option' ? 'OPÇÃO' : 'OBRIGAÇÃO'}</span><input type="number" min="1" step="500000" value={form.purchaseOption} onChange={(event) => updateForm('purchaseOption', event.target.value)} /></label>}
  </div>;
}

function ContractFields({ form, updateForm, currentSeason, allowNextSeason }: ContractFieldsProps) {
  return <div className="market-form-grid">
    <label><span>NOVO SALÁRIO MENSAL</span><input type="number" min="1000" step="1000" value={form.contractWage} onChange={(event) => updateForm('contractWage', event.target.value)} /></label>
    <label><span>DURAÇÃO DO CONTRATO</span><select value={form.contractDurationSeasons} onChange={(event) => updateForm('contractDurationSeasons', event.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8].map((season) => <option key={season} value={season}>{season} temporada{season === 1 ? '' : 's'}</option>)}</select></label>
    <label><span>INÍCIO DO VÍNCULO</span><select value={allowNextSeason ? form.contractStart : 'current'} onChange={(event) => updateForm('contractStart', event.target.value as ContractStart)}><option value="current">Temporada {currentSeason}</option>{allowNextSeason && <option value="next">Temporada {currentSeason + 1}</option>}</select></label>
  </div>;
}
