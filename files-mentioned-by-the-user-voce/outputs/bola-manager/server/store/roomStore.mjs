import { randomInt, randomUUID } from "node:crypto";
import {
  createFixtureSchedule,
  ensureFixtureSchedule,
  FIXTURE_SCHEDULE_VERSION,
  fixtureIdsEqual,
  nextFixtureId,
} from "../game/fixtures.mjs";
import { careerHasNextSeason, ensureCareerState } from "../game/career.mjs";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function defaultCodeFactory() {
  let suffix = "";
  for (let index = 0; index < 4; index += 1) {
    suffix += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return `BOLA-${suffix}`;
}

export class RoomError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = "RoomError";
    this.code = code;
    this.status = status;
  }
}

export class RoomStore {
  #persistence;
  #codeFactory;
  #now;

  constructor({ persistence, codeFactory = defaultCodeFactory, now = () => new Date() } = {}) {
    if (!persistence) throw new Error("RoomStore requer uma camada de persistencia explicita");
    this.#persistence = persistence;
    this.#codeFactory = codeFactory;
    this.#now = now;
  }

  async createRoom({
    name,
    creatorId,
    creatorName,
    clubId,
    activeLeagues,
    seasonLength,
    unlimitedSeasons = false,
    maxManagers,
  }) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = this.#normalizeCode(this.#codeFactory());
      const createdAt = this.#now().toISOString();
      const room = {
        id: randomUUID(),
        code,
        name,
        ownerId: creatorId,
        status: "waiting",
        activeLeagues: [...activeLeagues],
        seasonLength,
        unlimitedSeasons,
        currentSeason: 1,
        seasonYear: new Date(createdAt).getUTCFullYear(),
        seasonStartedAt: createdAt,
        seasonHistory: [],
        careerCompleted: false,
        careerCompletedAt: null,
        maxManagers,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        revision: 1,
        version: 1,
        currentFixtureId: null,
        fixtureSchedule: [],
        matchReadiness: { fixtureId: null, managerIds: [] },
        completedFixtureIds: [],
        completedMatches: [],
        lastCompletedMatch: null,
        lineups: [],
        managerIds: [creatorId],
        managers: [{
          id: creatorId,
          name: creatorName,
          clubId: clubId ?? null,
          ready: false,
          joinedAt: createdAt,
        }],
      };
      if (await this.#persistence.create(room)) return this.#snapshot(room);
    }
    throw new RoomError("Nao foi possivel gerar o codigo da sala", "CODE_EXHAUSTED", 503);
  }

  async listRoomsForManager(managerId) {
    const rooms = await this.#persistence.listByManager(managerId);
    return rooms.map((room) => this.#snapshot(room));
  }

  async getRoom(code) {
    const room = await this.#persistence.get(this.#normalizeCode(code));
    return room ? this.#snapshot(room) : null;
  }

  async requireRoom(code) {
    const room = await this.#persistence.get(this.#normalizeCode(code));
    if (!room) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    return room;
  }

  async requireMembership(code, managerId) {
    const room = await this.requireRoom(code);
    if (!room.managerIds.includes(managerId)) {
      throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
    }
    return this.#snapshot(room);
  }

  async requireOwnership(code, managerId) {
    const room = await this.requireMembership(code, managerId);
    if (room.ownerId !== managerId) {
      throw new RoomError("Somente o criador pode excluir a temporada", "OWNER_REQUIRED", 403);
    }
    return room;
  }

  async deleteRoom(code, managerId) {
    const normalizedCode = this.#normalizeCode(code);
    const room = await this.#persistence.remove(normalizedCode, (current) => {
      if (!current || !current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.ownerId !== managerId) {
        throw new RoomError("Somente o criador pode excluir a temporada", "OWNER_REQUIRED", 403);
      }
    });
    return this.#snapshot(room);
  }

  async joinRoom(code, { managerId, managerName, clubId }) {
    return this.#mutate(code, (room) => {
      const existing = room.managers.find((manager) => manager.id === managerId);
      if (existing) {
        if (room.status !== "waiting") return undefined;
        if (clubId) this.#assertClubAvailable(room, clubId, managerId);
        existing.name = managerName;
        if (clubId && !this.#clubIdsEqual(existing.clubId, clubId)) this.#removeLineup(room, managerId);
        existing.clubId = clubId ?? existing.clubId;
        return room;
      }
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      if (room.managers.length >= room.maxManagers) {
        throw new RoomError("A sala atingiu o limite de managers", "ROOM_FULL", 409);
      }
      if (clubId) this.#assertClubAvailable(room, clubId, managerId);
      room.managers.push({
        id: managerId,
        name: managerName,
        clubId: clubId ?? null,
        ready: false,
        joinedAt: this.#now().toISOString(),
      });
      room.managerIds.push(managerId);
      return room;
    });
  }

  async setReady(code, managerId, ready = true, clubId) {
    return this.#mutate(code, (room) => {
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      if (clubId) {
        this.#assertClubAvailable(room, clubId, managerId);
        if (!this.#clubIdsEqual(manager.clubId, clubId)) this.#removeLineup(room, managerId);
        manager.clubId = clubId;
      }
      if (ready && !manager.clubId) {
        throw new RoomError("Escolha um clube antes de confirmar", "CLUB_REQUIRED", 409);
      }
      manager.ready = ready;
      return room;
    });
  }

  async setMatchReady(code, managerId, ready = true, fixtureId) {
    let migratedDuringTransaction = false;
    return this.#mutate(code, (room) => {
      if (room.status !== "active") {
        throw new RoomError("Inicie a temporada antes de confirmar a partida", "ROOM_NOT_ACTIVE", 409);
      }
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      ensureCareerState(room, this.#now());
      const migrated = ensureFixtureSchedule(room);
      migratedDuringTransaction = migratedDuringTransaction || migrated;
      if (!room.currentFixtureId) {
        throw new RoomError("A temporada nao possui partidas pendentes", "NO_PENDING_FIXTURE", 409);
      }
      const targetFixtureId = migratedDuringTransaction ? room.currentFixtureId : fixtureId || room.currentFixtureId;
      if (!fixtureIdsEqual(targetFixtureId, room.currentFixtureId)) {
        throw new RoomError("Esta fixture nao e a atual", "FIXTURE_NOT_CURRENT", 409);
      }
      const canonicalFixtureId = room.currentFixtureId;
      if (!fixtureIdsEqual(room.matchReadiness?.fixtureId, canonicalFixtureId)) {
        room.matchReadiness = { fixtureId: canonicalFixtureId, managerIds: [] };
      }
      const readyIds = new Set(room.matchReadiness.managerIds);
      if (ready) readyIds.add(managerId);
      else readyIds.delete(managerId);
      room.matchReadiness.managerIds = [...readyIds];
      return room;
    });
  }

  async saveLineup(code, managerId, clubId, lineupIds) {
    return this.#mutate(code, (room) => {
      const manager = room.managers.find((candidate) => candidate.id === managerId);
      if (!manager) throw new RoomError("Manager nao pertence a sala", "MANAGER_NOT_FOUND", 404);
      if (!manager.clubId) throw new RoomError("Escolha um clube antes de escalar", "CLUB_REQUIRED", 409);
      if (!this.#clubIdsEqual(manager.clubId, clubId)) {
        throw new RoomError("Clube da escalacao mudou", "LINEUP_CLUB_CHANGED", 409);
      }
      room.lineups = Array.isArray(room.lineups) ? room.lineups : [];
      this.#removeLineup(room, managerId);
      const lineup = {
        managerId,
        clubId: manager.clubId,
        lineupIds: [...lineupIds],
        updatedAt: this.#now().toISOString(),
      };
      room.lineups.push(lineup);
      if (Array.isArray(room.matchReadiness?.managerIds)) {
        room.matchReadiness.managerIds = room.matchReadiness.managerIds
          .filter((readyManagerId) => readyManagerId !== managerId);
      }
      return room;
    });
  }

  async prepareMatch(code, managerId, requestedFixtureId) {
    let migrated = false;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      const careerChanged = ensureCareerState(current, this.#now());
      const fixtureChanged = ensureFixtureSchedule(current);
      const changed = careerChanged || fixtureChanged;
      migrated ||= changed;
      return changed ? current : undefined;
    });
    return {
      room,
      migrated,
      fixtureId: migrated ? room.currentFixtureId : requestedFixtureId,
    };
  }

  async startRoom(code, managerId) {
    return this.#mutate(code, (room) => {
      ensureCareerState(room, this.#now());
      if (room.ownerId !== managerId) {
        throw new RoomError("Somente o criador pode iniciar a temporada", "OWNER_REQUIRED", 403);
      }
      if (room.status !== "waiting") {
        throw new RoomError("A temporada desta sala ja comecou", "ROOM_ALREADY_STARTED", 409);
      }
      if (room.managers.length === 0 || room.managers.some((manager) => !manager.ready)) {
        throw new RoomError("Todos os managers precisam estar prontos", "MANAGERS_NOT_READY", 409);
      }
      room.status = "active";
      room.startedAt = this.#now().toISOString();
      room.seasonStartedAt = room.startedAt;
      room.careerCompleted = false;
      room.careerCompletedAt = null;
      room.fixtureSchedule = createFixtureSchedule(room);
      room.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
      room.currentFixtureId = room.fixtureSchedule[0]?.fixtureId ?? null;
      room.matchReadiness = { fixtureId: room.currentFixtureId, managerIds: [] };
      return room;
    });
  }

  async hasManager(code, managerId) {
    const room = await this.requireRoom(code);
    return room.managerIds.includes(managerId);
  }

  async completeMatch(code, fixtureId, result) {
    const room = await this.#mutate(code, (current) => {
      if (current.status !== "active") {
        throw new RoomError("A sala nao esta ativa", "ROOM_NOT_ACTIVE", 409);
      }
      ensureCareerState(current, this.#now());
      current.completedFixtureIds ??= [];
      current.completedMatches ??= [];
      if (current.completedFixtureIds.some((completedId) => fixtureIdsEqual(completedId, fixtureId))) {
        throw new RoomError("Esta fixture ja foi concluida", "FIXTURE_ALREADY_COMPLETED", 409);
      }
      if (!fixtureIdsEqual(current.currentFixtureId, fixtureId)) {
        throw new RoomError("Esta fixture nao e a atual", "FIXTURE_NOT_CURRENT", 409);
      }
      const canonicalFixtureId = current.fixtureSchedule?.find(
        (fixture) => fixtureIdsEqual(fixture.fixtureId, fixtureId),
      )?.fixtureId ?? current.currentFixtureId;
      const upcomingFixtureId = nextFixtureId(current, canonicalFixtureId);
      const completedAt = this.#now().toISOString();
      const summary = {
        code: current.code,
        id: result.id,
        fixtureId: canonicalFixtureId,
        homeTeam: result.homeTeam,
        awayTeam: result.awayTeam,
        score: structuredClone(result.score),
        statistics: structuredClone(result.statistics),
        ...(result.starImpact ? { starImpact: structuredClone(result.starImpact) } : {}),
        ...(result.strengthProfile ? { strengthProfile: structuredClone(result.strengthProfile) } : {}),
        skipped: Boolean(result.skipped),
        completedAt,
        seasonNumber: current.currentSeason,
        seasonYear: current.seasonYear,
        roomRevision: (current.revision || current.version || 0) + 1,
        nextFixtureId: upcomingFixtureId,
      };
      current.completedFixtureIds.push(canonicalFixtureId);
      current.completedMatches.push(summary);
      current.lastCompletedMatch = summary;
      current.currentFixtureId = upcomingFixtureId;
      current.matchReadiness = { fixtureId: upcomingFixtureId, managerIds: [] };

      if (!upcomingFixtureId) {
        const seasonNumber = current.currentSeason;
        current.seasonHistory.push({
          seasonNumber,
          seasonYear: current.seasonYear,
          startedAt: current.seasonStartedAt,
          completedAt,
          completedFixtureIds: [...current.completedFixtureIds],
          matchIds: current.completedMatches
            .filter((match) => (match.seasonNumber ?? seasonNumber) === seasonNumber)
            .map((match) => match.id),
        });
        if (careerHasNextSeason(current)) {
          current.currentSeason += 1;
          current.seasonYear += 1;
          current.seasonStartedAt = completedAt;
          current.completedFixtureIds = [];
          current.fixtureSchedule = createFixtureSchedule(current);
          current.scheduleVersion = FIXTURE_SCHEDULE_VERSION;
          current.currentFixtureId = current.fixtureSchedule[0]?.fixtureId ?? null;
          current.matchReadiness = { fixtureId: current.currentFixtureId, managerIds: [] };
          current.lineups = [];
          current.careerCompleted = false;
          current.careerCompletedAt = null;
          summary.nextFixtureId = current.currentFixtureId;
          summary.nextSeasonNumber = current.currentSeason;
          summary.nextSeasonYear = current.seasonYear;
        } else {
          current.careerCompleted = true;
          current.careerCompletedAt = completedAt;
        }
      }
      return current;
    });
    return { room, summary: this.#snapshot(room.lastCompletedMatch) };
  }

  #assertClubAvailable(room, clubId, managerId) {
    const comparisonId = clubId.toLocaleUpperCase("pt-BR");
    const holder = room.managers.find(
      (manager) => manager.id !== managerId
        && manager.clubId?.toLocaleUpperCase("pt-BR") === comparisonId,
    );
    if (holder) throw new RoomError("Este clube ja foi escolhido", "CLUB_UNAVAILABLE", 409);
  }

  #clubIdsEqual(left, right) {
    return String(left ?? "").trim().toLocaleUpperCase("pt-BR")
      === String(right ?? "").trim().toLocaleUpperCase("pt-BR");
  }

  #removeLineup(room, managerId) {
    if (!Array.isArray(room.lineups)) room.lineups = [];
    else room.lineups = room.lineups.filter((lineup) => lineup.managerId !== managerId);
  }

  async #mutate(code, mutation) {
    const normalizedCode = this.#normalizeCode(code);
    const room = await this.#persistence.mutate(normalizedCode, (current) => {
      if (!current) throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      const next = mutation(current);
      if (next === undefined) return undefined;
      next.revision = (next.revision || next.version || 0) + 1;
      next.version = next.revision;
      next.updatedAt = this.#now().toISOString();
      return next;
    });
    return this.#snapshot(room);
  }

  #normalizeCode(code) {
    return String(code).trim().toUpperCase();
  }

  #snapshot(room) {
    const snapshot = structuredClone(room);
    if (snapshot && Array.isArray(snapshot.managers)) ensureCareerState(snapshot, this.#now());
    return snapshot;
  }
}
