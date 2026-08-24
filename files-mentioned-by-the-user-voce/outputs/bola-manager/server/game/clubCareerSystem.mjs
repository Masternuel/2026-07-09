import {
  calculateMonthlyMaintenance,
  calculateMonthlyPayroll,
  creditFinance,
  debitFinance,
  ensureClubFinanceState,
  ensureFinanceAccount,
  mirrorSettledFinancialTransaction,
  postFinancialTransaction,
  processMonthlyClubFinance,
} from "./clubFinance.mjs";
import {
  ensureClubFacilities,
  facilityEffectsForClub,
  processFacilityProjects,
  recordMatchdayEconomy,
  startFacilityUpgrade,
} from "./clubFacilities.mjs";
import {
  calculateStaffEffects,
  ensureStaffState,
  fireStaff,
  hireStaff,
  processStaffContractExpirations,
  renewStaffContract,
} from "./staffEngine.mjs";
import {
  CAREER_EVENT_TYPES,
  enrichCareerEventFacts,
  ensureClubCareerState,
  markCareerNewsRead,
  recordCareerEvent,
} from "../domain/careerEvents.mjs";
import { ensureMarketState } from "./market.mjs";
import { calculateStarImpact } from "./starImpact.mjs";
import { buildCompletedLeagueStates } from "./leagueSeasonTransition.mjs";

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function seasonNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function operationScopePart(value, fallback) {
  return encodeURIComponent(identifier(value).toLocaleLowerCase("pt-BR") || fallback);
}

function fixtureOperationScope(room, { fixtureId, competitionId, seasonNumber: suppliedSeason }) {
  const season = seasonNumber(suppliedSeason, seasonNumber(room?.currentSeason, 1));
  return {
    season,
    competitionId: identifier(competitionId) || null,
    fixtureId: identifier(fixtureId),
    scope: `s${season}:${operationScopePart(competitionId, "unknown")}:${operationScopePart(fixtureId, "unknown")}`,
  };
}

function timestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function replaceRoom(target, source) {
  for (const key of Object.keys(target)) {
    if (!(key in source)) delete target[key];
  }
  Object.assign(target, source);
  return target;
}

function catalogClubs(room) {
  const clubs = [
    ...(room?.competitionCatalog ?? []).flatMap((league) => league?.clubs ?? []),
    ...(room?.tournamentCatalog ?? []).flatMap((tournament) => tournament?.participants ?? []),
  ];
  for (const manager of room?.managers ?? []) {
    if (manager?.clubId) clubs.push({ id: manager.clubId, name: manager.clubId });
  }
  return [...new Map(clubs.filter((club) => identifier(club?.id)).map((club) => [clubKey(club.id), club])).values()];
}

function careerPlayer(room, playerId) {
  const key = identifier(playerId).toLocaleLowerCase("pt-BR");
  return (room?.careerState?.players ?? []).find(
    (player) => identifier(player?.id).toLocaleLowerCase("pt-BR") === key,
  ) ?? null;
}

function marketPlayer(room, playerId) {
  const key = identifier(playerId).toLocaleLowerCase("pt-BR");
  return (room?.marketState?.registrations ?? []).find(
    (registration) => identifier(registration?.playerId).toLocaleLowerCase("pt-BR") === key,
  )?.playerSnapshot ?? null;
}

function eventInputForStaff(event) {
  return {
    ...event,
    aggregateType: "staff",
    aggregateId: event.staffId,
    clubIds: [event.clubId, event.relatedClubId].filter(Boolean),
    payload: {
      ...event.metadata,
      staffId: event.staffId,
      clubId: event.clubId,
      relatedClubId: event.relatedClubId,
      contractId: event.contractId,
      amount: event.amount,
    },
  };
}

/** Registra um fato de dominio e sua noticia, ambos idempotentes. */
export function recordClubCareerEvent(room, input) {
  return recordCareerEvent(room, enrichCareerEventFacts(room, input));
}

function staffFinanceCallback(target, transaction) {
  return postFinancialTransaction(target, {
    ...transaction,
    direction: transaction.type,
    occurredAt: transaction.date,
    metadata: { staffId: transaction.staffId },
  });
}

function staffEventCallback(target, event) {
  return recordClubCareerEvent(target, eventInputForStaff(event));
}

function staffCallbacks(now) {
  return {
    now,
    postFinancialTransaction: staffFinanceCallback,
    recordCareerEvent: staffEventCallback,
  };
}

export function careerDateFor(room, fallback = new Date()) {
  return timestamp(
    room?.clubCareerState?.currentDate
      ?? room?.seasonStartedAt
      ?? room?.startedAt
      ?? room?.createdAt
      ?? fallback,
  );
}

