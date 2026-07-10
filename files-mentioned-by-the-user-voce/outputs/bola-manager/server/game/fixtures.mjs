const FIXTURE_CATALOG = Object.freeze({
  abertura: { homeSlot: 0, awaySlot: 1, fallbackAway: "SAN" },
  "rodada-2": { homeSlot: 1, awaySlot: 0, fallbackHome: "PAL" },
  "copa-ida": { homeSlot: 0, awaySlot: 2, fallbackAway: "FLA" },
});

export const FIXTURE_ORDER = Object.freeze(Object.keys(FIXTURE_CATALOG));

const CLUB_NAMES = Object.freeze({
  AUR: "Aurora FC",
  SAN: "Santos",
  PAL: "Palmeiras",
  FLA: "Flamengo",
  COR: "Corinthians",
  GRE: "Gremio",
});

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function managerClub(room, slot, fallback) {
  return room.managers[slot]?.clubId || fallback;
}

function teamFromClub(clubId) {
  const normalized = clubId || "IA";
  return {
    clubId: normalized,
    name: CLUB_NAMES[normalized] || normalized,
    strength: 9 + (hashText(normalized) % 7),
  };
}

export function resolveServerFixture(room, requestedFixtureId) {
  const fixtureId = requestedFixtureId || room.currentFixtureId;
  if (!fixtureId) {
    const error = new Error("Nao existem fixtures pendentes nesta sala");
    error.code = "NO_PENDING_FIXTURE";
    error.status = 409;
    throw error;
  }
  if (room.completedFixtureIds?.includes(fixtureId)) {
    const error = new Error("Esta fixture ja foi concluida");
    error.code = "FIXTURE_ALREADY_COMPLETED";
    error.status = 409;
    throw error;
  }
  if (room.currentFixtureId && fixtureId !== room.currentFixtureId) {
    const error = new Error("Esta fixture ainda nao e a atual");
    error.code = "FIXTURE_NOT_CURRENT";
    error.status = 409;
    throw error;
  }
  const template = FIXTURE_CATALOG[fixtureId];
  if (!template) {
    const error = new Error("Fixture nao encontrado no catalogo do servidor");
    error.code = "FIXTURE_NOT_FOUND";
    error.status = 404;
    throw error;
  }
  const homeClub = managerClub(room, template.homeSlot, template.fallbackHome || "AUR");
  const awayClub = managerClub(room, template.awaySlot, template.fallbackAway || "SAN");
  const home = teamFromClub(homeClub);
  const away = teamFromClub(awayClub === home.clubId ? "SAN" : awayClub);
  return {
    fixtureId,
    homeTeam: home.name,
    awayTeam: away.name,
    homeStrength: home.strength,
    awayStrength: away.strength,
    seed: `${room.id}|${fixtureId}|${room.revision}`,
  };
}

export function nextFixtureId(fixtureId) {
  const index = FIXTURE_ORDER.indexOf(fixtureId);
  return index >= 0 ? FIXTURE_ORDER[index + 1] ?? null : null;
}
