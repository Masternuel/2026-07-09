import { useEffect, useMemo, useRef, useState } from 'react';
import { OpponentStudyPanel } from '../components/tactics/OpponentStudyPanel';
import type { OpponentStudyController } from '../hooks/useOpponentStudy';
import { Check, ChevronDown, ClipboardCheck, EyeOff, GripVertical, RotateCcw, Save, Shield, Target, Users } from 'lucide-react';
import { InstructionsPanel, type InstructionKey, type InstructionValue } from '../components/tactics/InstructionsPanel';
import { BENCH_PLAYER_DRAG_TYPE, TacticsField } from '../components/tactics/TacticsField';
import { Badge } from '../components/shared/Badge';
import { Button } from '../components/shared/Button';
import { StarPlayerMark } from '../components/shared/StarPlayerMark';
import {
  PlayerProfileHost,
  profilePlayersFromLocalRoster,
} from '../components/player/PlayerProfileHost';
import { formations } from '../constants/formations';
import type {
  BolaSocket,
  ClubChoice,
  IndividualTacticInstruction,
  IndividualWithBallInstruction,
  IndividualWithoutBallInstruction,
  LineupSaveResponse,
  Player,
  Room,
  RoomLineup,
  TacticMentality,
  TacticPlanV1,
  TacticSetPieces,
} from '../types';
import { average } from '../utils/formatters';
import { buildSavedLineup, createBench, createFormationLineup, isPlayerAvailableForLineup, isPositionCompatible } from '../utils/playerRoster';
import { hasKnownCatalogField, knownPlayerCondition, playerShirtNumberLabel } from '../utils/playerDataAvailability';
import { playerGoalkeeperRating, playerPhysicalRating, playerPositionRating } from '../utils/playerRating';
import { cloneTacticPlan, DEFAULT_TACTIC_PLAN } from '../utils/teamPlan';
import { previewTeamCohesion } from '../utils/teamCohesion';

interface TacticsViewProps {
  players: Player[];
  club: ClubChoice;
  opponentName?: string;
  studyController?: OpponentStudyController;
  savedLineup?: RoomLineup;
  savedLineupIds?: string[];
  currentSeason?: number;
  room?: Room | null;
  socket?: BolaSocket | null;
  managerId?: string;
  onRosterChanged?: () => void;
  onSaveLineup?: (lineupIds: string[], tactics?: TacticPlanV1) => Promise<LineupSaveResponse>;
  onToast: (message: string) => void;
}

interface TacticsSnapshot {
  plan: TacticPlanV1;
  lineup: Array<Player | undefined>;
  bench: Player[];
  persisted: boolean;
}

type SetPieceKey = keyof TacticSetPieces;

const defaultIndividualInstruction: Omit<IndividualTacticInstruction, 'playerId'> = {
  withBall: 'support-inside',
  withoutBall: 'press-more',
};

const mentalityOptions: Array<{ value: TacticMentality; label: string }> = [
  { value: 'cautious', label: 'Cautelosa' },
  { value: 'balanced', label: 'Equilibrada' },
  { value: 'positive', label: 'Positiva' },
  { value: 'attacking', label: 'Ofensiva' },
];

const withBallOptions: Array<{ value: IndividualWithBallInstruction; label: string }> = [
  { value: 'support-inside', label: 'Apoiar por dentro' },
  { value: 'hold-width', label: 'Dar amplitude' },
  { value: 'attack-space', label: 'Atacar o espaço' },
];

const withoutBallOptions: Array<{ value: IndividualWithoutBallInstruction; label: string }> = [
  { value: 'press-more', label: 'Pressionar mais' },
  { value: 'hold-position', label: 'Guardar posição' },
  { value: 'man-mark', label: 'Marcação individual' },
];

const setPieceDefinitions = [
  {
    key: 'corner' as const,
    title: 'Escanteio ofensivo',
    routines: [
      { value: 'short', label: 'Curto' },
      { value: 'near-post', label: 'Primeira trave' },
      { value: 'far-post', label: 'Segunda trave' },
    ],
  },
  {
    key: 'freeKick' as const,
    title: 'Falta frontal',
    routines: [
      { value: 'direct', label: 'Cobrança direta' },
      { value: 'cross', label: 'Cruzamento' },
      { value: 'short', label: 'Jogada curta' },
    ],
  },
  {
    key: 'goalKick' as const,
    title: 'Tiro de meta',
    routines: [
      { value: 'short', label: 'Saída curta' },
      { value: 'mixed', label: 'Saída mista' },
      { value: 'long', label: 'Ligação longa' },
    ],
  },
];

