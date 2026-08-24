import { calculateClubMonthlyPayroll } from "./payroll.mjs";

const EMPTY_MESSAGES = Object.freeze({
  finance: "Informações financeiras ainda não disponíveis",
  nextFixture: "Nenhuma partida agendada",
  recentResults: "Nenhum resultado registrado",
  squad: "Elenco ainda não disponível",
  injuries: "Nenhum jogador lesionado",
  suspensions: "Nenhum jogador suspenso",
  contracts: "Não há contratos próximos do fim",
  negotiations: "Nenhuma negociação em andamento",
  works: "Nenhuma obra em andamento",
  objectives: "Nenhum objetivo cadastrado",
  messages: "Nenhuma mensagem importante",
  administrative: "Nenhuma pendência no momento",
  competition: "Situação da competição ainda não disponível",
  staffAlerts: "Nenhum alerta da comissão técnica",
  coachCareerAlerts: "Nenhuma pendência na carreira do treinador",
  news: "Nenhuma notícia da carreira",
});

function text(value) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function key(value) {
  return text(value).toLocaleLowerCase("pt-BR");
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function integer(value) {
  const result = Number(value);
  return Number.isInteger(result) ? result : null;
}

function dateValue(value) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function uniqueBy(values, selector) {
  const seen = new Set();
  return values.filter((value) => {
    const selected = selector(value);
    if (!selected || seen.has(selected)) return false;
    seen.add(selected);
    return true;
  });
}

function stateFor(room) {
  return room?.clubCareerState && typeof room.clubCareerState === "object"
    ? room.clubCareerState
    : {};
}

function coachStateFor(room) {
  const employment = room?.coachEmploymentState && typeof room.coachEmploymentState === "object"
    ? room.coachEmploymentState
    : {};
  const career = room?.coachCareerState && typeof room.coachCareerState === "object"
    ? room.coachCareerState
    : {};
  return {
    ...employment,
    coaches: list(career.coaches).length > 0 ? career.coaches : employment.coaches,
  };
}

function allCatalogClubs(room) {
  return [
    ...list(room?.competitionCatalog).flatMap((league) => list(league?.clubs).map((club) => ({ club, league }))),
    ...list(room?.tournamentCatalog).flatMap((competition) => (
      list(competition?.participants).map((club) => ({ club, league: competition }))
    )),
  ];
}

function resolveClub(room, clubId) {
  const target = key(clubId);
  if (!target) return { id: "", name: "", aliases: new Set() };
  const entry = allCatalogClubs(room).find(({ club }) => (
    [club?.id, club?.code, club?.name].some((value) => key(value) === target)
  ));
  const club = entry?.club ?? {};
  return {
    id: text(club.id ?? clubId),
    code: text(club.code),
    name: text(club.name ?? clubId),
    league: entry?.league ?? null,
    aliases: new Set([clubId, club.id, club.code, club.name].map(key).filter(Boolean)),
  };
}

function sameClub(value, club) {
  return club.aliases.has(key(value));
}

function clubName(room, value) {
  return resolveClub(room, value).name || text(value);
}

function fixtureId(fixture) {
  return text(fixture?.fixtureId ?? fixture?.leagueFixtureId ?? fixture?.competitionFixtureId ?? fixture?.id);
}

function fixtureCompetitionId(fixture) {
  return text(fixture?.leagueId ?? fixture?.competitionId ?? fixture?.tournamentId) || null;
}

function fixtureInvolves(fixture, club) {
  return sameClub(fixture?.homeClubId, club) || sameClub(fixture?.awayClubId, club);
}

function fixtureAliases(fixture) {
  return new Set([
    fixture?.fixtureId,
    fixture?.leagueFixtureId,
    fixture?.competitionFixtureId,
    fixture?.id,
  ].map(key).filter(Boolean));
}

function fixtureCompleted(room, fixture) {
  const aliases = fixtureAliases(fixture);
  if (list(room?.completedFixtureIds).some((id) => aliases.has(key(id)))) return true;
  return [...list(room?.leagueMatchResults), ...list(room?.completedMatches)].some((result) => (
    [result?.fixtureId, result?.leagueFixtureId, result?.competitionFixtureId, result?.id]
      .some((id) => aliases.has(key(id)))
  ));
}

function fixtureDateSort(left, right) {
  const leftDate = dateValue(left?.scheduledAt)?.getTime();
  const rightDate = dateValue(right?.scheduledAt)?.getTime();
  if (leftDate !== undefined && rightDate !== undefined && leftDate !== rightDate) return leftDate - rightDate;
  return (integer(left?.round) ?? Number.MAX_SAFE_INTEGER) - (integer(right?.round) ?? Number.MAX_SAFE_INTEGER)
    || fixtureId(left).localeCompare(fixtureId(right));
}

function publicFixture(room, fixture, club) {
  if (!fixture) return null;
  const isHome = sameClub(fixture.homeClubId, club);
  const opponentId = isHome ? fixture.awayClubId : fixture.homeClubId;
  return {
    id: fixtureId(fixture),
    competitionId: fixtureCompetitionId(fixture),
    competitionName: text(fixture.competition ?? fixture.competitionName ?? club.league?.name) || null,
    stage: text(fixture.stage) || null,
    round: integer(fixture.round),
    scheduledAt: dateValue(fixture.scheduledAt)?.toISOString() ?? null,
    homeClubId: text(fixture.homeClubId),
    homeClubName: text(fixture.homeTeam) || clubName(room, fixture.homeClubId),
    awayClubId: text(fixture.awayClubId),
    awayClubName: text(fixture.awayTeam) || clubName(room, fixture.awayClubId),
    opponentClubId: text(opponentId),
    opponentClubName: isHome
      ? text(fixture.awayTeam) || clubName(room, fixture.awayClubId)
      : text(fixture.homeTeam) || clubName(room, fixture.homeClubId),
    venue: text(fixture.homeStadium ?? fixture.stadium) || null,
    isHome,
  };
}

export function selectNextFixture(room, clubId) {
  const club = resolveClub(room, clubId);
  if (!club.id) return null;
  const fixtures = uniqueBy([
    ...list(room?.fixtureSchedule),
    ...list(room?.leagueFixtureSchedule),
    ...list(room?.competitionSeason?.fixtures),
  ], (fixture) => key(fixtureId(fixture)));
  const current = fixtures.find((fixture) => (
    key(fixtureId(fixture)) === key(room?.currentFixtureId)
    && fixtureInvolves(fixture, club)
    && !fixtureCompleted(room, fixture)
  ));
  const next = current ?? fixtures
    .filter((fixture) => fixtureInvolves(fixture, club) && !fixtureCompleted(room, fixture))
    .sort(fixtureDateSort)[0] ?? null;
  return publicFixture(room, next, club);
}

function fixtureForResult(room, result) {
  const resultKeys = new Set([
    result?.fixtureId,
    result?.leagueFixtureId,
    result?.competitionFixtureId,
    result?.id,
  ].map(key).filter(Boolean));
  return [
    ...list(room?.fixtureSchedule),
    ...list(room?.leagueFixtureSchedule),
    ...list(room?.competitionSeason?.fixtures),
  ].find((fixture) => [...fixtureAliases(fixture)].some((id) => resultKeys.has(id))) ?? null;
}

function hydrateResult(room, result) {
  const fixture = fixtureForResult(room, result);
  const score = Array.isArray(result?.score) ? result.score.map(Number) : null;
  if (!score || score.length < 2 || !score.every((goal) => Number.isInteger(goal) && goal >= 0)) return null;
  const homeClubId = text(result?.homeClubId ?? fixture?.homeClubId);
  const awayClubId = text(result?.awayClubId ?? fixture?.awayClubId);
  if (!homeClubId || !awayClubId) return null;
  return {
    id: text(result?.id) || fixtureId(fixture) || text(result?.leagueFixtureId),
    fixtureId: text(result?.fixtureId ?? fixture?.fixtureId ?? result?.leagueFixtureId ?? fixture?.leagueFixtureId),
    leagueFixtureId: text(result?.leagueFixtureId ?? fixture?.leagueFixtureId) || null,
    competitionId: fixtureCompetitionId(result) ?? fixtureCompetitionId(fixture),
    competitionName: text(result?.competition ?? fixture?.competition ?? fixture?.competitionName) || null,
    round: integer(result?.round ?? fixture?.round),
    homeClubId,
    homeClubName: text(result?.homeTeam ?? fixture?.homeTeam) || clubName(room, homeClubId),
    awayClubId,
    awayClubName: text(result?.awayTeam ?? fixture?.awayTeam) || clubName(room, awayClubId),
    score: [score[0], score[1]],
    completedAt: dateValue(result?.completedAt)?.toISOString() ?? null,
  };
}

function resultForClub(result, club) {
  const isHome = sameClub(result.homeClubId, club);
  const goalsFor = result.score[isHome ? 0 : 1];
  const goalsAgainst = result.score[isHome ? 1 : 0];
  return {
    ...result,
    isHome,
    opponentClubId: isHome ? result.awayClubId : result.homeClubId,
    opponentClubName: isHome ? result.awayClubName : result.homeClubName,
    goalsFor,
    goalsAgainst,
    outcome: goalsFor === goalsAgainst ? "draw" : goalsFor > goalsAgainst ? "win" : "loss",
  };
}

export function selectRecentResults(room, clubId, limit = 5) {
  const club = resolveClub(room, clubId);
  if (!club.id) return [];
  const candidates = [
    ...list(room?.lastCompletedRound?.matches),
    ...list(room?.leagueMatchResults),
    ...list(room?.completedMatches),
  ].flatMap((result) => {
    const hydrated = hydrateResult(room, result);
    return hydrated && (sameClub(hydrated.homeClubId, club) || sameClub(hydrated.awayClubId, club))
      ? [resultForClub(hydrated, club)]
      : [];
  });
  return uniqueBy(candidates, (result) => key(result.leagueFixtureId || result.fixtureId || result.id))
    .sort((left, right) => (
      String(right.completedAt ?? "").localeCompare(String(left.completedAt ?? ""))
      || (right.round ?? 0) - (left.round ?? 0)
      || right.id.localeCompare(left.id)
    ))
    .slice(0, Math.max(0, integer(limit) ?? 5));
}

function playerClubId(room, player) {
  const registration = list(room?.marketState?.registrations).find((candidate) => (
    key(candidate?.playerId) === key(player?.id)
  ));
  return text(
    registration?.currentClubId
      ?? player?.currentClubId
      ?? player?.contract?.clubId
      ?? player?.clubId,
  );
}

function statusText(value) {
  return text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

function playerSnapshot(player, runtime) {
  const injuryMatches = Math.max(0, integer(runtime?.injuryMatches ?? player?.injuryMatches) ?? 0);
  const suspensionMatches = Math.max(0, integer(runtime?.suspensionMatches ?? player?.suspensionMatches) ?? 0);
  const status = statusText(runtime?.status ?? player?.status);
  const injured = injuryMatches > 0 || ["lesionado", "injured"].includes(status);
  const suspended = suspensionMatches > 0 || ["suspenso", "suspended"].includes(status);
  return {
    id: text(player?.id),
    name: text(player?.name),
    position: text(player?.position),
    condition: number(runtime?.condition ?? player?.condition),
    morale: number(runtime?.morale ?? player?.morale),
    injuryMatches,
    suspensionMatches,
    injured,
    suspended,
    available: !injured && !suspended && !["indisponivel", "unavailable"].includes(status),
    contract: player?.contract && typeof player.contract === "object" ? clone(player.contract) : null,
  };
}

function sourcePlayers(room, options) {
  return list(options?.players).length > 0 ? list(options.players) : list(room?.careerState?.players);
}

function activeSquadPlayer(room, player) {
  const contractStatus = statusText(player?.contract?.status);
  if (["free_agent", "expired", "released", "retired"].includes(contractStatus)) return false;
  if (player?.retired === true || statusText(player?.careerStage) === "retired") return false;
  const endSeason = integer(player?.contract?.endSeason);
  const currentSeason = integer(room?.currentSeason);
  return endSeason === null || currentSeason === null || endSeason >= currentSeason;
}

export function selectSquadStatus(room, clubId, options = {}) {
  const club = resolveClub(room, clubId);
  const runtimes = new Map(list(room?.playerStates).map((runtime) => [key(runtime?.playerId), runtime]));
  const players = sourcePlayers(room, options)
    .filter((player) => sameClub(playerClubId(room, player), club) && activeSquadPlayer(room, player))
    .map((player) => playerSnapshot(player, runtimes.get(key(player?.id))));
  const conditions = players.map((player) => player.condition).filter((value) => value !== null);
  const morales = players.map((player) => player.morale).filter((value) => value !== null);
  const clubMorale = list(room?.clubMoraleStates).find((item) => sameClub(item?.clubId, club));
  return {
    players,
    total: players.length,
    available: players.filter((player) => player.available).length,
    injured: players.filter((player) => player.injured),
    suspended: players.filter((player) => player.suspended),
    averageCondition: conditions.length
      ? Math.round(conditions.reduce((sum, value) => sum + value, 0) / conditions.length)
      : null,
    averageMorale: morales.length
      ? Math.round(morales.reduce((sum, value) => sum + value, 0) / morales.length)
      : number(clubMorale?.score),
  };
}

function contractEndDate(contract) {
  return dateValue(contract?.endDate ?? contract?.endsAt ?? contract?.endAt);
}

export function selectExpiringContracts(room, clubId, options = {}) {
  const squad = options.squad ?? selectSquadStatus(room, clubId, options);
  const asOf = dateValue(options.asOf ?? stateFor(room).currentDate ?? room?.updatedAt);
  const thresholdDays = Math.max(0, integer(options.contractExpiryDays) ?? 180);
  const currentSeason = integer(room?.currentSeason);
  return squad.players.flatMap((player) => {
    const contract = player.contract;
    if (!contract || !["", "active", "academy"].includes(statusText(contract.status))) return [];
    const endDate = contractEndDate(contract);
    const endSeason = integer(contract.endSeason);
    const remainingDays = asOf && endDate
      ? Math.ceil((endDate.getTime() - asOf.getTime()) / 86_400_000)
      : null;
    const expiringByDate = remainingDays !== null && remainingDays >= 0 && remainingDays <= thresholdDays;
    const expiringBySeason = endDate === null && currentSeason !== null && endSeason !== null && endSeason <= currentSeason;
    if (!expiringByDate && !expiringBySeason) return [];
    return [{
      playerId: player.id,
      playerName: player.name,
      endDate: endDate?.toISOString() ?? null,
      endSeason,
      remainingDays,
      wage: number(contract.wage),
      contractId: text(contract.id) || null,
    }];
  }).sort((left, right) => (
    (left.remainingDays ?? Number.MAX_SAFE_INTEGER) - (right.remainingDays ?? Number.MAX_SAFE_INTEGER)
    || (left.endSeason ?? Number.MAX_SAFE_INTEGER) - (right.endSeason ?? Number.MAX_SAFE_INTEGER)
    || left.playerName.localeCompare(right.playerName, "pt-BR")
  ));
}

function financialTransactions(room, club) {
  return list(stateFor(room).financialTransactions).filter((transaction) => sameClub(transaction?.clubId, club));
}

export function selectClubFinance(room, clubId) {
  const club = resolveClub(room, clubId);
  const careerState = stateFor(room);
  const account = list(room?.marketState?.finances).find((finance) => sameClub(finance?.clubId, club)) ?? null;
  const profile = list(careerState.financeProfiles).find((item) => sameClub(item?.clubId, club)) ?? null;
  const transactions = financialTransactions(room, club);
  const aggregateTotal = Number(careerState?.financialAggregates?.version) === 1
    ? list(careerState?.financialAggregates?.totals).find((item) => sameClub(item?.clubId, club)) ?? null
    : null;
  const payroll = calculateClubMonthlyPayroll(room, club.id).amount;
  const wageBudget = number(profile?.wageBudget);
  const debt = number(profile?.debt ?? profile?.debts);
  const transferBudget = number(profile?.transferBudget);
  if (!account) {
    return {
      status: "empty",
      balance: null,
      committed: null,
      available: null,
      income: null,
      expense: null,
      transferBudget,
      transferAvailable: transferBudget,
      wageBudget,
      payroll,
      debt,
      transactionCount: number(aggregateTotal?.count) ?? transactions.length,
      message: EMPTY_MESSAGES.finance,
    };
  }
  const balance = number(account.balance);
  const committed = number(account.committed) ?? 0;
  const available = balance === null ? null : balance - committed;
  const effectiveTransferBudget = transferBudget ?? available;
  const transferAvailable = available === null
    ? effectiveTransferBudget
    : Math.max(0, Math.min(available, effectiveTransferBudget ?? available));
  const income = number(aggregateTotal?.income) ?? transactions
    .filter((transaction) => transaction.direction === "income")
    .reduce((sum, transaction) => sum + Math.max(0, number(transaction.amount) ?? 0), 0);
  const expense = number(aggregateTotal?.expenses) ?? transactions
    .filter((transaction) => transaction.direction === "expense")
    .reduce((sum, transaction) => sum + Math.max(0, number(transaction.amount) ?? 0), 0);
  return {
    status: balance !== null && (balance < 0 || (available ?? 0) < 0 || (debt ?? 0) > 0) ? "negative" : "stable",
    balance,
    committed,
    available,
    transferBudget: effectiveTransferBudget,
    transferAvailable,
    wageBudget,
    payroll,
    debt,
    income,
    expense,
    netCashflow: income - expense,
    transactionCount: number(aggregateTotal?.count) ?? transactions.length,
    message: null,
  };
}

function dealInvolves(deal, club) {
  return [
    deal?.clubId,
    deal?.buyerClubId,
    deal?.sellerClubId,
    deal?.fromClubId,
    deal?.toClubId,
    deal?.lenderClubId,
    deal?.borrowerClubId,
  ].some((value) => sameClub(value, club));
}

export function selectMarketNegotiations(room, clubId) {
  const club = resolveClub(room, clubId);
  const state = room?.marketState ?? {};
  const offers = list(state.activeOffers).filter((offer) => (
    ["pending", "countered", "accepted_pending"].includes(statusText(offer?.status))
    && dealInvolves(offer, club)
  )).map((offer) => ({ ...clone(offer), kind: "offer" }));
  const listings = list(state.activeListings).filter((listing) => (
    statusText(listing?.status) === "open" && dealInvolves(listing, club)
  )).map((listing) => ({ ...clone(listing), kind: "listing" }));
  const scheduled = list(state.scheduledTransfers).filter((transfer) => (
    statusText(transfer?.status) === "scheduled" && dealInvolves(transfer, club)
  )).map((transfer) => ({ ...clone(transfer), kind: "scheduled_transfer" }));
  return [...offers, ...listings, ...scheduled].sort((left, right) => (
    String(right.updatedAt ?? right.createdAt ?? right.agreedAt ?? "")
      .localeCompare(String(left.updatedAt ?? left.createdAt ?? left.agreedAt ?? ""))
    || text(left.id).localeCompare(text(right.id))
  ));
}

function projectInProgress(project) {
  return ["active", "in_progress", "started", "under_construction"].includes(statusText(project?.status));
}

export function selectActiveProjects(room, clubId, options = {}) {
  const club = resolveClub(room, clubId);
  const asOf = dateValue(options.asOf ?? stateFor(room).currentDate ?? room?.updatedAt);
  return list(stateFor(room).facilityProjects)
    .filter((project) => sameClub(project?.clubId, club) && projectInProgress(project))
    .map((project) => {
      const completesAt = dateValue(
        project.completesAt ?? project.expectedAt ?? project.expectedCompletionAt ?? project.endDate,
      );
      return {
        ...clone(project),
        remainingDays: asOf && completesAt
          ? Math.max(0, Math.ceil((completesAt.getTime() - asOf.getTime()) / 86_400_000))
          : null,
      };
    })
    .sort((left, right) => (
      String(left.completesAt ?? left.expectedAt ?? left.expectedCompletionAt ?? left.endDate ?? "")
        .localeCompare(String(right.completesAt ?? right.expectedAt ?? right.expectedCompletionAt ?? right.endDate ?? ""))
      || text(left.id).localeCompare(text(right.id))
    ));
}

function stateClubItems(state, names, club) {
  return names.flatMap((name) => list(state?.[name]))
    .filter((item) => !text(item?.clubId) || sameClub(item.clubId, club))
    .map(clone);
}

export function selectBoardObjectives(room, clubId) {
  const club = resolveClub(room, clubId);
  return stateClubItems(stateFor(room), ["boardObjectives", "objectives"], club)
    .filter((objective) => !["cancelled", "archived"].includes(statusText(objective?.status)));
}

export function selectCentralMessages(room, clubId) {
  const club = resolveClub(room, clubId);
  return stateClubItems(stateFor(room), ["centralMessages", "messages"], club)
    .filter((message) => !["dismissed", "archived"].includes(statusText(message?.status)))
    .sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")));
}

export function selectStaffAlerts(room, clubId, options = {}) {
  const club = resolveClub(room, clubId);
  const state = stateFor(room);
  const explicit = stateClubItems(state, ["staffAlerts"], club)
    .filter((alert) => !["resolved", "dismissed", "archived"].includes(statusText(alert?.status)))
    .map((alert) => ({ ...alert, source: alert.source ?? "explicit" }));
  const asOf = dateValue(options.asOf ?? state.currentDate ?? room?.updatedAt);
  const contractExpiryDays = Math.max(0, integer(options.staffContractExpiryDays) ?? 180);
  const dissatisfactionThreshold = Math.max(
    0,
    Math.min(100, integer(options.staffDissatisfactionThreshold) ?? 35),
  );
  const members = list(state.staffMembers).filter((member) => sameClub(member?.clubId, club));
  const membersById = new Map(members.map((member) => [key(member?.id), member]));
  const contractAlerts = !asOf ? [] : list(state.staffContracts).flatMap((contract) => {
    if (statusText(contract?.status) !== "active" || !sameClub(contract?.clubId, club)) return [];
    const endDate = dateValue(contract?.endDate ?? contract?.endsAt ?? contract?.endAt);
    if (!endDate) return [];
    const remainingDays = Math.ceil((endDate.getTime() - asOf.getTime()) / 86_400_000);
    if (remainingDays < 0 || remainingDays > contractExpiryDays) return [];
    const member = membersById.get(key(contract?.staffId));
    return [{
      id: `staff-contract-expiring:${text(contract.id) || text(contract.staffId)}`,
      type: "STAFF_CONTRACT_EXPIRING",
      status: "active",
      source: "derived",
      clubId: club.id,
      staffId: text(contract.staffId),
      staffName: text(member?.name) || null,
      role: text(member?.role) || null,
      contractId: text(contract.id) || null,
      endDate: endDate.toISOString(),
      remainingDays,
    }];
  });
  const satisfactionAlerts = members.flatMap((member) => {
    const satisfaction = number(member?.satisfaction);
    if (satisfaction === null || satisfaction > dissatisfactionThreshold) return [];
    return [{
      id: `staff-dissatisfied:${text(member.id)}`,
      type: "STAFF_DISSATISFIED",
      status: "active",
      source: "derived",
      clubId: club.id,
      staffId: text(member.id),
      staffName: text(member.name) || null,
      role: text(member.role) || null,
      satisfaction,
    }];
  });
  return uniqueBy([...explicit, ...contractAlerts, ...satisfactionAlerts], (alert) => key(alert?.id))
    .sort((left, right) => (
      String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
      || (left.remainingDays ?? Number.MAX_SAFE_INTEGER) - (right.remainingDays ?? Number.MAX_SAFE_INTEGER)
      || text(left.id).localeCompare(text(right.id))
    ));
}

function coachRecords(state) {
  return [
    ...(state?.coach && typeof state.coach === "object" ? [state.coach] : []),
    ...list(state?.coaches),
  ];
}

function coachIdOf(value) {
  const related = text(value?.coachId ?? value?.coach?.id);
  if (related) return related;
  const isCoachRecord = value?.managerType !== undefined
    || value?.currentClubId !== undefined
    || Array.isArray(value?.assignments)
    || value?.marketReputation !== undefined;
  return isCoachRecord ? text(value?.id) : "";
}

function managerIdsOf(value) {
  return [
    value?.managerId,
    value?.targetManagerId,
    value?.recipientManagerId,
    value?.recipientId,
    value?.ownerManagerId,
    value?.recipientCoachId,
    value?.coach?.managerId,
  ].map(key).filter(Boolean);
}

function viewerCoachContext(room, state, club, managerId) {
  const managerKey = key(managerId);
  const manager = list(room?.managers).find((candidate) => key(candidate?.id) === managerKey) ?? null;
  const coachIds = new Set([
    managerId,
    manager?.coachId,
  ].map(key).filter(Boolean));
  const coaches = coachRecords(state);
  for (const coach of coaches) {
    if (managerIdsOf(coach).includes(managerKey) || key(coach?.id) === managerKey) {
      const coachId = key(coachIdOf(coach));
      if (coachId) coachIds.add(coachId);
    }
  }
  if (manager && sameClub(manager.clubId, club)) {
    for (const coach of coaches) {
      const human = ["human", "player", "user"].includes(statusText(coach?.managerType ?? coach?.type));
      if (!human || !sameClub(coach?.currentClubId ?? coach?.clubId, club)) continue;
      const coachId = key(coachIdOf(coach));
      if (coachId) coachIds.add(coachId);
    }
  }
  return { managerKey, manager, coachIds };
}

function privateCoachItemBelongsToViewer(item, context) {
  if (!context.managerKey) return false;
  const managerIds = managerIdsOf(item);
  if (managerIds.length > 0) return managerIds.includes(context.managerKey);
  const coachId = key(coachIdOf(item));
  return Boolean(coachId) && context.coachIds.has(coachId);
}

function coachNotificationBelongsToViewer(notification, context, room) {
  if (!context.managerKey) return false;
  const recipientRole = statusText(notification?.recipientRole);
  const recipientId = key(notification?.recipientId);
  if (recipientRole === "board") {
    const recipientClubId = recipientId || key(coachItemClubId(notification));
    return context.managerKey === key(room?.ownerId)
      || Boolean(context.manager && recipientClubId && sameClub(context.manager.clubId, recipientClubId));
  }
  if (recipientRole === "coach") {
    return recipientId === context.managerKey
      || context.coachIds.has(recipientId)
      || context.coachIds.has(key(coachIdOf(notification)));
  }
  return privateCoachItemBelongsToViewer(notification, context);
}

function coachItemClubId(item) {
  return text(item?.clubId ?? item?.club?.id ?? item?.toClubId ?? item?.targetClubId);
}

function coachItemClubName(room, item) {
  return text(item?.clubName ?? item?.club?.name ?? item?.toClubName)
    || clubName(room, coachItemClubId(item))
    || "Clube interessado";
}

function jobSecurityEntries(state) {
  const result = [];
  for (const source of [state?.jobSecurity, state?.jobSecurityByCoachId, state?.securityEvaluations, state?.evaluations]) {
    if (Array.isArray(source)) {
      result.push(...source);
    } else if (source && typeof source === "object") {
      if (source.score !== undefined || source.level !== undefined) {
        result.push(source);
      } else {
        for (const [coachId, value] of Object.entries(source)) {
          if (value && typeof value === "object") result.push({ coachId, ...value });
        }
      }
    }
  }
  for (const coach of coachRecords(state)) {
    if (coach?.jobSecurity && typeof coach.jobSecurity === "object") {
      result.push({ coachId: coachIdOf(coach), clubId: coach.currentClubId ?? coach.clubId, ...coach.jobSecurity });
    }
  }
  return result;
}

function currentCoachRecord(state, context, club) {
  return coachRecords(state).find((coach) => (
    context.coachIds.has(key(coachIdOf(coach)))
    && sameClub(coach?.currentClubId ?? coach?.clubId, club)
  )) ?? null;
}

function coachAlertBase({ id, type, clubId, coachId = null, title, message, tone, createdAt = null, ...extra }) {
  return {
    id,
    type,
    status: "active",
    source: "derived",
    route: "coach-career",
    clubId: clubId || null,
    coachId: coachId || null,
    title,
    message,
    tone,
    createdAt: dateValue(createdAt)?.toISOString() ?? null,
    ...extra,
  };
}

/**
 * Pendências factuais da carreira do treinador. Propostas, candidaturas e
 * entrevistas só são retornadas ao manager destinatário; termos financeiros
 * nunca entram no DTO da Central.
 */
export function selectCoachCareerAlerts(room, clubId, managerId = null, options = {}) {
  const state = coachStateFor(room);
  const club = resolveClub(room, clubId);
  const context = viewerCoachContext(room, state, club, managerId);
  const coach = currentCoachRecord(state, context, club);
  const currentCoachId = coachIdOf(coach) || [...context.coachIds][0] || null;
  const asOf = dateValue(options.asOf ?? state.currentDate ?? stateFor(room).currentDate ?? room?.updatedAt);
  const contractExpiryDays = Math.max(0, integer(options.coachContractExpiryDays) ?? 180);
  const alerts = [];

  const riskyLevels = new Set([
    "pressured", "very_pressured", "at_risk", "imminent",
    "pressionado", "muito pressionado", "em risco", "demissao iminente",
  ]);
  const security = jobSecurityEntries(state).find((entry) => {
    const entryCoachId = key(coachIdOf(entry));
    const coachMatches = entryCoachId ? context.coachIds.has(entryCoachId) : true;
    const entryClubId = text(entry?.clubId ?? entry?.club?.id);
    return coachMatches && (!entryClubId || sameClub(entryClubId, club));
  });
  const securityScore = number(security?.score);
  const securityLevel = statusText(security?.level);
  if (security && (riskyLevels.has(securityLevel) || (securityScore !== null && securityScore <= 40))) {
    const imminent = ["imminent", "demissao iminente"].includes(securityLevel) || (securityScore !== null && securityScore <= 15);
    const label = text(security.label ?? security.level) || "baixa";
    alerts.push(coachAlertBase({
      id: `coach-job-security:${currentCoachId ?? club.id}`,
      type: "COACH_JOB_SECURITY_LOW",
      clubId: club.id,
      coachId: currentCoachId,
      title: imminent ? "Cargo em risco imediato" : "Diretoria acompanha seu trabalho",
      message: `Sua segurança no cargo está ${label}${securityScore !== null ? ` (${securityScore}/100)` : ""}.`,
      tone: imminent ? "danger" : "warning",
      createdAt: security.updatedAt,
      score: securityScore,
      level: text(security.level) || null,
    }));
  }

  const activeEmployment = state?.activeEmployment && typeof state.activeEmployment === "object"
    ? state.activeEmployment
    : null;
  const contracts = uniqueBy([
    ...list(state.contracts),
    ...(activeEmployment?.contract && typeof activeEmployment.contract === "object"
      ? [activeEmployment.contract]
      : []),
  ], (contract) => key(contract?.id) || `${key(coachIdOf(contract))}:${key(coachItemClubId(contract))}`);
  for (const contract of contracts) {
    if (!["", "active", "renewing"].includes(statusText(contract?.status))) continue;
    const contractCoachId = key(coachIdOf(contract));
    const owned = contractCoachId
      ? context.coachIds.has(contractCoachId)
      : managerIdsOf(contract).includes(context.managerKey) || sameClub(coachItemClubId(contract), club);
    if (!owned || !sameClub(coachItemClubId(contract), club)) continue;
    const endDate = dateValue(contract?.endDate ?? contract?.endsAt ?? contract?.endAt);
    const remainingDays = asOf && endDate
      ? Math.ceil((endDate.getTime() - asOf.getTime()) / 86_400_000)
      : null;
    const endSeason = integer(contract?.endSeason);
    const currentSeason = integer(room?.currentSeason);
    const expiringByDate = remainingDays !== null && remainingDays >= 0 && remainingDays <= contractExpiryDays;
    const expiringBySeason = !endDate && endSeason !== null && currentSeason !== null && endSeason <= currentSeason;
    if (!expiringByDate && !expiringBySeason) continue;
    alerts.push(coachAlertBase({
      id: `coach-contract-expiring:${text(contract.id) || currentCoachId || club.id}`,
      type: "COACH_CONTRACT_EXPIRING",
      clubId: club.id,
      coachId: text(contract.coachId) || currentCoachId,
      title: "Contrato próximo do fim",
      message: remainingDays !== null
        ? `Seu contrato termina em ${remainingDays} ${remainingDays === 1 ? "dia" : "dias"}.`
        : `Seu contrato termina ao fim da temporada ${endSeason}.`,
      tone: remainingDays !== null && remainingDays <= 30 ? "danger" : "warning",
      createdAt: contract.updatedAt ?? contract.createdAt,
      contractId: text(contract.id) || null,
      endDate: endDate?.toISOString() ?? null,
      endSeason,
      remainingDays,
    }));
  }

  const proposalStatuses = new Set([
    "pending", "countered", "awaiting_response", "negotiating",
    "aguardando_resposta_diretoria", "aprovada_diretoria", "informacoes_solicitadas",
    "encerrado_vaga_preenchida",
  ]);
  for (const proposal of list(state.proposals)) {
    const proposalStatus = statusText(proposal?.status);
    if (!proposalStatuses.has(proposalStatus) || !privateCoachItemBelongsToViewer(proposal, context)) continue;
    const deadline = dateValue(proposal?.deadline ?? proposal?.expiresAt);
    if (proposalStatus === "pending" && asOf && deadline && deadline.getTime() < asOf.getTime()) continue;
    const interestedClub = coachItemClubName(room, proposal);
    const title = {
      countered: "Contraproposta em análise",
      aguardando_resposta_diretoria: "Contraproposta em análise",
      aprovada_diretoria: "Contraproposta aprovada",
      informacoes_solicitadas: "Diretoria pediu esclarecimentos",
      encerrado_vaga_preenchida: "Negociação encerrada",
    }[proposalStatus] ?? `Proposta do ${interestedClub}`;
    const message = {
      countered: "Sua contraproposta aguarda uma decisão formal da diretoria.",
      aguardando_resposta_diretoria: "Sua contraproposta aguarda uma decisão formal da diretoria.",
      aprovada_diretoria: "A diretoria aprovou os termos negociados.",
      informacoes_solicitadas: "A diretoria solicitou informações adicionais antes de decidir.",
      encerrado_vaga_preenchida: "A vaga foi preenchida e esta negociação foi encerrada.",
    }[proposalStatus] ?? `${interestedClub} aguarda sua resposta.`;
    const type = proposalStatus === "aguardando_resposta_diretoria" || proposalStatus === "countered"
      ? "COACH_COUNTERPROPOSAL_PENDING_BOARD"
      : proposalStatus === "aprovada_diretoria"
        ? "COACH_COUNTERPROPOSAL_APPROVED"
        : proposalStatus === "informacoes_solicitadas"
          ? "COACH_INFORMATION_REQUESTED"
          : proposalStatus === "encerrado_vaga_preenchida"
            ? "COACH_PROCESS_CLOSED"
            : "COACH_PROPOSAL_RECEIVED";
    alerts.push(coachAlertBase({
      id: `coach-proposal:${text(proposal.id)}`,
      type,
      clubId: coachItemClubId(proposal),
      coachId: coachIdOf(proposal) || currentCoachId,
      title,
      message,
      tone: proposalStatus === "aprovada_diretoria"
        ? "positive"
        : proposalStatus === "encerrado_vaga_preenchida" ? "neutral" : "info",
      createdAt: proposal.updatedAt ?? proposal.createdAt,
      proposalId: text(proposal.id),
      deadline: deadline?.toISOString() ?? null,
      private: true,
    }));

    const guaranteeIds = new Set(list(proposal?.guaranteeIds).map(key).filter(Boolean));
    const proposalGuarantees = list(state.guarantees).filter((guarantee) => (
      key(guarantee?.proposalId) === key(proposal?.id) || guaranteeIds.has(key(guarantee?.id))
    ));
    for (const [index, guarantee] of proposalGuarantees.entries()) {
      if (!guarantee || typeof guarantee !== "object") continue;
      const guaranteeStatus = statusText(guarantee.status);
      if (["fulfilled", "waived", "rejected", "cancelled"].includes(guaranteeStatus)) continue;
      const dueAt = dateValue(guarantee.dueAt ?? guarantee.deadline);
      if (!asOf || !dueAt) continue;
      const remainingDays = Math.ceil((dueAt.getTime() - asOf.getTime()) / 86_400_000);
      if (remainingDays > 7) continue;
      alerts.push(coachAlertBase({
        id: `coach-guarantee:${text(guarantee.id) || `${text(proposal.id)}:${index + 1}`}`,
        type: remainingDays < 0 ? "COACH_GUARANTEE_OVERDUE" : "COACH_GUARANTEE_DUE",
        clubId: coachItemClubId(proposal),
        coachId: coachIdOf(proposal) || currentCoachId,
        title: remainingDays < 0 ? "Garantia com prazo vencido" : "Prazo de garantia próximo",
        message: text(guarantee.description) || "Uma garantia negociada exige acompanhamento.",
        tone: remainingDays < 0 ? "danger" : "warning",
        createdAt: proposal.updatedAt ?? proposal.createdAt,
        proposalId: text(proposal.id),
        guaranteeId: text(guarantee.id) || null,
        deadline: dueAt.toISOString(),
        remainingDays,
        private: true,
      }));
    }
  }

  const interviewStatuses = new Set(["scheduled", "awaiting_answers", "pending", "confirmed"]);
  for (const interview of list(state.interviews)) {
    if (!interviewStatuses.has(statusText(interview?.status)) || !privateCoachItemBelongsToViewer(interview, context)) continue;
    const interviewClub = coachItemClubName(room, interview);
    alerts.push(coachAlertBase({
      id: `coach-interview:${text(interview.id)}`,
      type: "COACH_INTERVIEW_ACTIVE",
      clubId: coachItemClubId(interview),
      coachId: coachIdOf(interview) || currentCoachId,
      title: `Entrevista com ${interviewClub}`,
      message: statusText(interview.status) === "awaiting_answers"
        ? "A diretoria aguarda suas respostas."
        : `Entrevista ${text(interview.scheduledAt) ? "agendada" : "em andamento"}.`,
      tone: "info",
      createdAt: interview.updatedAt ?? interview.createdAt ?? interview.scheduledAt,
      interviewId: text(interview.id),
      deadline: dateValue(interview.deadline)?.toISOString() ?? null,
      private: true,
    }));
  }

  const applicationStatuses = new Set([
    "submitted", "shortlisted", "interview", "offered", "under_review",
    "contratado", "encerrado_vaga_preenchida",
  ]);
  for (const application of list(state.applications)) {
    if (!applicationStatuses.has(statusText(application?.status)) || !privateCoachItemBelongsToViewer(application, context)) continue;
    const applicationClub = coachItemClubName(room, application);
    alerts.push(coachAlertBase({
      id: `coach-application:${text(application.id)}`,
      type: "COACH_APPLICATION_ACTIVE",
      clubId: coachItemClubId(application),
      coachId: coachIdOf(application) || currentCoachId,
      title: statusText(application.status) === "encerrado_vaga_preenchida"
        ? "Processo seletivo encerrado"
        : statusText(application.status) === "contratado" ? "Contratação confirmada" : `Candidatura ao ${applicationClub}`,
      message: statusText(application.status) === "encerrado_vaga_preenchida"
        ? `${applicationClub} preencheu a vaga com outro candidato.`
        : statusText(application.status) === "contratado"
          ? `Seu processo com ${applicationClub} foi concluído como contratado.`
          : `Candidatura ${text(application.status).toLocaleLowerCase("pt-BR")} em análise.`,
      tone: ["offered", "contratado"].includes(statusText(application.status)) ? "positive" : "neutral",
      createdAt: application.updatedAt ?? application.submittedAt ?? application.createdAt,
      applicationId: text(application.id),
      vacancyId: text(application.vacancyId) || null,
      private: true,
    }));
  }

  for (const notification of list(state.notifications ?? state.coachNotifications)) {
    if (!coachNotificationBelongsToViewer(notification, context, room)) continue;
    if (notification.readAt || ["read", "dismissed", "archived"].includes(statusText(notification.status))) continue;
    const notificationId = text(notification.id);
    if (!notificationId) continue;
    alerts.push(coachAlertBase({
      id: notificationId,
      type: text(notification.type) || "COACH_CAREER_UPDATE",
      clubId: coachItemClubId(notification),
      coachId: coachIdOf(notification) || currentCoachId,
      title: text(notification.title) || "Atualização da negociação",
      message: text(notification.message ?? notification.body) || "Há uma nova atualização na sua carreira.",
      tone: ["neutral", "positive", "warning", "danger", "info"].includes(notification.tone)
        ? notification.tone
        : "info",
      createdAt: notification.createdAt ?? notification.occurredAt,
      proposalId: text(notification.proposalId) || null,
      vacancyId: text(notification.vacancyId) || null,
      guaranteeId: text(notification.guaranteeId) || null,
      private: true,
      durable: true,
    }));
  }

  const tonePriority = { danger: 0, warning: 1, info: 2, positive: 3, neutral: 4 };
  return uniqueBy(alerts, (alert) => key(alert.id)).sort((left, right) => (
    (tonePriority[left.tone] ?? 9) - (tonePriority[right.tone] ?? 9)
    || String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? ""))
    || text(left.id).localeCompare(text(right.id))
  ));
}

