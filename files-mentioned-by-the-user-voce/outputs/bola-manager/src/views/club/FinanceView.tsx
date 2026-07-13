import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CircleDollarSign, Landmark, ReceiptText, ShieldCheck, Star, TrendingUp, WalletCards } from 'lucide-react';
import { Badge } from '../../components/shared/Badge';
import { Button } from '../../components/shared/Button';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { useAuth } from '../../hooks/useAuth';
import { useStarImpact } from '../../hooks/useStarImpact';
import type { ClubChoice } from '../../types';
import { formatCurrency } from '../../utils/formatters';

interface FinanceViewProps { club: ClubChoice; onToast: (message: string) => void; }

export function FinanceView({ club, onToast }: FinanceViewProps) {
  const [period, setPeriod] = useState('mensal');
  const auth = useAuth();
  const credentials = useMemo(() => auth.identity
    ? { identity: auth.identity, getIdToken: auth.getIdToken }
    : null, [auth.getIdToken, auth.identity]);
  const starImpact = useStarImpact(club, credentials);
  const starCount = starImpact.profile?.starCount ?? 0;
  const sponsorBoostPercent = starImpact.profile?.sponsorBoostPercent ?? 0;
  const projectedSponsorValue = 42_000_000 + (starImpact.profile?.sponsorAnnualBonus ?? 0);
  const starNames = starImpact.profile?.starPlayers.map((player) => player.name).join(', ') ?? '';

  function negotiateSponsor() {
    onToast(starCount > 0
      ? `Força comercial de ${starCount} ${starCount === 1 ? 'estrela incluída' : 'estrelas incluídas'} na negociação (+${sponsorBoostPercent}% de atratividade).`
      : 'Reunião com o patrocinador agendada.');
  }

  return <main className="secondary-view view-enter"><div className="view-heading"><div><p className="eyebrow">DEPARTAMENTO FINANCEIRO · JULHO</p><h1>Finanças</h1><p>Caixa, orçamento duplo e sustentabilidade da temporada.</p></div><div className="compact-tabs"><button aria-selected={period === 'mensal'} onClick={() => setPeriod('mensal')}>Mensal</button><button aria-selected={period === 'anual'} onClick={() => setPeriod('anual')}>Anual</button></div></div>
    <section className="finance-kpis"><div className="finance-kpi feature"><span className="metric-icon"><WalletCards size={18} /></span><span><small>SALDO EM CAIXA</small><strong>{formatCurrency(128_400_000)}</strong><em><ArrowUpRight size={12} /> 8,4% no mês</em></span></div><div className="finance-kpi"><span className="metric-icon"><CircleDollarSign size={18} /></span><span><small>RESULTADO DE JULHO</small><strong>+ {formatCurrency(12_500_000)}</strong><em>Receita acima da projeção</em></span></div><div className="finance-kpi"><span className="metric-icon"><ReceiptText size={18} /></span><span><small>FOLHA SALARIAL</small><strong>{formatCurrency(18_700_000)}</strong><em>74% do teto</em></span></div><div className="finance-kpi"><span className="metric-icon"><ShieldCheck size={18} /></span><span><small>FAIR PLAY</small><strong>Regular</strong><em>Margem: R$ 42 mi</em></span></div></section>
    <div className="finance-layout"><section className="cashflow-panel"><header><div><p className="eyebrow">FLUXO DE CAIXA</p><h2>{period === 'mensal' ? 'Últimos 12 meses' : 'Últimas 5 temporadas'}</h2></div><div className="chart-legend"><span><i /> Receitas</span><span><i /> Despesas</span></div></header><div className="finance-chart"><div className="chart-y"><span>40 mi</span><span>30 mi</span><span>20 mi</span><span>10 mi</span><span>0</span></div><div className="finance-columns">{[22, 28, 25, 34, 29, 38, 31, 42, 36, 47, 39, 54].map((value, index) => <div key={index}><span style={{ height: `${value + 24}%` }} /><i style={{ height: `${value + (index % 3) * 3}%` }} /><small>{['AGO', 'SET', 'OUT', 'NOV', 'DEZ', 'JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL'][index]}</small></div>)}</div></div><div className="cashflow-summary"><span><ArrowUpRight size={14} /><strong>Receitas</strong><em>{formatCurrency(31_200_000)}</em></span><span><ArrowDownRight size={14} /><strong>Despesas</strong><em>{formatCurrency(18_700_000)}</em></span><span><TrendingUp size={14} /><strong>Resultado</strong><em>+ {formatCurrency(12_500_000)}</em></span></div></section>
      <aside className="budget-panel"><header><p className="eyebrow">ORÇAMENTOS</p><h2>Distribuição atual</h2></header><div className="budget-row"><span><strong>Contratações</strong><small>{formatCurrency(72_400_000)} disponíveis</small></span><strong>64%</strong><ProgressBar value={64} /></div><div className="budget-row"><span><strong>Operacional</strong><small>{formatCurrency(28_400_000)} disponíveis</small></span><strong>71%</strong><ProgressBar value={71} tone="info" /></div><div className="budget-row"><span><strong>Infraestrutura</strong><small>{formatCurrency(18_000_000)} disponíveis</small></span><strong>45%</strong><ProgressBar value={45} tone="warning" /></div><Button variant="secondary" icon={<Landmark size={15} />} onClick={() => onToast('Proposta de redistribuição enviada à diretoria.')}>Redistribuir orçamento</Button></aside>
      <section className="expense-breakdown"><header><p className="eyebrow">DESPESAS · JULHO</p><h2>Para onde foi o caixa</h2></header>{[['Folha salarial', 18_700_000, 58], ['Contratações e agentes', 5_800_000, 18], ['Viagens e logística', 3_200_000, 10], ['Infraestrutura', 2_700_000, 8], ['Base e scout', 1_900_000, 6]].map(([label, value, share]) => <div key={String(label)}><span><strong>{String(label)}</strong><small>{share}%</small></span><i><b style={{ width: `${share}%` }} /></i><strong>{formatCurrency(Number(value))}</strong></div>)}</section>
      <section className="sponsor-card">
        <div className="sponsor-mark">BV</div>
        <div className="sponsor-card__identity"><p className="eyebrow">PATROCINADOR MASTER</p><h2>Banco Vértice</h2><p>Contrato até dezembro de 2027 · bônus por Libertadores.</p></div>
        <span className="sponsor-card__value"><small>VALOR ANUAL PROJETADO</small><strong>{formatCurrency(projectedSponsorValue)}</strong></span>
        <div
          className={`sponsor-star-impact${starCount > 0 ? ' has-stars' : ''}${starImpact.error ? ' is-unavailable' : ''}`}
          title={starNames ? `Jogadores estrela: ${starNames}` : undefined}
          aria-live="polite"
        >
          <Star aria-hidden="true" fill={starCount > 0 ? 'currentColor' : 'none'} />
          {starImpact.loading
            ? <span><strong>Calculando impacto comercial</strong><small>Sincronizando elenco…</small></span>
            : starImpact.error
              ? <span><strong>Impacto indisponível</strong><small>Valor base mantido nesta projeção.</small></span>
              : starCount > 0
                ? <span><strong>{starCount} {starCount === 1 ? 'jogador estrela' : 'jogadores estrela'}</strong><small>+{sponsorBoostPercent}% atratividade comercial</small></span>
                : <span><strong>Sem jogadores estrela no elenco</strong><small>Valor base do contrato.</small></span>}
        </div>
        <Button variant="secondary" onClick={negotiateSponsor}>Negociar</Button>
      </section>
    </div>
  </main>;
}
