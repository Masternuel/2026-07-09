import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ApiFootballError, createApiFootballClient, createFileCache, createMemoryCache } from "../import/apiFootball/client.mjs";
import { assignPositions, buildCatalogRecords, clubOffsets, divisionFor, targetOverall } from "../import/apiFootball/catalogBuilder.mjs";
import { parseCatalogDatabase, createCatalogDatabasePackage } from "../services/catalogDatabase.mjs";
import { downloadDivisions, parseArguments } from "../../scripts/catalog-update.mjs";

const KEY = "test-key-not-real";
const POSITIONS = ["Goalkeeper", "Defender", "Defender", "Defender", "Defender", "Midfielder", "Midfielder", "Midfielder", "Attacker", "Attacker"];

function squad(teamId, size) {
  return Array.from({ length: size }, (_, index) => ({
    id: teamId * 1000 + index, name: `Jogador ${teamId}-${index}`, age: 18 + (index % 17), number: index + 1,
    position: POSITIONS[index % POSITIONS.length],
  }));
}

// Fake API: 4 divisions, `teamsPerLeague` clubs each, quota after `quota` real requests.
function fakeApi({ teamsPerLeague = 3, squadSize = 25, quota = Infinity, season = 2026 } = {}) {
  const calls = [];
  const leagueIds = { "Serie A": 71, "Serie B": 72, "Serie C": 75, "Serie D": 76 };
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), key: init.headers["x-apisports-key"] });
    const body = (response) => ({ ok: true, status: 200, headers: new Map([["x-ratelimit-requests-remaining", String(Math.max(0, quota - calls.length))]]), json: async () => ({ errors: [], response }) });
    if (calls.length > quota) return { ...body([]), json: async () => ({ errors: { requests: "You have reached the request limit for the day" }, response: [] }) };
    const path = url.pathname;
    if (path === "/leagues") {
      assert.equal(url.searchParams.get("season"), String(season));
      return body([...Object.entries(leagueIds).map(([name, id]) => ({ league: { id, name, type: "League" } })), { league: { id: 999, name: "Paulista - A1", type: "League" } }]);
    }
    if (path === "/teams") {
      const league = Number(url.searchParams.get("league"));
      return body(Array.from({ length: teamsPerLeague }, (_, index) => ({
        team: { id: league * 100 + index, name: `Clube ${league}-${index}`, code: index === 0 ? null : `C${index}` },
        venue: { name: `Estadio ${index}`, city: "Cidade", capacity: (index + 1) * 10_000 },
      })));
    }
    if (path === "/players/squads") {
      const team = Number(url.searchParams.get("team"));
      return body([{ team: { id: team }, players: squad(team, squadSize) }]);
    }
    throw new Error(`unexpected ${path}`);
  };
  return { fetchImpl, calls };
}

const fastClient = (fetchImpl, cache = createMemoryCache(), extra = {}) => createApiFootballClient({ key: KEY, fetchImpl, cache, minIntervalMs: 0, sleep: async () => {}, ...extra });

test("division names map to levels 1-4 and other leagues are ignored", () => {
  assert.equal(divisionFor("Serie A").level, 1);
  assert.equal(divisionFor("Serie D").level, 4);
  assert.equal(divisionFor("Paulista - A1"), null);
  assert.equal(divisionFor("Serie A Women"), null);
});

test("generated overall falls with division level and is deterministic", () => {
  const average = (level) => {
    let sum = 0;
    for (let id = 0; id < 400; id += 1) sum += targetOverall({ level, age: 26, seed: id });
    return sum / 400;
  };
  assert.ok(average(1) > average(2) && average(2) > average(3) && average(3) > average(4));
  assert.equal(targetOverall({ level: 1, age: 26, seed: 42 }), targetOverall({ level: 1, age: 26, seed: 42 }));
  assert.ok(targetOverall({ level: 1, age: 17, seed: 5 }) < targetOverall({ level: 1, age: 27, seed: 5 }) + 1);
});

test("bigger stadiums get a higher club offset", () => {
  const offsets = clubOffsets([{ venue: { capacity: 5_000 } }, { venue: { capacity: 60_000 } }, { venue: {} }]);
  assert.ok(offsets[1] > offsets[0]);
  assert.ok(offsets.every((value) => value >= -1.5 && value <= 1.5));
});

