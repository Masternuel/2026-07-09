import {
  addCompactHashIndexValues,
  compactHash,
  compactHashIndexContains,
  normalizeCompactHashIndex,
} from "../domain/compactHashIndex.mjs";
import { ensureMarketState } from "./market.mjs";
import { ensurePersistentFinanceLimits } from "./financeLimits.mjs";
import { calculateClubMonthlyPayroll } from "./payroll.mjs";

const MAX_MONEY = 2_000_000_000;
const MAX_FINANCIAL_TRANSACTIONS = 500;
const MAX_ACCOUNT_LEDGER = 100;
const MAX_RESERVATIONS_PER_CLUB = 160;
const FINANCIAL_AGGREGATES_VERSION = 1;
const MAX_MONTHLY_AGGREGATES_PER_CLUB = 24;
const MAX_YEARLY_AGGREGATES_PER_CLUB = 20;
// Recent fingerprints stay directly readable. Older fingerprints move to an
// exact bucketed index; unlike a Bloom filter it cannot reject a valid payment
// because of a false positive.
const MAX_FINANCIAL_ORIGIN_INDEX = 4_096;
const FINANCIAL_ORIGIN_ARCHIVE_VERSION = 1;

export class ClubFinanceError extends Error {
  constructor(message, code, status = 409, details = undefined) {
    super(message);
    this.name = "ClubFinanceError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function integer(value, fallback = 0, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(finite(value, fallback))));
}

function positiveMoney(value, field = "amount") {
  const number = Number(value);
  const amount = Math.trunc(number);
  if (!Number.isFinite(number) || !Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MONEY) {
    throw new ClubFinanceError("Informe um valor financeiro valido", "FINANCE_AMOUNT_INVALID", 400, { field });
  }
  return amount;
}

function optionalMoney(value, fallback = 0, field = "amount") {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  const amount = Math.trunc(number);
  if (!Number.isFinite(number) || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_MONEY) {
    throw new ClubFinanceError("Informe um valor financeiro valido", "FINANCE_AMOUNT_INVALID", 400, { field });
  }
  return amount;
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new ClubFinanceError("Data financeira invalida", "FINANCE_DATE_INVALID", 400);
  }
  return date.toISOString();
}

function optionalTimestamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function positiveSeason(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.trunc(number) >= 1 ? Math.trunc(number) : null;
}

function currentSeasonFor(room) {
  return positiveSeason(
    room?.currentSeason
      ?? room?.careerState?.currentSeason
      ?? room?.clubCareerState?.currentSeason,
  ) ?? 1;
}

function seasonReferenceDate(room, fallback) {
  return optionalTimestamp(
    room?.clubCareerState?.currentDate
      ?? room?.careerState?.currentDate
      ?? room?.currentDate
      ?? fallback,
  );
}

function seasonNumberFor(room, value, occurredAt) {
  const explicit = positiveSeason(
    value?.seasonNumber
      ?? value?.season
      ?? value?.metadata?.seasonNumber
      ?? value?.metadata?.season,
  );
  if (explicit) return explicit;

  const currentSeason = currentSeasonFor(room);
  const reference = seasonReferenceDate(room, occurredAt);
  const occurrence = optionalTimestamp(occurredAt ?? value?.occurredAt ?? value?.completedAt ?? value?.createdAt);
  if (reference && occurrence) {
    const elapsedYears = new Date(reference).getUTCFullYear() - new Date(occurrence).getUTCFullYear();
    return Math.max(1, currentSeason - elapsedYears);
  }
  return currentSeason;
}

function normalizeTransactionSeason(room, value, fallbackOccurredAt) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    ...value,
    seasonNumber: seasonNumberFor(
      room,
      value,
      value.occurredAt ?? value.completedAt ?? value.createdAt ?? fallbackOccurredAt,
    ),
  };
}

function aggregatePeriodKey(value) {
  const explicit = identifier(value?.periodKey);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  const occurredAt = optionalTimestamp(value?.occurredAt ?? value?.completedAt ?? value?.createdAt);
  return occurredAt ? occurredAt.slice(0, 7) : null;
}

function normalizeCategoryTotals(value) {
  const result = {};
  for (const [category, raw] of Object.entries(plainObject(value))) {
    const key = identifier(category) || "other";
    const summary = plainObject(raw);
    result[key] = {
      income: integer(summary.income, 0, 0),
      expenses: integer(summary.expenses, 0, 0),
      count: integer(summary.count, 0, 0),
    };
  }
  return result;
}

function normalizeAggregate(value, kind) {
  const source = plainObject(value);
  const clubId = identifier(source.clubId);
  const periodKey = kind === "monthly" ? identifier(source.periodKey) : null;
  const year = kind === "yearly" ? integer(source.year, 0, 1900, 9999) : null;
  if (!clubId || (kind === "monthly" && !/^\d{4}-\d{2}$/.test(periodKey)) || (kind === "yearly" && !year)) {
    return null;
  }
  const income = integer(source.income, 0, 0);
  const expenses = integer(source.expenses, 0, 0);
  return {
    clubId,
    ...(periodKey ? { periodKey } : {}),
    ...(year ? { year } : {}),
    income,
    expenses,
    net: income - expenses,
    count: integer(source.count, 0, 0),
    byCategory: normalizeCategoryTotals(source.byCategory),
  };
}

function boundedAggregateList(values, kind) {
  const byClub = new Map();
  for (const aggregate of (Array.isArray(values) ? values : []).map((value) => normalizeAggregate(value, kind)).filter(Boolean)) {
    const key = clubKey(aggregate.clubId);
    const list = byClub.get(key) ?? [];
    list.push(aggregate);
    byClub.set(key, list);
  }
  const limit = kind === "monthly" ? MAX_MONTHLY_AGGREGATES_PER_CLUB : MAX_YEARLY_AGGREGATES_PER_CLUB;
  return [...byClub.values()].flatMap((items) => items
    .sort((left, right) => String(left.periodKey ?? left.year).localeCompare(String(right.periodKey ?? right.year)))
    .slice(-limit));
}

