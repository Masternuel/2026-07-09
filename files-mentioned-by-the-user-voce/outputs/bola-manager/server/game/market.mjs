import { randomUUID } from "node:crypto";
import {
  adjustPersistentTransferBudget,
  ensurePersistentFinanceLimits,
} from "./financeLimits.mjs";
import { calculateClubMonthlyPayroll } from "./payroll.mjs";
import { calculateStaffEffects } from "./staffEngine.mjs";

const MAX_MONEY = 2_000_000_000;
const MAX_OFFERS = 100;
const MAX_LISTINGS = 50;
const MAX_TRANSACTIONS = 100;
const MAX_ACTIVITY = 100;
const MAX_REQUESTS = 200;
const MAX_CANDIDATES = 500;
const MAX_ACTIVE_OFFERS_PER_MANAGER = 20;
const MAX_CAREER_HISTORY = 500;
const MAX_SQUAD_SIZE = 60;
const MAX_AI_TRANSFER_TICKS = 500;
const MAX_AI_MARKET_HISTORY = 100;
const MAX_AI_NEGOTIATION_STEPS = 8;
const MAX_AI_AUCTION_BIDS = 12;
const AI_TRANSFER_INTERVAL_ROUNDS = 4;
const AI_MIN_SQUAD_AFTER_TRANSFER = 18;
const AI_STRATEGY_VERSION = 3;
const DEFAULT_CONTRACT_SEASONS = 3;
const FREE_AGENT_CLUB_ID = "__FREE_AGENT__";

function identifier(value) {
  return String(value ?? "").trim();
}

function identifierKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function identifiersEqual(left, right) {
  return identifierKey(left) === identifierKey(right);
}

function clubKey(value) {
  return identifierKey(value);
}

function integer(value, fallback = 0, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(0, Math.trunc(number)))
    : fallback;
}

function money(value, field = "amount") {
  const normalized = integer(value, -1, MAX_MONEY);
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new MarketError("Informe um valor valido", "MARKET_AMOUNT_INVALID", 400, { field });
  }
  return normalized;
}

function restoreRoom(room, snapshot) {
  for (const key of Object.keys(room)) delete room[key];
  Object.assign(room, snapshot);
}

function withRoomRollback(room, operation) {
  const before = structuredClone(room);
  try {
    return operation();
  } catch (error) {
    restoreRoom(room, before);
    throw error;
  }
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function isExpired(expiresAt, now = new Date()) {
  const expiresAtMs = new Date(expiresAt).getTime();
  const nowMs = new Date(now).getTime();
  return !Number.isFinite(expiresAtMs) || !Number.isFinite(nowMs) || expiresAtMs <= nowMs;
}

function managerFor(room, managerId) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === managerId);
  if (!manager) throw new MarketError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
  if (!manager.clubId) throw new MarketError("Escolha um clube antes de usar o mercado", "CLUB_REQUIRED", 409);
  return manager;
}

function clubFor(room, clubId) {
  const key = clubKey(clubId);
  for (const league of room.competitionCatalog ?? []) {
    const club = (league.clubs ?? []).find((candidate) => clubKey(candidate?.id) === key);
    if (club) return club;
  }
  return null;
}

function clubName(room, clubId) {
  if (clubKey(clubId) === clubKey(FREE_AGENT_CLUB_ID)) return "Agente livre";
  return clubFor(room, clubId)?.name || identifier(clubId);
}

function managerForClub(room, clubId) {
  const key = clubKey(clubId);
  return (room.managers ?? []).find((manager) => clubKey(manager.clubId) === key) ?? null;
}

function defaultBalance(room, clubId) {
  const club = clubFor(room, clubId);
  const configured = integer(club?.budget, 0, MAX_MONEY);
  if (configured > 0) return configured;
  const reputation = Math.max(1, Math.min(20, integer(club?.reputation, 10, 20)));
  return Math.min(MAX_MONEY, Math.max(20_000_000, reputation * 8_000_000));
}

function normalizeFinance(value, room, clubId) {
  const balance = integer(value?.balance, defaultBalance(room, clubId), MAX_MONEY);
  return {
    clubId: identifier(clubId),
    balance,
    committed: Math.min(balance, integer(value?.committed, 0, MAX_MONEY)),
    ledger: Array.isArray(value?.ledger) ? value.ledger.slice(-MAX_TRANSACTIONS) : [],
  };
}

function financeFor(state, room, clubId, create = true) {
  const key = clubKey(clubId);
  let finance = state.finances.find((candidate) => clubKey(candidate?.clubId) === key);
  if (!finance && create) {
    finance = normalizeFinance(null, room, clubId);
    state.finances.push(finance);
  }
  if (finance) {
    ensurePersistentFinanceLimits(room, clubId, {
      balance: finance.balance,
      currentPayroll: calculateClubMonthlyPayroll(room, clubId).amount,
    });
  }
  return finance ?? null;
}

function availableFinance(finance) {
  return Math.max(0, integer(finance?.balance) - integer(finance?.committed));
}

function financeLimitsFor(state, room, clubId) {
  const finance = financeFor(state, room, clubId);
  const payroll = calculateClubMonthlyPayroll(room, clubId);
  const profile = ensurePersistentFinanceLimits(room, clubId, {
    balance: finance?.balance,
    currentPayroll: payroll.amount,
  });
  return { finance, payroll, profile };
}

function availableTransferFinance(state, room, clubId) {
  const { finance, profile } = financeLimitsFor(state, room, clubId);
  const allocated = Math.max(0, integer(profile?.transferBudget, 0, MAX_MONEY) - integer(finance?.committed));
  return Math.min(availableFinance(finance), allocated);
}

function aiClubFinancialContext(room, state, clubId) {
  const { finance, payroll, profile } = financeLimitsFor(state, room, clubId);
  const allocated = Math.max(
    0,
    integer(profile?.transferBudget, 0, MAX_MONEY) - integer(finance?.committed),
  );
  return {
    finance,
    payroll,
    profile,
    availableBudget: Math.min(availableFinance(finance), allocated),
  };
}

function reserveTransfer(state, room, clubId, amount) {
  const finance = financeFor(state, room, clubId);
  if (!finance || availableTransferFinance(state, room, clubId) < amount) {
    throw new MarketError("Orcamento de transferencias insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409, {
      available: availableTransferFinance(state, room, clubId),
      amount,
    });
  }
  reserve(finance, amount);
}

function debitTransfer(state, room, clubId, amount) {
  const finance = financeFor(state, room, clubId);
  if (!finance || availableTransferFinance(state, room, clubId) < amount) {
    throw new MarketError("Orcamento de transferencias insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409, {
      available: availableTransferFinance(state, room, clubId),
      amount,
    });
  }
  debit(finance, amount);
  adjustPersistentTransferBudget(room, clubId, -amount, {
    balance: finance.balance + amount,
    currentPayroll: calculateClubMonthlyPayroll(room, clubId).amount,
  });
}

function creditTransfer(state, room, clubId, amount) {
  const finance = financeFor(state, room, clubId, true);
  credit(finance, amount);
  adjustPersistentTransferBudget(room, clubId, amount, {
    balance: Math.max(0, finance.balance - amount),
    currentPayroll: calculateClubMonthlyPayroll(room, clubId).amount,
  });
}

function assertWageBudget(room, state, clubId, player, dealType, loanTerms, contractTerms) {
  const { finance, payroll, profile } = financeLimitsFor(state, room, clubId);
  const playerId = identifierKey(player?.id);
  const existingCost = payroll.entries.find((entry) => identifierKey(entry.playerId) === playerId)?.cost ?? 0;
  const scheduledCost = state.scheduledTransfers.reduce((total, scheduled) => {
    if (scheduled?.status !== "scheduled"
      || !identifiersEqual(scheduled?.toClubId, clubId)
      || identifiersEqual(scheduled?.playerId, player?.id)) return total;
    return total + integer(scheduled?.contractTerms?.wage, 0, MAX_MONEY);
  }, 0);
  const proposedCost = dealType === "loan"
    ? Math.round(defaultWage(player) * (integer(loanTerms?.wageSharePercent, 50, 100) / 100))
    : integer(contractTerms?.wage, defaultWage(player), MAX_MONEY);
  const projectedPayroll = Math.max(0, payroll.amount - existingCost + scheduledCost + proposedCost);
  const wageBudget = integer(profile?.wageBudget, 0, MAX_MONEY);
  if (projectedPayroll > wageBudget) {
    throw new MarketError("Limite da folha salarial excedido", "MARKET_WAGE_BUDGET_INSUFFICIENT", 409, {
      clubId,
      balance: finance?.balance ?? 0,
      currentPayroll: payroll.amount,
      projectedPayroll,
      wageBudget,
    });
  }
  return { currentPayroll: payroll.amount, projectedPayroll, wageBudget };
}