/** Migra saves antigos e inicializa todos os agregados persistentes. */
export function ensureClubCareerSystems(room, { now = new Date() } = {}) {
  const effectiveAt = careerDateFor(room, now);
  ensureMarketState(room, effectiveAt);
  ensureClubFinanceState(room, effectiveAt);
  for (const club of catalogClubs(room)) ensureFinanceAccount(room, club.id, { now: effectiveAt });
  ensureClubFacilities(room, effectiveAt);
  ensureClubCareerState(room);
  // ensureStaffState is intentionally pure and returns a full room clone. An
  // aggregate migration must not replace the whole live room here: doing so
  // invalidates references held by match/finance transactions in progress.
  const staffState = ensureStaffState(room, { now: effectiveAt }).clubCareerState;
  for (const field of [
    "staffSchemaVersion",
    "staffMembers",
    "staffCandidates",
    "staffContracts",
    "staffHistory",
    "staffEffectsByClub",
    "processedStaffOperationIds",
    "staffInitializedClubIds",
  ]) {
    room.clubCareerState[field] = staffState[field];
  }
  return room.clubCareerState;
}

export function startClubUpgrade(room, input = {}) {
  const now = careerDateFor(room, input.now);
  ensureClubCareerSystems(room, { now });
  return startFacilityUpgrade(room, {
    ...input,
    now,
    debit: (transaction) => debitFinance(room, transaction),
    recordEvent: (event) => recordClubCareerEvent(room, event),
  });
}

export function hireClubStaff(room, input = {}) {
  const now = careerDateFor(room, input.now);
  ensureClubCareerSystems(room, { now });
  const result = hireStaff(room, input, staffCallbacks(now));
  replaceRoom(room, result.room);
  return { ...result, room };
}

export function fireClubStaff(room, input = {}) {
  const now = careerDateFor(room, input.now);
  ensureClubCareerSystems(room, { now });
  const result = fireStaff(room, input, staffCallbacks(now));
  replaceRoom(room, result.room);
  return { ...result, room };
}

export function renewClubStaff(room, input = {}) {
  const now = careerDateFor(room, input.now);
  ensureClubCareerSystems(room, { now });
  const result = renewStaffContract(room, input, staffCallbacks(now));
  replaceRoom(room, result.room);
  return { ...result, room };
}

function appendFinancialAlert(room, alert) {
  const state = ensureClubCareerState(room);
  state.financialAlerts = Array.isArray(state.financialAlerts) ? state.financialAlerts : [];
  if (!state.financialAlerts.some((candidate) => candidate.id === alert.id)) {
    state.financialAlerts.push(alert);
    state.financialAlerts = state.financialAlerts.slice(-120);
  }
}

function parseFinancialPeriod(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(identifier(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  return { year, month, index: (year * 12) + month - 1 };
}

function financialPeriodFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function financialPeriodsToClose(lastPeriodKey, currentPeriodKey) {
  const current = parseFinancialPeriod(currentPeriodKey);
  if (!current) return [];
  const previous = parseFinancialPeriod(lastPeriodKey);
  // Saves migrated from the old schema start accounting at the current month;
  // otherwise opening an old career could charge its whole historical lifetime.
  if (!previous) return [currentPeriodKey];
  if (previous.index >= current.index) return [];
  return Array.from(
    { length: current.index - previous.index },
    (_, offset) => financialPeriodFromIndex(previous.index + offset + 1),
  );
}

function financialPeriodEnd(periodKey) {
  const period = parseFinancialPeriod(periodKey);
  if (!period) return null;
  return new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59, 999)).toISOString();
}