function emptyAggregateState() {
  return { version: FINANCIAL_AGGREGATES_VERSION, monthly: [], yearly: [], totals: [] };
}

function mergeCategoryTotals(target, source) {
  for (const [category, raw] of Object.entries(normalizeCategoryTotals(source))) {
    const summary = target[category] ?? { income: 0, expenses: 0, count: 0 };
    summary.income += raw.income;
    summary.expenses += raw.expenses;
    summary.count += raw.count;
    target[category] = summary;
  }
  return target;
}

function categoryTotalsFromTransactions(transactions) {
  const result = {};
  for (const transaction of transactions) {
    const category = identifier(transaction?.category) || "other";
    const direction = transaction?.direction === "income" ? "income" : "expenses";
    const amount = integer(transaction?.amount, 0, 0);
    const summary = result[category] ?? { income: 0, expenses: 0, count: 0 };
    summary[direction] += amount;
    summary.count += 1;
    result[category] = summary;
  }
  return result;
}

function categoryTotalsMatchAggregate(byCategory, aggregate) {
  const summary = Object.values(normalizeCategoryTotals(byCategory)).reduce((result, category) => ({
    income: result.income + category.income,
    expenses: result.expenses + category.expenses,
    count: result.count + category.count,
  }), { income: 0, expenses: 0, count: 0 });
  return summary.income === aggregate.income
    && summary.expenses === aggregate.expenses
    && summary.count === aggregate.count;
}

function backfillYearlyCategoryTotals(aggregates, transactions = []) {
  for (const yearly of aggregates.yearly) {
    if (categoryTotalsMatchAggregate(yearly.byCategory, yearly)) continue;
    const monthly = aggregates.monthly.filter((entry) => (
      clubKey(entry.clubId) === clubKey(yearly.clubId)
      && Number(entry.periodKey.slice(0, 4)) === yearly.year
    ));
    const monthlyTotals = monthly.reduce((result, entry) => {
      result.income += entry.income;
      result.expenses += entry.expenses;
      result.count += entry.count;
      mergeCategoryTotals(result.byCategory, entry.byCategory);
      return result;
    }, { income: 0, expenses: 0, count: 0, byCategory: {} });
    if (
      monthlyTotals.income === yearly.income
      && monthlyTotals.expenses === yearly.expenses
      && monthlyTotals.count === yearly.count
    ) {
      yearly.byCategory = monthlyTotals.byCategory;
      continue;
    }
    const retained = transactions.filter((transaction) => {
      const periodKey = aggregatePeriodKey(transaction);
      return clubKey(transaction?.clubId) === clubKey(yearly.clubId)
        && periodKey
        && Number(periodKey.slice(0, 4)) === yearly.year;
    });
    const retainedTotals = retained.reduce((result, transaction) => {
      const amount = integer(transaction?.amount, 0, 0);
      result[transaction?.direction === "income" ? "income" : "expenses"] += amount;
      result.count += 1;
      return result;
    }, { income: 0, expenses: 0, count: 0 });
    if (
      retainedTotals.income === yearly.income
      && retainedTotals.expenses === yearly.expenses
      && retainedTotals.count === yearly.count
    ) yearly.byCategory = categoryTotalsFromTransactions(retained);
  }
}

function normalizeFinancialAggregates(value, transactions = []) {
  const source = plainObject(value);
  const aggregates = {
    version: FINANCIAL_AGGREGATES_VERSION,
    monthly: boundedAggregateList(source.monthly, "monthly"),
    yearly: boundedAggregateList(source.yearly, "yearly"),
    totals: (Array.isArray(source.totals) ? source.totals : [])
      .map((entry) => normalizeAggregate({ ...entry, periodKey: "2000-01" }, "monthly"))
      .filter(Boolean)
      .map(({ periodKey: _periodKey, ...entry }) => entry),
  };
  backfillYearlyCategoryTotals(aggregates, transactions);
  return aggregates;
}

function aggregateFor(list, clubId, field, value, factory) {
  const club = clubKey(clubId);
  let aggregate = list.find((entry) => (
    clubKey(entry?.clubId) === club
    && (field === "clubId" ? clubKey(entry?.[field]) === clubKey(value) : entry?.[field] === value)
  ));
  if (!aggregate) {
    aggregate = factory();
    list.push(aggregate);
  }
  return aggregate;
}

function applyTransactionToAggregates(aggregates, transaction) {
  const clubId = identifier(transaction?.clubId);
  const periodKey = aggregatePeriodKey(transaction);
  const year = periodKey ? Number(periodKey.slice(0, 4)) : null;
  if (!clubId || !periodKey || !year) return;
  const direction = transaction?.direction === "income" ? "income" : "expenses";
  const amount = integer(transaction?.amount, 0, 0);
  const category = identifier(transaction?.category) || "other";
  const monthly = aggregateFor(aggregates.monthly, clubId, "periodKey", periodKey, () => ({
    clubId, periodKey, income: 0, expenses: 0, net: 0, count: 0, byCategory: {},
  }));
  const yearly = aggregateFor(aggregates.yearly, clubId, "year", year, () => ({
    clubId, year, income: 0, expenses: 0, net: 0, count: 0, byCategory: {},
  }));
  const total = aggregateFor(aggregates.totals, clubId, "clubId", clubId, () => ({
    clubId, income: 0, expenses: 0, net: 0, count: 0, byCategory: {},
  }));
  for (const aggregate of [monthly, yearly, total]) {
    aggregate[direction] += amount;
    aggregate.net = aggregate.income - aggregate.expenses;
    aggregate.count += 1;
  }
  for (const aggregate of [monthly, yearly, total]) {
    const summary = aggregate.byCategory[category] ?? { income: 0, expenses: 0, count: 0 };
    summary[direction] += amount;
    summary.count += 1;
    aggregate.byCategory[category] = summary;
  }
  aggregates.monthly = boundedAggregateList(aggregates.monthly, "monthly");
  aggregates.yearly = boundedAggregateList(aggregates.yearly, "yearly");
}