function competitionForClub(room, club) {
  return list(room?.competitionCatalog).find((league) => (
    list(league?.clubs).some((candidate) => (
      sameClub(candidate?.id, club) || sameClub(candidate?.code, club) || sameClub(candidate?.name, club)
    ))
  )) ?? null;
}

function compareTable(left, right) {
  return right.points - left.points
    || right.wins - left.wins
    || right.goalDifference - left.goalDifference
    || right.goalsFor - left.goalsFor
    || left.name.localeCompare(right.name, "pt-BR");
}

export function selectCompetitionStatus(room, clubId) {
  const club = resolveClub(room, clubId);
  const league = competitionForClub(room, club);
  if (!league) return null;
  const clubs = list(league.clubs);
  const aliasesByClub = new Map(clubs.map((candidate) => [key(candidate.id), new Set([
    candidate.id, candidate.code, candidate.name,
  ].map(key).filter(Boolean))]));
  const rowById = new Map(clubs.map((candidate) => [key(candidate.id), {
    clubId: text(candidate.id),
    clubCode: text(candidate.code),
    name: text(candidate.name),
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }]));
  const resolveRow = (value) => {
    const target = key(value);
    for (const [id, aliases] of aliasesByClub) if (aliases.has(target)) return rowById.get(id);
    return null;
  };
  const fixtureSource = list(room?.leagueFixtureSchedule).length > 0
    ? list(room.leagueFixtureSchedule)
    : list(room?.fixtureSchedule);
  const leagueFixtures = fixtureSource.filter((fixture) => (
    key(fixture?.leagueId) === key(league.id)
    || (resolveRow(fixture?.homeClubId) && resolveRow(fixture?.awayClubId))
  ));
  const results = [...list(room?.leagueMatchResults), ...list(room?.completedMatches)];
  const applied = new Set();
  for (const fixture of leagueFixtures) {
    const aliases = fixtureAliases(fixture);
    const result = results.find((candidate) => (
      [candidate?.fixtureId, candidate?.leagueFixtureId, candidate?.id].some((id) => aliases.has(key(id)))
    ));
    const resultKey = key(result?.leagueFixtureId ?? result?.fixtureId ?? result?.id);
    const score = result?.score;
    if (!resultKey || applied.has(resultKey) || !Array.isArray(score) || score.length < 2) continue;
    const homeGoals = integer(score[0]);
    const awayGoals = integer(score[1]);
    const home = resolveRow(fixture.homeClubId);
    const away = resolveRow(fixture.awayClubId);
    if (!home || !away || homeGoals === null || awayGoals === null || homeGoals < 0 || awayGoals < 0) continue;
    applied.add(resultKey);
    home.played += 1;
    away.played += 1;
    home.goalsFor += homeGoals;
    home.goalsAgainst += awayGoals;
    away.goalsFor += awayGoals;
    away.goalsAgainst += homeGoals;
    if (homeGoals === awayGoals) {
      home.draws += 1; away.draws += 1; home.points += 1; away.points += 1;
    } else if (homeGoals > awayGoals) {
      home.wins += 1; away.losses += 1; home.points += 3;
    } else {
      away.wins += 1; home.losses += 1; away.points += 3;
    }
  }
  const table = [...rowById.values()].map((row) => ({
    ...row,
    goalDifference: row.goalsFor - row.goalsAgainst,
  })).sort(compareTable).map((row, index) => ({ ...row, position: index + 1 }));
  const row = table.find((candidate) => sameClub(candidate.clubId, club) || sameClub(candidate.clubCode, club));
  return row ? {
    competitionId: text(league.id),
    competitionName: text(league.name),
    seasonNumber: integer(room?.currentSeason),
    ...row,
    participantCount: table.length,
  } : null;
}