/** Avanca obras, contratos e fechamento mensal pela data virtual da carreira. */
export function processClubCareerDate(room, asOf = new Date()) {
  const effectiveAt = timestamp(asOf);
  ensureClubCareerSystems(room, { now: effectiveAt });
  const state = ensureClubCareerState(room);
  if (new Date(effectiveAt).getTime() > new Date(state.currentDate ?? 0).getTime()) {
    state.currentDate = effectiveAt;
  }
  const projects = processFacilityProjects(room, effectiveAt, {
    recordEvent: (event) => recordClubCareerEvent(room, event),
  });
  const staff = processStaffContractExpirations(room, staffCallbacks(effectiveAt));
  replaceRoom(room, staff.room);

  const currentPeriodKey = effectiveAt.slice(0, 7);
  const finance = [];
  for (const club of catalogClubs(room)) {
    const financeState = ensureClubCareerState(room);
    const lastPeriodKey = financeState.lastFinancialPeriodByClub?.[clubKey(club.id)];
    const periods = financialPeriodsToClose(lastPeriodKey, currentPeriodKey);
    for (const periodKey of periods) {
      const occurredAt = financialPeriodEnd(periodKey) ?? effectiveAt;
      const playerPayroll = calculateMonthlyPayroll(room, club.id);
      const staffEffects = calculateStaffEffects(room, club.id, occurredAt);
      const clubPlayers = (room?.careerState?.players ?? []).filter((player) => (
        clubKey(player?.currentClubId ?? player?.clubId ?? player?.contract?.clubId) === clubKey(club.id)
      ));
      const starImpact = calculateStarImpact(club.id, clubPlayers);
      try {
        const monthly = processMonthlyClubFinance(room, {
          clubId: club.id,
          periodKey,
          occurredAt,
          payroll: playerPayroll.amount + staffEffects.monthlyCost,
          paidPlayers: playerPayroll.paidPlayers,
          maintenance: calculateMonthlyMaintenance(room, club.id),
          sponsorBonus: Math.floor(starImpact.sponsorAnnualBonus / 12),
          payrollMetadata: {
            playerPayroll: playerPayroll.amount,
            staffPayroll: staffEffects.monthlyCost,
            staffCount: staffEffects.memberCount,
          },
        });
        finance.push(monthly);
        for (const transaction of monthly.transactions ?? []) {
          if (transaction.category !== "sponsorship") continue;
          recordClubCareerEvent(room, {
            id: `finance:${transaction.originId}`,
            operationId: transaction.originId,
            type: CAREER_EVENT_TYPES.SPONSOR_PAYMENT_RECEIVED,
            occurredAt: transaction.occurredAt,
            seasonNumber: room.currentSeason,
            clubIds: [club.id],
            payload: {
              clubId: club.id,
              amount: transaction.amount,
              sponsorName: transaction.metadata?.sponsorName,
              periodKey,
            },
          });
        }
      } catch (error) {
        if (!String(error?.code ?? "").includes("BUDGET_INSUFFICIENT")) throw error;
        appendFinancialAlert(room, {
          id: `finance-alert:${club.id}:${periodKey}`,
          clubId: club.id,
          type: "monthly_budget_insufficient",
          periodKey,
          occurredAt,
          message: "Saldo insuficiente para fechar as obrigacoes mensais.",
        });
        // The failed period remains pending. Later periods must wait so a retry
        // cannot leave an accounting gap in the career timeline.
        break;
      }
    }
  }
  return { projects, staff, finance };
}

function eventTypeForMarket(transaction) {
  if (transaction.status === "scheduled") return CAREER_EVENT_TYPES.TRANSFER_SCHEDULED;
  const eventType = identifier(transaction.eventType).toLocaleLowerCase("pt-BR");
  if (eventType.includes("loan-option") || eventType.includes("loan-obligation")) {
    return CAREER_EVENT_TYPES.LOAN_PURCHASED;
  }
  if (transaction.dealType === "loan") return CAREER_EVENT_TYPES.LOAN_STARTED;
  return CAREER_EVENT_TYPES.TRANSFER_COMPLETED;
}

function marketEventPayload(room, transaction) {
  const playerId = transaction?.player?.id;
  const player = careerPlayer(room, playerId) ?? marketPlayer(room, playerId) ?? transaction.player;
  return {
    ...transaction,
    playerId,
    playerName: player?.name ?? transaction?.player?.name,
    fromClubId: transaction.fromClubId,
    toClubId: transaction.toClubId,
    lenderClubId: transaction.dealType === "loan" ? transaction.fromClubId : undefined,
    borrowerClubId: transaction.dealType === "loan" ? transaction.toClubId : undefined,
  };
}

