function validPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function validNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function yearFrom(value, fallback) {
  const date = new Date(value ?? "");
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : fallback.getUTCFullYear();
}

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value, fallback = null, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : fallback;
}

function uniqueTextList(...values) {
  const result = new Map();
  const visit = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const [item, enabled] of Object.entries(value)) {
        if (enabled !== false && enabled != null) visit(item);
      }
      return;
    }
    const normalized = text(value);
    if (!normalized) return;
    const normalizedKey = normalized.toLocaleUpperCase("pt-BR");
    if (!result.has(normalizedKey)) result.set(normalizedKey, normalized);
  };
  for (const value of values) visit(value);
  return [...result.values()];
}

function canonicalLicenseTier(value, license) {
  const numeric = Number(value);
  if (value != null && value !== "" && Number.isFinite(numeric)) {
    if (numeric >= 4) return "PRO";
    if (numeric >= 3) return "A";
    if (numeric >= 2) return "B";
    if (numeric >= 1) return "C";
    return null;
  }
  const source = key(value) || key(license);
  if (!source) return null;
  if (/(^|[^A-Z])PRO([^A-Z]|$)/u.test(source)) return "PRO";
  if (/(^|[^A-Z])A([^A-Z]|$)/u.test(source)) return "A";
  if (/(^|[^A-Z])B([^A-Z]|$)/u.test(source)) return "B";
  if (/(^|[^A-Z])C([^A-Z]|$)/u.test(source)) return "C";
  return null;
}

function normalizedRating(value) {
  const numeric = Number(value);
  if (value != null && value !== "" && Number.isFinite(numeric)) {
    const normalized = numeric > 0 && numeric <= 20 ? numeric * 5 : numeric;
    return finiteNumber(normalized, null, 0, 100);
  }
  const aliases = new Map([
    ["VERY_LOW", 10],
    ["LOW", 25],
    ["LIGHT", 25],
    ["BALANCED", 50],
    ["NORMAL", 50],
    ["MEDIUM", 50],
    ["HIGH", 75],
    ["INTENSE", 90],
    ["VERY_HIGH", 90],
  ]);
  return aliases.get(key(value).replaceAll(/[\s-]+/gu, "_")) ?? null;
}

function normalizedAchievements(value) {
  if (Number.isFinite(Number(value)) && value !== "" && value != null) {
    return { titles: Math.max(0, Number(value)) };
  }
  if (Array.isArray(value)) {
    return value.flatMap((achievement) => {
      if (achievement && typeof achievement === "object") return [structuredClone(achievement)];
      const normalized = text(achievement);
      return normalized ? [normalized] : [];
    });
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(structuredClone(value)).flatMap(([field, entry]) => {
      const normalizedField = text(field);
      if (!normalizedField || entry == null) return [];
      if (Number.isFinite(Number(entry))) return [[normalizedField, Math.max(0, Number(entry))]];
      return [[normalizedField, entry]];
    }));
  }
  const normalized = text(value);
  return normalized ? [normalized] : {};
}

function normalizedCountryKnowledge(value, workedCountries = []) {
  const result = {};
  for (const country of uniqueTextList(workedCountries)) result[country] = 100;
  if (Array.isArray(value) || typeof value === "string") {
    for (const country of uniqueTextList(value)) result[country] = 100;
    return result;
  }
  if (!value || typeof value !== "object") return result;
  for (const [countryValue, knowledgeValue] of Object.entries(value)) {
    const country = text(countryValue);
    if (!country) continue;
    const score = knowledgeValue === true
      ? 100
      : knowledgeValue === false
        ? 0
        : finiteNumber(knowledgeValue, null, 0, 100);
    if (score != null) result[country] = score;
  }
  return result;
}

function key(value) {
  return text(value).toLocaleUpperCase("pt-BR");
}

function aiCoachId(value) {
  const sourceId = text(value);
  return sourceId.toLocaleLowerCase("pt-BR").startsWith("ai-coach:")
    ? sourceId
    : `ai-coach:${sourceId}`;
}