test("broad API positions are spread over specific game positions", () => {
  const players = squad(1, 20);
  const positions = assignPositions(players, "af-c1");
  const values = [...positions.values()];
  for (const position of ["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "ATA", "PD", "PE"]) assert.ok(values.includes(position), position);
  for (const player of players.filter((item) => item.position === "Goalkeeper")) assert.equal(positions.get(player.id), "GOL");
});

test("full download builds a valid Bola Manager database for Serie A-D", async () => {
  const api = fakeApi();
  const client = fastClient(api.fetchImpl);
  const result = await downloadDivisions(client, 2026);
  assert.equal(result.downloaded, 12);
  assert.ok(api.calls.every((call) => call.key === KEY));
  const { records, report } = buildCatalogRecords(result.divisions);
  const database = createCatalogDatabasePackage(records);
  const parsed = parseCatalogDatabase(JSON.parse(JSON.stringify(database)));
  assert.deepEqual(parsed.records.leagues.map((league) => [league.division, league.level]), [["Serie A", 1], ["Serie B", 2], ["Serie C", 3], ["Serie D", 4]]);
  assert.equal(parsed.records.clubs.length, 12);
  assert.equal(parsed.records.players.length, 12 * 25);
  assert.equal(report.generatedPlayers, 0);
  const byLeague = (level) => {
    const clubs = new Set(parsed.records.clubs.filter((club) => club.leagueId === parsed.records.leagues[level - 1].id).map((club) => club.id));
    const players = parsed.records.players.filter((player) => clubs.has(player.clubId));
    return players.reduce((sum, player) => sum + player.overall, 0) / players.length;
  };
  assert.ok(byLeague(1) > byLeague(4) + 2, "Serie A should be clearly stronger than Serie D");
  assert.ok(parsed.records.players.every((player) => Object.keys(player.attributes).length >= 15));
  // Running again is fully served by the cache (no extra quota spent).
  const before = api.calls.length;
  await downloadDivisions(client, 2026);
  assert.equal(api.calls.length, before);
});

test("short squads are completed with generated players up to a playable size", () => {
  const divisions = [{ league: { id: 76 }, level: 4, division: "Serie D", teams: [{ team: { id: 5, name: "Pequeno FC" }, venue: {} }], squads: new Map([[5, squad(5, 9)]]) }];
  const { records, report } = buildCatalogRecords(divisions);
  assert.equal(records.players.length, 22);
  assert.equal(report.generatedPlayers, 13);
  const goalkeepers = records.players.filter((player) => player.position === "GOL");
  assert.ok(goalkeepers.length >= 2);
  const shirts = records.players.map((player) => player.shirtNumber);
  assert.equal(new Set(shirts).size, shirts.length);
  parseCatalogDatabase(JSON.parse(JSON.stringify(createCatalogDatabasePackage(records))));
});

test("quota exhaustion stops with progress; cache lets the next run resume", async () => {
  const directory = await mkdtemp(join(tmpdir(), "api-football-cache-"));
  try {
    const first = fakeApi({ quota: 8 });
    await assert.rejects(downloadDivisions(fastClient(first.fetchImpl, createFileCache(directory)), 2026), (error) => {
      assert.equal(error.code, "API_FOOTBALL_QUOTA");
      assert.match(error.message, /3 de 12 elencos/);
      return true;
    });
    assert.ok((await readdir(directory)).length >= 8);
    const cacheText = (await Promise.all((await readdir(directory)).map((name) => readFile(join(directory, name), "utf8")))).join("");
    assert.ok(!cacheText.includes(KEY), "the API key must never be cached");
    const second = fakeApi();
    const result = await downloadDivisions(fastClient(second.fetchImpl, createFileCache(directory)), 2026);
    assert.equal(result.downloaded, 12);
    assert.equal(second.calls.length, 9, "only the squads still missing are requested");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("partial mode returns what was downloaded and fills missing squads", async () => {
  const api = fakeApi({ quota: 8 });
  const result = await downloadDivisions(fastClient(api.fetchImpl), 2026, { partial: true });
  assert.equal(result.incomplete, true);
  const { records, report } = buildCatalogRecords(result.divisions);
  assert.equal(report.missingSquads.length, 9);
  assert.equal(records.clubs.length, 12);
  assert.ok(records.players.filter((player) => player.generated).length >= 9 * 22);
});

test("API errors are classified and the key is required", async () => {
  assert.throws(() => createApiFootballClient({ key: "" }), (error) => error.code === "API_FOOTBALL_KEY_MISSING");
  const reply = (errors) => async () => ({ ok: true, status: 200, headers: new Map(), json: async () => ({ errors, response: [] }) });
  const cases = [
    [{ token: "Error/Missing application key." }, "API_FOOTBALL_AUTH"],
    [{ plan: "Free plans do not have access to this season, try from 2022 to 2024." }, "API_FOOTBALL_PLAN"],
    [{ requests: "You have reached the request limit for the day" }, "API_FOOTBALL_QUOTA"],
  ];
  for (const [errors, code] of cases) {
    await assert.rejects(fastClient(reply(errors)).get("/leagues"), (error) => error instanceof ApiFootballError && error.code === code && !error.message.includes(KEY));
  }
  let attempts = 0;
  const rateLimited = async () => {
    attempts += 1;
    return { ok: true, status: 200, headers: new Map(), json: async () => (attempts === 1 ? { errors: { rateLimit: "Too many requests. Your rate limit is 10 requests per minute." }, response: [] } : { errors: [], response: [1] }) };
  };
  assert.deepEqual(await fastClient(rateLimited).get("/leagues"), [1]);
  assert.equal(attempts, 2);
});

test("CLI arguments default to the current season and validate input", () => {
  const options = parseArguments([], new Date("2026-11-18T12:00:00Z"));
  assert.equal(options.season, 2026);
  assert.match(options.out, /bola-manager-base-2026\.json$/);
  assert.equal(parseArguments(["--season", "2025", "--partial"]).partial, true);
  assert.throws(() => parseArguments(["--season", "abc"]));
  assert.throws(() => parseArguments(["--bogus"]));
});