/** Espelha fatos do mercado ja liquidados; nunca movimenta saldo duas vezes. */
export function syncMarketCareerSideEffects(room) {
  ensureClubCareerSystems(room, { now: room?.marketState?.updatedAt ?? new Date() });
  const mirrored = [];
  const events = [];
  for (const transaction of room.marketState?.transactions ?? []) {
    if (!transaction?.id || !["completed", "scheduled"].includes(transaction.status)) continue;
    const type = eventTypeForMarket(transaction);
    const occurredAt = transaction.completedAt ?? room.marketState.updatedAt ?? careerDateFor(room);
    if (transaction.status === "completed" && Number(transaction.amount) > 0) {
      if (transaction.toClubId) mirrored.push(mirrorSettledFinancialTransaction(room, {
        clubId: transaction.toClubId,
        relatedClubId: transaction.fromClubId,
        playerId: transaction.player?.id,
        amount: transaction.amount,
        direction: "expense",
        originId: transaction.id,
        category: transaction.dealType === "loan" ? "loan_fee" : "transfer_fee",
        description: `${transaction.player?.name ?? "Jogador"} contratado`,
        occurredAt,
        source: "market-settlement",
      }));
      if (transaction.fromClubId) mirrored.push(mirrorSettledFinancialTransaction(room, {
        clubId: transaction.fromClubId,
        relatedClubId: transaction.toClubId,
        playerId: transaction.player?.id,
        amount: transaction.amount,
        direction: "income",
        originId: transaction.id,
        category: transaction.dealType === "loan" ? "loan_fee" : "transfer_fee",
        description: `${transaction.player?.name ?? "Jogador"} negociado`,
        occurredAt,
        source: "market-settlement",
      }));
    }
    events.push(recordClubCareerEvent(room, {
      id: `market:${type}:${transaction.id}`,
      operationId: transaction.id,
      type,
      occurredAt,
      seasonNumber: room.currentSeason,
      clubIds: [transaction.fromClubId, transaction.toClubId].filter(Boolean),
      playerIds: [transaction.player?.id].filter(Boolean),
      payload: marketEventPayload(room, transaction),
    }));
  }
  for (const loan of room.marketState?.loanHistory ?? []) {
    if (loan?.status !== "returned" || !loan?.id) continue;
    const operationId = loan.transactionId ?? `${loan.id}:return`;
    events.push(recordClubCareerEvent(room, {
      id: `market:${CAREER_EVENT_TYPES.LOAN_RETURNED}:${operationId}`,
      operationId,
      type: CAREER_EVENT_TYPES.LOAN_RETURNED,
      occurredAt: loan.endsAt ?? room.marketState.updatedAt ?? careerDateFor(room),
      seasonNumber: room.currentSeason,
      clubIds: [loan.borrowerClubId, loan.lenderClubId].filter(Boolean),
      playerIds: [loan.playerId].filter(Boolean),
      payload: {
        playerId: loan.playerId,
        fromClubId: loan.borrowerClubId,
        toClubId: loan.lenderClubId,
        borrowerClubId: loan.borrowerClubId,
        lenderClubId: loan.lenderClubId,
      },
    }));
  }
  return { mirrored, events };
}

export function recordClubMatchday(room, input) {
  ensureClubCareerSystems(room, { now: input?.occurredAt });
  return recordMatchdayEconomy(room, input, {
    credit: (transaction) => creditFinance(room, transaction),
    recordEvent: (event) => recordClubCareerEvent(room, event),
  });
}

export function awardClubPrize(room, input = {}) {
  const occurredAt = timestamp(input.occurredAt ?? new Date());
  ensureClubCareerSystems(room, { now: occurredAt });
  const operationId = identifier(input.operationId ?? input.originId);
  const credited = creditFinance(room, {
    clubId: input.clubId,
    amount: input.amount,
    originId: operationId,
    category: "prize",
    description: identifier(input.description) || "Premiação de competição",
    source: "competition-prize",
    competitionId: input.competitionId,
    occurredAt,
    metadata: { reason: input.reason },
  });
  const event = recordClubCareerEvent(room, {
    id: `prize:${operationId}`,
    operationId,
    type: CAREER_EVENT_TYPES.PRIZE_RECEIVED,
    occurredAt,
    seasonNumber: room.currentSeason,
    clubIds: [input.clubId],
    competitionId: input.competitionId,
    payload: {
      clubId: input.clubId,
      competitionId: input.competitionId,
      amount: input.amount,
      reason: input.reason,
    },
  });
  return { ...credited, event };
}

function positivePrizeAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= 2_000_000_000 ? amount : 0;
}

/** Resolve apenas valores persistidos; nunca estima premio pela reputacao ou formato. */
export function configuredChampionPrize(competition) {
  const objectPrizes = [competition?.prizes, competition?.rewards, competition?.awards]
    .filter((value) => value && typeof value === "object" && !Array.isArray(value));
  const rankedPrizes = [competition?.prizes, competition?.rewards, competition?.awards]
    .filter(Array.isArray)
    .flat()
    .find((entry) => (
      entry && typeof entry === "object"
      && ([1, "1"].includes(entry.position) || ["winner", "champion", "campeao", "campeão"].includes(
        identifier(entry.type ?? entry.place ?? entry.label).toLocaleLowerCase("pt-BR"),
      ))
    ));
  const amount = [
    competition?.prizeMoney,
    competition?.championPrize,
    competition?.winnerPrize,
    competition?.firstPlacePrize,
    competition?.premioCampeao,
    competition?.premiacaoCampeao,
    competition?.prize,
    competition?.premio,
    competition?.premiacao,
    ...objectPrizes.flatMap((value) => [
      value.winner,
      value.champion,
      value.campeao,
      value.first,
      value[1],
    ]),
    rankedPrizes?.amount,
    rankedPrizes?.value,
    rankedPrizes?.prizeMoney,
  ].map(positivePrizeAmount).find((value) => value > 0) ?? 0;
  return {
    amount,
    reason: identifier(
      competition?.prizeReason
      ?? competition?.prizeName
      ?? rankedPrizes?.reason
      ?? rankedPrizes?.name,
    ) || "titulo de campeao",
  };
}