function ensureFinancialAggregates(state, transactions) {
  const stored = plainObject(state.financialAggregates);
  const isCurrent = Number(stored.version) === FINANCIAL_AGGREGATES_VERSION;
  const aggregates = isCurrent ? normalizeFinancialAggregates(stored, transactions) : emptyAggregateState();
  if (!isCurrent) {
    for (const transaction of transactions) applyTransactionToAggregates(aggregates, transaction);
  }
  state.financialAggregates = aggregates;
  return aggregates;
}

function originFingerprint(clubId, originId) {
  const club = clubKey(clubId);
  const origin = identifier(originId);
  if (!club || !origin) return null;
  return compactHash(`${club}\0${origin}`);
}

function normalizeOriginIndex(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map(identifier)
    .filter((entry) => /^[A-Za-z0-9_-]{22}$/.test(entry)))];
}

function normalizeOriginArchive(value) {
  return normalizeCompactHashIndex(value, { version: FINANCIAL_ORIGIN_ARCHIVE_VERSION });
}

function originArchiveContains(archive, fingerprint) {
  return Boolean(fingerprint) && compactHashIndexContains(
    archive,
    fingerprint,
    { version: FINANCIAL_ORIGIN_ARCHIVE_VERSION },
  );
}

function addFingerprintsToOriginArchive(archive, fingerprints) {
  return addCompactHashIndexValues(
    archive,
    fingerprints.filter(Boolean),
    { version: FINANCIAL_ORIGIN_ARCHIVE_VERSION },
  );
}

function rememberOrigin(index, clubId, originId) {
  const fingerprint = originFingerprint(clubId, originId);
  if (fingerprint) index.add(fingerprint);
}

function transactionOrigin(value, { includeId = true } = {}) {
  return identifier(
    value?.originId
      ?? value?.operationId
      ?? value?.requestId
      ?? (includeId ? value?.id : null),
  );
}

function seedOriginIndex(state, transactions, finances) {
  const remembered = normalizeOriginIndex(state.financialOriginIndex);
  let archive = normalizeOriginArchive(state.financialOriginArchive);
  if (remembered.length > MAX_FINANCIAL_ORIGIN_INDEX) {
    archive = addFingerprintsToOriginArchive(
      archive,
      remembered.slice(0, -MAX_FINANCIAL_ORIGIN_INDEX),
    );
  }
  const index = new Set(remembered.slice(-MAX_FINANCIAL_ORIGIN_INDEX));
  for (const transaction of transactions) {
    rememberOrigin(index, transaction?.clubId, transactionOrigin(transaction));
  }
  for (const finance of finances) {
    for (const entry of Array.isArray(finance?.ledger) ? finance.ledger : []) {
      // Ledgers antigos do mercado usavam `id` apenas como identificador do
      // registro. O espelho financeiro ainda precisa enriquecer esses registros
      // com categoria, contraparte e temporada antes de considerar a operacao
      // completamente processada.
      rememberOrigin(
        index,
        entry?.clubId ?? finance?.clubId,
        transactionOrigin(entry, { includeId: false }),
      );
    }
  }
  const all = [...index];
  if (all.length > MAX_FINANCIAL_ORIGIN_INDEX) {
    archive = addFingerprintsToOriginArchive(archive, all.slice(0, -MAX_FINANCIAL_ORIGIN_INDEX));
  }
  state.financialOriginArchive = archive;
  delete state.financialOriginBloom;
  state.financialOriginIndex = all.slice(-MAX_FINANCIAL_ORIGIN_INDEX);
}

function rememberFinancialOrigin(state, clubId, originId) {
  const fingerprint = originFingerprint(clubId, originId);
  if (
    !fingerprint
    || state.financialOriginIndex.includes(fingerprint)
    || originArchiveContains(state.financialOriginArchive, fingerprint)
  ) return;
  state.financialOriginIndex.push(fingerprint);
  if (state.financialOriginIndex.length > MAX_FINANCIAL_ORIGIN_INDEX) {
    const pruned = state.financialOriginIndex.slice(0, -MAX_FINANCIAL_ORIGIN_INDEX);
    state.financialOriginArchive = addFingerprintsToOriginArchive(state.financialOriginArchive, pruned);
    state.financialOriginIndex = state.financialOriginIndex.slice(-MAX_FINANCIAL_ORIGIN_INDEX);
  }
}

function hasFinancialOrigin(state, clubId, originId) {
  const fingerprint = originFingerprint(clubId, originId);
  return Boolean(
    fingerprint
    && (
      state.financialOriginIndex.includes(fingerprint)
      || originArchiveContains(state.financialOriginArchive, fingerprint)
    )
  );
}

function restoreRoom(room, snapshot) {
  for (const key of Object.keys(room)) delete room[key];
  Object.assign(room, snapshot);
}

function catalogClub(room, clubId) {
  const target = clubKey(clubId);
  for (const competition of room?.competitionCatalog ?? []) {
    const club = (competition?.clubs ?? []).find((candidate) => clubKey(candidate?.id) === target);
    if (club) return club;
  }
  return null;
}

function openingBalanceFor(room, clubId, explicitBalance) {
  if (explicitBalance !== undefined && explicitBalance !== null) {
    return optionalMoney(explicitBalance, 0, "openingBalance");
  }
  const club = catalogClub(room, clubId);
  const configured = integer(club?.budget, 0, 0, MAX_MONEY);
  if (configured > 0) return configured;
  const reputation = integer(club?.reputation, 10, 1, 20);
  return Math.min(MAX_MONEY, Math.max(20_000_000, reputation * 8_000_000));
}

function normalizeReservation(value) {
  const id = identifier(value?.id ?? value?.reservationId ?? value?.operationId);
  if (!id) return null;
  return {
    ...plainObject(value),
    id,
    amount: integer(value?.amount, 0, 0, MAX_MONEY),
    status: value?.status === "released" ? "released" : "active",
    createdAt: optionalTimestamp(value?.createdAt),
    releasedAt: optionalTimestamp(value?.releasedAt),
  };
}