export function selectCareerNews(room, clubId, managerId = null, limit = 3) {
  const club = resolveClub(room, clubId);
  const managerKey = text(managerId);
  return list(stateFor(room).news)
    .filter((item) => list(item?.clubIds).some((id) => sameClub(id, club)))
    .slice()
    .sort((left, right) => (
      String(right.publishedAt ?? right.date ?? "").localeCompare(String(left.publishedAt ?? left.date ?? ""))
      || text(right.id).localeCompare(text(left.id))
    ))
    .slice(0, Math.max(0, integer(limit) ?? 3))
    .map((item) => ({
      ...clone(item),
      read: managerKey ? list(item.readByManagerIds).includes(managerKey) : false,
    }));
}

export function selectAdministrativePending(room, clubId, context = {}) {
  const club = resolveClub(room, clubId);
  const explicit = stateClubItems(
    stateFor(room),
    ["administrativePendencies", "pendingAdministrativeActions", "pendingActions", "financialAlerts"],
    club,
  ).filter((item) => !["resolved", "dismissed", "completed"].includes(statusText(item?.status)));
  const derived = [];
  if (context.finance?.status === "negative") {
    derived.push({
      id: `finance-negative:${club.id}`,
      type: "FINANCE_NEGATIVE",
      clubId: club.id,
      balance: context.finance.balance,
      available: context.finance.available,
    });
  }
  if (list(context.expiringContracts).length > 0) {
    derived.push({
      id: `contracts-expiring:${club.id}:${room?.currentSeason ?? "current"}`,
      type: "CONTRACTS_EXPIRING",
      clubId: club.id,
      count: context.expiringContracts.length,
      playerIds: context.expiringContracts.map((contract) => contract.playerId),
    });
  }
  return uniqueBy([...explicit, ...derived], (item) => key(item?.id));
}