function completedCompetitionFacts(room) {
  const facts = [];
  const seasonNumber = Number.isInteger(Number(room?.currentSeason)) ? Number(room.currentSeason) : 1;
  for (const state of room?.competitionSeason?.competitions ?? []) {
    if (state?.status !== "completed" || !identifier(state?.winnerClubId)) continue;
    const definition = (room?.tournamentCatalog ?? []).find(
      (candidate) => clubKey(candidate?.id) === clubKey(state.id),
    );
    if (!definition) continue;
    facts.push({
      seasonNumber: Number.isInteger(Number(state.seasonNumber)) ? Number(state.seasonNumber) : seasonNumber,
      competitionId: state.id,
      competitionName: identifier(definition.name ?? state.name) || state.id,
      winnerClubId: state.winnerClubId,
      definition,
    });
  }
  for (const state of buildCompletedLeagueStates(room)) {
    if (!identifier(state?.winnerClubId)) continue;
    const definition = (room?.competitionCatalog ?? []).find(
      (candidate) => clubKey(candidate?.id) === clubKey(state.id),
    );
    if (!definition) continue;
    facts.push({
      seasonNumber: Number.isInteger(Number(state.seasonNumber)) ? Number(state.seasonNumber) : seasonNumber,
      competitionId: state.id,
      competitionName: identifier(definition.name ?? state.name) || state.id,
      winnerClubId: state.winnerClubId,
      definition,
    });
  }
  return [...new Map(facts.map((fact) => [
    `${fact.seasonNumber}:${clubKey(fact.competitionId)}`,
    fact,
  ])).values()];
}

/** Registra titulo real e credita premio configurado. Reexecucao nao duplica nenhum efeito. */
export function awardCompletedCompetitionPrizes(room, { occurredAt = new Date() } = {}) {
  const completedAt = timestamp(occurredAt);
  ensureClubCareerSystems(room, { now: completedAt });
  return completedCompetitionFacts(room).map((fact) => {
    const operationBase = `competition:s${fact.seasonNumber}:${clubKey(fact.competitionId)}`;
    const title = recordClubCareerEvent(room, {
      id: `competition-title:${operationBase}`,
      operationId: `${operationBase}:title`,
      type: CAREER_EVENT_TYPES.COMPETITION_WON,
      occurredAt: completedAt,
      seasonNumber: fact.seasonNumber,
      clubIds: [fact.winnerClubId],
      competitionId: fact.competitionId,
      payload: {
        clubId: fact.winnerClubId,
        competitionId: fact.competitionId,
        competitionName: fact.competitionName,
      },
    });
    const canonicalWinnerClubId = identifier(
      title.event?.payload?.clubId ?? title.event?.clubIds?.[0],
    ) || fact.winnerClubId;
    const configured = configuredChampionPrize(fact.definition);
    const prize = configured.amount > 0
      ? awardClubPrize(room, {
        clubId: canonicalWinnerClubId,
        amount: configured.amount,
        operationId: `${operationBase}:prize`,
        competitionId: fact.competitionId,
        description: `Premiacao de ${fact.competitionName}`,
        reason: configured.reason,
        occurredAt: completedAt,
      })
      : null;
    return {
      competitionId: fact.competitionId,
      winnerClubId: canonicalWinnerClubId,
      amount: configured.amount,
      title,
      prize,
      awarded: prize?.applied === true,
    };
  });
}

function playerStateMap(values) {
  return new Map((Array.isArray(values) ? values : []).flatMap((state) => {
    const playerId = identifier(state?.playerId);
    const clubId = identifier(state?.clubId);
    return playerId && clubId ? [[`${clubKey(clubId)}:${playerId.toLocaleLowerCase("pt-BR")}`, state]] : [];
  }));
}