function boundedReservations(values) {
  const normalized = (Array.isArray(values) ? values : []).map(normalizeReservation).filter(Boolean);
  const active = normalized.filter((reservation) => reservation.status === "active");
  const released = normalized.filter((reservation) => reservation.status !== "active");
  const releasedLimit = Math.max(0, MAX_RESERVATIONS_PER_CLUB - active.length);
  return [...released.slice(-releasedLimit), ...active];
}

function normalizeProfile(value, clubId) {
  const source = plainObject(value);
  const sponsor = plainObject(source.sponsor);
  const broadcastRights = plainObject(source.broadcastRights);
  const sponsors = (Array.isArray(source.sponsors) ? source.sponsors : []).flatMap((entry) => {
    const contract = plainObject(entry);
    const name = identifier(contract.name);
    const annualValue = integer(contract.annualValue, 0, 0, MAX_MONEY);
    if (!name || annualValue <= 0) return [];
    return [{
      ...contract,
      id: identifier(contract.id) || `sponsor:${identifier(clubId)}:${name}`,
      name,
      annualValue,
      startsAt: optionalTimestamp(contract.startsAt),
      endsAt: optionalTimestamp(contract.endsAt),
      status: identifier(contract.status).toLocaleLowerCase("pt-BR") === "ended" ? "ended" : "active",
    }];
  });
  return {
    ...source,
    clubId: identifier(clubId),
    transferBudget: integer(source.transferBudget, 0, 0, MAX_MONEY),
    wageBudget: integer(source.wageBudget, 0, 0, MAX_MONEY),
    debts: integer(source.debts, 0, 0, MAX_MONEY),
    debtMonthlyPayment: integer(source.debtMonthlyPayment, 0, 0, MAX_MONEY),
    maintenanceMonthly: integer(source.maintenanceMonthly, 0, 0, MAX_MONEY),
    broadcastRights: {
      ...broadcastRights,
      monthlyAmount: integer(broadcastRights.monthlyAmount, 0, 0, MAX_MONEY),
      startsAt: optionalTimestamp(broadcastRights.startsAt),
      endsAt: optionalTimestamp(broadcastRights.endsAt),
    },
    sponsors,
    sponsor: {
      ...sponsor,
      name: identifier(sponsor.name) || null,
      monthlyAmount: integer(sponsor.monthlyAmount, 0, 0, MAX_MONEY),
      startsAt: optionalTimestamp(sponsor.startsAt),
      endsAt: optionalTimestamp(sponsor.endsAt),
    },
    reservations: boundedReservations(source.reservations),
  };
}

function activeDuring(contract, occurredAt) {
  const time = new Date(occurredAt).getTime();
  if (!Number.isFinite(time)) return false;
  const startsAt = optionalTimestamp(contract?.startsAt);
  const endsAt = optionalTimestamp(contract?.endsAt);
  return (!startsAt || time >= new Date(startsAt).getTime())
    && (!endsAt || time <= new Date(endsAt).getTime());
}

function activeSponsorFor(profile, occurredAt) {
  return (profile.sponsors ?? []).find((contract) => (
    contract.status === "active" && activeDuring(contract, occurredAt)
  ));
}

function sponsorIncomeFor(profile, occurredAt) {
  const active = activeSponsorFor(profile, occurredAt);
  if (active) return Math.floor(active.annualValue / 12);
  return activeDuring(profile.sponsor, occurredAt) ? profile.sponsor.monthlyAmount : 0;
}

function broadcastIncomeFor(profile, occurredAt) {
  return activeDuring(profile.broadcastRights, occurredAt)
    ? integer(profile.broadcastRights?.monthlyAmount, 0, 0, MAX_MONEY)
    : 0;
}

function profileFor(state, clubId, create = true) {
  const target = clubKey(clubId);
  let profile = state.financeProfiles.find((candidate) => clubKey(candidate?.clubId) === target);
  if (!profile && create) {
    profile = normalizeProfile(null, clubId);
    state.financeProfiles.push(profile);
  }
  return profile ?? null;
}

function accountFromMarketState(marketState, clubId) {
  const target = clubKey(clubId);
  return marketState.finances.find((candidate) => clubKey(candidate?.clubId) === target) ?? null;
}

function assertRoom(room) {
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    throw new ClubFinanceError("Save financeiro indisponivel", "FINANCE_ROOM_REQUIRED", 400);
  }
}

function assertClubId(clubId) {
  const normalized = identifier(clubId);
  if (!normalized) throw new ClubFinanceError("Clube obrigatorio", "FINANCE_CLUB_REQUIRED", 400);
  return normalized;
}

function ensureCanonicalMarketState(room, now) {
  if (room.marketState?.version === 1 && Array.isArray(room.marketState.finances)) {
    return room.marketState;
  }
  return ensureMarketState(room, now);
}

export function ensureClubFinanceState(room, now = new Date()) {
  assertRoom(room);
  const state = plainObject(room.clubCareerState);
  room.clubCareerState = state;
  const rawTransactions = Array.isArray(state.financialTransactions) ? state.financialTransactions : [];
  const rawFinances = Array.isArray(room.marketState?.finances) ? room.marketState.finances : [];
  seedOriginIndex(state, rawTransactions, rawFinances);
  ensureCanonicalMarketState(room, now);
  state.version = Math.max(1, integer(state.version, 1, 1));
  state.financialTransactions = rawTransactions
    .map((transaction) => normalizeTransactionSeason(room, transaction, now))
    .filter(Boolean)
    .slice(-MAX_FINANCIAL_TRANSACTIONS);
  ensureFinancialAggregates(state, state.financialTransactions);
  state.financeProfiles = Array.isArray(state.financeProfiles)
    ? state.financeProfiles.map((profile) => normalizeProfile(profile, profile?.clubId)).filter((profile) => profile.clubId)
    : [];
  state.lastFinancialPeriodByClub = plainObject(state.lastFinancialPeriodByClub);
  return state;
}

