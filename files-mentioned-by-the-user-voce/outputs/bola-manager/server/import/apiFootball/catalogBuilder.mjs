// Turns API-Football leagues/teams/squads into Bola Manager catalog records.
// The API gives names, ages, shirt numbers and broad positions only; every rating is
// generated here from division level, club size (stadium capacity) and age, with a
// deterministic per-player variance so re-running the update keeps the same numbers.
import { GENERATED_ATTRIBUTE_KEYS, generatedAttribute, hashText } from "../../game/attributeGeneration.mjs";
import { calculatePlayerOverall } from "../../game/lineupStrength.mjs";

export const NATIONAL_DIVISIONS = Object.freeze([
  { level: 1, division: "Serie A", pattern: /^serie a$/i },
  { level: 2, division: "Serie B", pattern: /^serie b$/i },
  { level: 3, division: "Serie C", pattern: /^serie c$/i },
  { level: 4, division: "Serie D", pattern: /^serie d$/i },
]);

// Average generated overall (1-20 scale) of a typical adult player per division level.
const LEVEL_BASE_OVERALL = Object.freeze({ 1: 13, 2: 11, 3: 9.5, 4: 8, 5: 7, 6: 6 });
const LEVEL_BUDGET = Object.freeze({ 1: 60_000_000, 2: 15_000_000, 3: 4_000_000, 4: 1_200_000, 5: 500_000, 6: 250_000 });
const MIN_SQUAD = Object.freeze({ GOL: 2, DEF: 6, MID: 6, ATT: 4 });
const MIN_SQUAD_SIZE = 22;
const CLUB_COLORS = Object.freeze([
  "#c92d35", "#17814b", "#2d61ca", "#262626", "#e7e7e7", "#4b98cf",
  "#8b2635", "#f2c230", "#e06c1f", "#6a2c91", "#1f7a8c", "#7a5c2e",
]);
const GROUP_PATTERNS = Object.freeze({
  GOL: ["GOL"],
  DEF: ["ZAG", "LD", "ZAG", "LE"],
  MID: ["VOL", "MC", "MEI"],
  ATT: ["ATA", "PD", "ATA", "PE"],
});
const FILLER_FIRST_NAMES = Object.freeze([
  "Lucas", "Gabriel", "Matheus", "Pedro", "Rafael", "Gustavo", "Felipe", "Bruno", "Thiago", "Diego",
  "Caio", "Vinicius", "Leonardo", "Joao", "Renan", "Igor", "Wesley", "Murilo", "Vitor", "Samuel",
  "Danilo", "Eduardo", "Henrique", "Rodrigo", "Marcelo", "Anderson", "Douglas", "Fabio", "Alan", "Erick",
]);
const FILLER_LAST_NAMES = Object.freeze([
  "Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Ferreira", "Almeida", "Ribeiro",
  "Carvalho", "Gomes", "Martins", "Rocha", "Araujo", "Barbosa", "Cardoso", "Teixeira", "Moura", "Nunes",
]);

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const unit = (seed) => (hashText(seed) % 10_000) / 10_000;

export function divisionFor(leagueName) {
  return NATIONAL_DIVISIONS.find((item) => item.pattern.test(String(leagueName).trim())) ?? null;
}

export function positionGroup(apiPosition) {
  const text = String(apiPosition ?? "").toLowerCase();
  if (text.startsWith("goal")) return "GOL";
  if (text.startsWith("def")) return "DEF";
  if (text.startsWith("att") || text.startsWith("for")) return "ATT";
  return "MID";
}

// Squads only say goalkeeper/defender/midfielder/attacker: spread each group over the
// game's specific positions in a stable order (players can be adjusted in the Editor).
export function assignPositions(players, clubKey) {
  const groups = new Map();
  for (const player of players) {
    const group = positionGroup(player.position);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(player);
  }
  const positions = new Map();
  for (const [group, members] of groups) {
    const ordered = [...members].sort((a, b) => hashText(`${clubKey}|${a.id}`) - hashText(`${clubKey}|${b.id}`));
    ordered.forEach((player, index) => positions.set(player.id, GROUP_PATTERNS[group][index % GROUP_PATTERNS[group].length]));
  }
  return positions;
}

function ageAdjustment(age) {
  if (age < 23) return -(23 - age) * 0.6;
  if (age > 30) return -(age - 30) * 0.45;
  return 0;
}