/** Projeta somente mudanças reais de disponibilidade produzidas pelo motor. */
export function recordPlayerAvailabilityEvents(room, {
  fixtureId,
  competitionId = null,
  seasonNumber: suppliedSeasonNumber = null,
  previousPlayerStates = [],
  occurredAt = new Date(),
} = {}) {
  ensureClubCareerSystems(room, { now: occurredAt });
  const operation = fixtureOperationScope(room, {
    fixtureId,
    competitionId,
    seasonNumber: suppliedSeasonNumber,
  });
  if (!operation.fixtureId) return [];
  const previous = playerStateMap(previousPlayerStates);
  const recorded = [];
  const recordAvailabilityEvent = (event, legacyOperationId) => {
    const legacy = (room.clubCareerState?.events ?? []).find((existing) => (
      existing?.type === event.type
      && identifier(existing?.operationId).toLocaleLowerCase("pt-BR")
        === identifier(legacyOperationId).toLocaleLowerCase("pt-BR")
      && seasonNumber(existing?.seasonNumber, 1) === operation.season
      && (!identifier(existing?.competitionId)
        || identifier(existing.competitionId).toLocaleLowerCase("pt-BR")
          === identifier(operation.competitionId).toLocaleLowerCase("pt-BR"))
    ));
    return legacy ?? recordClubCareerEvent(room, event);
  };
  for (const current of room.playerStates ?? []) {
    const playerId = identifier(current?.playerId);
    const clubId = identifier(current?.clubId);
    if (!playerId || !clubId) continue;
    const before = previous.get(`${clubKey(clubId)}:${playerId.toLocaleLowerCase("pt-BR")}`) ?? {};
    const beforeInjury = Math.max(0, Math.trunc(finite(before.injuryMatches)));
    const currentInjury = Math.max(0, Math.trunc(finite(current.injuryMatches)));
    const beforeSuspension = Math.max(0, Math.trunc(finite(before.suspensionMatches)));
    const currentSuspension = Math.max(0, Math.trunc(finite(current.suspensionMatches)));
    const base = {
      occurredAt,
      seasonNumber: operation.season,
      clubIds: [clubId],
      playerIds: [playerId],
      competitionId: operation.competitionId,
      matchId: operation.fixtureId,
      payload: {
        clubId,
        playerId,
        fixtureId: operation.fixtureId,
        competitionId: operation.competitionId,
        seasonNumber: operation.season,
      },
    };
    const playerScope = operationScopePart(playerId, "unknown");
    if (beforeInjury === 0 && currentInjury > 0) {
      recorded.push(recordAvailabilityEvent({
        ...base,
        id: `availability:${operation.scope}:injury:${playerScope}`,
        operationId: `availability:${operation.scope}:injury:${playerScope}`,
        type: CAREER_EVENT_TYPES.PLAYER_INJURED,
        payload: { ...base.payload, injuryMatches: currentInjury },
      }, `${operation.fixtureId}:injury:${playerId}`));
    } else if (beforeInjury > 0 && currentInjury === 0) {
      recorded.push(recordAvailabilityEvent({
        ...base,
        id: `availability:${operation.scope}:return:${playerScope}`,
        operationId: `availability:${operation.scope}:return:${playerScope}`,
        type: CAREER_EVENT_TYPES.PLAYER_RETURNED_FROM_INJURY,
      }, `${operation.fixtureId}:return:${playerId}`));
    }
    if (beforeSuspension === 0 && currentSuspension > 0) {
      recorded.push(recordAvailabilityEvent({
        ...base,
        id: `availability:${operation.scope}:suspension:${playerScope}`,
        operationId: `availability:${operation.scope}:suspension:${playerScope}`,
        type: CAREER_EVENT_TYPES.PLAYER_SUSPENDED,
        payload: { ...base.payload, suspensionMatches: currentSuspension },
      }, `${operation.fixtureId}:suspension:${playerId}`));
    }
  }
  return recorded;
}

export function recordCareerTransitionEvents(room, {
  summary,
  previousPlayers = [],
  occurredAt = new Date(),
} = {}) {
  ensureClubCareerSystems(room, { now: occurredAt });
  const previousById = new Map(previousPlayers.map((player) => [identifier(player?.id), player]));
  const currentById = new Map((room?.careerState?.players ?? []).map((player) => [identifier(player?.id), player]));
  const season = Number(summary?.seasonNumber ?? room.currentSeason);
  const recorded = [];
  for (const playerId of summary?.contracts?.renewedPlayerIds ?? []) {
    const player = currentById.get(identifier(playerId));
    const clubId = player?.contract?.clubId ?? player?.currentClubId ?? player?.clubId;
    if (!player || !clubId) continue;
    recorded.push(recordClubCareerEvent(room, {
      id: `season:${season}:contract-renewed:${player.id}`,
      operationId: `season:${season}:contract-renewed:${player.id}`,
      type: CAREER_EVENT_TYPES.PLAYER_CONTRACT_RENEWED,
      occurredAt,
      seasonNumber: season,
      clubIds: [clubId],
      playerIds: [player.id],
      payload: { clubId, playerId: player.id, endSeason: player.contract?.endSeason },
    }));
  }
  for (const playerId of summary?.contracts?.expiredPlayerIds ?? []) {
    const player = previousById.get(identifier(playerId));
    const clubId = player?.contract?.clubId ?? player?.currentClubId ?? player?.clubId;
    if (!player || !clubId) continue;
    recorded.push(recordClubCareerEvent(room, {
      id: `season:${season}:contract-expired:${player.id}`,
      operationId: `season:${season}:contract-expired:${player.id}`,
      type: CAREER_EVENT_TYPES.PLAYER_CONTRACT_EXPIRED,
      occurredAt,
      seasonNumber: season,
      clubIds: [clubId],
      playerIds: [player.id],
      payload: { clubId, playerId: player.id, playerName: player.name },
    }));
  }
  return recorded;
}

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Agrega somente efeitos comprovaveis da estrutura e da comissao do clube.
 * O bonus de partida e deliberadamente pequeno: ajuda, mas nunca decide sozinho.
 */