export function ensureFinanceAccount(room, clubId, { openingBalance, now = new Date() } = {}) {
  const normalizedClubId = assertClubId(clubId);
  const state = ensureClubFinanceState(room, now);
  let account = accountFromMarketState(room.marketState, normalizedClubId);
  if (!account) {
    account = {
      clubId: normalizedClubId,
      balance: openingBalanceFor(room, normalizedClubId, openingBalance),
      committed: 0,
      ledger: [],
    };
    room.marketState.finances.push(account);
  }
  account.balance = integer(account.balance, openingBalanceFor(room, normalizedClubId), 0, MAX_MONEY);
  account.committed = integer(account.committed, 0, 0, account.balance);
  account.ledger = (Array.isArray(account.ledger) ? account.ledger : [])
    .map((entry) => normalizeTransactionSeason(room, entry, now))
    .filter(Boolean)
    .slice(-MAX_ACCOUNT_LEDGER);
  const limitsProfile = ensurePersistentFinanceLimits(room, account.clubId, {
    balance: account.balance,
    currentPayroll: calculateClubMonthlyPayroll(room, account.clubId).amount,
  });
  const limitsIndex = state.financeProfiles.indexOf(limitsProfile);
  if (limitsIndex >= 0) {
    state.financeProfiles[limitsIndex] = normalizeProfile(limitsProfile, account.clubId);
  }
  profileFor(state, account.clubId, true);
  return account;
}

export function getFinanceAccount(room, clubId, { create = false, now = new Date() } = {}) {
  const normalizedClubId = assertClubId(clubId);
  if (create) return ensureFinanceAccount(room, normalizedClubId, { now });
  assertRoom(room);
  ensureCanonicalMarketState(room, now);
  return accountFromMarketState(room.marketState, normalizedClubId);
}

export function getFinanceProfile(room, clubId, { create = true, now = new Date() } = {}) {
  const normalizedClubId = assertClubId(clubId);
  const state = ensureClubFinanceState(room, now);
  if (create) ensureFinanceAccount(room, normalizedClubId, { now });
  return profileFor(state, normalizedClubId, create);
}

export function availableBalance(account) {
  return Math.max(0, integer(account?.balance, 0, 0, MAX_MONEY) - integer(account?.committed, 0, 0, MAX_MONEY));
}

function directionFor(value) {
  const normalized = identifier(value).toLocaleLowerCase("pt-BR");
  if (["income", "credit", "receita", "entrada"].includes(normalized)) return "income";
  if (["expense", "debit", "despesa", "saida", "saída"].includes(normalized)) return "expense";
  throw new ClubFinanceError("Tipo de lancamento invalido", "FINANCE_DIRECTION_INVALID", 400);
}

function originIdFor(input) {
  const originId = identifier(input?.originId ?? input?.operationId ?? input?.requestId ?? input?.id);
  if (!originId) {
    throw new ClubFinanceError(
      "Lancamento exige originId ou operationId",
      "FINANCE_ORIGIN_REQUIRED",
      400,
    );
  }
  return originId;
}

function existingTransaction(state, account, clubId, originId) {
  const club = clubKey(clubId);
  const origin = identifier(originId);
  return state.financialTransactions.find((transaction) => (
    clubKey(transaction?.clubId) === club && identifier(transaction?.originId) === origin
  )) ?? account.ledger.find((transaction) => (
    identifier(transaction?.originId ?? transaction?.operationId) === origin
  )) ?? (hasFinancialOrigin(state, clubId, originId) ? {
    id: `${clubId}:${originId}`,
    originId,
    operationId: originId,
    clubId,
    status: "completed",
    compacted: true,
  } : null);
}

function compactLedgerEntry(transaction) {
  return {
    id: transaction.id,
    originId: transaction.originId,
    operationId: transaction.originId,
    type: transaction.direction,
    direction: transaction.direction,
    category: transaction.category,
    amount: transaction.amount,
    signedAmount: transaction.signedAmount,
    completedAt: transaction.occurredAt,
    occurredAt: transaction.occurredAt,
    description: transaction.description,
    source: transaction.source,
    periodKey: transaction.periodKey,
    relatedClubId: transaction.relatedClubId,
    playerId: transaction.playerId,
    matchId: transaction.matchId,
    projectId: transaction.projectId,
    balanceAfter: transaction.balanceAfter,
    seasonNumber: transaction.seasonNumber,
  };
}

export function postFinancialTransaction(room, input = {}) {
  const clubId = assertClubId(input.clubId);
  const originId = originIdFor(input);
  const direction = directionFor(input.direction ?? input.type);
  const amount = positiveMoney(input.amount);
  const occurredAt = timestamp(input.occurredAt ?? input.completedAt ?? input.now ?? new Date());
  const state = ensureClubFinanceState(room, occurredAt);
  const account = ensureFinanceAccount(room, clubId, { now: occurredAt });
  const previous = existingTransaction(state, account, clubId, originId);
  if (previous) {
    return { transaction: clone(previous), account, applied: false, duplicate: true };
  }

  const balanceBefore = integer(account.balance, 0, 0, MAX_MONEY);
  if (direction === "expense" && availableBalance(account) < amount) {
    throw new ClubFinanceError("Orcamento insuficiente", "FINANCE_BUDGET_INSUFFICIENT", 409, {
      clubId,
      amount,
      available: availableBalance(account),
    });
  }
  if (direction === "income" && balanceBefore + amount > MAX_MONEY) {
    throw new ClubFinanceError("Saldo excede limite permitido", "FINANCE_BALANCE_LIMIT", 409, { clubId });
  }

  const balanceAfter = direction === "income" ? balanceBefore + amount : balanceBefore - amount;
  const relatedClubId = identifier(input.relatedClubId ?? input.counterpartyClubId) || null;
  const seasonNumber = seasonNumberFor(room, input, occurredAt);
  const transaction = {
    id: identifier(input.id) || `${clubId}:${originId}`,
    originId,
    operationId: originId,
    clubId,
    direction,
    type: direction,
    category: identifier(input.category) || "other",
    amount,
    signedAmount: direction === "income" ? amount : -amount,
    description: identifier(input.description) || null,
    source: identifier(input.source) || "club-finance",
    status: "completed",
    occurredAt,
    completedAt: occurredAt,
    periodKey: identifier(input.periodKey) || null,
    relatedClubId,
    counterpartyClubId: relatedClubId,
    playerId: identifier(input.playerId) || null,
    contractId: identifier(input.contractId) || null,
    competitionId: identifier(input.competitionId) || null,
    matchId: identifier(input.matchId ?? input.fixtureId) || null,
    projectId: identifier(input.projectId) || null,
    metadata: clone(plainObject(input.metadata)),
    balanceBefore,
    balanceAfter,
    seasonNumber,
    createdAt: timestamp(input.createdAt ?? occurredAt),
  };

  account.balance = balanceAfter;
  rememberFinancialOrigin(state, clubId, originId);
  account.ledger.push(compactLedgerEntry(transaction));
  account.ledger = account.ledger.slice(-MAX_ACCOUNT_LEDGER);
  state.financialTransactions.push(transaction);
  applyTransactionToAggregates(state.financialAggregates, transaction);
  state.financialTransactions = state.financialTransactions.slice(-MAX_FINANCIAL_TRANSACTIONS);
  room.marketState.updatedAt = occurredAt;
  return { transaction: clone(transaction), account, applied: true, duplicate: false };
}

