import { useMemo, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Landmark,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Star,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { ProgressBar } from '../../components/shared/ProgressBar';
import { Button } from '../../components/shared/Button';
import { useAuth } from '../../hooks/useAuth';
import { useClubCareer } from '../../hooks/useClubCareer';
import { useMarket } from '../../hooks/useMarket';
import { useStarImpact } from '../../hooks/useStarImpact';
import type {
  BolaSocket,
  ClubChoice,
  ClubFinancialMonthlyAggregate,
  ClubFinancialTransaction,
  ClubFinancialYearlyAggregate,
  MarketActiveLoan,
  MarketTransaction,
  Player,
  Room,
} from '../../types';
import { formatCurrency } from '../../utils/formatters';

function identifierKey(value: unknown) {
  return String(value ?? '').trim().toLocaleUpperCase('pt-BR');
}

function finiteMoney(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
}

function monthlyWage(player: Player | undefined) {
  return finiteMoney(player?.contract?.wage ?? player?.wage);
}

function transactionWasCompleted(transaction: MarketTransaction) {
  const status = String(transaction.status ?? 'completed').toLocaleLowerCase('pt-BR');
  return status === 'completed' && transaction.eventType !== 'transfer-agreement';
}

function payrollForClub(players: Player[], activeLoans: MarketActiveLoan[], clubId: string) {
  const targetClub = identifierKey(clubId);
  const roster = new Map(players.map((player) => [identifierKey(player.id), player]));
  let total = players.reduce((sum, player) => sum + monthlyWage(player), 0);
  let paidPlayers = players.filter((player) => monthlyWage(player) > 0).length;

  for (const loan of activeLoans) {
    const isBorrower = identifierKey(loan.borrowerClubId) === targetClub;
    const isOwner = identifierKey(loan.lenderClubId) === targetClub;
    if (!isBorrower && !isOwner) continue;

    const rosterPlayer = roster.get(identifierKey(loan.player.id));
    const snapshotWage = finiteMoney(loan.wage);
    const wage = snapshotWage > 0 ? snapshotWage : monthlyWage(rosterPlayer);
    const rawBorrowerShare = Number(loan.wageSharePercent);
    const borrowerShare = Math.max(0, Math.min(100, Number.isFinite(rawBorrowerShare) ? rawBorrowerShare : 50)) / 100;
    const borrowerCost = Math.round(wage * borrowerShare);
    const clubCost = isBorrower ? borrowerCost : wage - borrowerCost;
    const rosterCost = rosterPlayer ? monthlyWage(rosterPlayer) : 0;

    total += clubCost - rosterCost;
    if (rosterPlayer && rosterCost > 0 && clubCost === 0) paidPlayers -= 1;
    if (!rosterPlayer && clubCost > 0) paidPlayers += 1;
  }

  return { total: Math.max(0, Math.round(total)), paidPlayers: Math.max(0, paidPlayers) };
}

type RuntimeFinanceProfile = {
  transferBudget?: unknown;
  wageBudget?: unknown;
  staffPayroll?: unknown;
  debts?: unknown;
  maintenanceMonthly?: unknown;
  sponsors?: Array<{
    id?: unknown;
    name?: unknown;
    annualValue?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
    status?: unknown;
  }>;
  sponsor?: {
    name?: unknown;
    monthlyAmount?: unknown;
    startsAt?: unknown;
    endsAt?: unknown;
  };
};

type SponsorSnapshot = {
  name: string;
  annualValue: number;
  startsAt: string | null;
  endsAt: string | null;
};

function validDate(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? value : null;
}

function activeSponsor(profile: RuntimeFinanceProfile | null, asOf: Date): SponsorSnapshot | null {
  const isActiveAt = (startsAt: unknown, endsAt: unknown) => {
    const starts = validDate(startsAt);
    const ends = validDate(endsAt);
    return (!starts || new Date(starts).getTime() <= asOf.getTime())
      && (!ends || new Date(ends).getTime() >= asOf.getTime());
  };
  const sponsor = profile?.sponsors?.find((candidate) => (
    String(candidate.status ?? 'active').toLocaleLowerCase('pt-BR') === 'active'
    && String(candidate.name ?? '').trim()
    && finiteMoney(candidate.annualValue) > 0
    && isActiveAt(candidate.startsAt, candidate.endsAt)
  ));
  if (sponsor) {
    return {
      name: String(sponsor.name).trim(),
      annualValue: finiteMoney(sponsor.annualValue),
      startsAt: validDate(sponsor.startsAt),
      endsAt: validDate(sponsor.endsAt),
    };
  }

  const legacy = profile?.sponsor;
  const monthlyAmount = finiteMoney(legacy?.monthlyAmount);
  const name = String(legacy?.name ?? '').trim();
  return name && monthlyAmount > 0 && isActiveAt(legacy?.startsAt, legacy?.endsAt)
    ? {
      name,
      annualValue: monthlyAmount * 12,
      startsAt: validDate(legacy?.startsAt),
      endsAt: validDate(legacy?.endsAt),
    }
    : null;
}

function sponsorInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('pt-BR');
}

function shortDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(new Date(value));
}

function categoryLabel(value: string) {
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  const labels: Record<string, string> = {
    payroll: 'Folha salarial',
    staff_payroll: 'Comissão técnica',
    maintenance: 'Manutenção',
    sponsorship: 'Patrocínios',
    broadcast_rights: 'Direitos de transmissão',
    debt_payment: 'Pagamento de dívidas',
    matchday_revenue: 'Receita de jogos',
    transfer: 'Transferências',
    transfer_income: 'Vendas de jogadores',
    transfer_expense: 'Contratações',
    market: 'Mercado',
    stadium_investment: 'Investimentos no estádio',
    infrastructure_investment: 'Infraestrutura',
    staff_hire: 'Contratação de comissão',
    staff_termination: 'Rescisões da comissão',
    prize: 'Premiações',
    prizes: 'Premiações',
    other: 'Outros',
  };
  if (labels[normalized]) return labels[normalized];
  const readable = normalized.replaceAll('_', ' ').replaceAll('-', ' ').trim();
  return readable ? readable[0].toLocaleUpperCase('pt-BR') + readable.slice(1) : 'Outros';
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function transactionDate(transaction: ClubFinancialTransaction) {
  const date = new Date(transaction.occurredAt);
  return Number.isFinite(date.getTime()) ? date : null;
}

type CashflowBucket = {
  key: string;
  label: string;
  income: number;
  expenses: number;
};

function cashflowBuckets(
  transactions: ClubFinancialTransaction[],
  currentDate: Date,
  period: 'mensal' | 'anual',
  monthlyAggregates: ClubFinancialMonthlyAggregate[],
  yearlyAggregates: ClubFinancialYearlyAggregate[],
  aggregateStateReady: boolean,
) {
  const buckets: CashflowBucket[] = [];
  if (period === 'mensal') {
    for (let offset = 11; offset >= 0; offset -= 1) {
      const date = new Date(currentDate.getFullYear(), currentDate.getMonth() - offset, 1);
      buckets.push({
        key: monthKey(date),
        label: new Intl.DateTimeFormat('pt-BR', { month: 'short' })
          .format(date).replace('.', '').toLocaleUpperCase('pt-BR'),
        income: 0,
        expenses: 0,
      });
    }
  } else {
    for (let offset = 4; offset >= 0; offset -= 1) {
      const year = currentDate.getFullYear() - offset;
      buckets.push({ key: String(year), label: String(year), income: 0, expenses: 0 });
    }
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  if (aggregateStateReady) {
    const aggregates = period === 'mensal' ? monthlyAggregates : yearlyAggregates;
    for (const aggregate of aggregates) {
      const key = period === 'mensal'
        ? (aggregate as ClubFinancialMonthlyAggregate).periodKey
        : String((aggregate as ClubFinancialYearlyAggregate).year);
      const bucket = byKey.get(key);
      if (!bucket) continue;
      bucket.income = finiteMoney(aggregate.income);
      bucket.expenses = finiteMoney(aggregate.expenses);
    }
    return buckets;
  }
  for (const transaction of transactions) {
    const date = transactionDate(transaction);
    if (!date) continue;
    const key = period === 'mensal' ? monthKey(date) : String(date.getFullYear());
    const bucket = byKey.get(key);
    if (!bucket) continue;
    const amount = finiteMoney(transaction.amount);
    if (transaction.direction === 'income') bucket.income += amount;
    else bucket.expenses += amount;
  }
  return buckets;
}

function compactAxis(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function isTransferCategory(category: string) {
  const normalized = category.toLocaleLowerCase('pt-BR');
  return normalized.includes('transfer')
    || normalized.includes('market')
    || normalized.includes('player_sale')
    || normalized.includes('player_purchase');
}

function categoryAggregateIsComplete(aggregate: {
  income: number;
  expenses: number;
  count: number;
  byCategory: Record<string, { income: number; expenses: number; count: number }>;
}) {
  const summary = Object.values(aggregate.byCategory ?? {}).reduce((result, category) => ({
    income: result.income + finiteMoney(category.income),
    expenses: result.expenses + finiteMoney(category.expenses),
    count: result.count + finiteMoney(category.count),
  }), { income: 0, expenses: 0, count: 0 });
  return summary.income === finiteMoney(aggregate.income)
    && summary.expenses === finiteMoney(aggregate.expenses)
    && summary.count === finiteMoney(aggregate.count);
}

interface FinanceViewProps {
  club: ClubChoice;
  room: Room | null;
  roomCode?: string | null;
  socket: BolaSocket | null;
  managerId: string;
  players: Player[];
  onRosterChanged: () => void;
  onToast: (message: string) => void;
}

export function FinanceView({
  club,
  room,
  roomCode,
  socket,
  managerId,
  players,
  onRosterChanged,
}: FinanceViewProps) {
  const [period, setPeriod] = useState<'mensal' | 'anual'>('mensal');
  const auth = useAuth();
  const credentials = useMemo(() => auth.identity
    ? { identity: auth.identity, getIdToken: auth.getIdToken }
    : null, [auth.getIdToken, auth.identity]);
  const starImpact = useStarImpact(club, credentials, roomCode);
  const market = useMarket(room, socket, managerId, onRosterChanged);
  const career = useClubCareer(room, socket, club.id, managerId);
  const financeProfile = career.financeProfile as unknown as RuntimeFinanceProfile | null;
  const careerDate = useMemo(() => {
    const raw = room?.clubCareerState?.currentDate ?? room?.createdAt;
    const parsed = raw ? new Date(raw) : new Date();
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
  }, [room?.clubCareerState?.currentDate, room?.createdAt]);
  const sponsor = useMemo(() => activeSponsor(financeProfile, careerDate), [careerDate, financeProfile]);
  const marketFinance = market.snapshot?.finance;
  const balance = marketFinance?.balance ?? 0;
  const committed = marketFinance?.committed ?? 0;
  const available = marketFinance?.cashAvailable ?? 0;
  const transferAvailable = marketFinance?.transferAvailable ?? 0;
  const starCount = starImpact.profile?.starCount ?? 0;
  const sponsorBoostPercent = starImpact.profile?.sponsorBoostPercent ?? 0;
  const starNames = starImpact.profile?.starPlayers.map((player) => player.name).join(', ') ?? '';

  const playerPayroll = useMemo(
    () => payrollForClub(players, market.snapshot?.activeLoans ?? [], club.id),
    [club.id, market.snapshot?.activeLoans, players],
  );
  const calculatedStaffPayroll = useMemo(() => career.staff.reduce((total, member) => (
    total + finiteMoney(member.contract?.salary ?? member.salary)
  ), 0), [career.staff]);
  const staffPayroll = calculatedStaffPayroll || finiteMoney(financeProfile?.staffPayroll);
  const serverPlayerPayroll = marketFinance?.monthlyPayroll;
  const serverPaidPlayers = marketFinance?.paidPlayers;
  const playerPayrollTotal = serverPlayerPayroll ?? playerPayroll.total;
  const totalPayroll = playerPayrollTotal + staffPayroll;
  const paidContracts = (serverPaidPlayers ?? playerPayroll.paidPlayers) + career.staff.filter((member) => (
    finiteMoney(member.contract?.salary ?? member.salary) > 0
  )).length;

  const transactions = career.transactions;
  const aggregateStateReady = room?.clubCareerState?.financialAggregates?.version === 1;
  const buckets = useMemo(
    () => cashflowBuckets(
      transactions,
      careerDate,
      period,
      career.financialAggregates.monthly,
      career.financialAggregates.yearly,
      aggregateStateReady,
    ),
    [
      aggregateStateReady,
      career.financialAggregates.monthly,
      career.financialAggregates.yearly,
      careerDate,
      period,
      transactions,
    ],
  );
  const visibleKeys = useMemo(() => new Set(buckets.map((bucket) => bucket.key)), [buckets]);
  const visibleTransactions = useMemo(() => transactions.filter((transaction) => {
    const date = transactionDate(transaction);
    if (!date) return false;
    const key = period === 'mensal' ? monthKey(date) : String(date.getFullYear());
    return visibleKeys.has(key);
  }), [period, transactions, visibleKeys]);
  const cashflow = useMemo(() => buckets.reduce((summary, bucket) => ({
    income: summary.income + bucket.income,
    expenses: summary.expenses + bucket.expenses,
  }), { income: 0, expenses: 0 }), [buckets]);
  const netResult = cashflow.income - cashflow.expenses;
  const chartMaximum = Math.max(0, ...buckets.flatMap((bucket) => [bucket.income, bucket.expenses]));
  const axisMaximum = chartMaximum > 0 ? chartMaximum : 1;
  const axisLabels = [axisMaximum, axisMaximum * 0.75, axisMaximum * 0.5, axisMaximum * 0.25, 0];

  const persistentTransferTransactions = useMemo(
    () => transactions.filter((transaction) => isTransferCategory(transaction.category)),
    [transactions],
  );
  const completedMarketTransactions = (market.snapshot?.transactions ?? []).filter(transactionWasCompleted);
  const marketTransferIncome = completedMarketTransactions.reduce((total, transaction) => (
    identifierKey(transaction.fromClubId) === identifierKey(club.id)
      ? total + finiteMoney(transaction.amount)
      : total
  ), 0);
  const marketTransferExpenses = completedMarketTransactions.reduce((total, transaction) => (
    identifierKey(transaction.toClubId) === identifierKey(club.id)
      ? total + finiteMoney(transaction.amount)
      : total
  ), 0);
  const aggregateTransferTotals = useMemo(() => Object.entries(
    career.financialAggregates.total?.byCategory ?? {},
  ).filter(([category]) => isTransferCategory(category)).reduce((summary, [, category]) => ({
    income: summary.income + finiteMoney(category.income),
    expenses: summary.expenses + finiteMoney(category.expenses),
  }), { income: 0, expenses: 0 }), [career.financialAggregates.total]);
  const hasAggregateTransferHistory = aggregateStateReady && Object.keys(
    career.financialAggregates.total?.byCategory ?? {},
  ).some(isTransferCategory);
  const transferIncome = hasAggregateTransferHistory
    ? aggregateTransferTotals.income
    : persistentTransferTransactions.length > 0
    ? persistentTransferTransactions
      .filter((transaction) => transaction.direction === 'income')
      .reduce((total, transaction) => total + finiteMoney(transaction.amount), 0)
    : marketTransferIncome;
  const transferExpenses = hasAggregateTransferHistory
    ? aggregateTransferTotals.expenses
    : persistentTransferTransactions.length > 0
    ? persistentTransferTransactions
      .filter((transaction) => transaction.direction === 'expense')
      .reduce((total, transaction) => total + finiteMoney(transaction.amount), 0)
    : marketTransferExpenses;
  const marketResult = transferIncome - transferExpenses;

  const categoryAggregates = useMemo(() => (
    period === 'mensal'
      ? career.financialAggregates.monthly.filter((aggregate) => visibleKeys.has(aggregate.periodKey))
      : career.financialAggregates.yearly.filter((aggregate) => visibleKeys.has(String(aggregate.year)))
  ), [career.financialAggregates.monthly, career.financialAggregates.yearly, period, visibleKeys]);
  const expenseBreakdownIncomplete = aggregateStateReady
    && categoryAggregates.some((aggregate) => !categoryAggregateIsComplete(aggregate));
  const expenseRows = useMemo(() => {
    const byCategory = new Map<string, number>();
    if (aggregateStateReady && !expenseBreakdownIncomplete) {
      for (const aggregate of categoryAggregates) {
        for (const [category, summary] of Object.entries(aggregate.byCategory ?? {})) {
          byCategory.set(category, (byCategory.get(category) ?? 0) + finiteMoney(summary.expenses));
        }
      }
    } else if (!aggregateStateReady) {
      for (const transaction of visibleTransactions) {
        if (transaction.direction !== 'expense') continue;
        const category = transaction.category || 'other';
        byCategory.set(category, (byCategory.get(category) ?? 0) + finiteMoney(transaction.amount));
      }
    }
    const rows = [...byCategory.entries()]
      .filter(([, value]) => value > 0)
      .map(([category, value]) => ({ category, label: categoryLabel(category), value }))
      .sort((left, right) => right.value - left.value);
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map((row) => ({ ...row, share: total > 0 ? Math.round((row.value / total) * 100) : 0 }));
  }, [aggregateStateReady, categoryAggregates, expenseBreakdownIncomplete, visibleTransactions]);

  const transferBudget = finiteMoney(marketFinance?.transferBudget ?? financeProfile?.transferBudget);
  const wageBudget = finiteMoney(marketFinance?.wageBudget ?? financeProfile?.wageBudget);
  const debts = finiteMoney(financeProfile?.debts);
  const clubFacility = room?.clubCareerState?.clubFacilities
    ?.find((facility) => identifierKey(facility.clubId) === identifierKey(club.id));
  const calculatedMaintenance = finiteMoney(clubFacility?.stadium.maintenanceCost)
    + (clubFacility?.areas ?? []).reduce((total, area) => total + finiteMoney(area.maintenanceCost), 0);
  const maintenance = finiteMoney(financeProfile?.maintenanceMonthly) || calculatedMaintenance;
  const availablePercent = balance > 0 ? Math.round((available / balance) * 100) : 0;
  const committedPercent = balance > 0 ? Math.round((committed / balance) * 100) : 0;
  const wagePercent = wageBudget > 0 ? Math.round((playerPayrollTotal / wageBudget) * 100) : 0;
  const projectedSponsorValue = sponsor
    ? sponsor.annualValue + (starImpact.profile?.sponsorAnnualBonus ?? 0)
    : 0;
  const monthHeading = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' })
    .format(careerDate).toLocaleUpperCase('pt-BR');
  const sponsorTerm = sponsor
    ? [shortDate(sponsor.startsAt), shortDate(sponsor.endsAt)].filter(Boolean).join(' — ')
    : '';

  const financeHeading = <div className="view-heading">
    <div>
      <p className="eyebrow">DEPARTAMENTO FINANCEIRO · {monthHeading}</p>
      <h1>Finanças</h1>
      <p>Saldo, compromissos e lançamentos persistidos neste save.</p>
    </div>
    <div className="compact-tabs">
      <button aria-selected={period === 'mensal'} onClick={() => setPeriod('mensal')}>Mensal</button>
      <button aria-selected={period === 'anual'} onClick={() => setPeriod('anual')}>Anual</button>
    </div>
  </div>;

  if (!market.snapshot) {
    return <main className="secondary-view view-enter">
      {financeHeading}
      {market.loading ? <section className="market-empty market-empty--loading" aria-live="polite">
        <CircleDollarSign size={24} />
        <strong>Sincronizando finanças</strong>
        <small>Carregando o saldo real, compromissos e limites deste clube.</small>
      </section> : <section className="market-empty" role={market.error ? 'alert' : 'status'}>
        <CircleDollarSign size={24} />
        <strong>{market.error ? 'Finanças indisponíveis' : 'Dados financeiros não carregados'}</strong>
        <small>{market.error ?? 'O servidor ainda não enviou o snapshot financeiro deste clube.'}</small>
        <Button size="sm" variant="secondary" onClick={() => void market.refresh()} icon={<RefreshCw size={14} />}>Tentar novamente</Button>
      </section>}
    </main>;
  }

  return <main className="secondary-view view-enter">
    {financeHeading}
    {market.error && <div className="market-error" role="alert"><span>{market.error} Os últimos dados válidos continuam visíveis.</span><Button size="sm" variant="secondary" onClick={() => void market.refresh()} icon={<RefreshCw size={14} />}>Tentar novamente</Button></div>}
    {(market.loading || market.syncing) && <div className="market-error" role="status"><span>Atualizando dados financeiros sem ocultar o último snapshot válido…</span></div>}

    <section className="finance-kpis">
      <div className="finance-kpi feature">
        <span className="metric-icon"><WalletCards size={18} /></span>
        <span>
          <small>SALDO EM CAIXA</small>
          <strong>{market.loading ? 'Sincronizando…' : formatCurrency(balance)}</strong>
          <em><ArrowUpRight size={12} /> {formatCurrency(committed)} comprometidos</em>
        </span>
      </div>
      <div className="finance-kpi">
        <span className="metric-icon"><CircleDollarSign size={18} /></span>
        <span>
          <small>RESULTADO DE TRANSFERÊNCIAS</small>
          <strong>{marketResult >= 0 ? '+' : '−'} {formatCurrency(Math.abs(marketResult))}</strong>
          <em>{persistentTransferTransactions.length > 0 ? 'Livro-caixa do save' : 'Negócios concluídos no mercado'}</em>
        </span>
      </div>
      <div className="finance-kpi">
        <span className="metric-icon"><ReceiptText size={18} /></span>
        <span>
          <small>FOLHA MENSAL TOTAL</small>
          <strong>{formatCurrency(totalPayroll)}</strong>
          <em>{paidContracts} vínculos · {formatCurrency(staffPayroll)} da comissão</em>
        </span>
      </div>
      <div className="finance-kpi">
        <span className="metric-icon"><ShieldCheck size={18} /></span>
        <span>
          <small>CONTROLE FINANCEIRO</small>
          <strong>{debts > 0 || available < 0 ? 'Atenção' : 'Regular'}</strong>
          <em>{debts > 0 ? `${formatCurrency(debts)} em dívidas` : `${formatCurrency(available)} disponíveis`}</em>
        </span>
      </div>
    </section>

    <div className="finance-layout">
      <section className="cashflow-panel">
        <header>
          <div>
            <p className="eyebrow">FLUXO DE CAIXA</p>
            <h2>{period === 'mensal' ? 'Últimos 12 meses' : 'Últimos 5 anos'}</h2>
          </div>
          <div className="chart-legend"><span><i /> Receitas</span><span><i /> Despesas</span></div>
        </header>
        {chartMaximum > 0 ? <div className="finance-chart">
          <div className="chart-y">{axisLabels.map((value, index) => <span key={index}>{compactAxis(value)}</span>)}</div>
          <div className="finance-columns">
            {buckets.map((bucket) => <div key={bucket.key}>
              <span
                title={`Receitas: ${formatCurrency(bucket.income)}`}
                style={{ height: `${bucket.income > 0 ? Math.max(3, (bucket.income / chartMaximum) * 100) : 0}%` }}
              />
              <i
                title={`Despesas: ${formatCurrency(bucket.expenses)}`}
                style={{ height: `${bucket.expenses > 0 ? Math.max(3, (bucket.expenses / chartMaximum) * 100) : 0}%` }}
              />
              <small>{bucket.label}</small>
            </div>)}
          </div>
        </div> : <div className="report-chart-empty" style={{ minHeight: 250 }}>
          <CircleDollarSign size={24} />
          <strong>Sem movimentações no período</strong>
          <span>Receitas e despesas aparecerão depois que operações reais forem registradas no save.</span>
        </div>}
        <div className="cashflow-summary">
          <span><ArrowUpRight size={14} /><strong>Receitas</strong><em>{formatCurrency(cashflow.income)}</em></span>
          <span><ArrowDownRight size={14} /><strong>Despesas</strong><em>{formatCurrency(cashflow.expenses)}</em></span>
          <span><TrendingUp size={14} /><strong>Resultado</strong><em>{netResult >= 0 ? '+' : '−'} {formatCurrency(Math.abs(netResult))}</em></span>
        </div>
      </section>

      <aside className="budget-panel">
        <header><p className="eyebrow">ORÇAMENTO</p><h2>Posição atual</h2></header>
        <div className="budget-row">
          <span><strong>Disponível</strong><small>{formatCurrency(available)} livres no caixa</small></span>
          <strong>{availablePercent}%</strong>
          <ProgressBar value={availablePercent} />
        </div>
        <div className="budget-row">
          <span><strong>Comprometido</strong><small>{formatCurrency(committed)} reservados</small></span>
          <strong>{committedPercent}%</strong>
          <ProgressBar value={committedPercent} tone="info" />
        </div>
        {transferBudget > 0 && <div className="budget-row">
          <span><strong>Contratações</strong><small>Limite de {formatCurrency(transferBudget)}</small></span>
          <strong>{Math.round((Math.min(transferAvailable, transferBudget) / transferBudget) * 100)}%</strong>
          <ProgressBar value={(Math.min(transferAvailable, transferBudget) / transferBudget) * 100} tone="warning" />
        </div>}
        {wageBudget > 0 ? <div className="budget-row">
          <span><strong>Folha dos jogadores</strong><small>{formatCurrency(playerPayrollTotal)} de {formatCurrency(wageBudget)}</small></span>
          <strong>{wagePercent}%</strong>
          <ProgressBar value={wagePercent} tone={wagePercent > 100 ? 'warning' : 'info'} />
        </div> : <div className="budget-row">
          <span><strong>Limite salarial</strong><small>Nenhum limite configurado neste save</small></span>
          <Landmark size={15} />
        </div>}
        {maintenance > 0 && <div className="budget-row">
          <span><strong>Manutenção mensal</strong><small>Estádio e infraestrutura</small></span>
          <strong>{formatCurrency(maintenance)}</strong>
        </div>}
      </aside>

      <section className="expense-breakdown">
        <header><p className="eyebrow">DESPESAS REGISTRADAS</p><h2>Para onde foi o caixa</h2></header>
        {expenseBreakdownIncomplete ? <div style={{ gridTemplateColumns: '1fr', minHeight: 120, textAlign: 'center' }} role="status">
          <span style={{ justifyContent: 'center', flexDirection: 'column', gap: 5 }}>
            <strong>Detalhamento parcial indisponível</strong>
            <small>O total do período está correto, mas este save antigo não possui categorias completas para todo o intervalo.</small>
          </span>
        </div> : expenseRows.length > 0 ? expenseRows.map((row) => <div key={row.category}>
          <span><strong>{row.label}</strong><small>{row.share}%</small></span>
          <i><b style={{ width: `${row.share}%` }} /></i>
          <strong>{formatCurrency(row.value)}</strong>
        </div>) : <div style={{ gridTemplateColumns: '1fr', minHeight: 120, textAlign: 'center' }}>
          <span style={{ justifyContent: 'center', flexDirection: 'column', gap: 5 }}>
            <strong>Nenhuma despesa registrada</strong>
            <small>Esta área usa somente lançamentos persistidos no save.</small>
          </span>
        </div>}
      </section>

      <section className="sponsor-card">
        <div className="sponsor-mark">{sponsor ? sponsorInitials(sponsor.name) : '—'}</div>
        <div className="sponsor-card__identity">
          <p className="eyebrow">PATROCINADOR MASTER</p>
          <h2>{sponsor?.name ?? 'Nenhum contrato ativo'}</h2>
          <p>{sponsor
            ? sponsorTerm || 'Contrato ativo sem vigência informada.'
            : 'Quando um patrocínio for firmado, os valores e a vigência aparecerão aqui.'}</p>
        </div>
        <span className="sponsor-card__value">
          <small>VALOR ANUAL</small>
          <strong>{sponsor ? formatCurrency(projectedSponsorValue) : '—'}</strong>
        </span>
        <div
          className={`sponsor-star-impact${starCount > 0 ? ' has-stars' : ''}${starImpact.error ? ' is-unavailable' : ''}`}
          title={starNames ? `Jogadores estrela: ${starNames}` : undefined}
          aria-live="polite"
        >
          <Star aria-hidden="true" fill={starCount > 0 ? 'currentColor' : 'none'} />
          {starImpact.loading
            ? <span><strong>Calculando impacto comercial</strong><small>Sincronizando elenco…</small></span>
            : starImpact.error
              ? <span><strong>Impacto comercial indisponível</strong><small>Nenhum valor estimado foi acrescentado.</small></span>
              : starCount > 0
                ? <span><strong>{starCount} {starCount === 1 ? 'jogador estrela' : 'jogadores estrela'}</strong><small>+{sponsorBoostPercent}% de atratividade{!sponsor ? ' para futuros contratos' : ''}</small></span>
                : <span><strong>Sem jogadores estrela no elenco</strong><small>Nenhum bônus comercial aplicado.</small></span>}
        </div>
      </section>
    </div>
  </main>;
}