export function targetOverall({ level, clubOffset = 0, age = 24, seed }) {
  const base = LEVEL_BASE_OVERALL[level] ?? 6;
  const variance = (unit(`overall|${seed}`) - 0.5) * 4;
  return clamp(Math.round(base + clubOffset + ageAdjustment(age) + variance), 3, 19);
}

function capacityOffsets(teams) {
  const capacities = teams.map((item) => Number(item.venue?.capacity) || 0);
  const known = capacities.filter((value) => value > 0).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 0;
  const values = capacities.map((value) => value || median);
  const sorted = [...values].sort((a, b) => a - b);
  return teams.map((_, index) => {
    if (sorted.length < 2 || sorted[0] === sorted.at(-1)) return 0;
    const rank = sorted.indexOf(values[index]) + sorted.lastIndexOf(values[index]);
    return (rank / (2 * (sorted.length - 1)) - 0.5) * 3;
  });
}

// Club strength inside its division, from -1.5 to +1.5: mostly the final position in the
// season's table (rank inside its group for Serie D), plus stadium size; stadium only
// when the table is unavailable.
export function clubOffsets(teams, standings = new Map()) {
  const capacity = capacityOffsets(teams);
  return teams.map((item, index) => {
    const row = standings.get(item.team?.id);
    const value = row && row.groupSize > 1
      ? 0.75 * ((1 - (row.rank - 1) / (row.groupSize - 1) - 0.5) * 3) + 0.25 * capacity[index]
      : capacity[index];
    return Number(clamp(value, -1.5, 1.5).toFixed(2));
  });
}

// standings response -> Map(teamId -> { rank, groupSize }).
export function standingsByTeam(response) {
  const rows = new Map();
  for (const item of response ?? []) {
    for (const group of item?.league?.standings ?? []) {
      for (const entry of group ?? []) {
        if (entry?.team?.id != null && !rows.has(entry.team.id)) rows.set(entry.team.id, { rank: Number(entry.rank) || group.length, groupSize: group.length });
      }
    }
  }
  return rows;
}

// API names come in mixed case ("Vasco DA Gama"): keep Portuguese particles lowercase.
export function clubName(name) {
  return String(name).trim().replace(/(?<=\s)(DA|DE|DO|DAS|DOS|E)(?=\s)/g, (particle) => particle.toLowerCase());
}

function abbreviation(team) {
  const code = String(team.code ?? "").trim().toUpperCase();
  if (/^[A-Z0-9]{2,8}$/.test(code)) return code;
  return String(team.name).normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "CLB";
}

function marketValue(overall, age, reputation) {
  const ageFactor = age <= 21 ? 1.25 : age <= 29 ? 1.1 : age <= 32 ? 0.85 : 0.6;
  return Math.round(overall * ageFactor * reputation * 100_000);
}

function playerRecord({ id, clubId, name, position, age, shirtNumber, overall, reputation, generated = false }) {
  const attributes = Object.fromEntries(GENERATED_ATTRIBUTE_KEYS.map((attribute) => [
    attribute, generatedAttribute({ name: `${id}|${name}`, position }, attribute, overall),
  ]));
  const finalOverall = calculatePlayerOverall({ position, attributes }, overall);
  return {
    id, clubId, name, shortName: String(name).split(" ").at(-1), position, age,
    nationality: "Brasil", shirtNumber, overall: finalOverall, attributes,
    isStar: finalOverall >= 17, marketValue: marketValue(finalOverall, age, reputation),
    avatarImageUrl: null, avatarImagePath: null, active: true,
    ...(generated ? { generated: true } : {}),
  };
}

function fillerPlayers({ club, existing, level, clubOffset, startIndex }) {
  const counts = { GOL: 0, DEF: 0, MID: 0, ATT: 0 };
  for (const player of existing) {
    const position = player.position;
    counts[position === "GOL" ? "GOL" : ["ZAG", "LD", "LE"].includes(position) ? "DEF" : ["VOL", "MC", "MEI"].includes(position) ? "MID" : "ATT"] += 1;
  }
  const needed = [];
  for (const [group, minimum] of Object.entries(MIN_SQUAD)) for (let n = counts[group]; n < minimum; n += 1) needed.push(group);
  const order = ["MID", "DEF", "ATT", "GOL"];
  while (existing.length + needed.length < MIN_SQUAD_SIZE) needed.push(order[(existing.length + needed.length) % order.length]);
  const taken = new Set(existing.map((player) => player.shirtNumber).filter((value) => value != null));
  let shirt = 1;
  return needed.map((group, index) => {
    const seed = `${club.id}|filler|${startIndex + index}`;
    const groupCount = counts[group]++;
    const position = GROUP_PATTERNS[group][groupCount % GROUP_PATTERNS[group].length];
    const name = `${FILLER_FIRST_NAMES[hashText(`${seed}|first`) % FILLER_FIRST_NAMES.length]} ${FILLER_LAST_NAMES[hashText(`${seed}|last`) % FILLER_LAST_NAMES.length]}`;
    const age = 18 + (hashText(`${seed}|age`) % 15);
    while (taken.has(shirt)) shirt += 1;
    taken.add(shirt);
    return playerRecord({ id: `${club.id}-g${startIndex + index + 1}`, clubId: club.id, name, position, age, shirtNumber: shirt,
      overall: targetOverall({ level, clubOffset: clubOffset - 0.5, age, seed }), reputation: club.reputation, generated: true });
  });
}

