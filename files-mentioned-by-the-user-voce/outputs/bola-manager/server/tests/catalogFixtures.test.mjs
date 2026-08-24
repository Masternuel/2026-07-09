import assert from "node:assert/strict";
import test from "node:test";
import { resolveServerFixture } from "../game/fixtures.mjs";
import { RoomStore } from "../store/roomStore.mjs";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";

const competitionCatalog = [
  {
    id: "ENG-PL",
    name: "Liga Inglesa",
    country: "Inglaterra",
    division: "Premier League",
    clubs: [
      { id: "CHE", name: "Chelsea", code: "CHE", color: "#034694", darkThemeColor: "#66a3ff", lightThemeColor: "#034694", reputation: 18, stadium: "Stamford Bridge", stadiumCapacity: 40_341, crestImageUrl: "https://cdn.example.com/chelsea.png", leagueId: "ENG-PL" },
      { id: "ARS", name: "Arsenal", code: "ARS", color: "#db0007", darkThemeColor: "#ff777d", lightThemeColor: "#a30005", reputation: 18, stadium: "Emirates Stadium", stadiumCapacity: 60_704, crestImageUrl: "https://cdn.example.com/arsenal.png", leagueId: "ENG-PL" },
      { id: "LIV", name: "Liverpool", code: "LIV", color: "#c8102e", reputation: 19, crestImageUrl: null, leagueId: "ENG-PL" },
    ],
  },
  {
    id: "BR-A",
    name: "Brasileirao",
    country: "Brasil",
    division: "Serie A",
    clubs: [
      { id: "PAL", name: "Palmeiras", code: "PAL", color: "#159761", reputation: 17, crestImageUrl: null, leagueId: "BR-A" },
    ],
  },
];

function catalogStore() {
  return { async listCompetitionCatalog() { return structuredClone(competitionCatalog); } };
}

function mutableCatalogStore(initialCatalog) {
  let current = structuredClone(initialCatalog);
  return {
    async listCompetitionCatalog() { return structuredClone(current); },
    replace(nextCatalog) { current = structuredClone(nextCatalog); },
  };
}

test("fixture de save legado usa estadio seguro quando a base antiga nao possui o campo", () => {
  const fixture = resolveServerFixture({
    id: "legacy-room",
    revision: 1,
    currentFixtureId: "abertura",
    completedFixtureIds: [],
    fixtureSchedule: [{
      fixtureId: "abertura",
      homeClubId: "AUR",
      awayClubId: "SAN",
      homeTeam: "Aurora FC",
      awayTeam: "Santos",
      managerIds: [],
    }],
  }, "abertura");

  assert.equal(fixture.homeStadium, "A definir");
  assert.equal(fixture.homeStadiumCapacity, 0);
});

test("sala fixa o dono da base e sempre resolve o catalogo pessoal do criador", async () => {
  const resolvedOwners = [];
  const rootCatalog = {
    forOwner(ownerId) {
      resolvedOwners.push(ownerId);
      return {
        async ensureInitialized() {},
        async listCompetitionCatalog() { return structuredClone(competitionCatalog); },
      };
    },
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: rootCatalog,
    codeFactory: () => "BOLA-BASE",
  });
  const room = await store.createRoom({
    name: "Base do criador",
    creatorId: "manager-owner",
    creatorName: "Emanuel",
    clubId: "CHE",
    activeLeagues: ["ENG-PL"],
    seasonLength: 1,
    maxManagers: 1,
  });
  assert.equal(room.catalogOwnerId, "manager-owner");
  const catalogReadsBeforeOwnershipCheck = resolvedOwners.length;
  const ownedRoom = await store.requireOwnership(room.code, "manager-owner");
  assert.equal(ownedRoom.code, room.code);
  assert.equal(resolvedOwners.length, catalogReadsBeforeOwnershipCheck);
  await store.setReady(room.code, "manager-owner", true, "CHE");
  await store.startRoom(room.code, "manager-owner");
  assert.deepEqual(resolvedOwners, ["manager-owner", "manager-owner"]);
});

test("base pessoal vazia bloqueia clube demo em vez de misturar catalogos", async () => {
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: { async listCompetitionCatalog() { return []; } },
    codeFactory: () => "BOLA-EMPTY",
  });
  const room = await store.createRoom({
    name: "Base vazia",
    creatorId: "manager-owner",
    creatorName: "Emanuel",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    maxManagers: 1,
  });
  await assert.rejects(
    store.setReady(room.code, "manager-owner", true, "AUR"),
    (error) => error.code === "ROOM_CATALOG_EMPTY" && error.status === 409,
  );
});