function coachRecord(club) {
  const value = club?.headCoach ?? club?.coach ?? club?.manager ?? club?.managerProfile;
  if (typeof value === "string") return { name: text(value) };
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function competitionClubs(room) {
  const clubs = new Map();
  for (const competition of Array.isArray(room?.competitionCatalog) ? room.competitionCatalog : []) {
    for (const club of Array.isArray(competition?.clubs) ? competition.clubs : []) {
      const clubId = text(club?.id ?? club?.code);
      if (clubId) clubs.set(key(clubId), club);
    }
  }
  return clubs;
}

function assignmentFor(clubId, seasonNumber, startedAt, startedRound = 1) {
  return {
    clubId,
    startedSeason: seasonNumber,
    startedRound,
    startedAt,
    endedSeason: null,
    endedRound: null,
    endedAt: null,
  };
}

function normalizedCoach(value) {
  const id = text(value?.id);
  if (!id) return null;
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? structuredClone(value)
    : {};
  const suppliedLicenses = uniqueTextList(value?.licenses);
  const managerType = value?.managerType === "human" ? "human" : "ai";
  const license = text(value?.license ?? value?.coachingLicense ?? suppliedLicenses[0]) || null;
  const suppliedFormations = uniqueTextList(value?.preferredFormations, value?.formations);
  const suppliedStyles = uniqueTextList(value?.playStyles, value?.styles);
  const preferredFormation = text(
    value?.preferredFormation ?? value?.formation ?? suppliedFormations[0],
  ) || null;
  const style = text(value?.style ?? value?.playStyle ?? suppliedStyles[0]) || null;
  const playStyles = uniqueTextList(value?.playStyles, value?.styles, style);
  const preferredFormations = uniqueTextList(
    value?.preferredFormations,
    value?.formations,
    preferredFormation,
  );
  const workedCountries = uniqueTextList(
    value?.workedCountries,
    value?.countriesWorked,
    value?.countryExperience,
  );
  const experience = value?.experience && typeof value.experience === "object"
    ? value.experience
    : {};
  return {
    ...source,
    id,
    name: text(value?.name) || id,
    managerType,
    nationality: text(value?.nationality) || null,
    avatarImageUrl: text(value?.avatarImageUrl) || null,
    license,
    licenseTier: canonicalLicenseTier(value?.licenseTier, license),
    equivalentLicenses: uniqueTextList(
      value?.equivalentLicenses,
      value?.licenseEquivalents,
      value?.acceptedLicenses,
      suppliedLicenses,
    ).filter((candidate) => key(candidate) !== key(license)),
    languages: uniqueTextList(
      value?.languages,
      value?.spokenLanguages,
      value?.language,
      value?.languageKnowledge,
    ),
    yearsExperience: finiteNumber(
      value?.yearsExperience
        ?? value?.experienceYears
        ?? value?.totalExperienceYears
        ?? experience?.years
        ?? experience?.totalYears,
      null,
      0,
      80,
    ),
    youthExperienceYears: finiteNumber(
      value?.youthExperienceYears
        ?? value?.youthYears
        ?? value?.academyExperienceYears
        ?? experience?.youthYears,
      null,
      0,
      80,
    ),
    professionalExperienceYears: finiteNumber(
      value?.professionalExperienceYears ?? value?.professionalYears ?? experience?.professionalYears,
      null,
      0,
      80,
    ),
    internationalExperienceYears: finiteNumber(
      value?.internationalExperienceYears ?? value?.internationalYears ?? experience?.internationalYears,
      null,
      0,
      80,
    ),
    divisionExperienceYears: finiteNumber(
      value?.divisionExperienceYears
        ?? value?.currentDivisionExperienceYears
        ?? value?.leagueExperienceYears
        ?? experience?.divisionYears,
      null,
      0,
      80,
    ),
    workedCountries,
    workedLeagueIds: uniqueTextList(
      value?.workedLeagueIds,
      value?.leaguesWorked,
      value?.leagueIds,
    ),
    achievements: normalizedAchievements(value?.achievements ?? value?.honours ?? value?.titles),
    youthDevelopment: normalizedRating(value?.youthDevelopment),
    trainingIntensity: normalizedRating(value?.trainingIntensity),
    ambition: normalizedRating(value?.ambition),
    adaptability: normalizedRating(value?.adaptability),
    expectedSalary: finiteNumber(
      value?.expectedSalary ?? value?.salaryExpectation ?? value?.salary,
      null,
      0,
      20_000_000,
    ),
    marketReputation: finiteNumber(
      value?.marketReputation ?? value?.reputation,
      null,
      0,
      100,
    ),
    preferredFormation,
    preferredFormations,
    style,
    playStyles,
    countryKnowledge: normalizedCountryKnowledge(value?.countryKnowledge, workedCountries),
    reputation: finiteNumber(value?.reputation, null, 0, 100),
    status: text(value?.status) || (value?.currentClubId ? "employed" : "unemployed"),
    currentClubId: text(value?.currentClubId) || null,
    assignments: (Array.isArray(value?.assignments) ? value.assignments : []).flatMap((assignment) => {
      const clubId = text(assignment?.clubId);
      if (!clubId) return [];
      return [{
        ...(assignment && typeof assignment === "object" ? structuredClone(assignment) : {}),
        clubId,
        startedSeason: validPositiveInteger(assignment?.startedSeason) ? assignment.startedSeason : 1,
        startedRound: validPositiveInteger(assignment?.startedRound) ? assignment.startedRound : 1,
        startedAt: text(assignment?.startedAt) || null,
        endedSeason: validPositiveInteger(assignment?.endedSeason) ? assignment.endedSeason : null,
        endedRound: validNonNegativeInteger(assignment?.endedRound) ? assignment.endedRound : null,
        endedAt: text(assignment?.endedAt) || null,
      }];
    }),
  };
}

/** Persist stable coach identities and tenure; migration is deterministic. */
export function ensureCoachCareerState(room, now = new Date()) {
  const seasonNumber = validPositiveInteger(room?.currentSeason) ? room.currentSeason : 1;
  const occurredAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const previousStateExists = room?.coachCareerState?.version === 1;
  const completedRound = Math.max(0, Math.trunc(Number(room?.lastCompletedRound?.round) || 0));
  const clubs = competitionClubs(room);
  const aliases = new Map();
  for (const club of clubs.values()) {
    const clubId = text(club?.id ?? club?.code);
    aliases.set(key(clubId), clubId);
    const code = key(club?.code);
    if (code) aliases.set(code, clubId);
  }
  const existing = (Array.isArray(room?.coachCareerState?.coaches)
    ? room.coachCareerState.coaches
    : []).map(normalizedCoach).filter(Boolean);
  const byId = new Map(existing.map((coach) => [coach.id, coach]));
  const desired = new Map();
  const employmentIsAuthoritative = Number(room?.coachEmploymentState?.version ?? 0) >= 1;
  const activeEmployment = new Map((Array.isArray(room?.coachEmploymentState?.appointments)
    ? room.coachEmploymentState.appointments
    : []).filter((appointment) => appointment?.status === "active" && text(appointment?.coachId))
    .map((appointment) => [text(appointment.coachId), appointment]));

  for (const manager of Array.isArray(room?.managers) ? room.managers : []) {
    const id = text(manager?.id);
    const candidateClubId = aliases.get(key(manager?.clubId)) ?? text(manager?.clubId);
    if (!id) continue;
    const employment = activeEmployment.get(id) ?? null;
    const clubId = employmentIsAuthoritative
      ? text(employment?.clubId) || null
      : candidateClubId || null;
    const previous = byId.get(id);
    const detachedStatus = ["dismissed", "resigned", "retired", "negotiating", "awaiting_start"]
      .includes(text(previous?.status))
      ? previous.status
      : "unemployed";
    const normalized = normalizedCoach({
      ...previous,
      ...manager,
      id,
      name: text(manager?.name) || previous?.name || "Manager",
      managerType: "human",
      nationality: text(manager?.nationality) || previous?.nationality || null,
      avatarImageUrl: text(manager?.avatarImageUrl ?? manager?.photoUrl) || previous?.avatarImageUrl || null,
      preferredFormation: text(manager?.preferredFormation) || previous?.preferredFormation || null,
      style: text(manager?.style) || previous?.style || null,
      reputation: Number.isFinite(Number(manager?.reputation)) ? Number(manager.reputation) : previous?.reputation ?? null,
      status: text(manager?.status)
        || (employment
          ? (employment.role === "interim" ? "interim" : "employed")
          : clubId ? "employed" : detachedStatus),
      currentClubId: clubId,
      assignments: previous?.assignments ?? [],
    });
    const { assignments: _assignments, ...target } = normalized;
    desired.set(id, target);
  }

  // Once the employment engine has migrated the save, the persisted job
  // state is authoritative for AI coaches. Rebuilding them from catalog data
  // here would silently rehire dismissed coaches on every room load.
  if (employmentIsAuthoritative) {
    for (const coach of existing) {
      if (coach.managerType !== "ai" || !coach.currentClubId) continue;
      const { assignments: _assignments, ...target } = coach;
      desired.set(coach.id, target);
    }
  }
  const claimed = new Set([...desired.values()].map((coach) => key(coach.currentClubId)));
  for (const club of employmentIsAuthoritative ? [] : clubs.values()) {
    const clubId = text(club?.id ?? club?.code);
    if (!clubId || claimed.has(key(clubId))) continue;
    const metadata = coachRecord(club);
    const sourceId = text(metadata?.id ?? metadata?.coachId ?? metadata?.managerId) || clubId;
    const id = aiCoachId(sourceId);
    const normalized = normalizedCoach({
      ...metadata,
      id,
      name: text(metadata?.name ?? metadata?.fullName) || `Treinador de ${text(club?.name) || clubId}`,
      managerType: "ai",
      nationality: text(metadata?.nationality ?? metadata?.country) || null,
      avatarImageUrl: text(metadata?.avatarImageUrl ?? metadata?.photoUrl) || null,
      preferredFormation: text(metadata?.preferredFormation ?? metadata?.formation) || null,
      style: text(metadata?.style ?? metadata?.playStyle) || null,
      reputation: Number.isFinite(Number(metadata?.reputation)) ? Number(metadata.reputation) : null,
      status: text(metadata?.status) || "employed",
      currentClubId: clubId,
      assignments: [],
    });
    const { assignments: _assignments, ...target } = normalized;
    desired.set(id, target);
  }

  for (const coach of existing) {
    const target = desired.get(coach.id);
    if (target && key(target.currentClubId) === key(coach.currentClubId)) continue;
    const active = coach.assignments.findLast((assignment) => assignment.endedSeason === null);
    if (active) {
      active.endedSeason = seasonNumber;
      active.endedRound = completedRound;
      active.endedAt = occurredAt;
    }
    coach.currentClubId = null;
    coach.status = target?.status || (coach.status === "dismissed" ? "dismissed" : "unemployed");
  }
  for (const target of desired.values()) {
    const coach = byId.get(target.id) ?? { ...target, assignments: [] };
    Object.assign(coach, target);
    if (target.currentClubId && !coach.assignments.some((assignment) => (
      assignment.endedSeason === null && key(assignment.clubId) === key(target.currentClubId)
    ))) {
      coach.assignments.push(assignmentFor(
        target.currentClubId,
        seasonNumber,
        occurredAt,
        previousStateExists ? completedRound + 1 : 1,
      ));
    }
    byId.set(coach.id, coach);
  }
  const previousMetadata = room?.coachCareerState && typeof room.coachCareerState === "object"
    ? Object.fromEntries(Object.entries(room.coachCareerState).filter(([field]) => field !== "coaches"))
    : {};
  const next = {
    ...previousMetadata,
    version: 1,
    coaches: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id, "pt-BR")),
  };
  const before = JSON.stringify(room?.coachCareerState ?? null);
  const after = JSON.stringify(next);
  if (before === after) return false;
  room.coachCareerState = next;
  return true;
}