// Registra detalhes de uma operacao que ja alterou a conta canonica em outro
// dominio transacional (ex.: mercado). Nao movimenta o saldo pela segunda vez.
export function mirrorSettledFinancialTransaction(room, input = {}) {
  const clubId = assertClubId(input.clubId);
  const originId = originIdFor(input);
  const direction = directionFor(input.direction ?? input.type);
  const amount = positiveMoney(input.amount);
  const occurredAt = timestamp(input.occurredAt ?? input.completedAt ?? input.now ?? new Date());
  const state = ensureClubFinanceState(room, occurredAt);
  const account = ensureFinanceAccount(room, clubId, { now: occurredAt });
  const previous = existingTransaction(state, account, clubId, originId);
  if (previous) return { transaction: clone(previous), account, applied: false, duplicate: true };
  const relatedClubId = identifier(input.relatedClubId ?? input.counterpartyClubId) || null;
  const balanceAfter = integer(account.balance, 0, 0, MAX_MONEY);
  const seasonNumber = seasonNumberFor(room, input, occurredAt);
  const transaction = {
    id: identifier(input.id) || `${clubId}:${originId}`,
    originId,
    operationId: originId,
    clubId,
    direction,
    type: direction,
    category: identifier(input.category) || "other",
    amount,
    signedAmount: direction === "income" ? amount : -amount,
    description: identifier(input.description) || null,
    source: identifier(input.source) || "external-settlement",
    status: "completed",
    occurredAt,
    completedAt: occurredAt,
    periodKey: identifier(input.periodKey) || null,
    relatedClubId,
    counterpartyClubId: relatedClubId,
    playerId: identifier(input.playerId) || null,
    contractId: identifier(input.contractId) || null,
    competitionId: identifier(input.competitionId) || null,
    matchId: identifier(input.matchId ?? input.fixtureId) || null,
    projectId: identifier(input.projectId) || null,
    metadata: { ...clone(plainObject(input.metadata)), settledExternally: true },
    balanceBefore: null,
    balanceAfter,
    seasonNumber,
    createdAt: timestamp(input.createdAt ?? occurredAt),
  };
  rememberFinancialOrigin(state, clubId, originId);
  state.financialTransactions.push(transaction);
  applyTransactionToAggregates(state.financialAggregates, transaction);
  state.financialTransactions = state.financialTransactions.slice(-MAX_FINANCIAL_TRANSACTIONS);
  return { transaction: clone(transaction), account, applied: true, duplicate: false };
}

export function creditFinance(room, input = {}) {
  return postFinancialTransaction(room, { ...input, direction: "income" });
}

export function debitFinance(room, input = {}) {
  return postFinancialTransaction(room, { ...input, direction: "expense" });
}

function reservationIdFor(input) {
  const id = identifier(input?.reservationId ?? input?.operationId ?? input?.originId ?? input?.id);
  if (!id) {
    throw new ClubFinanceError("Reserva exige reservationId ou operationId", "FINANCE_RESERVATION_ID_REQUIRED", 400);
  }
  return id;
}

export function reserveFinance(room, input = {}) {
  const clubId = assertClubId(input.clubId);
  const reservationId = reservationIdFor(input);
  const amount = positiveMoney(input.amount);
  const createdAt = timestamp(input.createdAt ?? input.occurredAt ?? input.now ?? new Date());
  const state = ensureClubFinanceState(room, createdAt);
  const account = ensureFinanceAccount(room, clubId, { now: createdAt });
  const profile = profileFor(state, clubId, true);
  const previous = profile.reservations.find((reservation) => reservation.id === reservationId);
  if (previous) {
    return { reservation: clone(previous), account, applied: false, duplicate: true };
  }
  if (availableBalance(account) < amount) {
    throw new ClubFinanceError("Orcamento insuficiente", "FINANCE_BUDGET_INSUFFICIENT", 409, {
      clubId,
      amount,
      available: availableBalance(account),
    });
  }
  const reservation = {
    id: reservationId,
    clubId,
    amount,
    category: identifier(input.category) || "other",
    description: identifier(input.description) || null,
    relatedClubId: identifier(input.relatedClubId ?? input.counterpartyClubId) || null,
    metadata: clone(plainObject(input.metadata)),
    status: "active",
    createdAt,
    releasedAt: null,
  };
  account.committed += amount;
  profile.reservations.push(reservation);
  profile.reservations = boundedReservations(profile.reservations);
  room.marketState.updatedAt = createdAt;
  return { reservation: clone(reservation), account, applied: true, duplicate: false };
}