test("calendario usa somente clubes, nome e escudos da liga selecionada", async () => {
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: catalogStore(),
    codeFactory: () => "BOLA-ENGL",
    now: () => new Date("2026-07-13T00:00:00.000Z"),
  });
  const room = await store.createRoom({
    name: "Carreira inglesa",
    creatorId: "manager-che",
    creatorName: "Emanuel",
    clubId: "CHE",
    activeLeagues: ["ENG-PL"],
    seasonLength: 1,
    maxManagers: 1,
  });
  await store.setReady(room.code, "manager-che", true, "CHE");
  const started = await store.startRoom(room.code, "manager-che");

  assert.deepEqual(started.activeLeagues, ["ENG-PL"]);
  assert.equal(started.fixtureSchedule.length, 4);
  assert.equal(started.fixtureSchedule.every((fixture) => fixture.leagueId === "ENG-PL"), true);
  assert.equal(started.fixtureSchedule.every((fixture) => fixture.competition === "Liga Inglesa"), true);
  assert.equal(started.fixtureSchedule.some((fixture) => [fixture.homeClubId, fixture.awayClubId].includes("PAL")), false);
  const chelseaFixture = started.fixtureSchedule.find((fixture) => [fixture.homeClubId, fixture.awayClubId].includes("CHE"));
  assert.ok(chelseaFixture);
  assert.equal(
    chelseaFixture.homeClubId === "CHE" ? chelseaFixture.homeCrestImageUrl : chelseaFixture.awayCrestImageUrl,
    "https://cdn.example.com/chelsea.png",
  );
  assert.equal(
    chelseaFixture.homeClubId === "CHE" ? chelseaFixture.homeDarkThemeColor : chelseaFixture.awayDarkThemeColor,
    "#66a3ff",
  );
  assert.equal(
    chelseaFixture.homeClubId === "CHE" ? chelseaFixture.homeLightThemeColor : chelseaFixture.awayLightThemeColor,
    "#034694",
  );
  const arsenalFixture = started.fixtureSchedule.find((fixture) => [fixture.homeClubId, fixture.awayClubId].includes("ARS"));
  assert.ok(arsenalFixture);
  assert.equal(
    arsenalFixture.homeClubId === "ARS" ? arsenalFixture.homeDarkThemeColor : arsenalFixture.awayDarkThemeColor,
    "#ff777d",
  );
  const chelseaHomeFixture = started.fixtureSchedule.find((fixture) => fixture.homeClubId === "CHE");
  assert.ok(chelseaHomeFixture);
  assert.equal(chelseaHomeFixture.homeStadium, "Stamford Bridge");
  assert.equal(chelseaHomeFixture.homeStadiumCapacity, 40_341);
});

test("servidor bloqueia clube fora das ligas ativas", async () => {
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: catalogStore(),
    codeFactory: () => "BOLA-LOCK",
  });
  const room = await store.createRoom({
    name: "Somente Inglaterra",
    creatorId: "manager-1",
    creatorName: "Emanuel",
    activeLeagues: ["ENG-PL"],
    seasonLength: 1,
    maxManagers: 1,
  });
  await assert.rejects(
    store.setReady(room.code, "manager-1", true, "PAL"),
    (error) => error.code === "CLUB_LEAGUE_NOT_ACTIVE",
  );
});

test("save legado sem partidas troca calendario brasileiro pela liga real do clube", async () => {
  const legacyRoom = {
    id: "legacy-chelsea",
    code: "BOLA-CHEL",
    name: "Chelsea legado",
    ownerId: "manager-che",
    status: "active",
    activeLeagues: ["BR-A", "BR-B", "AR-A"],
    seasonLength: 1,
    unlimitedSeasons: false,
    currentSeason: 1,
    seasonYear: 2026,
    seasonStartedAt: "2026-07-13T00:00:00.000Z",
    seasonHistory: [],
    careerCompleted: false,
    maxManagers: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    startedAt: "2026-07-13T00:00:00.000Z",
    revision: 2,
    scheduleVersion: 1,
    currentFixtureId: "abertura",
    completedFixtureIds: [],
    completedMatches: [],
    matchReadiness: { fixtureId: "abertura", managerIds: [] },
    managerIds: ["manager-che"],
    managers: [{ id: "manager-che", name: "Emanuel", clubId: "CHE", ready: true, joinedAt: "2026-07-13T00:00:00.000Z" }],
    fixtureSchedule: [{
      fixtureId: "abertura", round: 1, competition: "Brasileirao",
      homeClubId: "CHE", awayClubId: "PAL", homeTeam: "CHE", awayTeam: "Palmeiras",
      homeManagerId: "manager-che", awayManagerId: null, managerIds: ["manager-che"],
    }],
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence([legacyRoom]),
    catalogStore: catalogStore(),
  });

  const migrated = await store.requireMembership(legacyRoom.code, "manager-che");
  assert.equal(migrated.activeLeagues.includes("ENG-PL"), true);
  assert.equal(migrated.fixtureSchedule.length, 4);
  assert.equal(migrated.fixtureSchedule.every((fixture) => fixture.competition === "Liga Inglesa"), true);
  assert.equal(migrated.fixtureSchedule.some((fixture) => [fixture.homeClubId, fixture.awayClubId].includes("PAL")), false);
});

