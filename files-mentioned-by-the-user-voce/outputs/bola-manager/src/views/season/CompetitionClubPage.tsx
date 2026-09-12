import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  ChevronRight,
  CircleAlert,
  Flag,
  Info,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
  TrendingUp,
  Trophy,
  Users,
  WalletCards,
} from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ClubMark } from '../../components/shared/ClubMark';
import { ResilientImage } from '../../components/shared/ResilientImage';
import { usePlayerCatalog } from '../../hooks/usePlayerCatalog';
import { useOpponentStudy } from '../../hooks/useOpponentStudy';
import { OpponentStudyPanel } from '../../components/tactics/OpponentStudyPanel';
import {
  loadCompetitionClubDetail,
  type CompetitionClubDetail,
  type CompetitionClubIdentity,
  type CompetitionClubMatch,
  type CompetitionClubSquadMember,
} from '../../services/competitionClubService';
import type { ClubChoice } from '../../types';
import { formatCurrency, initials } from '../../utils/formatters';
import type { RankingClub, RankingHistoryEntry } from '../../utils/rankings';

export type CompetitionClubTab = 'overview' | 'squad' | 'tactics' | 'calendar' | 'information';

interface CompetitionClubPageProps {
  club: CompetitionClubIdentity;
  managerClubId: string;
  roomCode?: string | null;
  revision?: number;
  currentSeason: number;
  competitionName: string;
  position: number | null;
  fixtures: CompetitionClubMatch[];
  publicSnapshot?: RankingClub | null;
  historyEntries?: RankingHistoryEntry[];
  activeTab: CompetitionClubTab;
  onTabChange: (tab: CompetitionClubTab) => void;
  onBack: () => void;
  onPlayerSelect: (playerId: string) => void;
  originLabel?: string;
  backLabel?: string;
}

const tabs: Array<{ id: CompetitionClubTab; label: string; icon: typeof Shield }> = [
  { id: 'overview', label: 'Visão Geral', icon: Shield },
  { id: 'squad', label: 'Elenco', icon: Users },
  { id: 'tactics', label: 'Tática', icon: Target },
  { id: 'calendar', label: 'Calendário', icon: CalendarDays },
  { id: 'information', label: 'Informações', icon: Info },
];

const squadStatusLabels: Record<CompetitionClubSquadMember['squadStatus'], string> = {
  starter: 'Titular',
  rotation: 'Rotação',
  reserve: 'Reserva',
  prospect: 'Promessa',
  unknown: 'Função indisponível',
};

const negotiabilityLabels: Record<CompetitionClubSquadMember['negotiability'], string> = {
  not_for_sale: 'Inegociável',
  open_to_offers: 'Aceita propostas',
  listed: 'Listado',
  unknown: 'Mercado indisponível',
};

function formatDate(value: string | null) {
  if (!value) return 'Data a definir';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'Data a definir';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(date).replace('.', '');
}

function formatCapacity(value: number) {
  return value > 0 ? new Intl.NumberFormat('pt-BR').format(value) : 'Não informada';
}

function moraleScore(member: CompetitionClubSquadMember) {
  if (Number.isFinite(member.player.moraleScore)) return Number(member.player.moraleScore);
  return { Excelente: 94, Boa: 80, Neutra: 65, Baixa: 45, 'Não informada': null }[member.player.morale];
}

function clubKey(value: string | null | undefined) {
  return String(value ?? '').trim().toLocaleLowerCase('pt-BR');
}

function campaignFromFixtures(fixtures: CompetitionClubMatch[], clubId: string) {
  const id = clubKey(clubId);
  return fixtures.filter((match) => match.completed && match.score).reduce((campaign, match) => {
    const home = clubKey(match.homeClubId) === id;
    const goalsFor = home ? match.score![0] : match.score![1];
    const goalsAgainst = home ? match.score![1] : match.score![0];
    campaign.played += 1;
    campaign.goalsFor += goalsFor;
    campaign.goalsAgainst += goalsAgainst;
    if (goalsFor > goalsAgainst) campaign.wins += 1;
    else if (goalsFor === goalsAgainst) campaign.draws += 1;
    else campaign.losses += 1;
    return campaign;
  }, { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0 });
}