// divisions: [{ league: { id, name }, level, division, teams: [{ team, venue }], squads: Map(teamId -> players[]) }]
export function buildCatalogRecords(divisions, { fillSquads = true } = {}) {
  const leagues = [];
  const clubs = [];
  const players = [];
  const seenTeams = new Set();
  const seenPlayers = new Set();
  const report = { leagues: [], generatedPlayers: 0, missingSquads: [], duplicateTeams: 0, duplicatePlayers: 0 };
  for (const entry of [...divisions].sort((a, b) => a.level - b.level)) {
    const leagueId = `af-l${entry.league.id}`;
    const offsets = clubOffsets(entry.teams, entry.standings);
    let clubCount = 0;
    let playerCount = 0;
    entry.teams.forEach(({ team, venue }, index) => {
      if (seenTeams.has(team.id)) { report.duplicateTeams += 1; return; }
      seenTeams.add(team.id);
      const clubId = `af-c${team.id}`;
      const clubOffset = offsets[index];
      const reputation = clamp(Math.round(18 - (entry.level - 1) * 3 + clubOffset * 1.4), 1, 20);
      const club = {
        id: clubId, name: clubName(team.name), abbreviation: abbreviation(team),
        colors: [CLUB_COLORS[hashText(clubId) % CLUB_COLORS.length]],
        stadium: String(venue?.name ?? "").trim() || "A definir",
        stadiumCapacity: clamp(Number(venue?.capacity) || 0, 0, 500_000),
        reputation, division: entry.division, country: "Brasil", state: null,
        city: String(venue?.city ?? "").trim() || null, leagueId,
        budget: Math.round((LEVEL_BUDGET[entry.level] ?? 200_000) * (1 + clubOffset * 0.3)),
        crestImageUrl: null, crestImagePath: null, active: true,
      };
      clubs.push(club);
      clubCount += 1;
      const squad = entry.squads.get(team.id) ?? null;
      if (!squad) report.missingSquads.push({ teamId: team.id, name: club.name });
      const source = (squad ?? []).filter((player) => player?.id != null && String(player.name ?? "").trim());
      const positions = assignPositions(source, clubId);
      const clubPlayers = [];
      for (const player of source) {
        if (seenPlayers.has(player.id)) { report.duplicatePlayers += 1; continue; }
        seenPlayers.add(player.id);
        const age = clamp(Number.parseInt(player.age, 10) || 24, 15, 45);
        const shirtNumber = Number.isInteger(player.number) && player.number >= 0 && player.number <= 99 ? player.number : null;
        clubPlayers.push(playerRecord({ id: `af-p${player.id}`, clubId, name: String(player.name).trim(), position: positions.get(player.id),
          age, shirtNumber, overall: targetOverall({ level: entry.level, clubOffset, age, seed: player.id }), reputation }));
      }
      if (fillSquads) {
        const filler = fillerPlayers({ club, existing: clubPlayers, level: entry.level, clubOffset, startIndex: 0 });
        report.generatedPlayers += filler.length;
        clubPlayers.push(...filler);
      }
      players.push(...clubPlayers);
      playerCount += clubPlayers.length;
    });
    leagues.push({ id: leagueId, name: `Brasileirao ${entry.division}`, country: "Brasil", level: entry.level,
      division: entry.division, legs: clubCount > 24 ? "single" : "double", active: clubCount >= 2 });
    report.leagues.push({ id: leagueId, division: entry.division, clubs: clubCount, players: playerCount });
  }
  return { records: { leagues, clubs, players, tournaments: [] }, report };
}