export function clubCareerPerformanceEffects(room, clubId, asOf = new Date()) {
  const now = timestamp(asOf);
  ensureClubCareerSystems(room, { now });
  const facility = facilityEffectsForClub(room, clubId, now);
  const staff = calculateStaffEffects(room, clubId, now);
  const club = catalogClubs(room).find((candidate) => clubKey(candidate?.id) === clubKey(clubId));
  const baseAcademyQuality = clamp(finite(
    club?.academyLevel ?? club?.youthRating ?? club?.reputation,
    10,
  ), 1, 20);
  const infrastructureYouthBonus = clamp(finite(facility.youthQualityBonus), 0, 5);
  const staffYouthBonus = clamp(finite(staff.youthIntakeQualityBonus), 0, 2);
  const youthQualityBonus = Math.round((infrastructureYouthBonus + staffYouthBonus) * 1_000) / 1_000;
  const youthDevelopment = {
    schemaVersion: 1,
    baseAcademyQuality,
    infrastructureBonus: infrastructureYouthBonus,
    staffBonus: staffYouthBonus,
    totalBonus: youthQualityBonus,
    effectiveAcademyQuality: Math.round(clamp(baseAcademyQuality + youthQualityBonus, 1, 20) * 1_000) / 1_000,
  };
  const developmentMultiplier = clamp(
    finite(facility.developmentMultiplier, 1) * finite(staff.trainingDevelopmentMultiplier, 1),
    1,
    1.35,
  );
  const injuryRiskMultiplier = clamp(
    finite(facility.injuryRiskMultiplier, 1) * finite(staff.injuryRiskMultiplier, 1),
    0.5,
    1,
  );
  const matchStrengthBonus = clamp(
    (developmentMultiplier - 1) * 1.6
      + finite(staff.tacticalAnalysisBonus) / 160,
    0,
    0.35,
  );
  const physicalSecondHalfBonus = clamp(
    (1 - finite(facility.fatigueMultiplier, 1)) * 0.16
      + (1 - finite(staff.injuryRiskMultiplier, 1)) * 0.06,
    0,
    0.07,
  );
  return {
    clubId: identifier(clubId),
    developmentMultiplier,
    youthQualityBonus,
    youthDevelopment,
    injuryRiskMultiplier,
    recoveryBonus: Math.max(0, finite(facility.recoveryBonus) + finite(staff.conditionRecoveryBonus)),
    scoutingConfidenceBonus: Math.max(
      0,
      finite(facility.scoutingConfidenceBonus) + finite(staff.scoutingConfidenceBonus),
    ),
    analysisConfidenceBonus: Math.max(
      0,
      finite(facility.analysisConfidenceBonus) + finite(staff.tacticalAnalysisBonus),
    ),
    scoutingSpeedMultiplier: clamp(finite(staff.scoutingSpeedMultiplier, 1), 0.7, 1),
    goalkeeperDevelopmentMultiplier: clamp(finite(staff.goalkeeperDevelopmentMultiplier, 1), 1, 1.2),
    moraleRecoveryBonus: Math.max(0, finite(staff.moraleRecoveryBonus)),
    negotiationBonus: clamp(finite(staff.negotiationBonus), 0, 0.12),
    matchStrengthBonus,
    physicalSecondHalfBonus,
    facility,
    staff,
    calculatedAt: now,
  };
}

export function clubCareerEffectsByClub(room, asOf = new Date()) {
  return Object.fromEntries(catalogClubs(room).map((club) => [
    clubKey(club.id),
    clubCareerPerformanceEffects(room, club.id, asOf),
  ]));
}

function applyCareerSide(fixture, side, effects) {
  const strengthField = side === "home" ? "homeStrength" : "awayStrength";
  const physicalField = side === "home"
    ? "homePhysicalSecondHalfModifier"
    : "awayPhysicalSecondHalfModifier";
  const previous = fixture?.strengthProfile?.[side] ?? {};
  const previousCareerBonus = finite(previous.careerBonus);
  const currentStrength = finite(
    fixture?.[strengthField],
    finite(previous.effective, finite(previous.base, 10)),
  );
  const effective = currentStrength - previousCareerBonus + effects.matchStrengthBonus;
  return {
    strengthField,
    physicalField,
    strength: Math.round(effective * 1_000) / 1_000,
    physical: clamp(
      finite(fixture?.[physicalField]) + effects.physicalSecondHalfBonus,
      -0.4,
      0.4,
    ),
    profile: {
      ...previous,
      careerBonus: effects.matchStrengthBonus,
      effective: Math.round(effective * 1_000) / 1_000,
    },
  };
}