function createDefaultPlan(): TacticPlanV1 {
  return cloneTacticPlan(DEFAULT_TACTIC_PLAN);
}

function clonePlan(plan: TacticPlanV1): TacticPlanV1 {
  return cloneTacticPlan(plan);
}

function hydratePlan(savedPlan: TacticPlanV1 | undefined): TacticPlanV1 {
  const fallback = createDefaultPlan();
  if (!savedPlan) return fallback;
  const formationId = formations.some((formation) => formation.id === savedPlan.formationId)
    ? savedPlan.formationId
    : fallback.formationId;
  return {
    ...fallback,
    ...savedPlan,
    version: 1,
    formationId,
    teamInstructions: { ...fallback.teamInstructions, ...savedPlan.teamInstructions },
    individualInstructions: Array.isArray(savedPlan.individualInstructions)
      ? savedPlan.individualInstructions.map((instruction) => ({ ...instruction }))
      : [],
    setPieces: {
      corner: { ...fallback.setPieces.corner, ...savedPlan.setPieces?.corner },
      freeKick: { ...fallback.setPieces.freeKick, ...savedPlan.setPieces?.freeKick },
      goalKick: { ...fallback.setPieces.goalKick, ...savedPlan.setPieces?.goalKick },
    },
    secret: savedPlan.secret !== false,
  };
}

function sanitizePlan(plan: TacticPlanV1, lineupIds: readonly string[]): TacticPlanV1 {
  const starterIds = new Set(lineupIds);
  const instructionsByPlayer = new Map(
    plan.individualInstructions
      .filter((instruction) => starterIds.has(instruction.playerId))
      .map((instruction) => [instruction.playerId, instruction]),
  );
  const validTaker = (takerId: string | null) => takerId && starterIds.has(takerId) ? takerId : null;
  return {
    ...clonePlan(plan),
    version: 1,
    formationId: formations.some((formation) => formation.id === plan.formationId) ? plan.formationId : '4-3-3',
    individualInstructions: lineupIds.map((playerId) => ({
      playerId,
      ...(instructionsByPlayer.get(playerId) ?? defaultIndividualInstruction),
    })),
    setPieces: {
      corner: { ...plan.setPieces.corner, takerId: validTaker(plan.setPieces.corner.takerId) },
      freeKick: { ...plan.setPieces.freeKick, takerId: validTaker(plan.setPieces.freeKick.takerId) },
      goalKick: { ...plan.setPieces.goalKick, takerId: validTaker(plan.setPieces.goalKick.takerId) },
    },
  };
}

function createSnapshot(
  players: readonly Player[],
  savedLineup: RoomLineup | undefined,
  savedLineupIds: readonly string[] | undefined,
): TacticsSnapshot {
  const plan = hydratePlan(savedLineup?.tactics);
  const formation = formations.find((candidate) => candidate.id === plan.formationId) ?? formations[0];
  const lineup = buildSavedLineup(players, formation, savedLineup?.lineupIds ?? savedLineupIds);
  const lineupIds = lineup.flatMap((player) => player ? [player.id] : []);
  return {
    plan: sanitizePlan(plan, lineupIds),
    lineup,
    bench: createBench(players, lineup),
    persisted: Boolean(savedLineup?.tactics),
  };
}

