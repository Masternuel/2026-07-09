const MAX_MONEY = 2_000_000_000;

function identifier(value) {
  return String(value ?? "").trim();
}

function key(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.max(0, Math.min(MAX_MONEY, Math.trunc(amount)))
    : 0;
}

function activePlayer(player) {
  const status = identifier(player?.contract?.status).toLocaleLowerCase("pt-BR");
  return player?.retired !== true
    && player?.active !== false
    && !["free_agent", "expired", "released", "retired"].includes(status);
}

function addPlayers(target, players) {
  for (const player of Array.isArray(players) ? players : []) {
    const playerId = key(player?.id);
    if (playerId) target.set(playerId, player);
  }
}

function playerCatalog(room) {
  const players = new Map();
  for (const competition of room?.competitionCatalog ?? []) {
    for (const club of competition?.clubs ?? []) addPlayers(players, club?.players);
  }
  for (const registration of room?.marketState?.registrations ?? []) {
    addPlayers(players, registration?.playerSnapshot ? [registration.playerSnapshot] : []);
  }
  addPlayers(players, room?.careerState?.players);
  return players;
}

function playerWage(player) {
  return money(player?.contract?.wage ?? player?.wage);
}

export function calculateClubMonthlyPayroll(room, clubId, suppliedPlayers = undefined) {
  const targetClub = key(clubId);
  const players = playerCatalog(room);
  addPlayers(players, suppliedPlayers);
  const registrations = Array.isArray(room?.marketState?.registrations)
    ? room.marketState.registrations
    : [];
  const activeLoans = new Map(registrations.flatMap((registration) => (
    registration?.loan && registration?.playerId
      ? [[key(registration.playerId), registration]]
      : []
  )));
  const entries = [];

  for (const [playerId, player] of players) {
    if (!activePlayer(player) || activeLoans.has(playerId)) continue;
    const registration = registrations.find((candidate) => key(candidate?.playerId) === playerId);
    const currentClubId = registration?.currentClubId
      ?? player?.currentClubId
      ?? player?.clubId
      ?? player?.contract?.clubId;
    if (key(currentClubId) !== targetClub) continue;
    const cost = playerWage(player);
    if (cost > 0) entries.push({ playerId: identifier(player?.id), cost, grossWage: cost, sharePercent: 100 });
  }

  for (const registration of activeLoans.values()) {
    const loan = registration.loan;
    const player = players.get(key(registration.playerId)) ?? registration.playerSnapshot ?? {};
    if (!activePlayer(player)) continue;
    const grossWage = playerWage(player);
    if (grossWage <= 0) continue;
    const rawBorrowerShare = Number(loan?.terms?.wageSharePercent);
    const borrowerShare = Number.isFinite(rawBorrowerShare)
      ? Math.max(0, Math.min(100, Math.trunc(rawBorrowerShare)))
      : 50;
    const borrowerCost = Math.round(grossWage * (borrowerShare / 100));
    let sharePercent = null;
    let cost = 0;
    if (key(loan?.borrowerClubId) === targetClub) {
      sharePercent = borrowerShare;
      cost = borrowerCost;
    } else if (key(loan?.lenderClubId) === targetClub) {
      sharePercent = 100 - borrowerShare;
      cost = grossWage - borrowerCost;
    }
    if (sharePercent === null) continue;
    if (cost > 0) entries.push({
      playerId: identifier(registration.playerId),
      cost,
      grossWage,
      sharePercent,
      loanId: identifier(loan?.id) || null,
    });
  }

  const coachEntries = (Array.isArray(room?.coachEmploymentState?.contracts)
    ? room.coachEmploymentState.contracts
    : []).flatMap((contract) => {
    const status = identifier(contract?.status).toLocaleLowerCase("pt-BR");
    if (status !== "active" || key(contract?.clubId) !== targetClub) return [];
    const cost = money(contract?.salary ?? contract?.wage ?? contract?.terms?.salary);
    if (!cost) return [];
    return [{
      coachId: identifier(contract?.coachId),
      contractId: identifier(contract?.id),
      cost,
      grossWage: cost,
      sharePercent: 100,
      role: identifier(contract?.role) || "head_coach",
    }];
  });
  entries.push(...coachEntries);

  const amount = Math.min(MAX_MONEY, entries.reduce((total, entry) => total + entry.cost, 0));
  return {
    amount,
    paidPlayers: entries.filter((entry) => entry.playerId).length,
    paidCoaches: coachEntries.length,
    entries,
  };
}
