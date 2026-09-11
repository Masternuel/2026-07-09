import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowUpDown, ChevronDown, Filter, Search, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { PlayerCareerActions } from '../components/player/PlayerCareerActions';
import {
  canonicalPlayerId,
  PlayerProfileHost,
  profilePlayersFromLocalRoster,
} from '../components/player/PlayerProfileHost';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { ProgressBar } from '../components/shared/ProgressBar';
import { StarPlayerMark } from '../components/shared/StarPlayerMark';
import type { BolaSocket, ClubChoice, Player, PlayerPosition, Room } from '../types';
import { average, cx, formatCurrency } from '../utils/formatters';
import { playerShirtNumberLabel } from '../utils/playerDataAvailability';
import { playerMoraleScore } from '../utils/playerMorale';
import { playerGoalkeeperRating, playerPhysicalRating, playerPositionRating } from '../utils/playerRating';
import { getSeasonProgress } from '../utils/seasonProgress';
import { bindSearchShortcut } from '../utils/searchShortcut';
import type { UseCareerStateResult } from '../hooks/useCareerState';

interface SquadViewProps {
  players: Player[];
  club: ClubChoice;
  room: Room | null;
  socket: BolaSocket | null;
  managerId: string;
  careerState?: UseCareerStateResult;
  onRosterChanged?: () => void;
  onToast: (message: string) => void;
}

const emptyCareerState: UseCareerStateResult = {
  career: null,
  loading: false,
  error: null,
  mutationKey: null,
  refresh() {},
  async saveTraining() { return null; },
  async renewContract() { return null; },
  async promoteAcademyPlayer() { return null; },
};

type SortKey = 'name' | 'position' | 'age' | 'value' | 'condition' | 'rating';

const filterGroups: Array<{ label: string; values: PlayerPosition[] }> = [
  { label: 'GOL', values: ['GOL'] },
  { label: 'Zagueiros', values: ['ZAG', 'LD', 'LE'] },
  { label: 'Meias', values: ['VOL', 'MC', 'MEI'] },
  { label: 'Atacantes', values: ['PD', 'PE', 'ATA'] },
];

const positionOrder: Record<PlayerPosition, number> = {
  GOL: 0,
  ZAG: 1,
  LD: 2,
  LE: 3,
  VOL: 4,
  MC: 5,
  MEI: 6,
  PD: 7,
  PE: 8,
  ATA: 9,
};

function overall(player: Player): number {
  return playerPositionRating(player);
}

function catalogFieldUnknown(player: Player, field: NonNullable<Player['catalogUnknownFields']>[number]) {
  return player.catalogUnknownFields?.includes(field) === true;
}