test("sala em espera recarrega clubes adicionados no Editor antes de iniciar", async () => {
  const englishLeague = structuredClone(competitionCatalog[0]);
  const liveCatalog = mutableCatalogStore([{ ...englishLeague, clubs: englishLeague.clubs.slice(0, 1) }]);
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: liveCatalog,
    codeFactory: () => "BOLA-LIVE",
  });
  const room = await store.createRoom({
    name: "Editor ao vivo",
    creatorId: "manager-che",
    creatorName: "Emanuel",
    clubId: "CHE",
    activeLeagues: ["ENG-PL"],
    seasonLength: 1,
    maxManagers: 1,
  });
  await store.setReady(room.code, "manager-che", true, "CHE");

  liveCatalog.replace([{ ...englishLeague, clubs: englishLeague.clubs.slice(0, 2) }]);
  const started = await store.startRoom(room.code, "manager-che");

  assert.equal(started.competitionCatalog[0].clubs.length, 2);
  assert.equal(started.fixtureSchedule.length, 2);
  assert.equal(started.fixtureSchedule[0].competition, "Liga Inglesa");
});

test("save ativo sinaliza liga incompleta e se recupera quando ganha adversario", async () => {
  const englishLeague = structuredClone(competitionCatalog[0]);
  const liveCatalog = mutableCatalogStore([{ ...englishLeague, clubs: englishLeague.clubs.slice(0, 1) }]);
  const legacyRoom = {
    id: "legacy-underfilled",
    code: "BOLA-WAIT",
    name: "Chelsea aguardando liga",
    ownerId: "manager-che",
    status: "active",
    activeLeagues: ["BR-A"],
    seasonLength: 1,
    unlimitedSeasons: false,
    currentSeason: 1,
    seasonYear: 2026,
    seasonStartedAt: "2026-07-13T00:00:00.000Z",
    seasonHistory: [],
    careerCompleted: false,
    maxManagers: 1,
    createdAt: "2026-07-13T00:00:00.000Z",
    startedAt: "2026-07-13T00:00:00.000Z",
    revision: 2,
    scheduleVersion: 1,
    currentFixtureId: "abertura",
    completedFixtureIds: [],
    completedMatches: [],
    matchReadiness: { fixtureId: "abertura", managerIds: [] },
    managerIds: ["manager-che"],
    managers: [{ id: "manager-che", name: "Emanuel", clubId: "CHE", ready: true, joinedAt: "2026-07-13T00:00:00.000Z" }],
    fixtureSchedule: [{
      fixtureId: "abertura", round: 1, competition: "Brasileirao",
      homeClubId: "CHE", awayClubId: "PAL", homeTeam: "CHE", awayTeam: "Palmeiras",
      homeManagerId: "manager-che", awayManagerId: null, managerIds: ["manager-che"],
    }],
  };
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence([legacyRoom]),
    catalogStore: liveCatalog,
  });

  const preserved = await store.requireMembership(legacyRoom.code, "manager-che");
  assert.equal(preserved.fixtureSchedule.length, 0);
  assert.equal(preserved.currentFixtureId, null);
  assert.equal(preserved.scheduleIssue.code, "LEAGUE_NEEDS_CLUBS");

  liveCatalog.replace([{ ...englishLeague, clubs: englishLeague.clubs.slice(0, 2) }]);
  const repaired = await store.requireMembership(legacyRoom.code, "manager-che");
  assert.equal(repaired.fixtureSchedule.length, 2);
  assert.equal(repaired.fixtureSchedule[0].competition, "Liga Inglesa");
  assert.equal(repaired.competitionCatalog[0].clubs.length, 2);
  assert.equal(repaired.scheduleIssue, null);
});

test("cada liga inicia sua propria primeira rodada", async () => {
  const catalog = structuredClone(competitionCatalog);
  catalog[1].clubs.push({
    id: "FLA", name: "Flamengo", code: "FLA", color: "#d71920", reputation: 17,
    crestImageUrl: null, leagueId: "BR-A",
  });
  const store = new RoomStore({
    persistence: new MemoryRoomPersistence(),
    catalogStore: { async listCompetitionCatalog() { return structuredClone(catalog); } },
    codeFactory: () => "BOLA-MULT",
  });
  const room = await store.createRoom({
    name: "Duas ligas",
    creatorId: "manager-che",
    creatorName: "Emanuel",
    clubId: "CHE",
    activeLeagues: ["ENG-PL", "BR-A"],
    seasonLength: 1,
    maxManagers: 2,
  });
  await store.joinRoom(room.code, { managerId: "manager-pal", managerName: "Outro", clubId: "PAL" });
  await store.setReady(room.code, "manager-che", true, "CHE");
  await store.setReady(room.code, "manager-pal", true, "PAL");
  const started = await store.startRoom(room.code, "manager-che");
  const firstByLeague = new Map();
  for (const fixture of started.fixtureSchedule) {
    if (!firstByLeague.has(fixture.leagueId)) firstByLeague.set(fixture.leagueId, fixture);
  }

  assert.equal(firstByLeague.get("ENG-PL").round, 1);
  assert.equal(firstByLeague.get("BR-A").round, 1);
});