export function ensureCareerState(room, now = new Date()) {
  let changed = false;
  const set = (key, value) => {
    if (room[key] === value) return;
    room[key] = value;
    changed = true;
  };

  if (!validPositiveInteger(room.seasonLength)) set("seasonLength", 1);
  if (typeof room.unlimitedSeasons !== "boolean") set("unlimitedSeasons", false);
  if (!validPositiveInteger(room.currentSeason)) set("currentSeason", 1);
  if (!validPositiveInteger(room.seasonYear)) {
    const firstYear = yearFrom(room.startedAt ?? room.createdAt, now);
    set("seasonYear", firstYear + room.currentSeason - 1);
  }
  if (typeof room.seasonStartedAt !== "string" || !room.seasonStartedAt) {
    set("seasonStartedAt", room.startedAt ?? room.createdAt ?? now.toISOString());
  }
  if (!Array.isArray(room.seasonHistory)) set("seasonHistory", []);
  if (typeof room.careerCompleted !== "boolean") set("careerCompleted", false);
  if (!(typeof room.careerCompletedAt === "string" || room.careerCompletedAt === null)) {
    set("careerCompletedAt", null);
  }
  changed = ensureCoachCareerState(room, now) || changed;
  return changed;
}

export function careerHasNextSeason(room) {
  return room.unlimitedSeasons === true || room.currentSeason < room.seasonLength;
}