export function SquadView({ players, club, room, socket, managerId, careerState = emptyCareerState, onRosterChanged = () => {}, onToast }: SquadViewProps) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchInput.current) return bindSearchShortcut(searchInput.current);
  }, []);
  const [group, setGroup] = useState('Todos');
  const [sortKey, setSortKey] = useState<SortKey>('position');
  const [ascending, setAscending] = useState(true);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [showAcademy, setShowAcademy] = useState(false);
  const careerPlayersById = useMemo(() => new Map(
    (careerState.career?.players ?? []).map((player) => [player.id.toLocaleLowerCase('pt-BR'), player]),
  ), [careerState.career?.players]);
  const enrichedPlayers = useMemo(() => players.map((player) => {
    const careerPlayer = careerPlayersById.get(player.id.toLocaleLowerCase('pt-BR'));
    if (!careerPlayer) return player;
    const catalogUnknownFields = player.catalogUnknownFields?.filter((field) => (
      field !== 'contract'
      && field !== 'potential'
      && !(field === 'condition' && careerPlayer.condition !== null && careerPlayer.condition !== undefined)
    ));
    return {
      ...player,
      age: careerPlayer.age,
      nationality: careerPlayer.nationality,
      wage: careerPlayer.contract.wage || careerPlayer.wage || player.wage,
      condition: careerPlayer.condition ?? player.condition,
      clubId: careerPlayer.clubId,
      overall: careerPlayer.overall,
      potential: careerPlayer.potential,
      academy: careerPlayer.academy,
      youth: careerPlayer.youth,
      retired: careerPlayer.retired,
      careerStage: careerPlayer.careerStage,
      contract: careerPlayer.contract,
      training: careerPlayer.training ?? player.training,
      generatedSeason: careerPlayer.generatedSeason,
      promotedSeason: careerPlayer.promotedSeason,
      catalogUnknownFields,
    } satisfies Player;
  }), [careerPlayersById, players]);
  const profilePlayers = useMemo(
    () => profilePlayersFromLocalRoster(enrichedPlayers, club),
    [club, enrichedPlayers],
  );
  const rosterPlayers = useMemo(
    () => enrichedPlayers.filter((player) => showAcademy ? player.academy === true : player.academy !== true),
    [enrichedPlayers, showAcademy],
  );
  const availableCount = rosterPlayers.filter((player) => player.status === 'Disponível').length;
  const availabilityPercent = rosterPlayers.length ? Math.round((availableCount / rosterPlayers.length) * 100) : 0;
  const knownConditions = rosterPlayers
    .filter((player) => !catalogFieldUnknown(player, 'condition'))
    .map((player) => player.condition);
  const averageCondition = knownConditions.length ? average(knownConditions) : null;
  const knownPotentials = rosterPlayers
    .filter((player) => !catalogFieldUnknown(player, 'potential') && player.potential !== undefined)
    .map((player) => player.potential as number);
  const season = getSeasonProgress(room);

  const filteredPlayers = useMemo(() => {
    const selectedPositions = filterGroups.find((item) => item.label === group)?.values;
    return rosterPlayers
      .filter((player) => player.name.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))
      .filter((player) => !selectedPositions || selectedPositions.includes(player.position))
      .sort((a, b) => {
        let result = 0;
        if (sortKey === 'name') result = a.name.localeCompare(b.name, 'pt-BR');
        if (sortKey === 'position') result = positionOrder[a.position] - positionOrder[b.position];
        if (sortKey === 'age') result = a.age - b.age;
        if (sortKey === 'value') result = a.value - b.value;
        if (sortKey === 'condition') result = a.condition - b.condition;
        if (sortKey === 'rating') result = overall(a) - overall(b);
        return ascending ? result : -result;
      });
  }, [ascending, group, query, rosterPlayers, sortKey]);

  function sort(key: SortKey) {
    if (sortKey === key) setAscending((value) => !value);
    else { setSortKey(key); setAscending(false); }
  }

  async function runCareerAction(action: () => Promise<unknown>, successMessage: string) {
    try {
      await action();
      onRosterChanged();
      onToast(successMessage);
      setSelectedPlayerId(null);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'O servidor não conseguiu salvar a carreira.');
    }
  }

  const activeSelectedPlayer = selectedPlayerId
    ? enrichedPlayers.find((player) => canonicalPlayerId(player.id) === canonicalPlayerId(selectedPlayerId)) ?? null
    : null;
  const selectedTrainingPlan = activeSelectedPlayer
    ? careerState.career?.trainingPlans.find((plan) => plan.playerId === activeSelectedPlayer.id) ?? activeSelectedPlayer.training
    : undefined;
  const selectedNationalTeam = activeSelectedPlayer
    ? careerState.career?.nationalSquads.find((squad) => squad.playerIds.includes(activeSelectedPlayer.id))?.teamId ?? null
    : null;

  return (
    <main className="squad-view view-enter">
      <div className="view-heading">
        <div><p className="eyebrow">{showAcademy ? 'CATEGORIAS DE BASE' : 'ELENCO PRINCIPAL'} · {rosterPlayers.length} ATLETAS</p><h1>{showAcademy ? 'Sub-20' : 'Elenco'}</h1><p>{showAcademy ? 'Talentos do save, potencial e promoção ao time principal.' : `Condição, contratos e treino antes da rodada ${season.currentRound}.`}</p></div>
        <div className="view-heading__actions"><Button variant="secondary" disabled title="Relatório do auxiliar ainda não possui serviço persistido" icon={<Filter size={15} />}>Relatório indisponível</Button><Button variant="primary" loading={careerState.loading} icon={<Users size={15} />} onClick={() => { setShowAcademy((current) => !current); setSelectedPlayerId(null); }}>{showAcademy ? 'Ver principal' : `Ver Sub-20 (${enrichedPlayers.filter((player) => player.academy).length})`}</Button></div>
      </div>

      {careerState.error && <div className="career-status is-error" role="status">{careerState.error}</div>}

      <section className="squad-overview">
        <div><span className="metric-icon"><ShieldCheck size={17} /></span><span><small>DISPONÍVEIS</small><strong>{availableCount} <em>/ {rosterPlayers.length}</em></strong></span><Badge tone="positive">{availabilityPercent}%</Badge></div>
        <div><span className="metric-icon"><Activity size={17} /></span><span><small>CONDIÇÃO MÉDIA</small><strong>{averageCondition === null ? '—' : `${averageCondition.toFixed(1).replace('.', ',')}%`}</strong></span><span className="metric-delta">elenco atual</span></div>
        <div><span className="metric-icon"><Sparkles size={17} /></span><span><small>{showAcademy ? 'POTENCIAL MÉDIO' : 'VALOR DO ELENCO'}</small><strong>{showAcademy ? knownPotentials.length ? `${average(knownPotentials).toFixed(1).replace('.', ',')}/20` : '—' : formatCurrency(rosterPlayers.reduce((sum, player) => sum + player.value, 0))}</strong></span><span className="metric-delta">save atual</span></div>
        <div className="squad-depth"><span><small>PROFUNDIDADE</small><strong>{(rosterPlayers.length / 10).toFixed(1).replace('.', ',')} por posição</strong></span><ProgressBar value={Math.min(100, rosterPlayers.length * 4)} /></div>
      </section>

      <section className="squad-table-panel">
        <header className="squad-toolbar">
          <div className="position-tabs" role="tablist">
            {['Todos', ...filterGroups.map((item) => item.label)].map((label) => <button key={label} aria-selected={group === label} onClick={() => setGroup(label)}>{label}</button>)}
          </div>
          <label className="table-search"><Search size={15} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar jogador" aria-label="Buscar jogador no elenco" aria-keyshortcuts="Control+k Meta+k" /><kbd title="Ctrl+K no Windows/Linux; ⌘K no macOS">Ctrl/⌘ K</kbd></label>
        </header>
        <div className="table-scroll">
          <table className="squad-table">
            <thead>
              <tr>
                <th><button onClick={() => sort('name')}>Jogador <ArrowUpDown size={12} /></button></th>
                <th><button onClick={() => sort('position')}>Pos.</button></th>
                <th><button onClick={() => sort('age')}>Idade</button></th>
                <th><button onClick={() => sort('rating')}>Nota pos.</button></th><th>POT./20</th><th>FÍS</th><th>GK</th>
                <th><button onClick={() => sort('condition')}>Condição</button></th>
                <th>Moral</th>
                <th><button onClick={() => sort('value')}>Valor</button></th>
                <th><span className="sr-only">Abrir</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredPlayers.map((player) => {
                const statusTone = player.status === 'Disponível' ? 'positive' : player.status === 'Lesionado' ? 'danger' : 'warning';
                const positionRating = playerPositionRating(player);
                const physicalRating = playerPhysicalRating(player);
                const attributesUnavailable = catalogFieldUnknown(player, 'attributes');
                const conditionUnavailable = catalogFieldUnknown(player, 'condition');
                const moraleUnavailable = catalogFieldUnknown(player, 'morale');
                const potentialUnavailable = catalogFieldUnknown(player, 'potential');
                return (
                  <tr key={player.id} onClick={() => setSelectedPlayerId(player.id)}>
                    <td><span className="player-number">{playerShirtNumberLabel(player)}</span><span className="player-cell"><span className="player-cell__name"><strong>{player.name}</strong>{player.isStar && <StarPlayerMark />}</span><small>{player.role}</small></span>{player.status !== 'Disponível' && <Badge tone={statusTone}>{player.status}</Badge>}</td>
                    <td><span className={`position-tag position-tag--${player.position.toLowerCase()}`}>{player.position}</span></td>
                    <td>{player.age}</td>
                    <td><strong className="player-rating-cell">{attributesUnavailable ? '—' : positionRating.toFixed(1)}</strong></td>
                    <td><span className="player-rating-cell">{potentialUnavailable ? '—' : player.potential?.toFixed(1) ?? '—'}</span></td>
                    <td><span className="player-rating-cell player-rating-cell--physical">{attributesUnavailable ? '—' : physicalRating.toFixed(1)}</span></td>
                    <td><span className="player-rating-cell player-rating-cell--goalkeeper">{player.position === 'GOL' && !attributesUnavailable ? playerGoalkeeperRating(player).toFixed(1) : '—'}</span></td>
                    <td>{conditionUnavailable ? '—' : <span className={cx('condition-cell', player.condition < 75 && 'warning')}><i style={{ '--condition': `${player.condition}%` } as React.CSSProperties} />{player.condition}%</span>}</td>
                    <td>{moraleUnavailable ? '—' : <span className={`morale morale--${player.morale.toLowerCase()}`} title={`Moral ${playerMoraleScore(player)} de 100`}>{player.morale} · {playerMoraleScore(player)}</span>}</td>
                    <td><strong className="money-cell">{formatCurrency(player.value)}</strong></td>
                    <td><button className="row-action" onClick={(event) => { event.stopPropagation(); setSelectedPlayerId(player.id); }} aria-label={`Abrir perfil de ${player.name}`}><ChevronDown size={14} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="table-footer"><span>Exibindo {filteredPlayers.length} de {rosterPlayers.length} atletas{!filteredPlayers.length ? ' · nenhum registro nesta categoria' : ''}</span><span>Ordenado por <strong>{sortKey}</strong></span></footer>
      </section>

      <PlayerProfileHost
        playerId={selectedPlayerId}
        players={profilePlayers}
        room={room}
        socket={socket}
        managerId={managerId}
        currentClubId={club.id}
        onRosterChanged={onRosterChanged}
        onClose={() => setSelectedPlayerId(null)}
        onToast={onToast}
        additionalContent={activeSelectedPlayer ? <PlayerCareerActions
          player={activeSelectedPlayer}
          currentSeason={careerState.career?.currentSeason ?? room?.currentSeason ?? 1}
          trainingPlan={selectedTrainingPlan}
          nationalTeam={selectedNationalTeam}
          mutationKey={careerState.mutationKey}
          available={Boolean(room?.code && careerState.career && !careerState.error)}
          onSaveTraining={async (input) => { await runCareerAction(() => careerState.saveTraining(input), 'Plano de treino salvo para o próximo ciclo.'); }}
          onRenewContract={async (input) => { await runCareerAction(() => careerState.renewContract(input), 'Contrato renovado e salvo nesta carreira.'); }}
          onPromoteAcademy={async (input) => { await runCareerAction(() => careerState.promoteAcademyPlayer(input), 'Jogador promovido ao elenco principal.'); }}
        /> : null}
      />
    </main>
  );
}