function reserve(finance, amount) {
  if (!finance || availableFinance(finance) < amount) {
    throw new MarketError("Orcamento insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409);
  }
  finance.committed += amount;
}

function release(finance, amount) {
  if (!finance) return;
  finance.committed = Math.max(0, integer(finance.committed) - integer(amount));
}

function debit(finance, amount) {
  if (!finance) throw new MarketError("Orcamento do clube indisponivel", "MARKET_FINANCE_NOT_FOUND", 409);
  if (integer(finance.balance) < amount) {
    throw new MarketError("Orcamento insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409);
  }
  finance.balance -= amount;
}

function credit(finance, amount) {
  if (!finance) return;
  finance.balance = Math.min(MAX_MONEY, integer(finance.balance) + amount);
}

function normalizeLoanTerms(value, fallbackFee = 0) {
  if (!value || typeof value !== "object") {
    return {
      fee: integer(fallbackFee, 0, MAX_MONEY),
      wageSharePercent: 50,
      durationRounds: 6,
      purchaseOption: null,
    };
  }
  const option = value.purchaseOption === null || value.purchaseOption === undefined
    ? null
    : integer(value.purchaseOption, 0, MAX_MONEY);
  const obligation = value.purchaseObligation === null || value.purchaseObligation === undefined
    ? null
    : integer(value.purchaseObligation, 0, MAX_MONEY);
  if (option && obligation) {
    throw new MarketError(
      "Escolha opcao ou obrigacao de compra, nao ambas",
      "MARKET_LOAN_CLAUSE_CONFLICT",
      400,
    );
  }
  return {
    fee: integer(value.fee, integer(fallbackFee, 0, MAX_MONEY), MAX_MONEY),
    wageSharePercent: Math.min(100, integer(value.wageSharePercent, 50, 100)),
    durationRounds: Math.max(1, Math.min(100, integer(value.durationRounds, 6, 100))),
    purchaseOption: option && option > 0 ? option : null,
    ...(obligation && obligation > 0 ? { purchaseObligation: obligation } : {}),
  };
}

function loanTermsWithFee(value, fee) {
  return { ...normalizeLoanTerms(value, fee), fee: integer(fee, 0, MAX_MONEY) };
}

function playerContract(player) {
  return player?.contract && typeof player.contract === "object" && !Array.isArray(player.contract)
    ? player.contract
    : null;
}

function playerIsFreeAgent(player) {
  const status = identifier(playerContract(player)?.status).toLocaleLowerCase("pt-BR");
  return ["free_agent", "expired", "released"].includes(status)
    || (!identifier(playerContract(player)?.clubId) && !identifier(player?.clubId));
}

function currentSeason(room) {
  return Math.max(1, integer(room?.currentSeason ?? room?.careerState?.currentSeason, 1));
}

function defaultWage(player) {
  const explicit = integer(playerContract(player)?.wage ?? player?.wage, 0, MAX_MONEY);
  if (explicit > 0) return explicit;
  return Math.max(1_000, Math.round(marketValueForPlayer(player) * 0.0035));
}

function normalizeContractTerms(room, player, value) {
  const season = currentSeason(room);
  const requestedSeason = Number(value?.effectiveSeason);
  if (Number.isFinite(requestedSeason) && Math.trunc(requestedSeason) > season + 1) {
    throw new MarketError(
      "A negociacao pode iniciar agora ou na proxima temporada",
      "MARKET_EFFECTIVE_SEASON_INVALID",
      400,
    );
  }
  const effectiveSeason = Math.max(season, integer(value?.effectiveSeason, season, season + 1));
  return {
    wage: Math.max(1_000, integer(value?.wage, defaultWage(player), MAX_MONEY)),
    durationSeasons: Math.max(1, Math.min(8, integer(value?.durationSeasons, DEFAULT_CONTRACT_SEASONS, 8))),
    effectiveSeason,
  };
}

function contractDates(room, effectiveSeason, durationSeasons, now) {
  const current = currentSeason(room);
  const base = new Date(now);
  const start = Number.isFinite(base.getTime()) ? base : new Date();
  if (effectiveSeason > current) start.setUTCFullYear(start.getUTCFullYear() + (effectiveSeason - current));
  const end = new Date(start);
  end.setUTCFullYear(end.getUTCFullYear() + durationSeasons);
  end.setUTCMilliseconds(end.getUTCMilliseconds() - 1);
  return { startDate: timestamp(start), endDate: timestamp(end) };
}

export function marketValueForPlayer(player) {
  const explicit = integer(player?.marketValue ?? player?.value, 0, MAX_MONEY);
  if (explicit > 0) return explicit;
  return Math.max(1_000_000, Math.min(MAX_MONEY, integer(player?.overall, 10, 20) * 2_000_000));
}

export function marketPlayerSummary(room, player, currentClubId = player?.clubId) {
  const clubId = identifier(currentClubId || player?.clubId);
  return {
    id: identifier(player?.id),
    name: identifier(player?.name) || "Jogador",
    position: identifier(player?.position).toUpperCase() || "MC",
    age: Math.max(14, Math.min(60, integer(player?.age, 24, 60))),
    overall: Math.max(1, Math.min(20, integer(player?.overall, 10, 20))),
    value: marketValueForPlayer(player),
    clubId,
    clubName: clubName(room, clubId),
    isStar: player?.isStar === true,
    avatarImageUrl: typeof player?.avatarImageUrl === "string" ? player.avatarImageUrl : null,
  };
}

function normalizeRegistration(value, legacyPlayerId = null) {
  const playerId = identifier(value?.playerId ?? value?.playerSnapshot?.id ?? legacyPlayerId);
  const originalClubId = identifier(value?.originalClubId ?? value?.catalogClubId);
  const permanentClubId = identifier(value?.permanentClubId ?? originalClubId);
  const currentClubId = identifier(value?.currentClubId ?? permanentClubId);
  if (!playerId || !originalClubId || !permanentClubId || !currentClubId) return null;
  const playerSnapshot = value?.playerSnapshot && typeof value.playerSnapshot === "object"
    ? { ...structuredClone(value.playerSnapshot), id: identifier(value.playerSnapshot.id) || playerId }
    : null;
  return {
    playerId,
    originalClubId,
    permanentClubId,
    currentClubId,
    playerSnapshot,
    transferId: identifier(value?.transferId) || null,
    contractId: identifier(value?.contractId ?? playerSnapshot?.contract?.id) || null,
    acquiredAt: value?.acquiredAt ? timestamp(value.acquiredAt) : null,
    competitionRegistrations: Array.isArray(value?.competitionRegistrations)
      ? value.competitionRegistrations.slice(-100).map((entry) => structuredClone(entry))
      : [],
    transferHistory: Array.isArray(value?.transferHistory)
      ? value.transferHistory.slice(-MAX_CAREER_HISTORY).map((entry) => structuredClone(entry))
      : [],
    loan: value?.loan && typeof value.loan === "object"
      ? {
        id: identifier(value.loan.id) || randomUUID(),
        lenderClubId: identifier(value.loan.lenderClubId ?? permanentClubId),
        borrowerClubId: identifier(value.loan.borrowerClubId ?? currentClubId),
        startedSeason: Math.max(1, integer(value.loan.startedSeason, 1)),
        returnSeason: Math.max(1, integer(value.loan.returnSeason, 2)),
        remainingRounds: Math.max(0, integer(value.loan.remainingRounds, value.loan.terms?.durationRounds ?? 1, 100)),
        startedAt: value.loan.startedAt ? timestamp(value.loan.startedAt) : null,
        endsAt: value.loan.endsAt ? timestamp(value.loan.endsAt) : null,
        fee: integer(value.loan.fee, 0, MAX_MONEY),
        terms: normalizeLoanTerms(value.loan.terms, value.loan.fee),
        contractTerms: normalizeContractTerms(
          { currentSeason: value.loan.startedSeason ?? 1 },
          playerSnapshot ?? {},
          value.loan.contractTerms,
        ),
        obligationReserved: integer(
          value.loan.obligationReserved,
          value.loan.terms?.purchaseObligation ?? 0,
          MAX_MONEY,
        ),
      }
      : null,
  };
}

function registrationEntries(value) {
  if (Array.isArray(value)) return value.map((registration) => [null, registration]);
  if (value && typeof value === "object") return Object.entries(value);
  return [];
}

function boundedDeals(values, maximum, isActive) {
  const all = Array.isArray(values) ? values : [];
  const active = all.filter(isActive);
  const terminal = all.filter((item) => !isActive(item));
  const terminalLimit = Math.max(0, maximum - active.length);
  return [...(terminalLimit > 0 ? terminal.slice(-terminalLimit) : []), ...active];
}

export function ensureMarketState(room, now = new Date()) {
  const raw = room.marketState && typeof room.marketState === "object" ? room.marketState : {};
  const legacyAdvancedRoundKey = identifier(raw.lastAdvancedRoundKey) || null;
  const advancedLoanRoundKeys = [...new Set([
    ...(Array.isArray(raw.advancedLoanRoundKeys) ? raw.advancedLoanRoundKeys.map(identifier) : []),
    legacyAdvancedRoundKey,
  ].filter(Boolean))].slice(-500);
  const registrationsById = new Map();
  for (const [legacyPlayerId, value] of registrationEntries(raw.registrations)) {
    const registration = normalizeRegistration(value, legacyPlayerId);
    if (registration) registrationsById.set(identifierKey(registration.playerId), registration);
  }
  const state = {
    version: 1,
    revision: Math.max(1, integer(raw.revision, 1)),
    finances: [],
    registrations: [...registrationsById.values()],
    activeOffers: boundedDeals(
      raw.activeOffers,
      MAX_OFFERS,
      (offer) => ["pending", "countered"].includes(offer?.status),
    ),
    activeListings: boundedDeals(
      raw.activeListings,
      MAX_LISTINGS,
      (listing) => listing?.status === "open",
    ),
    transactions: Array.isArray(raw.transactions) ? raw.transactions.slice(-MAX_TRANSACTIONS) : [],
    scheduledTransfers: Array.isArray(raw.scheduledTransfers)
      ? raw.scheduledTransfers.slice(-MAX_TRANSACTIONS).map((item) => structuredClone(item))
      : [],
    loanHistory: Array.isArray(raw.loanHistory)
      ? raw.loanHistory.slice(-MAX_TRANSACTIONS).map((item) => structuredClone(item))
      : [],
    activity: Array.isArray(raw.activity) ? raw.activity.slice(-MAX_ACTIVITY) : [],
    processedRequests: Array.isArray(raw.processedRequests) ? raw.processedRequests.slice(-MAX_REQUESTS) : [],
    aiTransferTickKeys: [...new Set(
      Array.isArray(raw.aiTransferTickKeys) ? raw.aiTransferTickKeys.map(identifier).filter(Boolean) : [],
    )].slice(-MAX_AI_TRANSFER_TICKS),
    aiMarketHistory: Array.isArray(raw.aiMarketHistory)
      ? raw.aiMarketHistory.slice(-MAX_AI_MARKET_HISTORY).map((item) => structuredClone(item))
      : [],
    aiTickRuns: Array.isArray(raw.aiTickRuns)
      ? raw.aiTickRuns.filter((item) => item && typeof item.tickKey === "string")
        .slice(-MAX_AI_MARKET_HISTORY).map((item) => structuredClone(item))
      : [],
    lastAiTransferTick: raw.lastAiTransferTick && typeof raw.lastAiTransferTick === "object"
      ? structuredClone(raw.lastAiTransferTick)
      : null,
    lastAdvancedRoundKey: legacyAdvancedRoundKey,
    advancedLoanRoundKeys,
    updatedAt: raw.updatedAt ? timestamp(raw.updatedAt) : timestamp(now),
  };
  const finances = Array.isArray(raw.finances) ? raw.finances : [];
  const financeClubIds = new Map();
  for (const finance of finances) {
    const clubId = identifier(finance?.clubId);
    if (clubId) financeClubIds.set(clubKey(clubId), clubId);
  }
  for (const league of room.competitionCatalog ?? []) {
    for (const club of league?.clubs ?? []) {
      const clubId = identifier(club?.id);
      if (clubId) financeClubIds.set(clubKey(clubId), clubId);
    }
  }
  for (const manager of room.managers ?? []) {
    const clubId = identifier(manager?.clubId);
    if (clubId) financeClubIds.set(clubKey(clubId), clubId);
  }
  for (const clubId of financeClubIds.values()) {
    const existing = finances.find((candidate) => clubKey(candidate?.clubId) === clubKey(clubId));
    state.finances.push(normalizeFinance(existing, room, clubId));
  }
  room.marketState = state;
  return state;
}

export function registrationForPlayer(room, playerId) {
  const state = room.marketState?.version === 1
    && Array.isArray(room.marketState.registrations)
    ? room.marketState
    : ensureMarketState(room);
  const playerKey = identifierKey(playerId);
  return state.registrations.find((candidate) => identifierKey(candidate.playerId) === playerKey) ?? null;
}

export function currentClubIdForPlayer(room, player) {
  const current = actualOwnership(room, player);
  return clubKey(current) === clubKey(FREE_AGENT_CLUB_ID) ? "" : current || "";
}

function requestKey(managerId, operation, requestId) {
  return `${identifier(managerId)}\u0000${identifier(operation)}\u0000${identifier(requestId)}`;
}

function previousRequest(state, managerId, operation, requestId) {
  const key = requestKey(managerId, operation, requestId);
  return state.processedRequests.find((candidate) => candidate.key === key)?.result ?? null;
}

function rememberRequest(state, managerId, operation, requestId, result) {
  state.processedRequests.push({
    key: requestKey(managerId, operation, requestId),
    result: structuredClone(result),
    createdAt: state.updatedAt,
  });
  state.processedRequests = state.processedRequests.slice(-MAX_REQUESTS);
}

function touch(state, now) {
  state.revision = Math.max(1, integer(state.revision, 1)) + 1;
  state.updatedAt = timestamp(now);
}

function activity(state, message, now, type = "market", actorName = null) {
  state.activity.push({ id: randomUUID(), message, actorName, createdAt: timestamp(now), type });
  state.activity = state.activity.slice(-MAX_ACTIVITY);
}

function careerPlayers(room) {
  const players = room?.careerState?.players;
  if (Array.isArray(players)) return players;
  if (!players || typeof players !== "object") return [];
  room.careerState.players = Object.entries(players).map(([id, player]) => ({
    ...(player && typeof player === "object" ? player : {}),
    id: identifier(player?.id) || id,
  }));
  return room.careerState.players;
}

function careerPlayer(room, playerId) {
  const key = identifierKey(playerId);
  return careerPlayers(room).find((candidate) => identifierKey(candidate?.id) === key) ?? null;
}

function careerPlayerIndex(room, playerId) {
  const key = identifierKey(playerId);
  return careerPlayers(room).findIndex((candidate) => identifierKey(candidate?.id) === key);
}

function sourcePlayer(room, registration, player) {
  const career = careerPlayer(room, player?.id ?? registration?.playerId);
  return {
    ...(player && typeof player === "object" ? structuredClone(player) : {}),
    ...(registration?.playerSnapshot && typeof registration.playerSnapshot === "object"
      ? structuredClone(registration.playerSnapshot)
      : {}),
    ...(career ? structuredClone(career) : {}),
    id: identifier(career?.id ?? registration?.playerId ?? player?.id),
  };
}

function setCareerPlayer(room, player) {
  if (!room.careerState || typeof room.careerState !== "object") return;
  const players = careerPlayers(room);
  const index = careerPlayerIndex(room, player.id);
  if (index >= 0) players[index] = structuredClone(player);
  else players.push(structuredClone(player));
}

function uniqueHistory(...collections) {
  const history = new Map();
  for (const entry of collections.flatMap((value) => (Array.isArray(value) ? value : []))) {
    const key = identifier(entry?.id) || JSON.stringify(entry);
    if (key) history.set(key, structuredClone(entry));
  }
  return [...history.values()].slice(-MAX_CAREER_HISTORY);
}

function competitionsForClub(room, clubId) {
  const target = clubKey(clubId);
  const competitionIds = [];
  for (const league of room.competitionCatalog ?? []) {
    if ((league?.clubs ?? []).some((club) => clubKey(club?.id) === target)) {
      competitionIds.push(identifier(league?.id));
    }
  }
  for (const tournament of room.tournamentCatalog ?? []) {
    if ((tournament?.participants ?? []).some((club) => clubKey(club?.id ?? club) === target)) {
      competitionIds.push(identifier(tournament?.id));
    }
  }
  return [...new Set(competitionIds.filter(Boolean))];
}

function syncCompetitionRegistrations(
  room,
  registration,
  player,
  clubId,
  now,
  seasonNumber = currentSeason(room),
) {
  const registeredAt = timestamp(now);
  const registrationSeason = Math.max(1, integer(seasonNumber, currentSeason(room)));
  const entries = competitionsForClub(room, clubId).map((competitionId) => ({
    id: `${identifierKey(competitionId)}:${identifierKey(registration.playerId)}`,
    competitionId,
    playerId: registration.playerId,
    clubId,
    seasonNumber: registrationSeason,
    status: "active",
    registeredAt,
  }));
  registration.competitionRegistrations = entries.map((entry) => structuredClone(entry));
  player.competitionRegistrations = entries.map((entry) => structuredClone(entry));
  const existing = Array.isArray(room.playerCompetitionRegistrations)
    ? room.playerCompetitionRegistrations
    : [];
  room.playerCompetitionRegistrations = [
    ...existing.filter((entry) => !identifiersEqual(entry?.playerId, registration.playerId)),
    ...entries,
  ];
  return entries;
}

function archiveContract(contract, transactionId, completedAt) {
  if (!contract || typeof contract !== "object") return null;
  if (!["active", "academy"].includes(identifier(contract.status).toLocaleLowerCase("pt-BR"))) return null;
  return {
    ...structuredClone(contract),
    id: identifier(contract.id) || randomUUID(),
    status: "terminated",
    endedAt: completedAt,
    endedReason: "transfer",
    replacedByTransferId: transactionId,
  };
}

function createContract(room, player, clubId, terms, transactionId, completedAt) {
  const { startDate, endDate } = contractDates(
    room,
    terms.effectiveSeason,
    terms.durationSeasons,
    completedAt,
  );
  return {
    id: randomUUID(),
    clubId,
    startSeason: terms.effectiveSeason,
    endSeason: terms.effectiveSeason + terms.durationSeasons - 1,
    startDate,
    endDate,
    wage: terms.wage,
    status: "active",
    renewalCount: 0,
    transferId: transactionId,
  };
}

function transferHistoryEntry({
  id,
  playerId,
  eventType,
  fromClubId,
  toClubId,
  amount,
  completedAt,
  seasonNumber,
  contractId = null,
  loanId = null,
}) {
  return {
    id,
    playerId,
    eventType,
    fromClubId: clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID) ? null : fromClubId,
    toClubId,
    amount,
    completedAt,
    seasonNumber,
    contractId,
    loanId,
  };
}

function recordCareerHistory(room, registration, player, entry) {
  registration.transferHistory = uniqueHistory(registration.transferHistory, [entry]);
  player.transferHistory = uniqueHistory(player.transferHistory, registration.transferHistory);
  if (room.careerState && typeof room.careerState === "object") {
    room.careerState.transferHistory = uniqueHistory(room.careerState.transferHistory, [entry]);
  }
}

function principalContractFor(room, registration, player, ownerClubId, completedAt = new Date()) {
  const source = sourcePlayer(room, registration, player);
  const contract = playerContract(source);
  if (contract && !["expired", "free_agent", "released", "retired"].includes(
    identifier(contract.status).toLocaleLowerCase("pt-BR"),
  )) {
    return { ...structuredClone(contract), clubId: ownerClubId, status: "active" };
  }
  const season = currentSeason(room);
  const dates = contractDates(room, season, DEFAULT_CONTRACT_SEASONS, completedAt);
  return {
    id: randomUUID(),
    clubId: ownerClubId,
    startSeason: season,
    endSeason: season + DEFAULT_CONTRACT_SEASONS - 1,
    ...dates,
    wage: defaultWage(source),
    status: "active",
    renewalCount: 0,
  };
}

function syncPermanentPlayer(room, registration, player, {
  fromClubId,
  toClubId,
  amount,
  transactionId,
  completedAt,
  contractTerms,
  eventType = "transfer",
}) {
  const source = sourcePlayer(room, registration, player);
  const previousContract = playerContract(source);
  const contract = createContract(
    room,
    source,
    toClubId,
    contractTerms,
    transactionId,
    completedAt,
  );
  const archived = archiveContract(previousContract, transactionId, completedAt);
  const entry = transferHistoryEntry({
    id: transactionId,
    playerId: registration.playerId,
    eventType,
    fromClubId,
    toClubId,
    amount,
    completedAt,
    seasonNumber: contractTerms.effectiveSeason,
    contractId: contract.id,
  });
  const updated = {
    ...source,
    id: registration.playerId,
    clubId: toClubId,
    currentClubId: toClubId,
    ownerClubId: toClubId,
    wage: contract.wage,
    active: true,
    retired: false,
    contract,
    contractHistory: uniqueHistory(source.contractHistory, archived ? [archived] : []),
    loan: null,
  };
  registration.permanentClubId = toClubId;
  registration.currentClubId = toClubId;
  registration.contractId = contract.id;
  registration.transferId = transactionId;
  registration.acquiredAt = completedAt;
  registration.loan = null;
  recordCareerHistory(room, registration, updated, entry);
  syncCompetitionRegistrations(
    room,
    registration,
    updated,
    toClubId,
    completedAt,
    contractTerms.effectiveSeason,
  );
  registration.playerSnapshot = structuredClone(updated);
  setCareerPlayer(room, updated);
  return { player: updated, contract, history: entry };
}

function projectedLoanEnd(room, borrowerClubId, durationRounds, startedAt) {
  const startMs = Date.parse(startedAt);
  const safeStartMs = Number.isFinite(startMs) ? startMs : Date.now();
  const rounds = Math.max(1, integer(durationRounds, 1, 100));
  const fixturesByKey = new Map();
  const schedules = [
    room.leagueFixtureSchedule,
    room.fixtureSchedule,
    room.competitionSeason?.fixtures,
  ];
  for (const schedule of schedules) {
    for (const fixture of Array.isArray(schedule) ? schedule : []) {
      if (!identifiersEqual(fixture?.homeClubId, borrowerClubId)
        && !identifiersEqual(fixture?.awayClubId, borrowerClubId)) continue;
      const scheduledMs = Date.parse(fixture?.scheduledAt);
      if (!Number.isFinite(scheduledMs) || scheduledMs <= safeStartMs) continue;
      const key = identifier(
        fixture?.leagueFixtureId
        ?? fixture?.fixtureId
        ?? fixture?.id
        ?? `${scheduledMs}:${fixture?.homeClubId}:${fixture?.awayClubId}`,
      );
      if (!fixturesByKey.has(key)) fixturesByKey.set(key, scheduledMs);
    }
  }
  const upcoming = [...fixturesByKey.values()].sort((left, right) => left - right);
  if (upcoming.length >= rounds) return timestamp(new Date(upcoming[rounds - 1]));
  return timestamp(new Date(safeStartMs + rounds * 7 * 24 * 60 * 60 * 1_000));
}

function syncLoanPlayer(room, registration, player, {
  fromClubId,
  toClubId,
  amount,
  transactionId,
  completedAt,
  terms,
  contractTerms,
}) {
  const source = sourcePlayer(room, registration, player);
  const contract = principalContractFor(room, registration, source, fromClubId, completedAt);
  const loan = {
    id: transactionId,
    lenderClubId: fromClubId,
    borrowerClubId: toClubId,
    startedSeason: currentSeason(room),
    returnSeason: currentSeason(room) + 1,
    remainingRounds: terms.durationRounds,
    startedAt: completedAt,
    endsAt: projectedLoanEnd(room, toClubId, terms.durationRounds, completedAt),
    fee: amount,
    terms,
    contractTerms,
    obligationReserved: integer(terms.purchaseObligation, 0, MAX_MONEY),
  };
  const entry = transferHistoryEntry({
    id: transactionId,
    playerId: registration.playerId,
    eventType: "loan",
    fromClubId,
    toClubId,
    amount,
    completedAt,
    seasonNumber: currentSeason(room),
    contractId: identifier(contract.id) || null,
    loanId: transactionId,
  });
  const updated = {
    ...source,
    id: registration.playerId,
    clubId: toClubId,
    currentClubId: toClubId,
    ownerClubId: fromClubId,
    active: true,
    contract,
    loan: structuredClone(loan),
  };
  registration.permanentClubId = fromClubId;
  registration.currentClubId = toClubId;
  registration.contractId = identifier(contract.id) || null;
  registration.transferId = transactionId;
  registration.acquiredAt = completedAt;
  registration.loan = loan;
  recordCareerHistory(room, registration, updated, entry);
  syncCompetitionRegistrations(
    room,
    registration,
    updated,
    toClubId,
    completedAt,
    contractTerms.effectiveSeason,
  );
  registration.playerSnapshot = structuredClone(updated);
  setCareerPlayer(room, updated);
  return { player: updated, contract, history: entry, loan };
}

function transferWindowIsOpen(room, now) {
  if (room.transferWindowOpen === false || room.transferWindow?.open === false) return false;
  const windows = Array.isArray(room.transferWindows) ? room.transferWindows : [];
  if (windows.length === 0) return true;
  const current = new Date(now).getTime();
  const season = currentSeason(room);
  return windows.some((window) => {
    if (window?.seasonNumber && integer(window.seasonNumber) !== season) return false;
    if (window?.open === true) return true;
    const starts = Date.parse(window?.startsAt);
    const ends = Date.parse(window?.endsAt);
    return Number.isFinite(starts) && Number.isFinite(ends) && starts <= current && current <= ends;
  });
}

function assertTransferWindow(room, now) {
  if (!transferWindowIsOpen(room, now)) {
    throw new MarketError("A janela de transferencias esta fechada", "MARKET_WINDOW_CLOSED", 409);
  }
}

function effectiveCareerClubId(room, candidate) {
  const career = careerPlayer(room, candidate?.id) ?? candidate;
  if (career && playerIsFreeAgent(career)) return FREE_AGENT_CLUB_ID;
  const registration = registrationForPlayer(room, candidate?.id);
  if (registration?.currentClubId) return registration.currentClubId;
  return identifier(career?.currentClubId ?? career?.clubId ?? career?.contract?.clubId);
}

function assertSquadCapacity(room, clubId, playerId, {
  effectiveSeason = currentSeason(room),
  includeScheduled = true,
} = {}) {
  const players = careerPlayers(room);
  const maximum = Math.max(1, integer(room.maxSquadSize, MAX_SQUAD_SIZE, 200));
  const ids = new Set(players.filter((candidate) => (
    candidate?.active !== false
    && !identifiersEqual(candidate?.id, playerId)
    && clubKey(effectiveCareerClubId(room, candidate)) === clubKey(clubId)
  )).map((candidate) => identifierKey(candidate.id)));
  if (includeScheduled) {
    const targetSeason = Math.max(1, integer(effectiveSeason, currentSeason(room)));
    for (const scheduled of room.marketState?.scheduledTransfers ?? []) {
      if (scheduled?.status !== "scheduled"
        || !identifiersEqual(scheduled?.toClubId, clubId)
        || integer(scheduled?.effectiveSeason) !== targetSeason
        || identifiersEqual(scheduled?.playerId, playerId)) continue;
      const scheduledPlayerId = identifierKey(scheduled?.playerId);
      if (scheduledPlayerId) ids.add(scheduledPlayerId);
    }
  }
  if (ids.size >= maximum) {
    throw new MarketError("O elenco comprador esta cheio", "MARKET_SQUAD_FULL", 409, { maximum });
  }
}

function actualOwnership(room, player) {
  const career = careerPlayer(room, player?.id);
  if (career && playerIsFreeAgent(career)) return FREE_AGENT_CLUB_ID;
  const registration = registrationForPlayer(room, player?.id);
  if (registration?.currentClubId) return registration.currentClubId;
  const clubId = identifier(career?.currentClubId ?? career?.clubId ?? career?.contract?.clubId ?? player?.clubId);
  if (clubId) return clubId;
  return playerIsFreeAgent(player) ? FREE_AGENT_CLUB_ID : null;
}

function assertDealOwnership(room, player, expectedClubId) {
  const actual = actualOwnership(room, player);
  if (!actual || clubKey(actual) !== clubKey(expectedClubId)) {
    throw new MarketError("Jogador nao pertence mais ao clube", "MARKET_PLAYER_CLUB_CHANGED", 409);
  }
  const registration = registrationForPlayer(room, player?.id);
  if (registration?.loan) throw new MarketError("Jogador emprestado nao pode ser negociado", "MARKET_PLAYER_ON_LOAN", 409);
  return actual;
}

function movePlayerRuntime(room, playerId, fromClubId, toClubId) {
  let runtimeFound = false;
  room.playerStates = (room.playerStates ?? []).filter((state) => {
    if (!identifiersEqual(state?.playerId, playerId)) return true;
    if (runtimeFound) return false;
    runtimeFound = true;
    state.clubId = toClubId;
    return true;
  });
  let personalDelta = null;
  for (const morale of room.clubMoraleStates ?? []) {
    const deltas = Array.isArray(morale.playerDeltas) ? morale.playerDeltas : [];
    const matching = deltas.find((candidate) => identifier(candidate?.playerId) === playerId);
    if (matching && clubKey(morale.clubId) === clubKey(fromClubId)) personalDelta = matching.delta;
    morale.playerDeltas = deltas.filter((candidate) => identifier(candidate?.playerId) !== playerId);
  }
  if (personalDelta !== null) {
    const target = (room.clubMoraleStates ?? []).find((morale) => clubKey(morale?.clubId) === clubKey(toClubId));
    if (target) {
      target.playerDeltas = Array.isArray(target.playerDeltas) ? target.playerDeltas : [];
      target.playerDeltas.push({ playerId, delta: personalDelta });
    }
  }
  const affectedManagerIds = (room.managers ?? [])
    .filter((manager) => [clubKey(fromClubId), clubKey(toClubId)].includes(clubKey(manager.clubId)))
    .map((manager) => manager.id);
  room.lineups = (room.lineups ?? []).map((lineup) => ({
    ...lineup,
    lineupIds: (lineup.lineupIds ?? []).filter((id) => !identifiersEqual(id, playerId)),
  }));
  if (Array.isArray(room.matchReadiness?.managerIds)) {
    room.matchReadiness.managerIds = room.matchReadiness.managerIds
      .filter((managerId) => !affectedManagerIds.includes(managerId));
  }
}

function playerRegistration(state, player, currentClubId) {
  let registration = state.registrations.find((candidate) => identifiersEqual(candidate.playerId, player.id));
  if (!registration) {
    registration = {
      playerId: identifier(player.id),
      originalClubId: identifier(player.clubId || currentClubId) || FREE_AGENT_CLUB_ID,
      permanentClubId: identifier(currentClubId),
      currentClubId: identifier(currentClubId),
      playerSnapshot: structuredClone(player),
      transferId: null,
      contractId: identifier(player?.contract?.id) || null,
      acquiredAt: null,
      competitionRegistrations: [],
      transferHistory: [],
      loan: null,
    };
    state.registrations.push(registration);
  }
  if (!registration.playerSnapshot) registration.playerSnapshot = structuredClone(player);
  return registration;
}

function cancelCompetingDeals(room, state, playerId, keptOfferId, keptListingId) {
  for (const offer of state.activeOffers) {
    if (!identifiersEqual(offer.player?.id, playerId) || offer.id === keptOfferId) continue;
    if (!["pending", "countered"].includes(offer.status)) continue;
    release(financeFor(state, room, offer.buyerClubId), offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = "cancelled";
  }
  for (const listing of state.activeListings) {
    if (!identifiersEqual(listing.player?.id, playerId) || listing.id === keptListingId || listing.status !== "open") continue;
    if (listing.highestBid) {
      release(
        financeFor(state, room, listing.highestBid.clubId),
        listing.highestBid.reservedAmount ?? listing.highestBid.amount,
      );
    }
    listing.status = "cancelled";
  }
}

function replaceOrAppendTransaction(state, transaction) {
  const index = state.transactions.findIndex((candidate) => candidate?.id === transaction.id);
  if (index >= 0) state.transactions[index] = transaction;
  else state.transactions.push(transaction);
  state.transactions = state.transactions.slice(-MAX_TRANSACTIONS);
}

function recordLedger(finance, entry) {
  if (!finance) return;
  finance.ledger.push(entry);
  finance.ledger = finance.ledger.slice(-MAX_TRANSACTIONS);
}

function publicFromClubId(fromClubId) {
  return clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID) ? null : fromClubId;
}

function transactionRecord(room, player, {
  id,
  dealType,
  eventType = dealType,
  fromClubId,
  toClubId,
  amount,
  terms,
  contractTerms,
  offerId = null,
  listingId = null,
  completedAt,
  status = "completed",
}) {
  return {
    id,
    player: marketPlayerSummary(room, player, toClubId),
    dealType,
    eventType,
    fromClubId: publicFromClubId(fromClubId),
    fromClubName: clubName(room, fromClubId),
    toClubId,
    toClubName: clubName(room, toClubId),
    amount,
    ...(terms ? { loanTerms: structuredClone(terms) } : {}),
    ...(contractTerms ? { contractTerms: structuredClone(contractTerms) } : {}),
    ...(offerId ? { offerId } : {}),
    ...(listingId ? { listingId } : {}),
    effectiveSeason: contractTerms?.effectiveSeason ?? currentSeason(room),
    status,
    completedAt,
  };
}

function scheduleTransfer(room, state, {
  player,
  fromClubId,
  toClubId,
  amount,
  contractTerms,
  offerId,
  listingId,
  now,
}) {
  if (availableTransferFinance(state, room, toClubId) < amount) {
    throw new MarketError("Orcamento insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409);
  }
  reserveTransfer(state, room, toClubId, amount);
  const id = randomUUID();
  const agreedAt = timestamp(now);
  const scheduled = {
    id,
    playerId: identifier(player.id),
    playerSnapshot: structuredClone(sourcePlayer(room, registrationForPlayer(room, player.id), player)),
    fromClubId,
    toClubId,
    amount,
    reservedAmount: amount,
    contractTerms: structuredClone(contractTerms),
    effectiveSeason: contractTerms.effectiveSeason,
    status: "scheduled",
    agreedAt,
    completedAt: null,
    cancelledAt: null,
    transactionId: id,
  };
  state.scheduledTransfers.push(scheduled);
  state.scheduledTransfers = state.scheduledTransfers.slice(-MAX_TRANSACTIONS);
  cancelCompetingDeals(room, state, player.id, offerId, listingId);
  const transaction = transactionRecord(room, player, {
    id,
    dealType: "transfer",
    eventType: "transfer-agreement",
    fromClubId,
    toClubId,
    amount,
    contractTerms,
    completedAt: agreedAt,
    status: "scheduled",
  });
  replaceOrAppendTransaction(state, transaction);
  activity(
    state,
    `${transaction.player.name} acertou transferencia para ${clubName(room, toClubId)} na temporada ${contractTerms.effectiveSeason}.`,
    now,
    "transfer-scheduled",
  );
  return transaction;
}

export function assertMarketIntegrity(room, playerId, {
  allowedOfferId = null,
  allowedListingId = null,
  transactionId = null,
} = {}) {
  const state = room.marketState?.version === 1 && Array.isArray(room.marketState?.registrations)
    ? room.marketState
    : ensureMarketState(room);
  const key = identifierKey(playerId);
  const registrations = state.registrations.filter((candidate) => identifierKey(candidate?.playerId) === key);
  if (registrations.length !== 1) {
    throw new MarketError("Vinculo duplicado ou ausente", "MARKET_INTEGRITY_REGISTRATION", 500);
  }
  const registration = registrations[0];
  const expectedContractClubId = registration.loan
    ? identifier(registration.permanentClubId ?? registration.loan.lenderClubId)
    : identifier(registration.currentClubId);
  if (!registration.currentClubId || !expectedContractClubId) {
    throw new MarketError("Clube atual ou proprietario ausente", "MARKET_INTEGRITY_CLUB", 500);
  }
  if (!registration.loan && !identifiersEqual(registration.currentClubId, registration.permanentClubId)) {
    throw new MarketError("Clube atual diverge do proprietario", "MARKET_INTEGRITY_OWNER", 500);
  }
  const records = careerPlayers(room).filter((candidate) => identifierKey(candidate?.id) === key);
  if (room.careerState && records.length !== 1) {
    throw new MarketError("Registro de carreira duplicado ou ausente", "MARKET_INTEGRITY_CAREER", 500);
  }
  const player = records[0] ?? registration.playerSnapshot;
  if (player) {
    if (!identifiersEqual(player.clubId ?? player.currentClubId, registration.currentClubId)) {
      throw new MarketError("Clube do perfil diverge do elenco", "MARKET_INTEGRITY_PLAYER_CLUB", 500);
    }
    if (!identifiersEqual(player.contract?.clubId, expectedContractClubId)) {
      throw new MarketError("Contrato ativo pertence a outro clube", "MARKET_INTEGRITY_CONTRACT_CLUB", 500);
    }
    if (identifier(player.contract?.status).toLocaleLowerCase("pt-BR") !== "active") {
      throw new MarketError("Contrato principal nao esta ativo", "MARKET_INTEGRITY_CONTRACT_STATUS", 500);
    }
    if ((player.contractHistory ?? []).some((contract) => identifier(contract?.status).toLocaleLowerCase("pt-BR") === "active")) {
      throw new MarketError("Mais de um contrato principal esta ativo", "MARKET_INTEGRITY_CONTRACT_DUPLICATE", 500);
    }
  }
  const runtimeCount = (room.playerStates ?? []).filter((candidate) => identifiersEqual(candidate?.playerId, playerId)).length;
  if (runtimeCount > 1) {
    throw new MarketError("Estado de jogador duplicado", "MARKET_INTEGRITY_RUNTIME_DUPLICATE", 500);
  }
  const wrongLineup = (room.lineups ?? []).find((lineup) => (
    !identifiersEqual(lineup?.clubId, registration.currentClubId)
    && (lineup?.lineupIds ?? []).some((id) => identifiersEqual(id, playerId))
  ));
  if (wrongLineup) {
    throw new MarketError("Jogador continua escalado pelo clube anterior", "MARKET_INTEGRITY_LINEUP", 500);
  }
  const competitionEntries = (room.playerCompetitionRegistrations ?? [])
    .filter((entry) => identifiersEqual(entry?.playerId, playerId));
  if (competitionEntries.some((entry) => !identifiersEqual(entry?.clubId, registration.currentClubId))) {
    throw new MarketError("Inscricao antiga de competicao permaneceu ativa", "MARKET_INTEGRITY_COMPETITION", 500);
  }
  const pendingOffer = state.activeOffers.find((offer) => (
    offer.id !== allowedOfferId
    && identifiersEqual(offer.player?.id, playerId)
    && ["pending", "countered"].includes(offer.status)
  ));
  const pendingListing = state.activeListings.find((listing) => (
    listing.id !== allowedListingId
    && identifiersEqual(listing.player?.id, playerId)
    && listing.status === "open"
  ));
  if (pendingOffer || pendingListing) {
    throw new MarketError("Negociacao pendente permaneceu ativa", "MARKET_INTEGRITY_PENDING_DEAL", 500);
  }
  if (transactionId && !state.transactions.some((transaction) => transaction.id === transactionId)) {
    throw new MarketError("Historico da transferencia ausente", "MARKET_INTEGRITY_HISTORY", 500);
  }
  return true;
}

function completeDeal(room, state, {
  player,
  fromClubId,
  toClubId,
  dealType,
  amount,
  loanTerms,
  contractTerms: requestedContractTerms,
  offerId = null,
  listingId = null,
  transactionId: providedTransactionId = null,
  executionSeason = null,
  skipWindow = false,
  now = new Date(),
}) {
  const playerId = identifier(player?.id);
  if (!playerId) throw new MarketError("Jogador invalido", "MARKET_PLAYER_INVALID", 400);
  if (!executionSeason && activeScheduledForPlayer(state, playerId)) {
    throw new MarketError("Jogador ja possui transferencia agendada", "MARKET_PLAYER_SCHEDULED", 409);
  }
  if (!skipWindow) assertTransferWindow(room, now);
  assertDealOwnership(room, player, fromClubId);
  const normalizedContractTerms = normalizeContractTerms(room, player, {
    ...requestedContractTerms,
    ...(executionSeason ? { effectiveSeason: executionSeason } : {}),
  });
  assertSquadCapacity(room, toClubId, playerId, {
    effectiveSeason: normalizedContractTerms.effectiveSeason,
    includeScheduled: !executionSeason,
  });
  const projectedLoanTerms = dealType === "loan" ? loanTermsWithFee(loanTerms, amount) : null;
  assertWageBudget(
    room,
    state,
    toClubId,
    player,
    dealType,
    projectedLoanTerms,
    normalizedContractTerms,
  );
  if (!executionSeason && normalizedContractTerms.effectiveSeason > currentSeason(room)) {
    if (dealType === "loan") {
      throw new MarketError(
        "Emprestimo deve iniciar na temporada atual",
        "MARKET_FUTURE_LOAN_UNSUPPORTED",
        409,
      );
    }
    return scheduleTransfer(room, state, {
      player,
      fromClubId,
      toClubId,
      amount,
      contractTerms: normalizedContractTerms,
      offerId,
      listingId,
      now,
    });
  }
  const registration = playerRegistration(state, player, fromClubId);
  if (registration.loan) throw new MarketError("Jogador ja esta emprestado", "MARKET_PLAYER_ON_LOAN", 409);
  const buyerFinance = financeFor(state, room, toClubId);
  const terms = projectedLoanTerms;
  const obligation = integer(terms?.purchaseObligation, 0, MAX_MONEY);
  if (availableTransferFinance(state, room, toClubId) < amount + obligation) {
    throw new MarketError("Orcamento insuficiente", "MARKET_BUDGET_INSUFFICIENT", 409);
  }
  const freeAgent = clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID);
  const sellerFinance = freeAgent ? null : financeFor(state, room, fromClubId, true);
  debitTransfer(state, room, toClubId, amount);
  if (sellerFinance) creditTransfer(state, room, fromClubId, amount);
  if (obligation > 0) reserveTransfer(state, room, toClubId, obligation);
  const transactionId = providedTransactionId || randomUUID();
  const completedAt = timestamp(now);
  let synchronized;
  if (dealType === "loan") {
    synchronized = syncLoanPlayer(room, registration, player, {
      fromClubId,
      toClubId,
      amount,
      transactionId,
      completedAt,
      terms,
      contractTerms: normalizedContractTerms,
    });
  } else {
    synchronized = syncPermanentPlayer(room, registration, player, {
      fromClubId,
      toClubId,
      amount,
      transactionId,
      completedAt,
      contractTerms: normalizedContractTerms,
      eventType: freeAgent ? "free-agent-signing" : "transfer",
    });
  }
  movePlayerRuntime(room, playerId, fromClubId, toClubId);
  cancelCompetingDeals(room, state, playerId, offerId, listingId);

  const transaction = transactionRecord(room, synchronized.player, {
    id: transactionId,
    dealType,
    fromClubId,
    toClubId,
    amount,
    terms,
    contractTerms: normalizedContractTerms,
    offerId,
    listingId,
    completedAt,
  });
  replaceOrAppendTransaction(state, transaction);
  recordLedger(buyerFinance, { id: transactionId, type: "expense", amount, completedAt, playerId });
  recordLedger(sellerFinance, { id: transactionId, type: "income", amount, completedAt, playerId });
  activity(
    state,
    `${transaction.player.name} ${dealType === "loan" ? "foi emprestado" : "foi transferido"} para ${clubName(room, toClubId)}.`,
    now,
    dealType,
  );
  assertMarketIntegrity(room, playerId, {
    allowedOfferId: offerId,
    allowedListingId: listingId,
    transactionId,
  });
  return transaction;
}

function resultReferences(state, result) {
  return {
    ...(result.listingId ? { listing: state.activeListings.find((item) => item.id === result.listingId) ?? null } : {}),
    ...(result.offerId ? { offer: state.activeOffers.find((item) => item.id === result.offerId) ?? null } : {}),
    ...(result.transactionId
      ? { transaction: state.transactions.find((item) => item.id === result.transactionId) ?? null }
      : {}),
    ...(result.cancelled ? { cancelled: true } : {}),
  };
}

function activeOfferForPlayer(state, playerId) {
  return state.activeOffers.find((offer) => (
    identifiersEqual(offer.player?.id, playerId) && ["pending", "countered"].includes(offer.status)
  ));
}

function activeListingForPlayer(state, playerId) {
  return state.activeListings.find((listing) => (
    identifiersEqual(listing.player?.id, playerId) && listing.status === "open"
  ));
}

function activeScheduledForPlayer(state, playerId) {
  return state.scheduledTransfers.find((transfer) => (
    identifiersEqual(transfer?.playerId, playerId) && transfer?.status === "scheduled"
  ));
}

function activeOfferForBuyer(state, buyerManagerId, playerId, dealType) {
  return state.activeOffers.find((offer) => (
    offer.buyerManagerId === buyerManagerId
    && identifiersEqual(offer.player?.id, playerId)
    && offer.dealType === dealType
    && ["pending", "countered"].includes(offer.status)
  ));
}

function closeLinkedOffers(room, state, listingId, status, now) {
  let count = 0;
  for (const offer of state.activeOffers) {
    if (offer.listingId !== listingId || !["pending", "countered"].includes(offer.status)) continue;
    release(financeFor(state, room, offer.buyerClubId), offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = status;
    offer.updatedAt = timestamp(now);
    offer.revision = state.revision + 1;
    count += 1;
  }
  return count;
}

function assertPlayerOwnership(room, player, expectedClubId) {
  return assertDealOwnership(room, player, expectedClubId);
}

export class MarketError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "MarketError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function createListingInternal(room, managerId, input, player, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "list", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const manager = managerFor(room, managerId);
  assertTransferWindow(room, now);
  const sellerClubId = assertPlayerOwnership(room, player, manager.clubId);
  if (activeScheduledForPlayer(state, player.id)) {
    throw new MarketError("Jogador ja possui transferencia agendada", "MARKET_PLAYER_SCHEDULED", 409);
  }
  if (activeListingForPlayer(state, identifier(player.id)) || activeOfferForPlayer(state, identifier(player.id))) {
    throw new MarketError("Jogador ja possui negociacao ativa", "MARKET_PLAYER_BUSY", 409);
  }
  if (state.activeListings.filter((listing) => listing.status === "open").length >= MAX_LISTINGS) {
    throw new MarketError("Limite de anuncios ativos atingido", "MARKET_LISTING_LIMIT", 409);
  }
  const mode = input.mode === "auction" ? "auction" : "direct";
  const dealType = input.dealType === "loan" ? "loan" : "transfer";
  const durationHours = Math.max(1, Math.min(168, integer(input.expiresInHours, 24, 168)));
  const expiresAt = new Date(new Date(now).getTime() + durationHours * 3_600_000).toISOString();
  const askingPrice = mode === "direct" ? money(input.askingPrice, "askingPrice") : null;
  const minimumBid = mode === "auction" ? money(input.minimumBid, "minimumBid") : null;
  const listing = {
    id: randomUUID(),
    mode,
    dealType,
    status: "open",
    player: marketPlayerSummary(room, player, sellerClubId),
    playerSnapshot: structuredClone(player),
    sellerClubId,
    sellerClubName: clubName(room, sellerClubId),
    sellerManagerId: managerId,
    askingPrice,
    minimumBid,
    currentBid: null,
    bidCount: 0,
    highestBid: null,
    expiresAt,
    loanTerms: dealType === "loan" ? loanTermsWithFee(input.loanTerms, askingPrice ?? minimumBid) : null,
    createdAt: timestamp(now),
    revision: state.revision + 1,
  };
  state.activeListings = boundedDeals(
    [...state.activeListings, listing],
    MAX_LISTINGS,
    (candidate) => candidate?.status === "open",
  );
  touch(state, now);
  activity(state, `${manager.name} anunciou ${listing.player.name}.`, now, "listing", manager.name);
  const requestResult = { listingId: listing.id };
  rememberRequest(state, managerId, "list", input.requestId, requestResult);
  return { listing };
}

function cancelListingInternal(room, managerId, input, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "cancel-listing", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const listing = state.activeListings.find((candidate) => candidate.id === input.listingId);
  if (!listing) throw new MarketError("Anuncio nao encontrado", "MARKET_LISTING_NOT_FOUND", 404);
  if (listing.sellerManagerId !== managerId) {
    throw new MarketError("Somente o vendedor pode cancelar", "MARKET_LISTING_FORBIDDEN", 403);
  }
  if (listing.status !== "open") throw new MarketError("Anuncio nao esta aberto", "MARKET_LISTING_CLOSED", 409);
  if (listing.highestBid) {
    throw new MarketError("Leilao com lance nao pode ser cancelado", "MARKET_AUCTION_HAS_BIDS", 409);
  }
  closeLinkedOffers(room, state, listing.id, "cancelled", now);
  listing.status = "cancelled";
  listing.revision = state.revision + 1;
  touch(state, now);
  activity(state, `Anuncio de ${listing.player.name} foi cancelado.`, now, "listing-cancelled");
  const requestResult = { listingId: listing.id, cancelled: true };
  rememberRequest(state, managerId, "cancel-listing", input.requestId, requestResult);
  return { listing, cancelled: true };
}

function offerExpiry(now) {
  return new Date(new Date(now).getTime() + 48 * 3_600_000).toISOString();
}

function negotiationBonusFor(room, clubId, now) {
  const bonus = Number(calculateStaffEffects(room, clubId, now)?.negotiationBonus);
  return Number.isFinite(bonus) ? Math.min(0.12, Math.max(0, bonus)) : 0;
}

function createOfferInternal(room, managerId, input, player, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "offer", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const buyer = managerFor(room, managerId);
  const buyerClubId = buyer.clubId;
  assertTransferWindow(room, now);
  const sellerClubId = actualOwnership(room, player);
  if (!sellerClubId) throw new MarketError("Clube vendedor desconhecido", "MARKET_SELLER_NOT_FOUND", 409);
  if (clubKey(buyerClubId) === clubKey(sellerClubId)) {
    throw new MarketError("Nao e possivel contratar jogador do proprio clube", "MARKET_SELF_DEAL", 409);
  }
  const registration = registrationForPlayer(room, player.id);
  if (registration?.loan) throw new MarketError("Jogador emprestado nao pode ser negociado", "MARKET_PLAYER_ON_LOAN", 409);
  if (activeScheduledForPlayer(state, player.id)) {
    throw new MarketError("Jogador ja possui transferencia agendada", "MARKET_PLAYER_SCHEDULED", 409);
  }
  const dealType = input.dealType === "loan" ? "loan" : "transfer";
  const freeAgent = clubKey(sellerClubId) === clubKey(FREE_AGENT_CLUB_ID);
  if (freeAgent && dealType === "loan") {
    throw new MarketError("Agente livre nao pode ser emprestado", "MARKET_FREE_AGENT_LOAN", 409);
  }
  if (activeOfferForBuyer(state, managerId, player.id, dealType)) {
    throw new MarketError(
      "Ja existe uma proposta ativa deste clube pelo jogador",
      "MARKET_OFFER_DUPLICATE",
      409,
    );
  }
  const managerOfferCount = state.activeOffers.filter((offer) => (
    offer.buyerManagerId === managerId && ["pending", "countered"].includes(offer.status)
  )).length;
  if (managerOfferCount >= MAX_ACTIVE_OFFERS_PER_MANAGER) {
    throw new MarketError(
      "Limite de propostas ativas deste manager atingido",
      "MARKET_MANAGER_OFFER_LIMIT",
      409,
    );
  }
  if (state.activeOffers.filter((offer) => ["pending", "countered"].includes(offer.status)).length >= MAX_OFFERS) {
    throw new MarketError("Limite de propostas ativas atingido", "MARKET_OFFER_LIMIT", 409);
  }
  const playerListing = activeListingForPlayer(state, identifier(player.id));
  if (!input.listingId && playerListing) {
    if (isExpired(playerListing.expiresAt, now)) {
      throw new MarketError("Anuncio expirado", "MARKET_LISTING_EXPIRED", 409);
    }
    throw new MarketError(
      "Use o anuncio ativo para negociar este jogador",
      "MARKET_LISTING_REQUIRED",
      409,
    );
  }
  const listing = input.listingId
    ? state.activeListings.find((candidate) => candidate.id === input.listingId)
    : null;
  if (input.listingId && !listing) throw new MarketError("Anuncio nao encontrado", "MARKET_LISTING_NOT_FOUND", 404);
  if (listing) {
    if (listing.status !== "open") throw new MarketError("Anuncio nao esta aberto", "MARKET_LISTING_CLOSED", 409);
    if (isExpired(listing.expiresAt, now)) {
      throw new MarketError("Anuncio expirado", "MARKET_LISTING_EXPIRED", 409);
    }
    if (listing.mode === "auction") throw new MarketError("Use lance para participar do leilao", "MARKET_BID_REQUIRED", 409);
    if (!identifiersEqual(listing.player.id, player.id)) {
      throw new MarketError("Jogador do anuncio mudou", "MARKET_LISTING_PLAYER_CHANGED", 409);
    }
  }
  if (listing && listing.dealType !== dealType) throw new MarketError("Tipo da negociacao mudou", "MARKET_DEAL_TYPE_CHANGED", 409);
  const amount = money(input.amount);
  const normalizedLoanTerms = dealType === "loan"
    ? loanTermsWithFee(listing ? listing.loanTerms : input.loanTerms, amount)
    : null;
  const contractTerms = normalizeContractTerms(room, player, input.contractTerms);
  const reservedAmount = amount + integer(normalizedLoanTerms?.purchaseObligation, 0, MAX_MONEY);
  const buyerFinance = financeFor(state, room, buyerClubId);
  reserveTransfer(state, room, buyerClubId, reservedAmount);
  const seller = freeAgent ? null : managerForClub(room, sellerClubId);
  const offer = {
    id: randomUUID(),
    listingId: listing?.id ?? null,
    player: marketPlayerSummary(room, player, sellerClubId),
    playerSnapshot: structuredClone(player),
    buyerClubId,
    buyerClubName: clubName(room, buyerClubId),
    buyerManagerId: managerId,
    sellerClubId,
    sellerClubName: clubName(room, sellerClubId),
    sellerManagerId: seller?.id ?? null,
    dealType,
    amount,
    reservedAmount,
    counterAmount: null,
    loanTerms: normalizedLoanTerms,
    contractTerms,
    status: "pending",
    message: identifier(input.message) || null,
    createdAt: timestamp(now),
    updatedAt: timestamp(now),
    expiresAt: offerExpiry(now),
    revision: state.revision + 1,
  };
  state.activeOffers = boundedDeals(
    [...state.activeOffers, offer],
    MAX_OFFERS,
    (candidate) => ["pending", "countered"].includes(candidate?.status),
  );

  let transaction = null;
  const asking = listing?.askingPrice
    ?? (freeAgent
      ? Math.max(250_000, defaultWage(player) * 6)
      : dealType === "loan"
      ? Math.max(500_000, Math.round(marketValueForPlayer(player) * 0.10))
      : marketValueForPlayer(player));
  const negotiationBonus = !listing && !seller
    ? negotiationBonusFor(room, buyerClubId, now)
    : 0;
  const effectiveAsking = negotiationBonus > 0
    ? Math.max(1, Math.ceil(asking * (1 - negotiationBonus)))
    : asking;
  offer.baseAskingAmount = asking;
  offer.effectiveAskingAmount = effectiveAsking;
  offer.negotiationBonusApplied = negotiationBonus;
  if (listing && listing.mode === "direct" && amount >= asking) {
    release(buyerFinance, offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = "accepted";
    transaction = completeDeal(room, state, {
      player,
      fromClubId: sellerClubId,
      toClubId: buyerClubId,
      dealType,
      amount,
      loanTerms: offer.loanTerms,
      contractTerms: offer.contractTerms,
      offerId: offer.id,
      listingId: listing.id,
      now,
    });
    listing.status = "completed";
  } else if (!seller) {
    if (amount >= effectiveAsking) {
      release(buyerFinance, offer.reservedAmount);
      offer.reservedAmount = 0;
      offer.status = "accepted";
      transaction = completeDeal(room, state, {
        player,
        fromClubId: sellerClubId,
        toClubId: buyerClubId,
        dealType,
        amount,
        loanTerms: offer.loanTerms,
        contractTerms: offer.contractTerms,
        offerId: offer.id,
        listingId: listing?.id,
        now,
      });
      if (listing) listing.status = "completed";
    } else if (amount >= Math.ceil(effectiveAsking * 0.85)) {
      release(buyerFinance, offer.reservedAmount);
      offer.reservedAmount = 0;
      offer.status = "countered";
      offer.counterAmount = effectiveAsking;
    } else {
      release(buyerFinance, offer.reservedAmount);
      offer.reservedAmount = 0;
      offer.status = "rejected";
    }
  }
  touch(state, now);
  offer.updatedAt = state.updatedAt;
  activity(state, `${buyer.name} enviou proposta por ${offer.player.name}.`, now, "offer", buyer.name);
  const requestResult = {
    offerId: offer.id,
    ...(transaction ? { transactionId: transaction.id } : {}),
  };
  rememberRequest(state, managerId, "offer", input.requestId, requestResult);
  return { offer, transaction };
}

function respondOfferInternal(room, managerId, input, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "respond", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const actor = managerFor(room, managerId);
  const offer = state.activeOffers.find((candidate) => candidate.id === input.offerId);
  if (!offer) throw new MarketError("Proposta nao encontrada", "MARKET_OFFER_NOT_FOUND", 404);
  if (!["pending", "countered"].includes(offer.status)) {
    throw new MarketError("Proposta nao esta aberta", "MARKET_OFFER_CLOSED", 409);
  }
  const isBuyer = offer.buyerManagerId === managerId;
  const isSeller = offer.sellerManagerId === managerId;
  if (!isBuyer && !isSeller) throw new MarketError("Proposta nao pertence a este manager", "MARKET_OFFER_FORBIDDEN", 403);
  if (isExpired(offer.expiresAt, now)) {
    throw new MarketError("Proposta expirada", "MARKET_OFFER_EXPIRED", 409);
  }
  if (offer.listingId) {
    const linkedListing = state.activeListings.find((candidate) => candidate.id === offer.listingId);
    if (!linkedListing || linkedListing.status !== "open") {
      throw new MarketError("Anuncio nao esta aberto", "MARKET_LISTING_CLOSED", 409);
    }
    if (isExpired(linkedListing.expiresAt, now)) {
      throw new MarketError("Anuncio expirado", "MARKET_LISTING_EXPIRED", 409);
    }
  }
  const buyerFinance = financeFor(state, room, offer.buyerClubId);
  let transaction = null;
  let cancelled = false;

  if (input.action === "counter") {
    if (!isSeller || offer.status !== "pending") {
      throw new MarketError("Somente vendedor pode fazer contraproposta", "MARKET_COUNTER_FORBIDDEN", 403);
    }
    const counterAmount = money(input.counterAmount, "counterAmount");
    release(buyerFinance, offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.counterAmount = counterAmount;
    offer.status = "countered";
  } else if (input.action === "accept") {
    if (offer.status === "pending" && !isSeller) {
      throw new MarketError("Somente vendedor pode aceitar esta proposta", "MARKET_ACCEPT_FORBIDDEN", 403);
    }
    if (offer.status === "countered" && !isBuyer) {
      throw new MarketError("Somente comprador pode aceitar a contraproposta", "MARKET_ACCEPT_FORBIDDEN", 403);
    }
    const finalAmount = offer.status === "countered" ? offer.counterAmount : offer.amount;
    if (!finalAmount) throw new MarketError("Valor final invalido", "MARKET_AMOUNT_INVALID", 409);
    const finalReservation = finalAmount + integer(offer.loanTerms?.purchaseObligation, 0, MAX_MONEY);
    if (offer.reservedAmount > 0) release(buyerFinance, offer.reservedAmount);
    reserveTransfer(state, room, offer.buyerClubId, finalReservation);
    release(buyerFinance, finalReservation);
    offer.reservedAmount = 0;
    transaction = completeDeal(room, state, {
      player: offer.playerSnapshot,
      fromClubId: offer.sellerClubId,
      toClubId: offer.buyerClubId,
      dealType: offer.dealType,
      amount: finalAmount,
      loanTerms: offer.loanTerms,
      contractTerms: offer.contractTerms,
      offerId: offer.id,
      listingId: offer.listingId,
      now,
    });
    offer.status = "accepted";
    const listing = offer.listingId
      ? state.activeListings.find((candidate) => candidate.id === offer.listingId)
      : null;
    if (listing) listing.status = "completed";
  } else if (input.action === "cancel") {
    if (!isBuyer) throw new MarketError("Somente comprador pode cancelar", "MARKET_CANCEL_FORBIDDEN", 403);
    release(buyerFinance, offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = "cancelled";
    cancelled = true;
  } else if (input.action === "reject") {
    if (offer.status === "pending" && !isSeller) {
      throw new MarketError("Somente vendedor pode rejeitar esta proposta", "MARKET_REJECT_FORBIDDEN", 403);
    }
    if (offer.status === "countered" && !isBuyer) {
      throw new MarketError("Somente comprador pode rejeitar a contraproposta", "MARKET_REJECT_FORBIDDEN", 403);
    }
    release(buyerFinance, offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = "rejected";
  }
  offer.updatedAt = timestamp(now);
  offer.revision = state.revision + 1;
  touch(state, now);
  activity(state, `${actor.name} atualizou proposta por ${offer.player.name}.`, now, "offer-response", actor.name);
  const requestResult = {
    offerId: offer.id,
    ...(transaction ? { transactionId: transaction.id } : {}),
    ...(cancelled ? { cancelled: true } : {}),
  };
  rememberRequest(state, managerId, "respond", input.requestId, requestResult);
  return { offer, transaction, cancelled };
}

function placeClubBid(room, state, listing, bidder, amountValue, now = new Date()) {
  if (!listing) throw new MarketError("Leilao nao encontrado", "MARKET_LISTING_NOT_FOUND", 404);
  if (listing.mode !== "auction") throw new MarketError("Anuncio nao e leilao", "MARKET_NOT_AUCTION", 409);
  if (listing.status !== "open") throw new MarketError("Leilao encerrado", "MARKET_LISTING_CLOSED", 409);
  if (new Date(listing.expiresAt).getTime() <= new Date(now).getTime()) {
    throw new MarketError("Leilao encerrado", "MARKET_LISTING_EXPIRED", 409);
  }
  if (clubKey(listing.sellerClubId) === clubKey(bidder.clubId)) {
    throw new MarketError("Vendedor nao pode dar lance", "MARKET_SELF_DEAL", 409);
  }
  const amount = money(amountValue);
  const bidIncrement = Math.max(1, integer(listing.bidIncrement, 500_000, MAX_MONEY));
  const minimum = listing.currentBid === null
    ? listing.minimumBid
    : listing.currentBid + bidIncrement;
  if (amount < minimum) {
    throw new MarketError("Lance abaixo do minimo", "MARKET_BID_TOO_LOW", 409, { minimum });
  }
  const bidderFinance = financeFor(state, room, bidder.clubId);
  const reservedAmount = amount + integer(listing.loanTerms?.purchaseObligation, 0, MAX_MONEY);
  if (listing.highestBid && identifiersEqual(listing.highestBid.clubId, bidder.clubId)) {
    release(bidderFinance, listing.highestBid.reservedAmount ?? listing.highestBid.amount);
  }
  reserveTransfer(state, room, bidder.clubId, reservedAmount);
  if (listing.highestBid && !identifiersEqual(listing.highestBid.clubId, bidder.clubId)) {
    release(
      financeFor(state, room, listing.highestBid.clubId),
      listing.highestBid.reservedAmount ?? listing.highestBid.amount,
    );
  }
  listing.highestBid = {
    managerId: identifier(bidder.managerId) || null,
    clubId: bidder.clubId,
    clubName: clubName(room, bidder.clubId),
    amount,
    reservedAmount,
    createdAt: timestamp(now),
  };
  listing.currentBid = amount;
  listing.bidCount = integer(listing.bidCount) + 1;
  listing.revision = state.revision + 1;
  return listing;
}

function placeBidInternal(room, managerId, input, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "bid", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const manager = managerFor(room, managerId);
  const listing = state.activeListings.find((candidate) => candidate.id === input.listingId);
  placeClubBid(room, state, listing, {
    managerId,
    clubId: manager.clubId,
  }, input.amount, now);
  touch(state, now);
  activity(state, `${manager.name} deu lance por ${listing.player.name}.`, now, "bid", manager.name);
  const requestResult = { listingId: listing.id };
  rememberRequest(state, managerId, "bid", input.requestId, requestResult);
  return { listing };
}

function settleAuctionListing(room, state, listing, now = new Date()) {
  if (!listing?.highestBid) {
    throw new MarketError("Leilao sem lance vencedor", "MARKET_AUCTION_NO_BID", 409);
  }
  const bidderFinance = financeFor(state, room, listing.highestBid.clubId);
  release(bidderFinance, listing.highestBid.reservedAmount ?? listing.highestBid.amount);
  const transaction = completeDeal(room, state, {
    player: listing.playerSnapshot,
    fromClubId: listing.sellerClubId,
    toClubId: listing.highestBid.clubId,
    dealType: listing.dealType,
    amount: listing.highestBid.amount,
    loanTerms: listing.loanTerms,
    contractTerms: listing.contractTerms,
    listingId: listing.id,
    now,
  });
  listing.status = "completed";
  listing.revision = state.revision + 1;
  return transaction;
}

function expireOffers(room, state, now) {
  let changed = false;
  const nowMs = new Date(now).getTime();
  for (const offer of state.activeOffers) {
    if (!["pending", "countered"].includes(offer.status)) continue;
    if (new Date(offer.expiresAt).getTime() > nowMs) continue;
    release(financeFor(state, room, offer.buyerClubId), offer.reservedAmount);
    offer.reservedAmount = 0;
    offer.status = "expired";
    offer.updatedAt = timestamp(now);
    changed = true;
  }
  return changed;
}

function settleExpiredMarketInternal(room, now = new Date()) {
  const state = ensureMarketState(room, now);
  let changed = expireOffers(room, state, now);
  const transactions = [];
  const nowMs = new Date(now).getTime();
  for (const listing of state.activeListings) {
    if (listing.status !== "open" || new Date(listing.expiresAt).getTime() > nowMs) continue;
    if (listing.mode === "auction" && listing.highestBid) {
      const transaction = settleAuctionListing(room, state, listing, now);
      transactions.push(transaction);
    } else {
      closeLinkedOffers(room, state, listing.id, "expired", now);
      listing.status = "expired";
    }
    listing.revision = state.revision + 1;
    changed = true;
  }
  if (changed) {
    touch(state, now);
    activity(state, "Mercado atualizou negociacoes expiradas.", now, "settlement");
  }
  return { changed, transactions };
}

function closeLoanHistory(state, registration, loan, disposition, now, transactionId = null) {
  const endedAt = timestamp(now);
  const closed = {
    ...structuredClone(loan),
    playerId: registration.playerId,
    endsAt: endedAt,
    status: disposition,
    transactionId,
  };
  state.loanHistory.push(closed);
  state.loanHistory = state.loanHistory.slice(-MAX_TRANSACTIONS);
  const original = state.transactions.find((transaction) => transaction?.id === loan.id);
  if (original) {
    original.loanStatus = disposition;
    original.returnedAt = endedAt;
  }
  return closed;
}

function syncReturnedLoanPlayer(
  room,
  registration,
  loan,
  now,
  effectiveSeason = currentSeason(room),
) {
  const source = sourcePlayer(room, registration, registration.playerSnapshot);
  const ownerClubId = identifier(registration.permanentClubId || loan.lenderClubId);
  const contract = principalContractFor(room, registration, source, ownerClubId, now);
  const historyId = randomUUID();
  const completedAt = timestamp(now);
  const entry = transferHistoryEntry({
    id: historyId,
    playerId: registration.playerId,
    eventType: "loan-return",
    fromClubId: loan.borrowerClubId,
    toClubId: ownerClubId,
    amount: 0,
    completedAt,
    seasonNumber: currentSeason(room),
    contractId: identifier(contract.id) || null,
    loanId: loan.id,
  });
  const updated = {
    ...source,
    id: registration.playerId,
    clubId: ownerClubId,
    currentClubId: ownerClubId,
    ownerClubId,
    contract,
    loan: null,
  };
  registration.currentClubId = ownerClubId;
  registration.permanentClubId = ownerClubId;
  registration.loan = null;
  recordCareerHistory(room, registration, updated, entry);
  syncCompetitionRegistrations(
    room,
    registration,
    updated,
    ownerClubId,
    completedAt,
    effectiveSeason,
  );
  registration.playerSnapshot = structuredClone(updated);
  setCareerPlayer(room, updated);
  movePlayerRuntime(room, registration.playerId, loan.borrowerClubId, ownerClubId);
  const transaction = transactionRecord(room, updated, {
    id: historyId,
    dealType: "loan",
    eventType: "loan-return",
    fromClubId: loan.borrowerClubId,
    toClubId: ownerClubId,
    amount: 0,
    terms: loan.terms,
    contractTerms: loan.contractTerms,
    completedAt,
  });
  replaceOrAppendTransaction(room.marketState, transaction);
  closeLoanHistory(room.marketState, registration, loan, "returned", now, historyId);
  activity(
    room.marketState,
    `${updated.name ?? "Jogador"} retornou para ${clubName(room, ownerClubId)}.`,
    now,
    "loan-return",
  );
  assertMarketIntegrity(room, registration.playerId, { transactionId: historyId });
  return { registration, transaction, disposition: "returned" };
}

function convertLoanToTransfer(
  room,
  state,
  registration,
  amount,
  now,
  eventType,
  effectiveSeason = currentSeason(room),
) {
  const loan = registration.loan;
  if (!loan) throw new MarketError("Emprestimo nao encontrado", "MARKET_LOAN_NOT_FOUND", 404);
  const buyerFinance = financeFor(state, room, loan.borrowerClubId);
  const sellerFinance = financeFor(state, room, loan.lenderClubId, true);
  const reserved = integer(loan.obligationReserved, 0, MAX_MONEY);
  if (reserved > 0) release(buyerFinance, reserved);
  const terms = normalizeContractTerms(room, registration.playerSnapshot, {
    ...loan.contractTerms,
    effectiveSeason,
  });
  assertWageBudget(
    room,
    state,
    loan.borrowerClubId,
    registration.playerSnapshot,
    "transfer",
    null,
    terms,
  );
  if (availableTransferFinance(state, room, loan.borrowerClubId) < amount) {
    throw new MarketError("Orcamento insuficiente para comprar o emprestado", "MARKET_BUDGET_INSUFFICIENT", 409);
  }
  debitTransfer(state, room, loan.borrowerClubId, amount);
  creditTransfer(state, room, loan.lenderClubId, amount);
  const transactionId = randomUUID();
  const completedAt = timestamp(now);
  const synchronized = syncPermanentPlayer(room, registration, registration.playerSnapshot, {
    fromClubId: loan.lenderClubId,
    toClubId: loan.borrowerClubId,
    amount,
    transactionId,
    completedAt,
    contractTerms: terms,
    eventType,
  });
  const transaction = transactionRecord(room, synchronized.player, {
    id: transactionId,
    dealType: "transfer",
    eventType,
    fromClubId: loan.lenderClubId,
    toClubId: loan.borrowerClubId,
    amount,
    contractTerms: terms,
    completedAt,
  });
  replaceOrAppendTransaction(state, transaction);
  recordLedger(buyerFinance, { id: transactionId, type: "expense", amount, completedAt, playerId: registration.playerId });
  recordLedger(sellerFinance, { id: transactionId, type: "income", amount, completedAt, playerId: registration.playerId });
  closeLoanHistory(state, registration, loan, "converted", now, transactionId);
  cancelCompetingDeals(room, state, registration.playerId, null, null);
  activity(
    state,
    `${synchronized.player.name ?? "Jogador"} foi comprado em definitivo por ${clubName(room, loan.borrowerClubId)}.`,
    now,
    "loan-conversion",
  );
  assertMarketIntegrity(room, registration.playerId, { transactionId });
  return { registration, transaction, disposition: "converted" };
}

function finishLoan(room, state, registration, now, effectiveSeason = currentSeason(room)) {
  const loan = registration.loan;
  if (!loan) return null;
  const obligation = integer(loan.terms?.purchaseObligation, 0, MAX_MONEY);
  if (obligation > 0) {
    return convertLoanToTransfer(
      room,
      state,
      registration,
      obligation,
      now,
      "loan-obligation",
      effectiveSeason,
    );
  }
  if (loan.obligationReserved > 0) {
    release(financeFor(state, room, loan.borrowerClubId), loan.obligationReserved);
  }
  return syncReturnedLoanPlayer(room, registration, loan, now, effectiveSeason);
}

function exerciseLoanOptionInternal(room, managerId, input, now = new Date()) {
  const state = ensureMarketState(room, now);
  const duplicate = previousRequest(state, managerId, "exercise-loan-option", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const manager = managerFor(room, managerId);
  const registration = state.registrations.find((candidate) => (
    identifiersEqual(candidate?.playerId, input.playerId)
    || identifier(candidate?.loan?.id) === identifier(input.loanId)
  ));
  const loan = registration?.loan;
  if (!loan) throw new MarketError("Emprestimo nao encontrado", "MARKET_LOAN_NOT_FOUND", 404);
  if (!identifiersEqual(manager.clubId, loan.borrowerClubId)) {
    throw new MarketError("Somente o clube tomador pode exercer a opcao", "MARKET_LOAN_OPTION_FORBIDDEN", 403);
  }
  const amount = integer(loan.terms?.purchaseOption, 0, MAX_MONEY);
  if (amount <= 0) throw new MarketError("Emprestimo nao possui opcao de compra", "MARKET_LOAN_OPTION_MISSING", 409);
  const result = convertLoanToTransfer(room, state, registration, amount, now, "loan-option");
  touch(state, now);
  rememberRequest(state, managerId, "exercise-loan-option", input.requestId, {
    transactionId: result.transaction.id,
  });
  return result;
}

function scheduledCancellationReason(error) {
  if (error?.code === "MARKET_SQUAD_FULL") return "squad-full";
  return identifier(error?.code)
    .toLocaleLowerCase("pt-BR")
    .replace(/^market_/, "")
    .replaceAll("_", "-") || "validation-failed";
}

function cancelScheduledTransfer(room, state, scheduled, now, reason, errorCode = null) {
  const buyerFinance = financeFor(state, room, scheduled.toClubId);
  release(buyerFinance, scheduled.reservedAmount);
  scheduled.reservedAmount = 0;
  scheduled.status = "cancelled";
  scheduled.cancelledAt = timestamp(now);
  scheduled.reason = reason;
  scheduled.errorCode = errorCode;
  const transaction = state.transactions.find((candidate) => candidate.id === scheduled.transactionId);
  if (transaction) {
    transaction.status = "cancelled";
    transaction.cancelledAt = scheduled.cancelledAt;
    transaction.reason = reason;
    transaction.errorCode = errorCode;
  }
  return scheduled;
}

function processScheduledTransfersInternal(room, seasonNumber, now = new Date()) {
  const initialState = ensureMarketState(room, now);
  const season = Math.max(1, integer(seasonNumber, 1));
  const completed = [];
  const cancelled = [];
  const dueIds = initialState.scheduledTransfers
    .filter((scheduled) => (
      scheduled.status === "scheduled" && integer(scheduled.effectiveSeason) <= season
    ))
    .map((scheduled) => scheduled.id);
  for (const scheduledId of dueIds) {
    const beforeItem = structuredClone(room);
    try {
      const state = ensureMarketState(room, now);
      const scheduled = state.scheduledTransfers.find((candidate) => candidate.id === scheduledId);
      if (!scheduled || scheduled.status !== "scheduled") continue;
      const actual = actualOwnership(room, scheduled.playerSnapshot);
      if (!actual || !identifiersEqual(actual, scheduled.fromClubId)) {
        cancelled.push(cancelScheduledTransfer(
          room,
          state,
          scheduled,
          now,
          "player-club-changed",
          "MARKET_PLAYER_CLUB_CHANGED",
        ));
        continue;
      }
      assertSquadCapacity(room, scheduled.toClubId, scheduled.playerId, {
        effectiveSeason: scheduled.effectiveSeason,
        includeScheduled: false,
      });
      const buyerFinance = financeFor(state, room, scheduled.toClubId);
      release(buyerFinance, scheduled.reservedAmount);
      scheduled.reservedAmount = 0;
      const transaction = completeDeal(room, state, {
        player: scheduled.playerSnapshot,
        fromClubId: scheduled.fromClubId,
        toClubId: scheduled.toClubId,
        dealType: "transfer",
        amount: scheduled.amount,
        contractTerms: scheduled.contractTerms,
        transactionId: scheduled.transactionId,
        executionSeason: Math.max(1, integer(scheduled.effectiveSeason, season)),
        skipWindow: true,
        now,
      });
      scheduled.status = "completed";
      scheduled.completedAt = timestamp(now);
      completed.push(transaction);
    } catch (error) {
      if (!(error instanceof MarketError)) throw error;
      restoreRoom(room, beforeItem);
      const restoredState = ensureMarketState(room, now);
      const restoredScheduled = restoredState.scheduledTransfers.find(
        (candidate) => candidate.id === scheduledId,
      );
      if (!restoredScheduled || restoredScheduled.status !== "scheduled") throw error;
      cancelled.push(cancelScheduledTransfer(
        room,
        restoredState,
        restoredScheduled,
        now,
        scheduledCancellationReason(error),
        error.code,
      ));
    }
  }
  if (completed.length || cancelled.length) touch(ensureMarketState(room, now), now);
  return { changed: completed.length > 0 || cancelled.length > 0, completed, cancelled };
}

function leagueKeyForClub(room, clubId) {
  const targetClubKey = clubKey(clubId);
  const league = (room.competitionCatalog ?? []).find((candidate) => (
    (candidate?.clubs ?? []).some((club) => clubKey(club?.id) === targetClubKey)
  ));
  return identifierKey(league?.id);
}

function advanceMarketLoansInternal(room, seasonNumber, round, now = new Date(), leagueId = null) {
  const state = ensureMarketState(room, now);
  const season = Math.max(1, integer(seasonNumber, 1));
  const normalizedRound = Math.max(1, integer(round, 1));
  const targetLeagueKey = identifierKey(leagueId);
  const legacyRoundKey = `${season}:${normalizedRound}`;
  const roundKey = targetLeagueKey
    ? `${season}:${targetLeagueKey}:${normalizedRound}`
    : legacyRoundKey;
  if (state.advancedLoanRoundKeys.includes(roundKey)
    || (!targetLeagueKey && state.lastAdvancedRoundKey === legacyRoundKey)) {
    return { changed: false, returned: [] };
  }
  state.lastAdvancedRoundKey = roundKey;
  state.advancedLoanRoundKeys.push(roundKey);
  state.advancedLoanRoundKeys = state.advancedLoanRoundKeys.slice(-500);
  const returned = [];
  let advanced = 0;
  for (const registration of state.registrations) {
    if (!registration.loan) continue;
    if (targetLeagueKey
      && leagueKeyForClub(room, registration.loan.borrowerClubId) !== targetLeagueKey) continue;
    advanced += 1;
    registration.loan.remainingRounds = Math.max(0, integer(registration.loan.remainingRounds) - 1);
    if (registration.loan.remainingRounds === 0) {
      const value = finishLoan(room, state, registration, now);
      if (value?.disposition === "returned") returned.push(value.registration);
      else if (value?.disposition === "converted") returned.push(value.registration);
    }
  }
  if (advanced > 0) touch(state, now);
  return { changed: advanced > 0, returned };
}

function returnLoansForSeasonInternal(room, nextSeasonNumber, now = new Date()) {
  const state = ensureMarketState(room, now);
  const returned = [];
  for (const registration of state.registrations) {
    if (!registration.loan || registration.loan.returnSeason > nextSeasonNumber) continue;
    const value = finishLoan(room, state, registration, now, nextSeasonNumber);
    if (value) returned.push(value.registration);
  }
  if (returned.length > 0) touch(state, now);
  return { changed: returned.length > 0, returned };
}

function reconcileMarketCareerStateInternal(room, now = new Date()) {
  const state = ensureMarketState(room, now);
  let changed = false;

  for (const career of careerPlayers(room)) {
    const playerId = identifier(career?.id);
    if (!playerId) continue;
    const registration = state.registrations.find((candidate) => identifiersEqual(candidate.playerId, playerId));
    if (!playerIsFreeAgent(career) && career.active !== false && career.retired !== true) {
      if (registration) {
        registration.playerSnapshot = structuredClone(career);
        registration.contractId = identifier(career.contract?.id) || registration.contractId;
      }
      continue;
    }

    const hadPendingDeal = state.activeOffers.some((offer) => (
      identifiersEqual(offer.player?.id, playerId) && ["pending", "countered"].includes(offer.status)
    )) || state.activeListings.some((listing) => (
      identifiersEqual(listing.player?.id, playerId) && listing.status === "open"
    ));
    cancelCompetingDeals(room, state, playerId, null, null);
    if (hadPendingDeal) changed = true;
    for (const scheduled of state.scheduledTransfers) {
      if (scheduled.status !== "scheduled" || !identifiersEqual(scheduled.playerId, playerId)) continue;
      release(financeFor(state, room, scheduled.toClubId), scheduled.reservedAmount);
      scheduled.reservedAmount = 0;
      scheduled.status = "cancelled";
      scheduled.cancelledAt = timestamp(now);
      scheduled.reason = "career-link-ended";
      const transaction = state.transactions.find((candidate) => candidate.id === scheduled.transactionId);
      if (transaction) {
        transaction.status = "cancelled";
        transaction.cancelledAt = scheduled.cancelledAt;
      }
      changed = true;
    }

    const updated = {
      ...structuredClone(career),
      clubId: null,
      currentClubId: null,
      ownerClubId: null,
      loan: null,
      competitionRegistrations: [],
    };
    if (registration) {
      registration.permanentClubId = FREE_AGENT_CLUB_ID;
      registration.currentClubId = FREE_AGENT_CLUB_ID;
      registration.contractId = null;
      registration.loan = null;
      registration.competitionRegistrations = [];
      registration.playerSnapshot = structuredClone(updated);
      changed = true;
    }
    setCareerPlayer(room, updated);
    room.playerCompetitionRegistrations = (room.playerCompetitionRegistrations ?? [])
      .filter((entry) => !identifiersEqual(entry?.playerId, playerId));
    room.playerStates = (room.playerStates ?? [])
      .filter((entry) => !identifiersEqual(entry?.playerId, playerId));
    room.lineups = (room.lineups ?? []).map((lineup) => ({
      ...lineup,
      lineupIds: (lineup.lineupIds ?? []).filter((id) => !identifiersEqual(id, playerId)),
    }));
    for (const morale of room.clubMoraleStates ?? []) {
      morale.playerDeltas = (morale.playerDeltas ?? [])
        .filter((entry) => !identifiersEqual(entry?.playerId, playerId));
    }
  }

  if (changed) touch(state, now);
  return { changed };
}

function publicListing(room, listing, manager) {
  const ownListing = listing.sellerManagerId === manager.id;
  return {
    id: listing.id,
    mode: listing.mode,
    dealType: listing.dealType,
    status: listing.status,
    player: structuredClone(listing.player),
    sellerClubId: listing.sellerClubId,
    sellerClubName: listing.sellerClubName,
    askingPrice: listing.askingPrice,
    minimumBid: listing.minimumBid,
    currentBid: listing.currentBid,
    bidCount: integer(listing.bidCount),
    expiresAt: listing.expiresAt,
    loanTerms: listing.loanTerms ? structuredClone(listing.loanTerms) : null,
    ownListing,
    canBid: listing.status === "open" && listing.mode === "auction" && !ownListing,
    canOffer: listing.status === "open" && listing.mode === "direct" && !ownListing,
    createdAt: listing.createdAt,
    revision: listing.revision,
  };
}

function stableAiScore(value) {
  let hash = 2166136261;
  for (const character of String(value ?? "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const AI_POSITION_TARGETS = Object.freeze({
  goalkeeper: 2,
  defense: 7,
  midfield: 7,
  attack: 4,
});
const AI_CLUB_STYLES = Object.freeze([
  "balanced",
  "possession",
  "counter",
  "pressing",
  "defensive",
  "attacking",
]);
const AI_MARKET_METHODS = new Set(["negotiation", "loan", "free-agent", "auction"]);

function aiClamp(value, minimum = 0, maximum = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function aiCompactFactor(value) {
  return Math.round(aiClamp(value) * 1_000) / 1_000;
}

function aiRating(value, fallback = 10) {
  let parsed = Number(value);
  if (!Number.isFinite(parsed)) parsed = fallback;
  if (parsed > 20) parsed /= 5;
  return aiClamp(parsed, 1, 20);
}

function aiNormalizedText(value) {
  return identifier(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function aiPositionGroup(player) {
  const position = aiNormalizedText(
    player?.position ?? player?.primaryPosition ?? player?.role,
  ).toLocaleUpperCase("pt-BR");
  if (["GOL", "GK", "GOALKEEPER"].some((value) => position.includes(value))) return "goalkeeper";
  if (["ZAG", "DC", "CB", "LD", "LE", "RB", "LB", "DEF"].some((value) => position.includes(value))) {
    return "defense";
  }
  if (["ATA", "CA", "ST", "CF", "PE", "PD", "LW", "RW", "ATT"].some((value) => position.includes(value))) {
    return "attack";
  }
  return "midfield";
}

function aiAttributeRating(player, names, fallback) {
  const attributes = player?.attributes && typeof player.attributes === "object"
    ? player.attributes
    : {};
  const normalized = new Map(Object.entries(attributes).map(([key, value]) => [
    aiNormalizedText(key).replaceAll(/[^a-z0-9]/g, ""),
    value,
  ]));
  for (const name of names) {
    const direct = player?.[name];
    if (Number.isFinite(Number(direct))) return aiRating(direct, fallback);
    const key = aiNormalizedText(name).replaceAll(/[^a-z0-9]/g, "");
    if (normalized.has(key)) return aiRating(normalized.get(key), fallback);
  }
  return aiRating(fallback, 10);
}

function aiPlayerOverall(player) {
  return aiRating(player?.overall ?? player?.rating ?? player?.currentAbility, 10);
}

function aiPlayerPotential(player) {
  return aiRating(
    player?.potential
      ?? player?.potentialOverall
      ?? player?.potentialAbility
      ?? player?.attributes?.potential,
    aiPlayerOverall(player),
  );
}

function aiClubReputation(club) {
  return aiRating(club?.reputation ?? club?.prestige ?? club?.rating, 10);
}

function aiStyleForClub(club) {
  const explicit = aiNormalizedText([
    club?.playingStyle,
    club?.tacticalStyle,
    club?.preferredStyle,
    club?.style,
    club?.philosophy,
  ].filter(Boolean).join(" "));
  if (explicit) return explicit;
  return AI_CLUB_STYLES[stableAiScore(club?.id ?? club?.code) % AI_CLUB_STYLES.length];
}

function aiStyleFit(player, styleValue) {
  const style = aiNormalizedText(styleValue);
  const overall = aiPlayerOverall(player);
  let names;
  if (style.includes("posse") || style.includes("possession") || style.includes("tiki")) {
    names = ["passing", "passe", "technique", "tecnica", "vision", "visao"];
  } else if (style.includes("contra") || style.includes("counter") || style.includes("vertical")) {
    names = ["pace", "velocidade", "acceleration", "aceleracao", "dribbling", "drible"];
  } else if (style.includes("press") || style.includes("intens")) {
    names = ["stamina", "resistencia", "workRate", "trabalho", "aggression", "agressividade"];
  } else if (style.includes("defens")) {
    names = ["tackling", "desarme", "marking", "marcacao", "positioning", "posicionamento"];
  } else if (style.includes("attack") || style.includes("ofens")) {
    names = ["finishing", "finalizacao", "offBall", "movimentacao", "creativity", "criatividade"];
  } else {
    names = aiPositionGroup(player) === "attack"
      ? ["finishing", "finalizacao", "dribbling", "drible"]
      : aiPositionGroup(player) === "defense"
        ? ["tackling", "desarme", "marking", "marcacao"]
        : aiPositionGroup(player) === "goalkeeper"
          ? ["reflexes", "reflexos", "handling", "manuseio"]
          : ["passing", "passe", "vision", "visao"];
  }
  const ratings = names.map((name) => aiAttributeRating(player, [name], overall));
  const average = ratings.reduce((sum, value) => sum + value, 0) / Math.max(1, ratings.length);
  return aiClamp((average - 4) / 16);
}

/** Pure strategic fit scorer used by the autonomous market. */
export function scoreAiTransferFit(player, context = {}) {
  const roster = Array.isArray(context.buyerRoster) ? context.buyerRoster : [];
  const club = context.buyerClub && typeof context.buyerClub === "object" ? context.buyerClub : {};
  const group = aiPositionGroup(player);
  const targetDepth = AI_POSITION_TARGETS[group];
  const groupPlayers = roster.filter((candidate) => aiPositionGroup(candidate) === group);
  const overall = aiPlayerOverall(player);
  const potential = Math.max(overall, aiPlayerPotential(player));
  const age = aiClamp(Number(player?.age) || 24, 14, 45);
  const groupAverage = groupPlayers.length > 0
    ? groupPlayers.reduce((sum, candidate) => sum + aiPlayerOverall(candidate), 0) / groupPlayers.length
    : Math.max(1, overall - 2);
  const value = Math.max(1, marketValueForPlayer(player));
  const wage = Math.max(1, defaultWage(player));
  const availableBudget = Math.max(0, Number(context.availableBudget) || 0);
  const wageBudget = Math.max(0, Number(context.wageBudget) || 0);
  const currentPayroll = Math.max(0, Number(context.currentPayroll) || 0);
  const wageHeadroom = Math.max(0, wageBudget - currentPayroll);
  const clubReputation = aiClubReputation(club);
  const stature = (overall * 0.7) + (potential * 0.3);
  const baselineValue = Math.max(1_000_000, overall * 2_000_000);
  const components = {
    positionalNeed: aiClamp((targetDepth + 1 - groupPlayers.length) / (targetDepth + 1)),
    depth: aiClamp(1 - (groupPlayers.length / Math.max(1, targetDepth * 1.75))),
    quality: aiClamp((overall - groupAverage + 4) / 8),
    age: aiClamp(1 - (Math.abs(age - 24) / 15)),
    potential: aiClamp((potential - overall + 2) / 8),
    value: aiClamp((baselineValue / value) / 1.35),
    wage: wageHeadroom > 0 ? aiClamp(1 - (wage / wageHeadroom)) : 0,
    budget: availableBudget > 0 ? aiClamp(availableBudget / Math.max(value, 1)) : 0,
    reputation: aiClamp(1 - (Math.max(0, stature - clubReputation - 2) / 12)),
    style: aiStyleFit(player, context.buyerStyle ?? aiStyleForClub(club)),
  };
  const score = (
    components.positionalNeed * 0.20
    + components.depth * 0.08
    + components.quality * 0.18
    + components.age * 0.07
    + components.potential * 0.12
    + components.value * 0.10
    + components.wage * 0.07
    + components.budget * 0.08
    + components.reputation * 0.04
    + components.style * 0.06
  ) * 100;
  return {
    score: Math.round(score * 100) / 100,
    positionGroup: group,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [
      key,
      aiCompactFactor(value),
    ])),
  };
}

function scoreAiSellerRelease(room, state, player, club, roster, financialContext = null) {
  const group = aiPositionGroup(player);
  const groupPlayers = roster.filter((candidate) => aiPositionGroup(candidate) === group);
  const targetDepth = AI_POSITION_TARGETS[group];
  const overall = aiPlayerOverall(player);
  const potential = Math.max(overall, aiPlayerPotential(player));
  const age = aiClamp(Number(player?.age) || 24, 14, 45);
  const average = groupPlayers.length > 0
    ? groupPlayers.reduce((sum, candidate) => sum + aiPlayerOverall(candidate), 0) / groupPlayers.length
    : overall;
  const { finance, profile } = financialContext ?? financeLimitsFor(state, room, club.id);
  const referenceBudget = Math.max(1, defaultBalance(room, club.id));
  const value = marketValueForPlayer(player);
  const wage = defaultWage(player);
  const components = {
    positionalSurplus: aiClamp((groupPlayers.length - targetDepth) / Math.max(1, targetDepth)),
    depth: aiClamp((roster.length - AI_MIN_SQUAD_AFTER_TRANSFER) / 12),
    quality: aiClamp((average - overall + 3) / 7),
    age: aiClamp((age - 25) / 10),
    potential: aiClamp(1 - ((potential - overall + 1) / 7)),
    value: aiClamp(value / Math.max(1, referenceBudget * 0.25)),
    wage: aiClamp(wage / Math.max(1, Number(profile?.wageBudget) * 0.08 || wage * 2)),
    budget: aiClamp(1 - (Math.min(Number(finance?.balance) || 0, Number(profile?.transferBudget) || 0) / referenceBudget)),
    reputation: aiClamp((aiClubReputation(club) - overall + 4) / 10),
    style: aiClamp(1 - aiStyleFit(player, aiStyleForClub(club))),
  };
  const protectedRole = player?.star === true
    || player?.isStar === true
    || player?.starPlayer === true
    || ["key_player", "important", "starter"].includes(
      aiNormalizedText(player?.squadStatus ?? player?.squadRole ?? player?.importance).replace(/\s+/g, "_"),
    );
  const score = (
    components.positionalSurplus * 0.22
    + components.depth * 0.10
    + components.quality * 0.16
    + components.age * 0.08
    + components.potential * 0.10
    + components.value * 0.08
    + components.wage * 0.08
    + components.budget * 0.08
    + components.reputation * 0.04
    + components.style * 0.06
  ) * 100 - (protectedRole ? 28 : 0);
  return {
    score: Math.round(score * 100) / 100,
    positionGroup: group,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [
      key,
      aiCompactFactor(value),
    ])),
  };
}

function aiRoundMoney(value) {
  const parsed = Math.max(1, Math.min(MAX_MONEY, Math.round(Number(value) || 1)));
  const step = parsed >= 10_000_000 ? 100_000 : 50_000;
  return Math.max(step, Math.min(MAX_MONEY, Math.round(parsed / step) * step));
}

function aiRoundWage(value) {
  const parsed = Math.max(1_000, Math.min(MAX_MONEY, Math.round(Number(value) || 1_000)));
  return Math.max(1_000, Math.round(parsed / 1_000) * 1_000);
}

function aiContractTerms(player, fit, seed) {
  const age = Math.max(14, Math.min(45, integer(player?.age, 24, 45)));
  const potential = aiPlayerPotential(player);
  const overall = aiPlayerOverall(player);
  const durationBase = age <= 23 || potential >= overall + 2 ? 4 : age >= 31 ? 2 : 3;
  const durationDelta = stableAiScore(`${seed}:contract-duration`) % 3 - 1;
  const wageMultiplier = 0.94
    + (aiClamp(fit?.score / 100) * 0.22)
    + ((stableAiScore(`${seed}:contract-wage`) % 9) / 100);
  return {
    wage: Math.max(1_000, Math.min(MAX_MONEY, Math.round(defaultWage(player) * wageMultiplier / 1_000) * 1_000)),
    durationSeasons: Math.max(2, Math.min(5, durationBase + durationDelta)),
  };
}

function simulateAiContractNegotiation({ seed, player, buyer }) {
  const baseWage = Math.max(1_000, defaultWage(player));
  const fit = aiClamp(buyer.fit.score / 100);
  const wageHeadroom = Math.max(0, integer(buyer.wageHeadroom, 0, MAX_MONEY));
  const maximumWage = Math.max(0, Math.floor(Math.min(
    wageHeadroom,
    baseWage * (1.02 + fit * 0.30 + ((stableAiScore(`${seed}:wage-limit`) % 8) / 100)),
  ) / 1_000) * 1_000);
  const agentFloor = aiRoundWage(baseWage * (0.90 + ((1 - fit) * 0.08)));
  let agentAsk = aiRoundWage(baseWage * (1.02 + ((stableAiScore(`${seed}:wage-ask`) % 13) / 100)));
  let clubOffer = aiRoundWage(Math.min(
    maximumWage,
    baseWage * (0.84 + fit * 0.14),
  ));
  const age = Math.max(14, Math.min(45, integer(player?.age, 24, 45)));
  const baseDuration = age <= 23 || aiPlayerPotential(player) >= aiPlayerOverall(player) + 2
    ? 4
    : age >= 31 ? 2 : 3;
  const requestedDuration = Math.max(2, Math.min(5,
    baseDuration + (stableAiScore(`${seed}:duration-request`) % 2),
  ));
  let offeredDuration = Math.max(2, Math.min(5,
    baseDuration + (stableAiScore(`${seed}:duration-offer`) % 3) - 1,
  ));
  const maxRounds = 2 + (stableAiScore(`${seed}:contract-round-limit`) % 3);
  const history = [];
  let wage = null;
  let durationSeasons = null;
  if (wageHeadroom < agentFloor || maximumWage < agentFloor) {
    return {
      agreed: false,
      terms: null,
      appealScore: 0,
      maxRounds,
      roundsUsed: 0,
      limitReached: true,
      history: [{ round: 0, actor: "club", action: "withdraw", reason: "wage-budget" }],
    };
  }
  for (let round = 1; round <= maxRounds; round += 1) {
    history.push({
      round,
      actor: "club",
      action: round === 1 ? "offer" : "counter",
      wage: clubOffer,
      durationSeasons: offeredDuration,
    });
    if (clubOffer >= agentAsk && offeredDuration >= requestedDuration - 1) {
      wage = clubOffer;
      durationSeasons = offeredDuration;
      history.push({ round, actor: "agent", action: "accept", wage, durationSeasons });
      break;
    }
    history.push({
      round,
      actor: "agent",
      action: "counter",
      wage: agentAsk,
      durationSeasons: requestedDuration,
    });
    const remaining = Math.max(1, maxRounds - round + 1);
    agentAsk = aiRoundWage(Math.max(agentFloor, agentAsk - ((agentAsk - agentFloor) / remaining)));
    clubOffer = aiRoundWage(Math.min(
      maximumWage,
      clubOffer + Math.max(1_000, (agentAsk - clubOffer) * (round === maxRounds - 1 ? 1 : 0.6)),
    ));
    if (offeredDuration < requestedDuration && round >= 1) offeredDuration += 1;
  }
  if (wage === null && maximumWage >= agentFloor) {
    const finalWage = aiRoundWage(Math.min(maximumWage, Math.max(agentFloor, agentAsk)));
    if (finalWage >= agentFloor) {
      wage = finalWage;
      durationSeasons = Math.max(offeredDuration, requestedDuration - 1);
      history.push({
        round: maxRounds,
        actor: "club",
        action: "final-offer",
        wage,
        durationSeasons,
      });
      history.push({
        round: maxRounds,
        actor: "agent",
        action: "accept",
        wage,
        durationSeasons,
      });
    }
  }
  const wageAppeal = wage ? aiClamp(wage / Math.max(baseWage * 1.2, 1)) : 0;
  const durationAppeal = durationSeasons ? aiClamp(durationSeasons / 5) : 0;
  const clubAppeal = aiClamp(aiClubReputation(buyer.club) / 20);
  return {
    agreed: wage !== null,
    terms: wage === null ? null : { wage, durationSeasons },
    appealScore: Math.round((wageAppeal * 55 + durationAppeal * 20 + clubAppeal * 25) * 100) / 100,
    maxRounds,
    roundsUsed: new Set(history.map((entry) => entry.round)).size,
    limitReached: wage === null,
    history: history.slice(-MAX_AI_NEGOTIATION_STEPS),
  };
}

function simulateAiNegotiation({
  seed,
  baseAmount,
  buyerScore,
  sellerScore,
  buyerBudget,
  agent = false,
}) {
  const base = Math.max(1, Number(baseAmount) || 1);
  const buyerStrength = aiClamp(buyerScore / 100);
  const sellerRelease = aiClamp(sellerScore / 100);
  const maxRounds = 2 + (stableAiScore(`${seed}:round-limit`) % 3);
  const sellerFloor = aiRoundMoney(base * (agent
    ? 0.88 + ((1 - buyerStrength) * 0.08)
    : 0.78 + ((1 - sellerRelease) * 0.14)));
  let sellerAsk = aiRoundMoney(base * (agent
    ? 1.03 + ((stableAiScore(`${seed}:agent-ask`) % 10) / 100)
    : 0.94 + ((1 - sellerRelease) * 0.16)));
  const buyerLimit = aiRoundMoney(Math.min(
    Math.max(1, buyerBudget),
    base * (agent ? 1.04 + buyerStrength * 0.18 : 0.88 + buyerStrength * 0.30),
  ));
  let buyerOffer = aiRoundMoney(Math.min(
    buyerLimit,
    base * (0.76 + buyerStrength * 0.12),
  ));
  const history = [];
  let amount = null;
  for (let round = 1; round <= maxRounds; round += 1) {
    history.push({ round, actor: "buyer", action: round === 1 ? "offer" : "counter", amount: buyerOffer });
    if (buyerOffer >= sellerAsk) {
      amount = buyerOffer;
      history.push({ round, actor: agent ? "agent" : "seller", action: "accept", amount });
      break;
    }
    const remaining = Math.max(1, maxRounds - round + 1);
    const concession = Math.max(50_000, Math.round((sellerAsk - sellerFloor) / remaining));
    sellerAsk = aiRoundMoney(Math.max(sellerFloor, sellerAsk - concession));
    history.push({
      round,
      actor: agent ? "agent" : "seller",
      action: "counter",
      amount: sellerAsk,
    });
    if (buyerLimit < sellerAsk && round === maxRounds) break;
    const closingPressure = round === maxRounds - 1 ? 1 : 0.55;
    buyerOffer = aiRoundMoney(Math.min(
      buyerLimit,
      buyerOffer + Math.max(50_000, (sellerAsk - buyerOffer) * closingPressure),
    ));
  }
  if (amount === null && buyerLimit >= sellerFloor) {
    const finalAmount = aiRoundMoney(Math.min(buyerLimit, Math.max(sellerFloor, sellerAsk)));
    if (finalAmount >= sellerFloor) {
      amount = finalAmount;
      history.push({ round: maxRounds, actor: "buyer", action: "accept", amount });
    }
  }
  return {
    agreed: amount !== null,
    amount,
    maxRounds,
    roundsUsed: new Set(history.map((entry) => entry.round)).size,
    limitReached: amount === null,
    history: history.slice(-MAX_AI_NEGOTIATION_STEPS),
  };
}

function simulateAiAuction({ seed, player, sellerScore, buyers }) {
  const value = marketValueForPlayer(player);
  const reservePrice = aiRoundMoney(value * (0.80 + ((1 - aiClamp(sellerScore / 100)) * 0.14)));
  let bidIncrement = aiRoundMoney(Math.max(250_000, value * (0.025 + ((stableAiScore(`${seed}:increment`) % 4) / 100))));
  const contenders = buyers.map((buyer) => {
    const contractNegotiation = simulateAiContractNegotiation({
      seed: `${seed}:contract:${clubKey(buyer.club.id)}`,
      player,
      buyer,
    });
    return {
      ...buyer,
      contractNegotiation,
      maximumBid: aiRoundMoney(Math.min(
        buyer.availableBudget,
        value * (0.88 + (aiClamp(buyer.fit.score / 100) * 0.34)),
      )),
    };
  }).filter((buyer) => buyer.maximumBid >= reservePrice)
    .sort((left, right) => (
      right.maximumBid - left.maximumBid
      || stableAiScore(`${seed}:bidder:${right.club.id}`) - stableAiScore(`${seed}:bidder:${left.club.id}`)
      || identifier(left.club.id).localeCompare(identifier(right.club.id))
    ));
  if (contenders.length < 2) return null;
  const winner = contenders.find((candidate) => (
    candidate.contractNegotiation.agreed
    && candidate.maximumBid > reservePrice
    && contenders.some((rival) => !identifiersEqual(rival.club.id, candidate.club.id))
  ));
  if (!winner) return null;
  const rivals = contenders.filter((candidate) => (
    !identifiersEqual(candidate.club.id, winner.club.id)
  ));
  const finalists = [winner, ...rivals].slice(0, MAX_AI_AUCTION_BIDS);
  const runnerUp = rivals[0];
  const maximumIncrement = winner.maximumBid - reservePrice;
  if (maximumIncrement <= 0) return null;
  bidIncrement = Math.max(1, Math.min(bidIncrement, maximumIncrement));
  const winningBid = aiRoundMoney(Math.min(
    winner.maximumBid,
    Math.max(reservePrice, runnerUp.maximumBid + bidIncrement),
  ));
  const bidHistory = [{
    round: 1,
    bidderClubId: runnerUp.club.id,
    amount: Math.max(reservePrice, Math.min(runnerUp.maximumBid, winningBid - bidIncrement)),
    maximumBid: runnerUp.maximumBid,
  }];
  bidHistory.push({
    round: bidHistory.length + 1,
    bidderClubId: winner.club.id,
    amount: winningBid,
    maximumBid: winner.maximumBid,
  });
  const bidderCount = new Set(bidHistory.map((bid) => clubKey(bid.bidderClubId))).size;
  return {
    winner,
    amount: winningBid,
    reservePrice,
    bidIncrement,
    maxBids: MAX_AI_AUCTION_BIDS,
    bidderCount,
    bidHistory: bidHistory.slice(-MAX_AI_AUCTION_BIDS),
    contractCompetition: finalists.map((contender) => ({
      clubId: contender.club.id,
      appealScore: contender.contractNegotiation.appealScore,
      terms: structuredClone(contender.contractNegotiation.terms),
    })),
  };
}

function aiTransferClubs(room, leagueId) {
  const managedClubKeys = new Set((room.managers ?? [])
    .map((manager) => clubKey(manager?.clubId))
    .filter(Boolean));
  const requestedLeagueKey = clubKey(leagueId);
  const clubs = [];
  for (const league of room.competitionCatalog ?? []) {
    if (league?.active === false) continue;
    if (requestedLeagueKey && clubKey(league?.id) !== requestedLeagueKey) continue;
    for (const club of league?.clubs ?? []) {
      const clubId = identifier(club?.id);
      if (!clubId || managedClubKeys.has(clubKey(clubId))) continue;
      if (!clubs.some((candidate) => identifiersEqual(candidate.id, clubId))) {
        clubs.push({ ...structuredClone(club), id: clubId, reputation: integer(club?.reputation, 10, 20) });
      }
    }
  }
  return clubs;
}

function aiTransferPlayerEligible(room, state, player, aiClubKeys) {
  const playerId = identifier(player?.id);
  const negotiability = aiNormalizedText(
    player?.negotiability ?? player?.transferStatus ?? player?.availability,
  ).replace(/[\s-]+/g, "_");
  if (!playerId
    || player?.active === false
    || player?.academy === true
    || player?.youth === true
    || player?.retired === true
    || player?.careerStage === "academy"
    || player?.notForSale === true
    || player?.untransferable === true
    || player?.untouchable === true
    || ["not_for_sale", "inegociavel", "indisponivel"].includes(negotiability)) return false;
  const currentClubId = actualOwnership(room, player);
  const freeAgent = clubKey(currentClubId) === clubKey(FREE_AGENT_CLUB_ID);
  if (!freeAgent && !aiClubKeys.has(clubKey(currentClubId))) return false;
  const registration = registrationForPlayer(room, playerId);
  if (registration?.loan || activeScheduledForPlayer(state, playerId)) return false;
  if (activeListingForPlayer(state, playerId) || activeOfferForPlayer(state, playerId)) return false;
  return true;
}

function aiRoundsRemaining(room, leagueId, round) {
  const targetLeagueKey = clubKey(leagueId);
  const rounds = (room.leagueFixtureSchedule ?? [])
    .filter((fixture) => !targetLeagueKey || clubKey(fixture?.leagueId) === targetLeagueKey)
    .map((fixture) => Number(fixture?.round))
    .filter(Number.isInteger);
  const configured = Number(room?.seasonTotalRounds ?? room?.totalRounds ?? room?.careerState?.totalRounds);
  const maximum = rounds.length > 0
    ? Math.max(...rounds)
    : Number.isInteger(configured) && configured > 0
      ? configured
      : 38;
  return Math.max(0, maximum - round);
}

function aiFixtureCompleted(room, fixture) {
  if (fixture?.status === "completed" || fixture?.completedAt || fixture?.result) return true;
  const completedIds = new Set([
    ...(room.completedFixtureIds ?? []),
    ...(room.leagueMatchResults ?? []).map((result) => (
      result?.leagueFixtureId ?? result?.fixtureId ?? result?.id
    )),
  ].map(identifierKey).filter(Boolean));
  const fixtureId = identifierKey(
    fixture?.leagueFixtureId ?? fixture?.fixtureId ?? fixture?.id,
  );
  return Boolean(fixtureId && completedIds.has(fixtureId));
}

function aiClubLeagueIds(room, clubId) {
  const ids = [];
  for (const league of room.competitionCatalog ?? []) {
    if (league?.active === false) continue;
    if (!(league.clubs ?? []).some((club) => identifiersEqual(club?.id, clubId))) continue;
    const leagueId = identifier(league?.id);
    if (leagueId) ids.push(leagueId);
  }
  return [...new Set(ids.map(clubKey))];
}

function aiClubRoundsRemaining(room, clubId, fallbackLeagueId, fallbackRound) {
  const leagueKeys = aiClubLeagueIds(room, clubId);
  if (leagueKeys.length === 0) return aiRoundsRemaining(room, fallbackLeagueId, fallbackRound);
  const values = leagueKeys.map((leagueKey) => {
    const fixtures = (room.leagueFixtureSchedule ?? []).filter((fixture) => (
      clubKey(fixture?.leagueId) === leagueKey
      && (identifiersEqual(fixture?.homeClubId, clubId) || identifiersEqual(fixture?.awayClubId, clubId))
    ));
    const maximum = fixtures.reduce((value, fixture) => Math.max(value, integer(fixture?.round)), 0);
    const completedRound = fixtures.reduce((value, fixture) => (
      aiFixtureCompleted(room, fixture) ? Math.max(value, integer(fixture?.round)) : value
    ), 0);
    const currentRound = completedRound > 0 ? completedRound : fallbackRound;
    return maximum > 0
      ? Math.max(0, maximum - currentRound)
      : aiRoundsRemaining(room, leagueKey, fallbackRound);
  });
  return Math.min(...values);
}

function aiLoanRoundsRemaining(room, fromClubId, toClubId, fallbackLeagueId, fallbackRound) {
  return Math.min(
    aiClubRoundsRemaining(room, fromClubId, fallbackLeagueId, fallbackRound),
    aiClubRoundsRemaining(room, toClubId, fallbackLeagueId, fallbackRound),
  );
}

function aiLoanTerms(player, buyer, seed, remainingRounds) {
  const desiredDuration = 4 + (stableAiScore(`${seed}:loan-duration`) % 7);
  const durationRounds = Math.max(3, Math.min(12, remainingRounds, desiredDuration));
  const wageSharePercent = 40 + (stableAiScore(`${seed}:loan-wage-share`) % 9) * 5;
  const playerValue = marketValueForPlayer(player);
  const clauseRoll = stableAiScore(`${seed}:loan-clause`) % 100;
  const purchaseAmount = aiRoundMoney(playerValue * (0.76 + (aiClamp(buyer.fit.score / 100) * 0.18)));
  const terms = {
    durationRounds,
    wageSharePercent: Math.min(80, wageSharePercent),
    purchaseOption: null,
  };
  if (clauseRoll < 38) terms.purchaseOption = purchaseAmount;
  else if (clauseRoll >= 88 && buyer.availableBudget >= purchaseAmount) {
    terms.purchaseObligation = purchaseAmount;
  }
  return terms;
}

function aiBuyerContexts(room, player, clubs, rosters, financialContexts, fromClubId) {
  const maximum = Math.max(1, integer(room.maxSquadSize, MAX_SQUAD_SIZE, 200));
  return clubs.filter((club) => !identifiersEqual(club.id, fromClubId)).flatMap((club) => {
    const roster = rosters.get(clubKey(club.id)) ?? [];
    if (roster.length >= maximum) return [];
    const financial = financialContexts.get(clubKey(club.id));
    if (!financial) return [];
    const { payroll, profile, availableBudget } = financial;
    const fit = scoreAiTransferFit(player, {
      buyerClub: club,
      buyerRoster: roster,
      availableBudget,
      wageBudget: integer(profile?.wageBudget, 0, MAX_MONEY),
      currentPayroll: payroll.amount,
      buyerStyle: aiStyleForClub(club),
    });
    return [{
      club,
      roster,
      fit,
      availableBudget,
      wageBudget: integer(profile?.wageBudget, 0, MAX_MONEY),
      currentPayroll: payroll.amount,
      wageHeadroom: Math.max(0, integer(profile?.wageBudget, 0, MAX_MONEY) - payroll.amount),
    }];
  }).sort((left, right) => (
    right.fit.score - left.fit.score
    || identifier(left.club.id).localeCompare(identifier(right.club.id))
  ));
}

export function scoreAiMarketMethodPreference(method, player, context = {}) {
  const value = Math.max(1, marketValueForPlayer(player));
  const affordability = aiClamp((Number(context.availableBudget) || 0) / Math.max(value * 2, 1));
  const constrained = 1 - affordability;
  const age = aiClamp(Number(player?.age) || 24, 14, 45);
  const development = aiClamp(
    ((aiPlayerPotential(player) - aiPlayerOverall(player)) / 5) + (age <= 23 ? 0.35 : 0),
  );
  const reputation = aiClamp(aiClubReputation(context.buyerClub) / 20);
  const scores = {
    negotiation: 30 + affordability * 48 + reputation * 10 - constrained * 12,
    auction: 24 + affordability * 46 + reputation * 8 - constrained * 10,
    loan: 24 + constrained * 38 + development * 34,
    "free-agent": 30 + constrained * 45 + (age >= 22 && age <= 30 ? 10 : 3),
  };
  return Math.round(aiClamp(scores[method] ?? 0, 0, 100) * 100) / 100;
}

function aiMethodStrategyAdjustment(method, buyer, player, seed) {
  const preference = scoreAiMarketMethodPreference(method, player, {
    buyerClub: buyer.club,
    availableBudget: buyer.availableBudget,
  });
  const variation = ((stableAiScore(`${seed}:method-variation`) % 3_001) / 100) - 15;
  return ((preference - 50) * 0.28) + variation;
}

function aiNegotiatedAction({
  seed,
  method,
  player,
  fromClubId,
  buyer,
  seller,
  remainingRounds,
}) {
  const value = marketValueForPlayer(player);
  const baseAmount = method === "free-agent"
    ? Math.max(250_000, defaultWage(player) * (5 + (stableAiScore(`${seed}:signing-months`) % 5)))
    : method === "loan"
      ? Math.max(500_000, value * (0.07 + ((stableAiScore(`${seed}:loan-fee`) % 7) / 100)))
      : value;
  const negotiation = simulateAiNegotiation({
    seed,
    baseAmount,
    buyerScore: buyer.fit.score,
    sellerScore: seller?.score ?? 100,
    buyerBudget: Math.max(1, buyer.availableBudget),
    agent: method === "free-agent",
  });
  if (!negotiation.agreed || !negotiation.amount || negotiation.amount > buyer.availableBudget) return null;
  const contractNegotiation = method === "loan"
    ? null
    : simulateAiContractNegotiation({ seed: `${seed}:contract`, player, buyer });
  if (contractNegotiation && !contractNegotiation.agreed) return null;
  const contractTerms = contractNegotiation?.terms ?? aiContractTerms(player, buyer.fit, seed);
  const loanTerms = method === "loan"
    ? aiLoanTerms(player, buyer, seed, remainingRounds)
    : null;
  const obligation = integer(loanTerms?.purchaseObligation, 0, MAX_MONEY);
  if (negotiation.amount + obligation > buyer.availableBudget) {
    if (loanTerms) delete loanTerms.purchaseObligation;
    else return null;
  }
  const sellerScore = seller?.score ?? 100;
  return {
    method,
    initiative: method === "loan"
      ? (stableAiScore(`${seed}:initiative`) % 100 < 50 ? "lender-offer" : "borrower-request")
      : method === "free-agent"
        ? "agent-competition"
        : "buyer-offer",
    player,
    fromClubId,
    buyer,
    seller,
    amount: negotiation.amount,
    contractTerms,
    loanTerms,
    negotiation,
    contractNegotiation,
    strategicScore: (buyer.fit.score * 0.76)
      + (sellerScore * 0.24)
      + ((contractNegotiation?.appealScore ?? 50) - 50) * (method === "free-agent" ? 0.32 : 0.12)
      + aiMethodStrategyAdjustment(method, buyer, player, seed),
  };
}

function aiAuctionAction({ seed, player, fromClubId, buyers, seller }) {
  const auction = simulateAiAuction({
    seed,
    player,
    sellerScore: seller.score,
    buyers,
  });
  if (!auction) return null;
  return {
    method: "auction",
    initiative: "seller-auction",
    player,
    fromClubId,
    buyer: auction.winner,
    seller,
    amount: auction.amount,
    contractTerms: auction.winner.contractNegotiation.terms,
    contractNegotiation: auction.winner.contractNegotiation,
    loanTerms: null,
    auction,
    competingClubIds: auction.bidHistory.map((bid) => bid.bidderClubId),
    strategicScore: (auction.winner.fit.score * 0.72)
      + (seller.score * 0.18)
      + Math.min(10, auction.bidderCount * 2)
      + ((auction.winner.contractNegotiation.appealScore - 50) * 0.12)
      + aiMethodStrategyAdjustment("auction", auction.winner, player, seed),
  };
}

function compactAiDecision(action, { tickKey, seasonNumber, round, leagueId, policyMethod, now }) {
  const competingClubIds = [...new Set(
    (action.competingClubIds ?? [action.buyer.club.id]).map(identifier).filter(Boolean),
  )];
  return {
    strategyVersion: AI_STRATEGY_VERSION,
    tickKey,
    seasonNumber,
    round,
    leagueId: leagueId === "all" ? null : leagueId,
    generatedAt: timestamp(now),
    playerId: identifier(action.player?.id),
    positionGroup: action.buyer.fit.positionGroup,
    fromClubId: publicFromClubId(action.fromClubId),
    toClubId: action.buyer.club.id,
    method: action.method,
    initiative: action.initiative,
    policyMethod,
    competitionCount: competingClubIds.length,
    competingClubIds,
    strategicScore: Math.round(action.strategicScore * 100) / 100,
    buyerScore: action.buyer.fit.score,
    buyerFactors: structuredClone(action.buyer.fit.components),
    sellerScore: action.seller?.score ?? null,
    sellerFactors: action.seller?.components ? structuredClone(action.seller.components) : null,
    contractAppealScore: action.contractNegotiation?.appealScore ?? null,
  };
}

function attachAiTransactionMetadata(room, action, result, context) {
  const transaction = result?.transaction;
  if (!transaction) return null;
  const decisionMetadata = compactAiDecision(action, context);
  transaction.source = "ai";
  transaction.method = action.method;
  transaction.requestId = context.requestId;
  transaction.decisionMetadata = decisionMetadata;
  if (action.competingContractOffers?.length) {
    transaction.competingContractOffers = structuredClone(action.competingContractOffers);
  }
  if (action.negotiation) {
    transaction.negotiationHistory = structuredClone(
      action.negotiation.history.slice(-MAX_AI_NEGOTIATION_STEPS),
    );
    transaction.negotiationLimits = {
      maxRounds: action.negotiation.maxRounds,
      roundsUsed: action.negotiation.roundsUsed,
      limitReached: action.negotiation.limitReached,
    };
  }
  if (action.contractNegotiation) {
    transaction.contractNegotiationHistory = structuredClone(
      action.contractNegotiation.history.slice(-MAX_AI_NEGOTIATION_STEPS),
    );
    transaction.contractNegotiationLimits = {
      maxRounds: action.contractNegotiation.maxRounds,
      roundsUsed: action.contractNegotiation.roundsUsed,
      limitReached: action.contractNegotiation.limitReached,
      appealScore: action.contractNegotiation.appealScore,
    };
  }
  if (action.auction) {
    transaction.bidHistory = structuredClone(action.auction.bidHistory.slice(-MAX_AI_AUCTION_BIDS));
    transaction.auction = {
      reservePrice: action.auction.reservePrice,
      bidIncrement: action.auction.bidIncrement,
      maxBids: action.auction.maxBids,
      bidCount: action.auction.bidHistory.length,
      bidderCount: action.auction.bidderCount,
      contractCompetition: structuredClone(action.auction.contractCompetition ?? []),
    };
  }
  const state = ensureMarketState(room, context.now);
  const historyEntry = {
    id: `ai-market-history:${context.requestId}`,
    transactionId: transaction.id,
    tickKey: context.tickKey,
    method: action.method,
    dealType: transaction.dealType,
    playerId: transaction.player?.id,
    fromClubId: transaction.fromClubId,
    toClubId: transaction.toClubId,
    amount: transaction.amount,
    strategicScore: decisionMetadata.strategicScore,
    competitionCount: decisionMetadata.competitionCount,
    negotiationRounds: action.negotiation?.roundsUsed ?? 0,
    bidCount: action.auction?.bidHistory.length ?? 0,
    completedAt: transaction.completedAt,
  };
  state.aiMarketHistory = [
    ...state.aiMarketHistory.filter((entry) => entry?.id !== historyEntry.id),
    historyEntry,
  ].slice(-MAX_AI_MARKET_HISTORY);
  return transaction;
}

function runAiTransferTickInternal(room, input = {}, now = new Date()) {
  const state = ensureMarketState(room, now);
  const seasonNumber = Math.max(1, integer(input.seasonNumber, currentSeason(room)));
  const round = Math.max(1, integer(input.round, 1));
  const leagueId = identifier(input.leagueId) || "all";
  const intervalRounds = Math.max(1, integer(
    input.intervalRounds,
    AI_TRANSFER_INTERVAL_ROUNDS,
    38,
  ));
  const preferredMethod = AI_MARKET_METHODS.has(input.preferredMethod)
    ? input.preferredMethod
    : null;
  const tickKey = `${seasonNumber}:global:${round}`;
  const legacyTickProcessed = state.aiTransferTickKeys.some((key) => (
    key.startsWith(`${seasonNumber}:`) && key.endsWith(`:${round}`)
  ));
  if (state.aiTransferTickKeys.includes(tickKey) || legacyTickProcessed) {
    return { changed: false, duplicate: true, tickKey };
  }
  state.aiTransferTickKeys.push(tickKey);
  state.aiTransferTickKeys = state.aiTransferTickKeys.slice(-MAX_AI_TRANSFER_TICKS);

  const finish = (status, details = {}) => {
    const current = ensureMarketState(room, now);
    if (!current.aiTransferTickKeys.includes(tickKey)) {
      current.aiTransferTickKeys.push(tickKey);
      current.aiTransferTickKeys = current.aiTransferTickKeys.slice(-MAX_AI_TRANSFER_TICKS);
    }
    current.lastAiTransferTick = {
      tickKey,
      seasonNumber,
      round,
      leagueId: leagueId === "all" ? null : leagueId,
      status,
      completedAt: timestamp(now),
      ...structuredClone(details),
    };
    touch(current, now);
    return { changed: status === "completed", tickKey, status, ...details };
  };

  if (round % intervalRounds !== 0) return finish("cadence");
  if (!transferWindowIsOpen(room, now)) return finish("window-closed");

  const aiClubs = aiTransferClubs(room, null);
  if (aiClubs.length < 1) return finish("not-enough-ai-clubs");
  const aiClubKeys = new Set(aiClubs.map((club) => clubKey(club.id)));
  const playerMap = new Map();
  const suppliedPlayers = Array.isArray(input.players) ? input.players : [];
  for (const player of [...suppliedPlayers, ...careerPlayers(room)]) {
    const playerId = identifier(player?.id);
    if (playerId) playerMap.set(identifierKey(playerId), player);
  }
  const allPlayers = [...playerMap.values()];
  const rosters = new Map(aiClubs.map((club) => [clubKey(club.id), []]));
  for (const player of allPlayers) {
    if (player?.active === false
      || player?.academy === true
      || player?.youth === true
      || player?.retired === true
      || player?.careerStage === "academy") continue;
    rosters.get(clubKey(actualOwnership(room, player)))?.push(player);
  }
  const players = allPlayers.filter((player) => aiTransferPlayerEligible(room, state, player, aiClubKeys));
  const financialContexts = new Map(aiClubs.map((club) => [
    clubKey(club.id),
    aiClubFinancialContext(room, state, club.id),
  ]));
  const seed = `${room.id ?? room.code}:${tickKey}`;
  let policyMethod = preferredMethod ?? "club-strategy";
  const orderedPlayers = players
    .filter((player) => {
      const fromClubId = actualOwnership(room, player);
      return clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID)
        || (rosters.get(clubKey(fromClubId))?.length ?? 0) > AI_MIN_SQUAD_AFTER_TRANSFER;
    })
    .sort((left, right) => (
      stableAiScore(`${seed}:player:${left.id}`) - stableAiScore(`${seed}:player:${right.id}`)
      || identifier(left.id).localeCompare(identifier(right.id))
    ))
    .slice(0, 96);
  const actions = [];
  const loanRoundsCache = new Map();
  const pushCompetingActions = (candidates) => {
    const viable = candidates.filter(Boolean);
    const competingClubIds = [...new Set(viable.map((action) => identifier(action.buyer.club.id)))];
    const competingContractOffers = viable.flatMap((action) => (
      action.contractNegotiation?.agreed ? [{
        clubId: action.buyer.club.id,
        appealScore: action.contractNegotiation.appealScore,
        offerScore: Math.round(action.strategicScore * 100) / 100,
        terms: structuredClone(action.contractTerms),
      }] : []
    ));
    for (const action of viable) {
      action.competingClubIds = competingClubIds;
      action.competingContractOffers = competingContractOffers;
      if (!preferredMethod || preferredMethod === action.method) actions.push(action);
    }
  };
  for (const player of orderedPlayers) {
    const fromClubId = actualOwnership(room, player);
    const freeAgent = clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID);
    const buyers = aiBuyerContexts(room, player, aiClubs, rosters, financialContexts, fromClubId)
      .filter((buyer) => buyer.fit.score >= 20)
      .slice(0, 16);
    if (buyers.length === 0) continue;
    const sellerClub = freeAgent
      ? null
      : aiClubs.find((club) => identifiersEqual(club.id, fromClubId));
    const seller = sellerClub
      ? scoreAiSellerRelease(
        room,
        state,
        player,
        sellerClub,
        rosters.get(clubKey(fromClubId)) ?? [],
        financialContexts.get(clubKey(fromClubId)),
      )
      : null;
    const playerSeed = `${seed}:${identifier(player.id)}`;
    if (freeAgent) {
      pushCompetingActions(buyers.slice(0, 4).map((buyer) => aiNegotiatedAction({
        seed: `${playerSeed}:free-agent:${clubKey(buyer.club.id)}`,
        method: "free-agent",
        player,
        fromClubId,
        buyer,
        seller,
        remainingRounds: 0,
      })));
      continue;
    }

    const sellerOpenToPermanent = seller && seller.score >= 25;
    const negotiations = sellerOpenToPermanent
      ? buyers.slice(0, 4).map((buyer) => aiNegotiatedAction({
        seed: `${playerSeed}:negotiation:${clubKey(buyer.club.id)}`,
        method: "negotiation",
        player,
        fromClubId,
        buyer,
        seller,
        remainingRounds: 0,
      }))
      : [];
    pushCompetingActions(negotiations);
    const sellerGroupDepth = (rosters.get(clubKey(fromClubId)) ?? [])
      .filter((candidate) => aiPositionGroup(candidate) === aiPositionGroup(player)).length;
    const loanEligible = Number(player?.age ?? 24) <= 25
      && aiPlayerPotential(player) >= aiPlayerOverall(player) + 1
      && sellerGroupDepth > AI_POSITION_TARGETS[aiPositionGroup(player)];
    const loans = loanEligible
      ? buyers.slice(0, 4).map((buyer) => {
        const loanRoundsKey = [clubKey(fromClubId), clubKey(buyer.club.id)].sort().join(":");
        if (!loanRoundsCache.has(loanRoundsKey)) {
          loanRoundsCache.set(loanRoundsKey, aiLoanRoundsRemaining(
            room,
            fromClubId,
            buyer.club.id,
            leagueId === "all" ? null : leagueId,
            round,
          ));
        }
        const remainingRounds = loanRoundsCache.get(loanRoundsKey);
        return remainingRounds >= 3 ? aiNegotiatedAction({
          seed: `${playerSeed}:loan:${clubKey(buyer.club.id)}`,
          method: "loan",
          player,
          fromClubId,
          buyer,
          seller: { ...seller, score: Math.max(45, 100 - seller.score) },
          remainingRounds,
        }) : null;
      })
      : [];
    pushCompetingActions(loans);
    const auction = buyers.length >= 2 && sellerOpenToPermanent
      ? aiAuctionAction({
        seed: `${playerSeed}:auction`,
        player,
        fromClubId,
        buyers,
        seller,
      })
      : null;
    if (auction && (!preferredMethod || preferredMethod === "auction")) actions.push(auction);
  }
  actions.sort((left, right) => (
    right.strategicScore - left.strategicScore
    || stableAiScore(`${seed}:action:${left.method}:${left.player.id}:${left.buyer.club.id}`)
      - stableAiScore(`${seed}:action:${right.method}:${right.player.id}:${right.buyer.club.id}`)
    || identifier(left.player.id).localeCompare(identifier(right.player.id))
  ));
  let orderedActions = actions;
  if (!preferredMethod && actions.length > 0) {
    const bestByMethod = [...AI_MARKET_METHODS].flatMap((method) => {
      const action = actions.find((candidate) => candidate.method === method);
      return action ? [{ method, score: action.strategicScore }] : [];
    });
    const minimumScore = Math.min(...bestByMethod.map((entry) => entry.score));
    const weighted = bestByMethod.map((entry) => ({
      ...entry,
      weight: Math.max(5, Math.round((entry.score - minimumScore) + 5)),
    }));
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = stableAiScore(`${seed}:method-selection`) % totalWeight;
    policyMethod = weighted.at(-1).method;
    for (const entry of weighted) {
      if (roll < entry.weight) {
        policyMethod = entry.method;
        break;
      }
      roll -= entry.weight;
    }
    orderedActions = [
      ...actions.filter((action) => action.method === policyMethod).slice(0, 4),
      ...actions.filter((action) => action.method !== policyMethod),
    ];
  }

  const maxDeals = Math.max(1, Math.min(4, integer(
    input.maxDeals,
    Math.ceil(aiClubs.length / 8),
    4,
  )));
  const maxAttempts = Math.min(48, Math.max(12, maxDeals * 12));
  const completedDeals = [];
  const failedAttempts = [];
  const usedPlayerKeys = new Set();
  const usedClubKeys = new Set();
  let attempts = 0;
  for (const action of orderedActions) {
    if (attempts >= maxAttempts || completedDeals.length >= maxDeals) break;
    const playerKey = identifierKey(action.player.id);
    const buyerKey = clubKey(action.buyer.club.id);
    const sellerKey = clubKey(action.fromClubId);
    if (usedPlayerKeys.has(playerKey)
      || usedClubKeys.has(buyerKey)
      || (sellerKey !== clubKey(FREE_AGENT_CLUB_ID) && usedClubKeys.has(sellerKey))) continue;
    attempts += 1;
    const requestId = `ai-market:${tickKey}:${action.method}:${identifier(action.player.id)}:${clubKey(action.fromClubId)}:${clubKey(action.buyer.club.id)}`;
    try {
      const result = action.method === "auction"
        ? withRoomRollback(room, () => executeAiAuctionInternal(room, {
          requestId,
          expectedFromClubId: action.fromClubId,
        }, action, now))
        : executeAiTransfer(room, {
          requestId,
          expectedFromClubId: action.fromClubId,
          toClubId: action.buyer.club.id,
          amount: action.amount,
          dealType: action.method === "loan" ? "loan" : "transfer",
          contractTerms: action.contractTerms,
          ...(action.loanTerms ? { loanTerms: action.loanTerms } : {}),
        }, action.player, now);
      const transaction = attachAiTransactionMetadata(room, action, result, {
        tickKey,
        seasonNumber,
        round,
        leagueId,
        requestId,
        policyMethod,
        now,
      });
      if (!transaction) continue;
      usedPlayerKeys.add(playerKey);
      usedClubKeys.add(buyerKey);
      if (sellerKey !== clubKey(FREE_AGENT_CLUB_ID)) usedClubKeys.add(sellerKey);
      completedDeals.push({
        transactionId: transaction.id,
        playerId: identifier(action.player.id),
        fromClubId: publicFromClubId(action.fromClubId),
        toClubId: action.buyer.club.id,
        amount: action.amount,
        method: action.method,
        policyMethod,
        negotiationRounds: action.negotiation?.roundsUsed ?? 0,
        bidCount: action.auction?.bidHistory.length ?? 0,
      });
    } catch (error) {
      if (error instanceof MarketError && error.status >= 400 && error.status < 500) {
        failedAttempts.push({ method: action.method, code: error.code });
        continue;
      }
      throw error;
    }
  }
  if (completedDeals.length > 0) {
    return finish("completed", {
      ...completedDeals[0],
      deals: completedDeals,
      dealCount: completedDeals.length,
      attempts,
      failedAttempts: failedAttempts.slice(-8),
    });
  }
  return finish("no-deal", {
    attempts,
    preferredMethod,
    policyMethod,
    failedAttempts: failedAttempts.slice(-8),
  });
}

function executeAiTransferInternal(room, input, player, now = new Date()) {
  const state = ensureMarketState(room, now);
  const operationOwner = `ai:${identifier(input.toClubId)}`;
  const duplicate = previousRequest(state, operationOwner, "ai-transfer", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const fromClubId = actualOwnership(room, player);
  const toClubId = identifier(input.toClubId);
  if (!fromClubId || !toClubId) {
    throw new MarketError("Clubes da transferencia IA invalidos", "MARKET_AI_CLUB_INVALID", 400);
  }
  const expectedFromClubId = identifier(input.expectedFromClubId);
  if (expectedFromClubId && !identifiersEqual(expectedFromClubId, fromClubId)) {
    throw new MarketError(
      "Jogador nao pertence mais ao clube esperado pela IA",
      "MARKET_PLAYER_CLUB_CHANGED",
      409,
      { expectedFromClubId, currentClubId: publicFromClubId(fromClubId) },
    );
  }
  if (identifiersEqual(fromClubId, toClubId)) {
    throw new MarketError("Nao e possivel transferir para o mesmo clube", "MARKET_SELF_DEAL", 409);
  }
  const dealType = input.dealType === "loan" ? "loan" : "transfer";
  if (dealType === "loan" && clubKey(fromClubId) === clubKey(FREE_AGENT_CLUB_ID)) {
    throw new MarketError("Agente livre nao pode ser emprestado", "MARKET_FREE_AGENT_LOAN", 409);
  }
  const transaction = completeDeal(room, state, {
    player,
    fromClubId,
    toClubId,
    dealType,
    amount: money(input.amount),
    loanTerms: input.loanTerms,
    contractTerms: input.contractTerms,
    now,
  });
  touch(state, now);
  rememberRequest(state, operationOwner, "ai-transfer", input.requestId, {
    transactionId: transaction.id,
  });
  return { transaction };
}

function executeAiAuctionInternal(room, input, action, now = new Date()) {
  const state = ensureMarketState(room, now);
  const operationOwner = `ai:${identifier(action.buyer.club.id)}`;
  const duplicate = previousRequest(state, operationOwner, "ai-auction", input.requestId);
  if (duplicate) return { duplicate: true, ...resultReferences(state, duplicate) };
  const fromClubId = actualOwnership(room, action.player);
  if (identifier(input.expectedFromClubId) && !identifiersEqual(input.expectedFromClubId, fromClubId)) {
    throw new MarketError(
      "Jogador nao pertence mais ao clube esperado pela IA",
      "MARKET_PLAYER_CLUB_CHANGED",
      409,
    );
  }
  if (activeListingForPlayer(state, action.player.id) || activeOfferForPlayer(state, action.player.id)) {
    throw new MarketError("Jogador ja possui negociacao ativa", "MARKET_PLAYER_BUSY", 409);
  }
  if (state.activeListings.filter((listing) => listing.status === "open").length >= MAX_LISTINGS) {
    throw new MarketError("Limite de anuncios ativos atingido", "MARKET_LISTING_LIMIT", 409);
  }
  const listing = {
    id: randomUUID(),
    mode: "auction",
    dealType: "transfer",
    status: "open",
    source: "ai",
    player: marketPlayerSummary(room, action.player, fromClubId),
    playerSnapshot: structuredClone(action.player),
    sellerClubId: fromClubId,
    sellerClubName: clubName(room, fromClubId),
    sellerManagerId: null,
    askingPrice: null,
    minimumBid: action.auction.reservePrice,
    bidIncrement: action.auction.bidIncrement,
    currentBid: null,
    bidCount: 0,
    highestBid: null,
    expiresAt: timestamp(new Date(new Date(now).getTime() + 60_000)),
    loanTerms: null,
    contractTerms: structuredClone(action.contractTerms),
    createdAt: timestamp(now),
    revision: state.revision + 1,
  };
  state.activeListings = boundedDeals(
    [...state.activeListings, listing],
    MAX_LISTINGS,
    (candidate) => candidate?.status === "open",
  );
  for (const bid of action.auction.bidHistory) {
    placeClubBid(room, state, listing, {
      managerId: null,
      clubId: bid.bidderClubId,
    }, bid.amount, now);
  }
  const transaction = settleAuctionListing(room, state, listing, now);
  touch(state, now);
  activity(
    state,
    `${listing.player.name} foi arrematado por ${listing.highestBid.clubName}.`,
    now,
    "auction-settlement",
  );
  rememberRequest(state, operationOwner, "ai-auction", input.requestId, {
    listingId: listing.id,
    transactionId: transaction.id,
  });
  return { listing, transaction };
}

function publicOffer(offer, managerId) {
  const direction = offer.buyerManagerId === managerId ? "outgoing" : "incoming";
  const isBuyer = direction === "outgoing";
  const isSeller = offer.sellerManagerId === managerId;
  const pending = offer.status === "pending";
  const countered = offer.status === "countered";
  return {
    id: offer.id,
    listingId: offer.listingId,
    player: structuredClone(offer.player),
    buyerClubId: offer.buyerClubId,
    buyerClubName: offer.buyerClubName,
    sellerClubId: offer.sellerClubId,
    sellerClubName: offer.sellerClubName,
    dealType: offer.dealType,
    amount: offer.amount,
    counterAmount: offer.counterAmount,
    loanTerms: offer.loanTerms ? structuredClone(offer.loanTerms) : null,
    contractTerms: offer.contractTerms ? structuredClone(offer.contractTerms) : null,
    status: offer.status,
    direction,
    permissions: {
      accept: (pending && isSeller) || (countered && isBuyer),
      reject: (pending && isSeller) || (countered && isBuyer),
      counter: pending && isSeller,
      cancel: (pending || countered) && isBuyer,
    },
    message: offer.message,
    createdAt: offer.createdAt,
    expiresAt: offer.expiresAt,
    revision: offer.revision,
  };
}

export function marketSnapshot(room, managerId, candidates = [], now = new Date()) {
  const state = ensureMarketState(room, now);
  const manager = managerFor(room, managerId);
  const finance = financeFor(state, room, manager.clubId);
  const { payroll, profile } = financeLimitsFor(state, room, manager.clubId);
  const cashAvailable = availableFinance(finance);
  const transferAvailable = availableTransferFinance(state, room, manager.clubId);
  const candidateMap = new Map();
  for (const player of candidates) {
    if (!player?.id) continue;
    const currentClubId = actualOwnership(room, player);
    if (!currentClubId || clubKey(currentClubId) === clubKey(manager.clubId)) continue;
    if (registrationForPlayer(room, player.id)?.loan) continue;
    candidateMap.set(identifier(player.id), marketPlayerSummary(room, player, currentClubId));
  }
  for (const listing of state.activeListings) {
    if (listing.status === "open" && clubKey(listing.sellerClubId) !== clubKey(manager.clubId)) {
      candidateMap.set(listing.player.id, structuredClone(listing.player));
    }
  }
  const offers = state.activeOffers
    .filter((offer) => offer.buyerManagerId === managerId || offer.sellerManagerId === managerId)
    .map((offer) => publicOffer(offer, managerId));
  const activeLoans = state.registrations.flatMap((registration) => {
    const loan = registration.loan;
    if (!loan || ![clubKey(loan.lenderClubId), clubKey(loan.borrowerClubId)].includes(clubKey(manager.clubId))) return [];
    const source = sourcePlayer(room, registration, registration.playerSnapshot ?? { id: registration.playerId });
    const player = marketPlayerSummary(room, source, registration.currentClubId);
    return [{
      id: loan.id,
      player,
      lenderClubId: loan.lenderClubId,
      lenderClubName: clubName(room, loan.lenderClubId),
      borrowerClubId: loan.borrowerClubId,
      borrowerClubName: clubName(room, loan.borrowerClubId),
      fee: loan.fee,
      wage: defaultWage(source),
      wageSharePercent: loan.terms.wageSharePercent,
      purchaseOption: loan.terms.purchaseOption,
      purchaseObligation: loan.terms.purchaseObligation,
      canExerciseOption: identifiersEqual(manager.clubId, loan.borrowerClubId)
        && integer(loan.terms.purchaseOption, 0, MAX_MONEY) > 0,
      remainingRounds: loan.remainingRounds,
      startedAt: loan.startedAt,
      endsAt: loan.endsAt,
    }];
  });
  return {
    revision: state.revision,
    serverTime: timestamp(now),
    finance: {
      clubId: manager.clubId,
      balance: finance.balance,
      committed: finance.committed,
      available: transferAvailable,
      cashAvailable,
      transferBudget: integer(profile?.transferBudget, 0, MAX_MONEY),
      transferAvailable,
      wageBudget: integer(profile?.wageBudget, 0, MAX_MONEY),
      monthlyPayroll: payroll.amount,
      paidPlayers: payroll.paidPlayers,
    },
    listings: state.activeListings.slice(-MAX_LISTINGS).map((listing) => publicListing(room, listing, manager)),
    // Um campeonato importado costuma superar 100 atletas rapidamente.
    // Mantem ate 500 resumos (sem snapshots completos) dentro do limite do Socket.IO.
    candidates: [...candidateMap.values()].slice(0, MAX_CANDIDATES),
    offers,
    activeLoans,
    scheduledTransfers: state.scheduledTransfers
      .filter((item) => [clubKey(item.fromClubId), clubKey(item.toClubId)].includes(clubKey(manager.clubId)))
      .map((item) => structuredClone(item)),
    transactions: state.transactions.slice(-MAX_TRANSACTIONS).reverse().map((item) => structuredClone(item)),
    activity: state.activity.slice(-MAX_ACTIVITY).reverse().map((item) => structuredClone(item)),
  };
}

export function createListing(...args) {
  return withRoomRollback(args[0], () => createListingInternal(...args));
}

export function cancelListing(...args) {
  return withRoomRollback(args[0], () => cancelListingInternal(...args));
}

export function createOffer(...args) {
  return withRoomRollback(args[0], () => createOfferInternal(...args));
}

export function respondOffer(...args) {
  return withRoomRollback(args[0], () => respondOfferInternal(...args));
}

export function placeBid(...args) {
  return withRoomRollback(args[0], () => placeBidInternal(...args));
}

export function settleExpiredMarket(...args) {
  return withRoomRollback(args[0], () => settleExpiredMarketInternal(...args));
}

export function exerciseLoanOption(...args) {
  return withRoomRollback(args[0], () => exerciseLoanOptionInternal(...args));
}

export function processScheduledTransfers(...args) {
  return withRoomRollback(args[0], () => processScheduledTransfersInternal(...args));
}

export function advanceMarketLoans(...args) {
  return withRoomRollback(args[0], () => advanceMarketLoansInternal(...args));
}

export function returnLoansForSeason(...args) {
  return withRoomRollback(args[0], () => returnLoansForSeasonInternal(...args));
}

export function reconcileMarketCareerState(...args) {
  return withRoomRollback(args[0], () => reconcileMarketCareerStateInternal(...args));
}

export function executeAiTransfer(...args) {
  return withRoomRollback(args[0], () => executeAiTransferInternal(...args));
}

export function runAiTransferTick(...args) {
  return withRoomRollback(args[0], () => runAiTransferTickInternal(...args));
}