export function TacticsView({
  players,
  club,
  opponentName = 'adversário',
  studyController,
  savedLineup,
  savedLineupIds,
  room = null,
  socket = null,
  managerId = '',
  onRosterChanged = () => undefined,
  onSaveLineup,
  onToast,
}: TacticsViewProps) {
  const externalSnapshotKey = JSON.stringify({
    lineupIds: savedLineup?.lineupIds ?? savedLineupIds ?? [],
    tactics: savedLineup?.tactics ?? null,
    players: players.map((player) => ({
      id: player.id,
      position: player.position,
      status: player.status,
      condition: player.condition,
    })),
  });
  const externalSnapshot = useMemo(
    () => createSnapshot(players, savedLineup, savedLineupIds),
    [externalSnapshotKey],
  );
  const [baseline, setBaseline] = useState<TacticsSnapshot>(() => externalSnapshot);
  const [plan, setPlan] = useState<TacticPlanV1>(() => clonePlan(externalSnapshot.plan));
  const [lineup, setLineup] = useState<Array<Player | undefined>>(() => [...externalSnapshot.lineup]);
  const [bench, setBench] = useState<Player[]>(() => [...externalSnapshot.bench]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [dirty, setDirty] = useState(() => !externalSnapshot.persisted);
  const [savePending, setSavePending] = useState(false);
  const [panelTab, setPanelTab] = useState<'team' | 'individual' | 'setpieces'>('team');
  const [profilePlayerId, setProfilePlayerId] = useState<string | null>(null);
  const benchClickTimer = useRef<number | null>(null);
  const profilePlayers = useMemo(
    () => profilePlayersFromLocalRoster(players, club),
    [club, players],
  );

  const formation = formations.find((item) => item.id === plan.formationId) ?? formations[0];
  const teamRating = useMemo(() => {
    const ratings = lineup.flatMap((player) => (
      player && hasKnownCatalogField(player, 'attributes') ? [playerPositionRating(player)] : []
    ));
    return ratings.length ? average(ratings) : null;
  }, [lineup]);
  const selectedPlayer = selectedSlot === null ? undefined : lineup[selectedSlot];
  const selectedInstruction = selectedPlayer
    ? plan.individualInstructions.find((instruction) => instruction.playerId === selectedPlayer.id) ?? {
        playerId: selectedPlayer.id,
        ...defaultIndividualInstruction,
      }
    : null;
  const starters = lineup.flatMap((player) => player ? [player] : []);
  const starterIds = new Set(starters.map((player) => player.id));
  const unavailableStarters = starters.filter((player) => !isPlayerAvailableForLineup(player));
  const outOfPosition = lineup.flatMap((player, index) => {
    const role = formation.slots[index]?.role;
    return player && role && !isPositionCompatible(player.position, role) ? [{ player, role }] : [];
  });
  const cohesionPreview = previewTeamCohesion(
    savedLineup,
    sanitizePlan(plan, starters.map((player) => player.id)),
    lineup,
  );

  useEffect(() => {
    setBaseline(externalSnapshot);
    applySnapshot(externalSnapshot);
  }, [externalSnapshot]);

  useEffect(() => () => {
    if (benchClickTimer.current !== null) window.clearTimeout(benchClickTimer.current);
  }, []);

  function applySnapshot(snapshot: TacticsSnapshot) {
    setPlan(clonePlan(snapshot.plan));
    setLineup([...snapshot.lineup]);
    setBench([...snapshot.bench]);
    setSelectedSlot(null);
    setDirty(!snapshot.persisted);
  }

  function markPlan(update: (current: TacticPlanV1) => TacticPlanV1) {
    setPlan((current) => update(current));
    setDirty(true);
  }

  function changeFormation(formationId: string) {
    const nextFormation = formations.find((candidate) => candidate.id === formationId);
    if (!nextFormation || nextFormation.id === plan.formationId) return;
    const remapped = createFormationLineup(starters, nextFormation);
    setLineup(remapped);
    setBench(createBench(players, remapped));
    setSelectedSlot(null);
    markPlan((current) => ({ ...current, formationId: nextFormation.id }));
  }

  function swap(from: number, to: number) {
    setLineup((current) => {
      const next = [...current];
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
    setDirty(true);
  }

  function placeBenchPlayer(player: Player, targetSlot: number) {
    if (!formation.slots[targetSlot]) {
      onToast('A posição escolhida não existe nesta formação.');
      return;
    }
    if (!isPlayerAvailableForLineup(player)) {
      onToast(`${player.shortName} está indisponível e não pode ser escalado.`);
      return;
    }
    const nextLineup = lineup.map((item, index) => index === targetSlot ? player : item);
    setLineup(nextLineup);
    setBench(createBench(players, nextLineup));
    setSelectedSlot(null);
    setDirty(true);
  }

  function selectFromBench(player: Player) {
    if (!isPlayerAvailableForLineup(player)) {
      onToast(`${player.shortName} está indisponível e não pode ser escalado.`);
      return;
    }
    if (selectedSlot === null) {
      onToast('Selecione uma posição no campo para fazer a troca.');
      return;
    }
    placeBenchPlayer(player, selectedSlot);
  }

  function queueBenchSelection(player: Player) {
    if (benchClickTimer.current !== null) window.clearTimeout(benchClickTimer.current);
    benchClickTimer.current = window.setTimeout(() => {
      benchClickTimer.current = null;
      selectFromBench(player);
    }, 220);
  }

  function openBenchProfile(player: Player) {
    if (benchClickTimer.current !== null) {
      window.clearTimeout(benchClickTimer.current);
      benchClickTimer.current = null;
    }
    setProfilePlayerId(player.id);
  }

  function dropBenchPlayer(playerId: string, targetSlot: number) {
    const player = bench.find((candidate) => candidate.id === playerId);
    if (!player) {
      onToast('Esse jogador não está mais disponível no banco.');
      return;
    }
    placeBenchPlayer(player, targetSlot);
  }

  function changeInstruction(key: InstructionKey, value: InstructionValue) {
    markPlan((current) => ({
      ...current,
      teamInstructions: { ...current.teamInstructions, [key]: value },
    }));
  }

  function changeIndividual(
    field: 'withBall' | 'withoutBall',
    value: IndividualWithBallInstruction | IndividualWithoutBallInstruction,
  ) {
    if (!selectedPlayer) return;
    markPlan((current) => {
      const existing = current.individualInstructions.find((instruction) => instruction.playerId === selectedPlayer.id) ?? {
        playerId: selectedPlayer.id,
        ...defaultIndividualInstruction,
      };
      const next = { ...existing, [field]: value } as IndividualTacticInstruction;
      return {
        ...current,
        individualInstructions: [
          ...current.individualInstructions.filter((instruction) => instruction.playerId !== selectedPlayer.id),
          next,
        ],
      };
    });
  }

  function changeSetPieceRoutine(key: SetPieceKey, value: string) {
    markPlan((current) => {
      if (key === 'corner') {
        return { ...current, setPieces: { ...current.setPieces, corner: { ...current.setPieces.corner, routine: value as TacticSetPieces['corner']['routine'] } } };
      }
      if (key === 'freeKick') {
        return { ...current, setPieces: { ...current.setPieces, freeKick: { ...current.setPieces.freeKick, routine: value as TacticSetPieces['freeKick']['routine'] } } };
      }
      return { ...current, setPieces: { ...current.setPieces, goalKick: { ...current.setPieces.goalKick, routine: value as TacticSetPieces['goalKick']['routine'] } } };
    });
  }

  function changeSetPieceTaker(key: SetPieceKey, takerId: string | null) {
    markPlan((current) => ({
      ...current,
      setPieces: {
        ...current.setPieces,
        [key]: { ...current.setPieces[key], takerId },
      },
    }));
  }

  async function save() {
    const lineupIds = lineup.flatMap((player) => player ? [player.id] : []).slice(0, 11);
    if (lineupIds.length !== 11) {
      onToast(`A formação precisa de 11 titulares. Faltam ${Math.max(0, 11 - lineupIds.length)}.`);
      return;
    }
    const goalkeepers = starters.filter((player) => player.position === 'GOL');
    if (goalkeepers.length !== 1 || lineup[0]?.position !== 'GOL') {
      onToast('A escalação precisa de exatamente um goleiro na posição GOL.');
      return;
    }
    if (unavailableStarters.length > 0) {
      onToast(`Indisponíveis não podem ser escalados: ${unavailableStarters.map((player) => player.shortName).join(', ')}.`);
      return;
    }
    const savedPlan = sanitizePlan(plan, lineupIds);
    setSavePending(true);
    try {
      if (onSaveLineup) await onSaveLineup(lineupIds, savedPlan);
      const nextBaseline: TacticsSnapshot = {
        plan: clonePlan(savedPlan),
        lineup: [...lineup],
        bench: [...bench],
        persisted: true,
      };
      setPlan(savedPlan);
      setBaseline(nextBaseline);
      setDirty(false);
      const warning = outOfPosition.length
        ? ` ${outOfPosition.length} jogador(es) fora da função reduziram o entrosamento.`
        : '';
      onToast(onSaveLineup
        ? `Plano de ${club.name} salvo para a sala.${warning}`
        : `Plano de ${club.name} salvo localmente.${warning}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível salvar o plano tático.');
    } finally {
      setSavePending(false);
    }
  }

  function restore() {
    applySnapshot(baseline);
  }

  return (
    <main className="tactics-view view-enter">
      <div className="view-heading tactics-heading">
        <div><p className="eyebrow">PLANO DE JOGO · VERSÃO 09</p><h1>Táticas</h1><p>Estrutura dinâmica, funções e comportamento em todas as fases.</p></div>
        <div className="view-heading__actions"><Button variant="secondary" icon={<RotateCcw size={15} />} onClick={restore}>Restaurar</Button><Button variant="primary" loading={savePending} icon={dirty ? <Save size={15} /> : <Check size={15} />} onClick={() => void save()}>{dirty ? 'Salvar alterações' : 'Plano salvo'}</Button></div>
      </div>

      <div className="tactics-workspace">
        <section className="formation-board">
          <header className="formation-toolbar">
            <div className="formation-select"><span>FORMAÇÃO</span><select value={plan.formationId} onChange={(event) => changeFormation(event.target.value)}>{formations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.description}</option>)}</select><ChevronDown size={14} /></div>
            <div className="mentality-switch"><span>MENTALIDADE</span>{mentalityOptions.map((item) => <button type="button" key={item.value} aria-pressed={plan.mentality === item.value} onClick={() => markPlan((current) => ({ ...current, mentality: item.value }))}>{item.label}</button>)}</div>
            <Badge tone={cohesionPreview >= 70 ? 'positive' : 'warning'} dot>Entrosamento {cohesionPreview}%{dirty ? ' · prévia' : ''}</Badge>
          </header>

          <div className="field-stage">
            <div className="field-stage__label"><span><Target size={14} /> Ataque</span><span>ARRASTE PARA TROCAR · DUPLO CLIQUE PARA VER STATS</span></div>
            <TacticsField formation={formation} lineup={lineup} onSwap={swap} onBenchPlayerDrop={dropBenchPlayer} selectedIndex={selectedSlot} onSelect={(index) => setSelectedSlot(index === selectedSlot ? null : index)} onPlayerDoubleClick={(player) => setProfilePlayerId(player.id)} />
            <div className="field-stage__label field-stage__label--bottom"><span><Shield size={14} /> Defesa</span><span>{club.name.toUpperCase()} · MANDO DE CAMPO</span></div>
          </div>

          <div className="bench">
            <header><span><Users size={14} /> BANCO DE RESERVAS · {bench.length}</span><small>Arraste para escalar · duplo clique para ver stats</small></header>
            <div className="bench-list">
              {bench.map((player) => {
                const available = isPlayerAvailableForLineup(player);
                const condition = knownPlayerCondition(player);
                const attributesKnown = hasKnownCatalogField(player, 'attributes');
                return (
                  <button
                    type="button"
                    key={player.id}
                    aria-disabled={!available}
                    draggable={available}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData(BENCH_PLAYER_DRAG_TYPE, player.id);
                    }}
                    onClick={() => queueBenchSelection(player)}
                    onDoubleClick={(event) => {
                      event.preventDefault();
                      openBenchProfile(player);
                    }}
                    title={available ? `Arraste ou clique para escalar. Duplo clique para ver os stats de ${player.shortName}` : `${player.shortName} está indisponível. Duplo clique para ver os stats`}
                  >
                    <GripVertical size={13} />
                    <span className="bench-number">{playerShirtNumberLabel(player)}</span>
                    <span><span className="bench-player__name"><strong>{player.shortName}</strong>{player.isStar && <StarPlayerMark />}</span><small>{player.position} · FÍS {attributesKnown ? playerPhysicalRating(player).toFixed(1) : '—'} · {condition === null ? 'condição —' : `${condition}%`} · {player.status}</small></span>
                    <strong>{attributesKnown ? playerPositionRating(player).toFixed(1) : '—'}</strong>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <aside className="tactic-controls">
          <div className="tactic-score">
            <div><span>IDENTIDADE DO PLANO</span><strong>{teamRating === null ? '—' : teamRating.toFixed(1)}</strong><small>{teamRating === null ? '' : '/10'}</small></div>
            <dl><div><dt>Formação</dt><dd>{formation.id}</dd></div><div><dt>Mentalidade</dt><dd>{mentalityOptions.find((item) => item.value === plan.mentality)?.label}</dd></div><div><dt>Plano</dt><dd>{plan.secret ? 'Secreto' : 'Público'}</dd></div></dl>
          </div>
          <div className="control-tabs">
            <button type="button" aria-selected={panelTab === 'team'} onClick={() => setPanelTab('team')}>Equipe</button>
            <button type="button" aria-selected={panelTab === 'individual'} onClick={() => setPanelTab('individual')}>Individuais</button>
            <button type="button" aria-selected={panelTab === 'setpieces'} onClick={() => setPanelTab('setpieces')}>Bola parada</button>
          </div>
          {panelTab === 'team' && <InstructionsPanel values={plan.teamInstructions} onChange={changeInstruction} />}
          {panelTab === 'individual' && (
            <div className="individual-panel">
              <p>Selecione um titular no campo para definir sua função com e sem a bola.</p>
              {selectedSlot !== null && selectedPlayer ? <div className="selected-player-instruction"><span className="avatar">{selectedPlayer.number}</span><span><strong>{selectedPlayer.name}</strong><small>{formation.slots[selectedSlot].role} · NOTA {playerPositionRating(selectedPlayer).toFixed(1)} · FÍS {playerPhysicalRating(selectedPlayer).toFixed(1)}{selectedPlayer.position === 'GOL' ? ` · GK ${playerGoalkeeperRating(selectedPlayer).toFixed(1)}` : ''}</small></span></div> : <div className="empty-instruction"><Users size={22} /><strong>Nenhum atleta selecionado</strong><span>Toque em uma posição do campo.</span></div>}
              <label><span>Com a bola</span><select disabled={!selectedInstruction} value={selectedInstruction?.withBall ?? defaultIndividualInstruction.withBall} onChange={(event) => changeIndividual('withBall', event.target.value as IndividualWithBallInstruction)}>{withBallOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label><span>Sem a bola</span><select disabled={!selectedInstruction} value={selectedInstruction?.withoutBall ?? defaultIndividualInstruction.withoutBall} onChange={(event) => changeIndividual('withoutBall', event.target.value as IndividualWithoutBallInstruction)}>{withoutBallOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            </div>
          )}
          {panelTab === 'setpieces' && (
            <div className="setpiece-panel">
              <ClipboardCheck size={25} /><h3>Bolas paradas</h3><p>Rotina e cobrador são salvos junto do plano. Apenas titulares podem cobrar.</p>
              {setPieceDefinitions.map((definition) => {
                const current = plan.setPieces[definition.key];
                const takerId = current.takerId && starterIds.has(current.takerId) ? current.takerId : '';
                return (
                  <fieldset className="setpiece-control" key={definition.key}>
                    <legend>{definition.title}</legend>
                    <label><span>Rotina</span><select value={current.routine} onChange={(event) => changeSetPieceRoutine(definition.key, event.target.value)}>{definition.routines.map((routine) => <option key={routine.value} value={routine.value}>{routine.label}</option>)}</select></label>
                    <label><span>Cobrador</span><select value={takerId} onChange={(event) => changeSetPieceTaker(definition.key, event.target.value || null)}><option value="">Automático</option>{starters.map((player) => <option key={player.id} value={player.id}>{player.shortName} · {player.position}</option>)}</select></label>
                  </fieldset>
                );
              })}
            </div>
          )}
          <label className="secret-tactic"><span><EyeOff size={15} /><span><strong>Tática secreta</strong><small>Ocultar plano dos outros managers</small></span></span><input type="checkbox" checked={plan.secret} onChange={(event) => markPlan((current) => ({ ...current, secret: event.target.checked }))} /><i /></label>
          {outOfPosition.length > 0 && <div className="tactic-validation" role="status"><strong>{outOfPosition.length} fora de posição</strong><span>{outOfPosition.map(({ player, role }) => `${player.shortName} em ${role}`).join(' · ')}</span></div>}
          {studyController ? <OpponentStudyPanel controller={studyController} /> : <p>Estudo indisponível para {opponentName}.</p>}
        </aside>
      </div>
      <PlayerProfileHost
        playerId={profilePlayerId}
        players={profilePlayers}
        room={room}
        socket={socket}
        managerId={managerId}
        currentClubId={club.id}
        onRosterChanged={onRosterChanged}
        onClose={() => setProfilePlayerId(null)}
        onToast={onToast}
      />
    </main>
  );
}