/** Aplica efeitos persistentes do clube ao mesmo payload usado pelo simulador. */
export function applyClubCareerEffectsToFixture(room, fixture, asOf = new Date()) {
  if (!fixture) return fixture;
  const home = clubCareerPerformanceEffects(room, fixture.homeClubId, asOf);
  const away = clubCareerPerformanceEffects(room, fixture.awayClubId, asOf);
  const homeApplied = applyCareerSide(fixture, "home", home);
  const awayApplied = applyCareerSide(fixture, "away", away);
  return {
    ...fixture,
    [homeApplied.strengthField]: homeApplied.strength,
    [awayApplied.strengthField]: awayApplied.strength,
    [homeApplied.physicalField]: homeApplied.physical,
    [awayApplied.physicalField]: awayApplied.physical,
    clubCareerEffects: { home, away },
    strengthProfile: {
      ...(fixture.strengthProfile ?? {}),
      home: homeApplied.profile,
      away: awayApplied.profile,
    },
  };
}

/** Efeito real e persistente de recuperacao da estrutura/comissao. */
export function applyClubRecoveryEffects(room, asOf = new Date()) {
  const now = timestamp(asOf);
  ensureClubCareerSystems(room, { now });
  const effectsByClub = new Map(catalogClubs(room).map((club) => {
    const facility = facilityEffectsForClub(room, club.id, now);
    const staff = calculateStaffEffects(room, club.id, now);
    return [clubKey(club.id), {
      conditionBonus: Math.max(0, facility.recoveryBonus + staff.conditionRecoveryBonus),
      moraleRecoveryBonus: Math.max(0, finite(staff.moraleRecoveryBonus)),
      injuryRecoveryMultiplier: clamp(
        finite(staff.injuryRecoveryMultiplier, 1) - finite(facility.recoveryBonus) * 0.025,
        0.55,
        1,
      ),
    }];
  }));
  let changed = 0;
  room.playerStates = (room.playerStates ?? []).map((state) => {
    const player = careerPlayer(room, state.playerId) ?? marketPlayer(room, state.playerId);
    const clubId = player?.currentClubId ?? player?.clubId;
    const effects = effectsByClub.get(clubKey(clubId));
    if (!effects) return state;
    const condition = Number.isFinite(Number(state.condition))
      ? Math.min(100, Math.round((Number(state.condition) + effects.conditionBonus) * 10) / 10)
      : state.condition;
    const currentInjuryMatches = Math.max(0, Math.trunc(finite(state.injuryMatches)));
    const injuryMatches = currentInjuryMatches > 0
      ? Math.max(1, Math.round(currentInjuryMatches * effects.injuryRecoveryMultiplier))
      : 0;
    if (condition === state.condition && injuryMatches === currentInjuryMatches) return state;
    changed += 1;
    return { ...state, condition, injuryMatches };
  });
  let moraleChanged = 0;
  room.clubMoraleStates = (room.clubMoraleStates ?? []).map((state) => {
    const effects = effectsByClub.get(clubKey(state?.clubId));
    if (!effects?.moraleRecoveryBonus) return state;
    const score = finite(state?.score, 70);
    const recoveredScore = score < 70
      ? Math.min(70, Math.round((score + effects.moraleRecoveryBonus) * 10) / 10)
      : score;
    const playerDeltas = (Array.isArray(state?.playerDeltas) ? state.playerDeltas : []).map((entry) => {
      const delta = finite(entry?.delta);
      if (delta >= 0) return entry;
      return {
        ...entry,
        delta: Math.min(0, Math.round((delta + effects.moraleRecoveryBonus) * 10) / 10),
      };
    }).filter((entry) => finite(entry?.delta) !== 0);
    if (recoveredScore === score && JSON.stringify(playerDeltas) === JSON.stringify(state.playerDeltas ?? [])) {
      return state;
    }
    moraleChanged += 1;
    return { ...state, score: recoveredScore, playerDeltas, updatedAt: now };
  });
  return {
    changed,
    moraleChanged,
    bonuses: Object.fromEntries([...effectsByClub].map(([clubId, effects]) => [clubId, effects.conditionBonus])),
    moraleRecoveryBonuses: Object.fromEntries(
      [...effectsByClub].map(([clubId, effects]) => [clubId, effects.moraleRecoveryBonus]),
    ),
    injuryRecoveryMultipliers: Object.fromEntries(
      [...effectsByClub].map(([clubId, effects]) => [clubId, effects.injuryRecoveryMultiplier]),
    ),
  };
}

export function markClubCareerNewsRead(room, { newsId, managerId, readAt = new Date() } = {}) {
  ensureClubCareerSystems(room, { now: readAt });
  return markCareerNewsRead(room, newsId, managerId, readAt);
}
