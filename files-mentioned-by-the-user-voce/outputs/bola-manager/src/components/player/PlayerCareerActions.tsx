import { useEffect, useState } from 'react';
import { Dumbbell, GraduationCap } from 'lucide-react';
import type {
  CareerTrainingFocus,
  CareerTrainingIntensity,
  CareerTrainingPlan,
  Player,
} from '../../types';
import type {
  CareerContractInput,
  CareerPromotionInput,
  CareerTrainingInput,
} from '../../hooks/useCareerState';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

interface PlayerCareerActionsProps {
  player: Player;
  currentSeason: number;
  trainingPlan?: CareerTrainingPlan;
  nationalTeam?: string | null;
  mutationKey?: string | null;
  available: boolean;
  onSaveTraining?: (input: CareerTrainingInput) => Promise<void>;
  onRenewContract?: (input: CareerContractInput) => Promise<void>;
  onPromoteAcademy?: (input: CareerPromotionInput) => Promise<void>;
}

const trainingFocusLabels: Array<[CareerTrainingFocus, string]> = [
  ['balanced', 'Equilibrado'], ['technical', 'Técnico'], ['attacking', 'Ataque'], ['defending', 'Defesa'],
  ['physical', 'Físico'], ['goalkeeping', 'Goleiro'], ['recovery', 'Recuperação'],
];

const trainingIntensityLabels: Array<[CareerTrainingIntensity, string]> = [
  ['low', 'Baixa'], ['normal', 'Normal'], ['high', 'Alta'],
];

export function PlayerCareerActions({
  player,
  currentSeason,
  trainingPlan,
  nationalTeam = null,
  mutationKey = null,
  available,
  onSaveTraining,
  onRenewContract,
  onPromoteAcademy,
}: PlayerCareerActionsProps) {
  const [trainingFocus, setTrainingFocus] = useState<CareerTrainingFocus>('balanced');
  const [trainingIntensity, setTrainingIntensity] = useState<CareerTrainingIntensity>('normal');
  const [contractYears, setContractYears] = useState(3);
  const [contractWage, setContractWage] = useState(0);

  useEffect(() => {
    const activePlan = trainingPlan ?? player.training;
    setTrainingFocus(activePlan?.focus ?? 'balanced');
    setTrainingIntensity(activePlan?.intensity ?? 'normal');
    setContractYears(3);
    setContractWage(Math.round(Math.max(player.academy ? 4_000 : 0, player.contract?.wage ?? player.wage ?? 0)));
  }, [player.academy, player.contract?.wage, player.id, player.training, player.wage, trainingPlan]);

  return (
    <section className="player-career-actions" aria-label="Gestão de carreira do jogador">
      <header>
        <h4>Gestão do jogador</h4>
        {nationalTeam && <Badge tone="positive">Convocado · {nationalTeam}</Badge>}
      </header>
      {!available && <p className="rankings-player-profile__feedback" role="status">Ações de carreira indisponíveis até o save ser sincronizado.</p>}
      <section className="career-controls">
        <h3><span><Dumbbell size={14} /> PLANO DE TREINO</span><span>{trainingPlan?.active === false ? 'INATIVO' : 'PRÓXIMO CICLO'}</span></h3>
        <div className="career-form-grid">
          <label><span>FOCO</span><select disabled={!available} value={trainingFocus} onChange={(event) => setTrainingFocus(event.target.value as CareerTrainingFocus)}>{trainingFocusLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span>INTENSIDADE</span><select disabled={!available} value={trainingIntensity} onChange={(event) => setTrainingIntensity(event.target.value as CareerTrainingIntensity)}>{trainingIntensityLabels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <Button className="career-form-action" size="sm" variant="secondary" loading={mutationKey === `training:${player.id}`} disabled={!available || !onSaveTraining} onClick={() => void onSaveTraining?.({ playerId: player.id, focus: trainingFocus, intensity: trainingIntensity, active: true })}>Salvar treino</Button>
        </div>
      </section>
      <section className="career-controls">
        <h3><span><GraduationCap size={14} /> {player.academy ? 'PROMOVER AO PRINCIPAL' : 'RENOVAR CONTRATO'}</span><span>TEMPORADA {currentSeason}</span></h3>
        <div className="career-form-grid">
          <label><span>DURAÇÃO</span><select disabled={!available} value={contractYears} onChange={(event) => setContractYears(Number(event.target.value))}>{[1, 2, 3, 4, 5].map((years) => <option key={years} value={years}>{years} {years === 1 ? 'temporada' : 'temporadas'}</option>)}</select></label>
          <label><span>SALÁRIO MENSAL</span><input disabled={!available} type="number" min="0" max="10000000" step="1000" value={contractWage} onChange={(event) => setContractWage(Math.max(0, Number(event.target.value)))} /></label>
          {player.academy ? (
            <Button className="career-form-action" size="sm" variant="primary" loading={mutationKey === `academy:${player.id}`} disabled={!available || !onPromoteAcademy || player.age < 16} onClick={() => void onPromoteAcademy?.({ playerId: player.id, years: contractYears, wage: contractWage })}>{player.age < 16 ? 'Disponível aos 16 anos' : 'Promover jogador'}</Button>
          ) : (
            <Button className="career-form-action" size="sm" variant="primary" loading={mutationKey === `contract:${player.id}`} disabled={!available || !onRenewContract} onClick={() => void onRenewContract?.({ playerId: player.id, years: contractYears, wage: contractWage })}>Renovar contrato</Button>
          )}
        </div>
      </section>
    </section>
  );
}