export function releaseFinance(room, input = {}) {
  const clubId = assertClubId(input.clubId);
  const reservationId = reservationIdFor(input);
  const releasedAt = timestamp(input.releasedAt ?? input.occurredAt ?? input.now ?? new Date());
  const state = ensureClubFinanceState(room, releasedAt);
  const account = ensureFinanceAccount(room, clubId, { now: releasedAt });
  const profile = profileFor(state, clubId, true);
  const reservation = profile.reservations.find((candidate) => candidate.id === reservationId);
  if (!reservation) {
    throw new ClubFinanceError("Reserva financeira nao encontrada", "FINANCE_RESERVATION_NOT_FOUND", 404, {
      clubId,
      reservationId,
    });
  }
  if (reservation.status === "released") {
    return { reservation: clone(reservation), account, applied: false, duplicate: true };
  }
  const amount = Math.min(integer(reservation.amount, 0, 0, MAX_MONEY), integer(account.committed, 0, 0, MAX_MONEY));
  account.committed -= amount;
  reservation.status = "released";
  reservation.releasedAt = releasedAt;
  reservation.releaseReason = identifier(input.reason) || null;
  room.marketState.updatedAt = releasedAt;
  return { reservation: clone(reservation), account, releasedAmount: amount, applied: true, duplicate: false };
}

function dateWithin(value, from, to) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return false;
  if (from && time < new Date(from).getTime()) return false;
  if (to && time > new Date(to).getTime()) return false;
  return true;
}

export function aggregateCashflow(room, {
  clubId,
  from = null,
  to = null,
  periodKey = null,
} = {}) {
  const normalizedClubId = assertClubId(clubId);
  const state = ensureClubFinanceState(room);
  if (from) timestamp(from);
  if (to) timestamp(to);
  const wantedPeriod = identifier(periodKey);
  const transactions = state.financialTransactions.filter((transaction) => (
    clubKey(transaction?.clubId) === clubKey(normalizedClubId)
    && (!wantedPeriod || identifier(transaction?.periodKey) === wantedPeriod)
    && dateWithin(transaction?.occurredAt, from, to)
  ));
  const categories = new Map();
  const periods = new Map();
  let income = 0;
  let expenses = 0;
  for (const transaction of transactions) {
    const amount = integer(transaction.amount, 0, 0, MAX_MONEY);
    if (transaction.direction === "income") income += amount;
    else expenses += amount;
    const category = identifier(transaction.category) || "other";
    const categorySummary = categories.get(category) ?? { category, income: 0, expenses: 0, net: 0, count: 0 };
    categorySummary[transaction.direction === "income" ? "income" : "expenses"] += amount;
    categorySummary.net += transaction.direction === "income" ? amount : -amount;
    categorySummary.count += 1;
    categories.set(category, categorySummary);
    const period = identifier(transaction.periodKey) || identifier(transaction.occurredAt).slice(0, 7) || "unknown";
    const periodSummary = periods.get(period) ?? { periodKey: period, income: 0, expenses: 0, net: 0, count: 0 };
    periodSummary[transaction.direction === "income" ? "income" : "expenses"] += amount;
    periodSummary.net += transaction.direction === "income" ? amount : -amount;
    periodSummary.count += 1;
    periods.set(period, periodSummary);
  }
  return {
    clubId: normalizedClubId,
    income,
    expenses,
    net: income - expenses,
    count: transactions.length,
    byCategory: [...categories.values()].sort((left, right) => left.category.localeCompare(right.category, "pt-BR")),
    byPeriod: [...periods.values()].sort((left, right) => left.periodKey.localeCompare(right.periodKey, "pt-BR")),
    transactions: clone(transactions),
  };
}

export function getFinancialAggregates(room, clubId) {
  const normalizedClubId = assertClubId(clubId);
  const state = ensureClubFinanceState(room);
  const target = clubKey(normalizedClubId);
  const aggregates = state.financialAggregates;
  return clone({
    version: aggregates.version,
    clubId: normalizedClubId,
    monthly: aggregates.monthly.filter((entry) => clubKey(entry?.clubId) === target),
    yearly: aggregates.yearly.filter((entry) => clubKey(entry?.clubId) === target),
    total: aggregates.totals.find((entry) => clubKey(entry?.clubId) === target) ?? {
      clubId: normalizedClubId,
      income: 0,
      expenses: 0,
      net: 0,
      count: 0,
      byCategory: {},
    },
  });
}

export function calculateMonthlyPayroll(room, clubId, players = undefined) {
  const payroll = calculateClubMonthlyPayroll(room, clubId, players);
  return { amount: payroll.amount, paidPlayers: payroll.paidPlayers };
}

export function calculateMonthlyMaintenance(room, clubId) {
  const target = clubKey(assertClubId(clubId));
  const facility = (room?.clubCareerState?.clubFacilities ?? []).find((candidate) => (
    clubKey(candidate?.clubId) === target
  ));
  if (!facility) return 0;
  const stadium = optionalMoney(facility?.stadium?.maintenanceCost, 0, "stadium.maintenanceCost");
  const areas = (Array.isArray(facility?.areas) ? facility.areas : []).reduce((sum, area) => (
    sum + optionalMoney(area?.maintenanceCost, 0, "area.maintenanceCost")
  ), 0);
  return Math.min(MAX_MONEY, stadium + areas);
}

function transactionsForPeriod(state, clubId, periodKey) {
  return state.financialTransactions.filter((transaction) => (
    clubKey(transaction?.clubId) === clubKey(clubId)
    && identifier(transaction?.periodKey) === identifier(periodKey)
    && identifier(transaction?.source) === "monthly-finance"
  ));
}