function MatchList({ matches, emptyMessage }: { matches: CompetitionClubMatch[]; emptyMessage: string }) {
  if (!matches.length) return <div className="competition-club-empty"><CalendarDays size={22} /><strong>{emptyMessage}</strong><span>Os jogos aparecerão quando o calendário da competição estiver disponível.</span></div>;
  return (
    <div className="competition-club-match-list">
      {matches.map((match) => (
        <article key={match.id} className={match.completed ? 'is-completed' : ''}>
          <span className="competition-club-match-list__round">R{match.round || '—'}</span>
          <div className="competition-club-match-list__teams">
            <span><ClubMark code={match.homeCode} color="#aeb6bf" imageUrl={match.homeCrestImageUrl} size="sm" /><strong>{match.homeName}</strong></span>
            <b>{match.score ? `${match.score[0]} – ${match.score[1]}` : '×'}</b>
            <span><ClubMark code={match.awayCode} color="#aeb6bf" imageUrl={match.awayCrestImageUrl} size="sm" /><strong>{match.awayName}</strong></span>
          </div>
          <span className="competition-club-match-list__meta"><small>{match.competitionName}</small>{formatDate(match.scheduledAt)}</span>
        </article>
      ))}
    </div>
  );
}

function SquadList({
  members,
  contractsVisible,
  onPlayerSelect,
}: {
  members: CompetitionClubSquadMember[];
  contractsVisible: boolean;
  onPlayerSelect: (member: CompetitionClubSquadMember) => void;
}) {
  if (!members.length) return <div className="competition-club-empty"><Users size={22} /><strong>Elenco vazio</strong><span>Nenhum jogador foi encontrado para este clube.</span></div>;
  return (
    <div className="competition-squad-table" aria-label="Elenco do clube">
      <div className="competition-squad-table__head" aria-hidden="true">
        <span>JOGADOR</span><span>IDADE</span><span>NAC.</span><span>POS.</span><span>OVR</span><span>POT.</span><span>VALOR</span><span>SALÁRIO</span><span>CONTRATO</span><span>SITUAÇÃO</span><span>FÍSICO</span><span>MORAL</span>
      </div>
      {members.map((member) => {
        const player = member.player;
        const unknown = new Set(player.catalogUnknownFields ?? []);
        const knownMoraleScore = moraleScore(member);
        return (
          <button type="button" key={player.id} onClick={() => onPlayerSelect(member)} aria-label={`Abrir perfil de ${player.name}`}>
            <span className="competition-squad-table__player">
              <span className="competition-squad-table__avatar">
                <ResilientImage src={player.avatarImageUrl} alt={`Foto de ${player.name}`} fallback={<span>{initials(player.name)}</span>} />
              </span>
              <span><strong>{player.name}</strong><small>{negotiabilityLabels[member.negotiability]}</small></span>
            </span>
            <span>{player.age}</span><span>{player.nationality}</span><span><Badge tone="info">{player.position}</Badge></span>
            <strong>{(player.overall ?? 0).toFixed(1)}</strong><span>{unknown.has('potential') || player.potential === undefined ? '—' : player.potential.toFixed(1)}</span>
            <span>{formatCurrency(player.value)}</span><span>{contractsVisible && !unknown.has('contract') ? formatCurrency(player.wage) : contractsVisible ? 'Indisponível' : 'Restrito'}</span>
            <span>{contractsVisible && !unknown.has('contract') && member.contractSeasonsRemaining !== null ? `${member.contractSeasonsRemaining} temp.` : 'Indisponível'}</span><span>{squadStatusLabels[member.squadStatus]}</span>
            <span className={!unknown.has('condition') && player.condition < 75 ? 'is-warning' : ''}>{unknown.has('condition') ? '—' : `${player.condition}%`}</span><span>{unknown.has('morale') || knownMoraleScore === null ? 'Indisponível' : `${player.morale} · ${Math.round(knownMoraleScore)}`}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProtectedPanel({ title, message }: { title: string; message: string }) {
  return <div className="competition-club-protected"><LockKeyhole size={25} /><strong>{title}</strong><p>{message}</p></div>;
}

export function CompetitionClubPage({
  club,
  managerClubId,
  roomCode = null,
  revision = 0,
  currentSeason,
  competitionName,
  position,
  fixtures,
  publicSnapshot = null,
  historyEntries = [],
  activeTab,
  onTabChange,
  onBack,
  onPlayerSelect,
  originLabel = 'Competições',
  backLabel = 'Voltar à competição',
}: CompetitionClubPageProps) {
  const pageRef = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<CompetitionClubDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const playerCatalogClub = useMemo<ClubChoice>(() => ({
    id: club.id,
    name: club.name,
    code: club.code,
    city: club.city,
    stars: Math.max(1, Math.min(5, Math.round(club.reputation / 20))),
    budget: String(club.budget),
    color: club.color,
    darkThemeColor: club.darkThemeColor,
    lightThemeColor: club.lightThemeColor,
    crestImageUrl: club.crestImageUrl,
    stadium: club.stadium,
    stadiumCapacity: club.capacity,
    division: club.division,
    country: club.country,
  }), [club]);
  const playerCatalog = usePlayerCatalog(playerCatalogClub, roomCode);
  const studyController = useOpponentStudy(roomCode ?? undefined, revision, activeTab === 'tactics', club.id, managerClubId);

  useEffect(() => {
    if (playerCatalog.loading) {
      setLoading(true);
      setError(null);
      return undefined;
    }
    if (playerCatalog.error) {
      setDetail(null);
      setLoading(false);
      setError(playerCatalog.error);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    void loadCompetitionClubDetail({
      club,
      managerClubId,
      currentSeason,
      competitionName,
      position,
      fixtures,
      players: playerCatalog.players,
    }).then((payload) => {
      if (active) setDetail(payload);
    }).catch((nextError: unknown) => {
      if (active) setError(nextError instanceof Error ? nextError.message : 'Não foi possível carregar o clube.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [club, competitionName, currentSeason, fixtures, managerClubId, playerCatalog.error, playerCatalog.loading, playerCatalog.players, position, retry]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => pageRef.current?.focus({ preventScroll: false }));
    return () => window.cancelAnimationFrame(frame);
  }, [club.id, loading, error]);

  const tabGroupId = `competition-club-${club.id.replace(/[^a-z0-9_-]/gi, '-')}`;

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    onTabChange(nextTab.id);
    window.requestAnimationFrame(() => document.getElementById(`${tabGroupId}-tab-${nextTab.id}`)?.focus());
  }

  const activeTabLabel = tabs.find((tab) => tab.id === activeTab)?.label ?? 'Visão Geral';
  const allMatches = useMemo(() => detail ? [...(fixtures.length ? fixtures : [...detail.recentMatches, ...detail.upcomingMatches])].sort((left, right) => (
    (Date.parse(left.scheduledAt ?? '') || Number.MAX_SAFE_INTEGER) - (Date.parse(right.scheduledAt ?? '') || Number.MAX_SAFE_INTEGER)
    || left.round - right.round
  )) : [], [detail, fixtures]);

  if (loading) {
    return <section ref={pageRef} tabIndex={-1} className="competition-club-state" aria-live="polite"><LoaderCircle className="spin" size={30} /><strong>Carregando clube…</strong><span>Preparando elenco, calendário e informações conhecidas.</span></section>;
  }

  if (error || !detail) {
    return <section ref={pageRef} tabIndex={-1} className="competition-club-state is-error" role="alert"><CircleAlert size={30} /><strong>Não foi possível abrir o clube</strong><span>{error || 'Dados indisponíveis.'}</span><div><Button icon={<ArrowLeft size={15} />} onClick={onBack}>{backLabel}</Button><Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => { playerCatalog.refresh(); setRetry((value) => value + 1); }}>Tentar novamente</Button></div></section>;
  }

  const identity = detail.identity;
  const tactical = studyController.study;
  const publicSquadValue = publicSnapshot && publicSnapshot.squadValue > 0
    ? publicSnapshot.squadValue
    : detail.finances.squadValue;
  const publicPlayerCount = publicSnapshot && publicSnapshot.playerCount > 0
    ? publicSnapshot.playerCount
    : detail.squad.length;
  const publicPayroll = publicSnapshot?.payroll
    ?? (detail.isManagerClub ? detail.finances.weeklyPayroll : null);
  const averagePlayerValue = publicSnapshot?.averagePlayerValue
    ?? (publicPlayerCount > 0 && publicSquadValue > 0 ? publicSquadValue / publicPlayerCount : null);
  const publicPosition = publicSnapshot?.position ?? detail.position;
  const financeStatus = detail.isManagerClub && detail.finances.balance > 0 && detail.finances.weeklyPayroll > 0
    ? (detail.finances.balance >= detail.finances.weeklyPayroll * 45
      ? 'Saudável'
      : detail.finances.balance >= detail.finances.weeklyPayroll * 20 ? 'Estável' : 'Pressionada')
    : 'Não disponível';
  const fixtureCampaign = campaignFromFixtures(fixtures, identity.id);
  const campaign = publicSnapshot ? {
    played: publicSnapshot.played,
    wins: publicSnapshot.wins,
    draws: publicSnapshot.draws,
    losses: publicSnapshot.losses,
    goalsFor: publicSnapshot.goalsFor,
    goalsAgainst: publicSnapshot.goalsAgainst,
    goalDifference: publicSnapshot.goalDifference,
    points: publicSnapshot.points,
  } : {
    ...fixtureCampaign,
    goalDifference: fixtureCampaign.goalsFor - fixtureCampaign.goalsAgainst,
    points: fixtureCampaign.wins * 3 + fixtureCampaign.draws,
  };
  const clubAliases = new Set([
    identity.id,
    identity.code,
    identity.name,
    publicSnapshot?.id,
    publicSnapshot?.code,
    publicSnapshot?.name,
  ].map(clubKey).filter(Boolean));
  const clubHistory = historyEntries.filter((entry) => clubAliases.has(clubKey(entry.clubId)));

  function handlePlayerSelect(member: CompetitionClubSquadMember) {
    onPlayerSelect(member.player.id);
  }

  return (
    <section ref={pageRef} tabIndex={-1} className="competition-club-page" aria-label={`Detalhes de ${identity.name}`}>
      <header className="competition-club-page__topbar">
        <button type="button" className="competition-club-back" onClick={onBack}><ArrowLeft size={16} /> {backLabel}</button>
        <nav className="competition-club-breadcrumbs" aria-label="Navegação estrutural">
          <button type="button" onClick={onBack}>{originLabel}</button><ChevronRight size={13} /><button type="button" onClick={onBack}>{detail.competitionName}</button><ChevronRight size={13} /><span>{identity.name}</span><ChevronRight size={13} /><strong>{activeTabLabel}</strong>
        </nav>
        <Badge tone={detail.isManagerClub ? 'positive' : tactical ? 'info' : 'neutral'}>{detail.isManagerClub ? 'Seu clube' : tactical ? `Conhecimento ${tactical.confidence}%` : 'Sem relatório tático'}</Badge>
      </header>

      <section className="competition-club-hero" style={{ '--club-accent': identity.color } as React.CSSProperties}>
        <div className="competition-club-hero__identity">
          <ClubMark code={identity.code} color={identity.color} darkThemeColor={identity.darkThemeColor} lightThemeColor={identity.lightThemeColor} imageUrl={identity.crestImageUrl} size="lg" />
          <div><p className="eyebrow">{identity.country} · {identity.division}</p><h1>{identity.name}</h1><p><MapPin size={14} /> {identity.city} · Reputação {identity.reputation > 0 ? `${identity.reputation}/100` : 'indisponível'}</p></div>
        </div>
        <dl className="competition-club-hero__facts">
          <div><dt><Trophy size={14} /> POSIÇÃO</dt><dd>{publicPosition ? `${publicPosition}º` : 'Não definida'}</dd></div>
          <div><dt><Building2 size={14} /> ESTÁDIO</dt><dd>{identity.stadium}<small>{formatCapacity(identity.capacity)} lugares</small></dd></div>
          <div><dt><WalletCards size={14} /> FINANÇAS</dt><dd>{financeStatus}<small>{detail.isManagerClub && detail.finances.balance > 0 ? formatCurrency(detail.finances.balance) : 'Valores indisponíveis'}</small></dd></div>
          <div><dt><Users size={14} /> ELENCO</dt><dd>{publicPlayerCount}<small>jogadores registrados</small></dd></div>
        </dl>
      </section>

      <nav className="competition-club-tabs" role="tablist" aria-label="Seções do clube">
        {tabs.map((tab, index) => {
          const Icon = tab.icon;
          return <button type="button" role="tab" id={`${tabGroupId}-tab-${tab.id}`} key={tab.id} aria-selected={activeTab === tab.id} aria-controls={`${tabGroupId}-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => onTabChange(tab.id)}><Icon size={15} />{tab.label}</button>;
        })}
      </nav>

      <div id={`${tabGroupId}-panel-${activeTab}`} className="competition-club-tabpanel" role="tabpanel" aria-labelledby={`${tabGroupId}-tab-${activeTab}`}>
        {activeTab === 'overview' && (
          <div className="competition-club-overview">
            <div className="competition-club-grid competition-club-grid--metrics">
              <article><Landmark size={18} /><span><small>Situação financeira</small><strong>{financeStatus}</strong></span></article>
              <article><BadgeDollarSign size={18} /><span><small>Valor do elenco</small><strong>{publicSquadValue > 0 ? formatCurrency(publicSquadValue) : 'Não disponível'}</strong></span></article>
              <article><TrendingUp size={18} /><span><small>Orçamento de transferências</small><strong>{detail.isManagerClub && detail.finances.transferBudget !== null ? formatCurrency(detail.finances.transferBudget) : 'Não disponível'}</strong></span></article>
              <article><Sparkles size={18} /><span><small>Reputação</small><strong>{identity.reputation > 0 ? `${identity.reputation}/100` : 'Não disponível'}</strong></span></article>
            </div>
            <div className="competition-club-grid competition-club-grid--matches">
              <section className="competition-club-card"><header><div><p className="eyebrow">FORMA RECENTE</p><h2>Últimos resultados</h2></div><Badge tone="neutral">{detail.recentMatches.length}</Badge></header><MatchList matches={detail.recentMatches} emptyMessage="Nenhum resultado recente" /></section>
              <section className="competition-club-card"><header><div><p className="eyebrow">AGENDA</p><h2>Próximos jogos</h2></div><Badge tone="info">{detail.upcomingMatches.length}</Badge></header><MatchList matches={detail.upcomingMatches} emptyMessage="Nenhum jogo agendado" /></section>
            </div>
            <section className="competition-club-card competition-club-campaign">
              <header><div><p className="eyebrow">CAMPANHA REAL</p><h2>Desempenho na competição</h2></div><Badge tone="info">{publicPosition ? `${publicPosition}º lugar` : `${campaign.points} pts`}</Badge></header>
              <dl>
                <div><dt>Jogos</dt><dd>{campaign.played}</dd></div><div><dt>Vitórias</dt><dd>{campaign.wins}</dd></div><div><dt>Empates</dt><dd>{campaign.draws}</dd></div><div><dt>Derrotas</dt><dd>{campaign.losses}</dd></div>
                <div><dt>Gols pró</dt><dd>{campaign.goalsFor}</dd></div><div><dt>Gols contra</dt><dd>{campaign.goalsAgainst}</dd></div><div><dt>Saldo</dt><dd>{campaign.goalDifference > 0 ? '+' : ''}{campaign.goalDifference}</dd></div><div><dt>Pontos</dt><dd>{campaign.points}</dd></div>
              </dl>
            </section>
          </div>
        )}

        {activeTab === 'squad' && (
          <section className="competition-club-card competition-club-squad">
            <header><div><p className="eyebrow">ELENCO PRINCIPAL · {detail.squad.length} JOGADORES</p><h2>Plantel de {identity.name}</h2></div><span className="competition-club-knowledge"><Shield size={14} /> Dados do elenco</span></header>
            {detail.visibility.squad ? <SquadList members={detail.squad} contractsVisible={detail.visibility.contracts} onPlayerSelect={handlePlayerSelect} /> : <ProtectedPanel title="Elenco indisponível" message="Nenhum roster real foi retornado para este clube." />}
          </section>
        )}

        {activeTab === 'tactics' && <OpponentStudyPanel controller={studyController} onPlayerSelect={onPlayerSelect} />}

        {activeTab === 'calendar' && <section className="competition-club-card"><header><div><p className="eyebrow">TEMPORADA {detail.currentSeason}</p><h2>Calendário de {identity.name}</h2></div><Badge tone="info">{allMatches.length} jogos conhecidos</Badge></header><MatchList matches={allMatches} emptyMessage="Calendário indisponível" /></section>}

        {activeTab === 'information' && (
          <div className="competition-club-information">
            <section className="competition-club-card"><header><div><p className="eyebrow">IDENTIDADE</p><h2>Informações do clube</h2></div></header><dl><div><dt><Flag size={14} /> País</dt><dd>{identity.country}</dd></div><div><dt><Trophy size={14} /> Divisão</dt><dd>{identity.division}</dd></div><div><dt><MapPin size={14} /> Cidade</dt><dd>{identity.city}</dd></div><div><dt><Sparkles size={14} /> Reputação</dt><dd>{identity.reputation > 0 ? `${identity.reputation}/100` : 'Não disponível'}</dd></div></dl></section>
            <section className="competition-club-card"><header><div><p className="eyebrow">PATRIMÔNIO</p><h2>Estádio</h2></div></header><dl><div><dt><Building2 size={14} /> Nome</dt><dd>{identity.stadium}</dd></div><div><dt><Users size={14} /> Capacidade</dt><dd>{formatCapacity(identity.capacity)}</dd></div><div><dt><MapPin size={14} /> Localização</dt><dd>{identity.city}</dd></div></dl></section>
            <section className="competition-club-card"><header><div><p className="eyebrow">FINANÇAS</p><h2>Dados públicos do elenco</h2></div></header><dl><div><dt>Valor do elenco</dt><dd>{publicSquadValue > 0 ? formatCurrency(publicSquadValue) : 'Não disponível'}</dd></div><div><dt>Jogadores avaliados</dt><dd>{publicPlayerCount || 'Não disponível'}</dd></div><div><dt>Valor médio</dt><dd>{averagePlayerValue && averagePlayerValue > 0 ? formatCurrency(averagePlayerValue) : 'Não disponível'}</dd></div><div><dt>Folha conhecida</dt><dd>{publicPayroll && publicPayroll > 0 ? formatCurrency(publicPayroll) : 'Não divulgada'}</dd></div>{detail.isManagerClub && <><div><dt>Saldo</dt><dd>{detail.finances.balance > 0 ? formatCurrency(detail.finances.balance) : 'Não disponível'}</dd></div><div><dt>Transferências</dt><dd>{detail.finances.transferBudget !== null ? formatCurrency(detail.finances.transferBudget) : 'Não disponível'}</dd></div></>}</dl></section>
            <section className="competition-club-card competition-club-history"><header><div><p className="eyebrow">HISTÓRICO</p><h2>Registros do clube</h2></div><Badge tone="neutral">{clubHistory.length}</Badge></header>{clubHistory.length ? <div className="competition-club-history-list">{clubHistory.map((entry) => <article key={entry.id}><span>{entry.seasonYear ?? `Temporada ${entry.seasonNumber ?? '—'}`}</span><strong>{entry.label ?? 'Atualização de ranking'}</strong><small>{entry.round ? `Rodada ${entry.round}` : 'Rodada não informada'}{entry.position ? ` · ${entry.position}º lugar` : ''}{entry.createdAt ? ` · ${formatDate(entry.createdAt)}` : ''}</small></article>)}</div> : <div className="competition-club-empty"><Trophy size={22} /><strong>Histórico ainda não registrado</strong><span>As campanhas concluídas e mudanças de posição aparecerão aqui.</span></div>}</section>
          </div>
        )}
      </div>
    </section>
  );
}
