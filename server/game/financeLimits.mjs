const MAX_MONEY = 2_000_000_000;

function identifier(value) {
  return String(value ?? "").trim();
}

function clubKey(value) {
  return identifier(value).toLocaleUpperCase("pt-BR");
}

function money(value, fallback = 0) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? Math.max(0, Math.min(MAX_MONEY, Math.trunc(amount)))
    : fallback;
}

export function defaultTransferBudget(balance) {
  return money(balance);
}

export function defaultWageBudget(balance, currentPayroll = 0) {
  const safeBalance = money(balance);
  const payrollFloor = money(Math.ceil(money(currentPayroll) * 1.15));
  const cashBasedLimit = safeBalance > 0
    ? Math.max(250_000, Math.round(safeBalance / 12))
    : 0;
  return Math.min(MAX_MONEY, Math.max(payrollFloor, cashBasedLimit));
}

export function ensurePersistentFinanceLimits(room, clubId, {
  balance = 0,
  currentPayroll = 0,
} = {}) {
  const normalizedClubId = identifier(clubId);
  if (!normalizedClubId) return null;
  if (!room.clubCareerState || typeof room.clubCareerState !== "object" || Array.isArray(room.clubCareerState)) {
    room.clubCareerState = {};
  }
  const career = room.clubCareerState;
  if (!Array.isArray(career.financeProfiles)) career.financeProfiles = [];
  let profile = career.financeProfiles.find((candidate) => (
    clubKey(candidate?.clubId) === clubKey(normalizedClubId)
  ));
  if (!profile) {
    profile = { clubId: normalizedClubId };
    career.financeProfiles.push(profile);
  }
  profile.clubId = identifier(profile.clubId) || normalizedClubId;
  const initialized = Number(profile.financeLimitsVersion) >= 1;
  if (!initialized && money(profile.transferBudget) <= 0) {
    profile.transferBudget = defaultTransferBudget(balance);
  } else {
    profile.transferBudget = money(profile.transferBudget);
  }
  if (!initialized && money(profile.wageBudget) <= 0) {
    profile.wageBudget = defaultWageBudget(balance, currentPayroll);
  } else {
    profile.wageBudget = money(profile.wageBudget);
  }
  profile.financeLimitsVersion = 1;
  return profile;
}

export function adjustPersistentTransferBudget(room, clubId, delta, defaults = {}) {
  const profile = ensurePersistentFinanceLimits(room, clubId, defaults);
  if (!profile) return null;
  profile.transferBudget = money(money(profile.transferBudget) + Number(delta || 0));
  return profile;
}