export function processMonthlyClubFinance(room, input = {}) {
  const clubId = assertClubId(input.clubId);
  const periodKey = identifier(input.periodKey);
  if (!periodKey) throw new ClubFinanceError("Periodo financeiro obrigatorio", "FINANCE_PERIOD_REQUIRED", 400);
  const occurredAt = timestamp(input.occurredAt ?? input.now ?? new Date());
  const before = clone(room);
  try {
    const state = ensureClubFinanceState(room, occurredAt);
    const account = ensureFinanceAccount(room, clubId, { now: occurredAt });
    const profile = profileFor(state, clubId, true);
    const key = clubKey(clubId);
    if (identifier(state.lastFinancialPeriodByClub[key]) === periodKey) {
      return {
        clubId,
        periodKey,
        transactions: clone(transactionsForPeriod(state, clubId, periodKey)),
        account,
        applied: false,
        duplicate: true,
      };
    }

    const payroll = input.payroll === undefined
      ? calculateMonthlyPayroll(room, clubId, input.players)
      : { amount: optionalMoney(input.payroll, 0, "payroll"), paidPlayers: integer(input.paidPlayers, 0) };
    const defaultMaintenance = profile.maintenanceMonthly || calculateMonthlyMaintenance(room, clubId);
    const maintenance = optionalMoney(input.maintenance, defaultMaintenance, "maintenance");
    const baseSponsorIncome = optionalMoney(
      input.sponsorIncome,
      sponsorIncomeFor(profile, occurredAt),
      "sponsorIncome",
    );
    const sponsorBonus = baseSponsorIncome > 0
      ? optionalMoney(input.sponsorBonus, 0, "sponsorBonus")
      : 0;
    const sponsorIncome = Math.min(MAX_MONEY, baseSponsorIncome + sponsorBonus);
    const broadcastIncome = optionalMoney(
      input.broadcastIncome,
      broadcastIncomeFor(profile, occurredAt),
      "broadcastIncome",
    );
    const debtPayment = Math.min(
      profile.debts,
      optionalMoney(input.debtPayment, profile.debtMonthlyPayment, "debtPayment"),
    );
    if (input.maintenance !== undefined) profile.maintenanceMonthly = maintenance;
    if (input.sponsorIncome !== undefined) profile.sponsor.monthlyAmount = baseSponsorIncome;
    if (input.broadcastIncome !== undefined) profile.broadcastRights.monthlyAmount = broadcastIncome;
    if (input.debtPayment !== undefined) profile.debtMonthlyPayment = debtPayment;

    if (availableBalance(account) + sponsorIncome + broadcastIncome < payroll.amount + maintenance + debtPayment) {
      throw new ClubFinanceError("Orcamento insuficiente para fechar o mes", "FINANCE_MONTHLY_BUDGET_INSUFFICIENT", 409, {
        clubId,
        periodKey,
        available: availableBalance(account),
        sponsorIncome,
        broadcastIncome,
        debtPayment,
        payroll: payroll.amount,
        maintenance,
      });
    }

    const results = [];
    if (sponsorIncome > 0) {
      results.push(creditFinance(room, {
        clubId,
        amount: sponsorIncome,
        originId: `monthly:${clubId}:${periodKey}:sponsor`,
        category: "sponsorship",
        description: identifier(input.sponsorDescription) || `Patrocinio de ${periodKey}`,
        source: "monthly-finance",
        periodKey,
        occurredAt,
        metadata: {
          sponsorName: activeSponsorFor(profile, occurredAt)?.name
            ?? profile.sponsor.name,
          baseSponsorIncome,
          sponsorBonus,
          ...plainObject(input.sponsorMetadata),
        },
      }));
    }
    if (broadcastIncome > 0) {
      results.push(creditFinance(room, {
        clubId,
        amount: broadcastIncome,
        originId: `monthly:${clubId}:${periodKey}:broadcast`,
        category: "broadcast_rights",
        description: `Direitos de transmissão de ${periodKey}`,
        source: "monthly-finance",
        periodKey,
        occurredAt,
      }));
    }
    if (payroll.amount > 0) {
      results.push(debitFinance(room, {
        clubId,
        amount: payroll.amount,
        originId: `monthly:${clubId}:${periodKey}:payroll`,
        category: "payroll",
        description: `Folha salarial de ${periodKey}`,
        source: "monthly-finance",
        periodKey,
        occurredAt,
        metadata: { paidPlayers: payroll.paidPlayers, ...plainObject(input.payrollMetadata) },
      }));
    }
    if (maintenance > 0) {
      results.push(debitFinance(room, {
        clubId,
        amount: maintenance,
        originId: `monthly:${clubId}:${periodKey}:maintenance`,
        category: "maintenance",
        description: `Manutencao de ${periodKey}`,
        source: "monthly-finance",
        periodKey,
        occurredAt,
        metadata: clone(plainObject(input.maintenanceMetadata)),
      }));
    }
    if (debtPayment > 0) {
      results.push(debitFinance(room, {
        clubId,
        amount: debtPayment,
        originId: `monthly:${clubId}:${periodKey}:debt`,
        category: "debt_payment",
        description: `Pagamento de dívida de ${periodKey}`,
        source: "monthly-finance",
        periodKey,
        occurredAt,
      }));
      // Posting a transaction normalizes finance profiles and replaces their
      // object references. Re-read the canonical profile before mutating debt.
      const currentProfile = profileFor(ensureClubFinanceState(room, occurredAt), clubId, true);
      currentProfile.debts = Math.max(0, currentProfile.debts - debtPayment);
    }
    state.lastFinancialPeriodByClub[key] = periodKey;
    return {
      clubId,
      periodKey,
      payroll,
      maintenance,
      sponsorIncome,
      sponsorBonus,
      broadcastIncome,
      debtPayment,
      transactions: results.map((result) => result.transaction),
      account,
      applied: true,
      duplicate: false,
    };
  } catch (error) {
    restoreRoom(room, before);
    throw error;
  }
}

// Concise aliases keep integration callbacks independent from storage naming.
export const ensureAccount = ensureFinanceAccount;
export const getAccount = getFinanceAccount;
export const postTransaction = postFinancialTransaction;
export const credit = creditFinance;
export const debit = debitFinance;
export const reserve = reserveFinance;
export const release = releaseFinance;
export const processMonthlyFinance = processMonthlyClubFinance;