function section(items, emptyMessage) {
  return {
    items,
    empty: items.length === 0,
    message: items.length === 0 ? emptyMessage : null,
  };
}

/**
 * Painel factual. Nao cria alertas, partidas, valores ou textos de noticia.
 * Aceita buildCentralSnapshot(room, options) ou buildCentralSnapshot({ room, ...options }).
 */
export function buildCentralSnapshot(input, options = {}) {
  const room = input?.room ?? input;
  const config = input?.room ? { ...input, ...options } : options;
  const clubId = text(config.clubId);
  const managerId = text(config.managerId) || null;
  const squad = selectSquadStatus(room, clubId, config);
  const finance = selectClubFinance(room, clubId);
  const expiringContracts = selectExpiringContracts(room, clubId, { ...config, squad });
  const negotiations = selectMarketNegotiations(room, clubId);
  const activeProjects = selectActiveProjects(room, clubId, config);
  const objectives = selectBoardObjectives(room, clubId);
  const messages = selectCentralMessages(room, clubId);
  const staffAlerts = selectStaffAlerts(room, clubId, config);
  const coachCareerAlerts = selectCoachCareerAlerts(room, clubId, managerId, config);
  const recentResults = selectRecentResults(room, clubId, config.recentResultsLimit ?? 5);
  const latestNews = selectCareerNews(room, clubId, managerId, config.newsLimit ?? 3);
  const administrativePending = selectAdministrativePending(room, clubId, {
    finance,
    expiringContracts,
  });
  const nextFixture = selectNextFixture(room, clubId);
  const competitionStatus = selectCompetitionStatus(room, clubId);
  return {
    clubId,
    asOf: dateValue(config.asOf ?? stateFor(room).currentDate ?? room?.updatedAt)?.toISOString() ?? null,
    finance,
    nextFixture,
    recentResults: section(recentResults, EMPTY_MESSAGES.recentResults),
    squad: {
      ...squad,
      empty: squad.total === 0,
      message: squad.total === 0 ? EMPTY_MESSAGES.squad : null,
    },
    injuries: section(squad.injured, EMPTY_MESSAGES.injuries),
    suspensions: section(squad.suspended, EMPTY_MESSAGES.suspensions),
    expiringContracts: section(expiringContracts, EMPTY_MESSAGES.contracts),
    negotiations: section(negotiations, EMPTY_MESSAGES.negotiations),
    activeProjects: section(activeProjects, EMPTY_MESSAGES.works),
    objectives: section(objectives, EMPTY_MESSAGES.objectives),
    messages: section(messages, EMPTY_MESSAGES.messages),
    administrativePending: section(administrativePending, EMPTY_MESSAGES.administrative),
    competitionStatus: competitionStatus ?? {
      empty: true,
      message: EMPTY_MESSAGES.competition,
    },
    staffAlerts: section(staffAlerts, EMPTY_MESSAGES.staffAlerts),
    coachCareerAlerts: section(coachCareerAlerts, EMPTY_MESSAGES.coachCareerAlerts),
    latestNews: section(latestNews, EMPTY_MESSAGES.news),
    emptyMessages: {
      nextFixture: nextFixture ? null : EMPTY_MESSAGES.nextFixture,
      finance: finance.message,
    },
  };
}

export { EMPTY_MESSAGES as CENTRAL_EMPTY_MESSAGES };
