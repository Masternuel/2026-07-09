import { randomInt, randomUUID } from "node:crypto";
import { nextFixtureId } from "../game/fixtures.mjs";

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

  async createRoom({ name, creatorId, creatorName, clubId, activeLeagues, seasonLength, maxManagers }) {
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
        maxManagers,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        revision: 1,
        version: 1,
        currentFixtureId: "abertura",
        completedFixtureIds: [],
        completedMatches: [],
        lastCompletedMatch: null,
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

  async joinRoom(code, { managerId, managerName, clubId }) {
    return this.#mutate(code, (room) => {
      const existing = room.managers.find((manager) => manager.id === managerId);
      if (existing) {
        if (room.status !== "waiting") return undefined;
        if (clubId) this.#assertClubAvailable(room, clubId, managerId);
        existing.name = managerName;
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
        manager.clubId = clubId;
      }
      if (ready && !manager.clubId) {
        throw new RoomError("Escolha um clube antes de confirmar", "CLUB_REQUIRED", 409);
      }
      manager.ready = ready;
      return room;
    });
  }

  async startRoom(code, managerId) {
    return this.#mutate(code, (room) => {
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
      current.completedFixtureIds ??= [];
      current.completedMatches ??= [];
      if (current.completedFixtureIds.includes(fixtureId)) {
        throw new RoomError("Esta fixture ja foi concluida", "FIXTURE_ALREADY_COMPLETED", 409);
      }
      if (current.currentFixtureId !== fixtureId) {
        throw new RoomError("Esta fixture nao e a atual", "FIXTURE_NOT_CURRENT", 409);
      }
      const upcomingFixtureId = nextFixtureId(fixtureId);
      const summary = {
        id: result.id,
        fixtureId,
        homeTeam: result.homeTeam,
        awayTeam: result.awayTeam,
        score: structuredClone(result.score),
        statistics: structuredClone(result.statistics),
        skipped: Boolean(result.skipped),
        completedAt: this.#now().toISOString(),
        roomRevision: (current.revision || current.version || 0) + 1,
        nextFixtureId: upcomingFixtureId,
      };
      current.completedFixtureIds.push(fixtureId);
      current.completedMatches.push(summary);
      current.lastCompletedMatch = summary;
      current.currentFixtureId = upcomingFixtureId;
      return current;
    });
    return { room, summary: this.#snapshot(room.lastCompletedMatch) };
  }

  #assertClubAvailable(room, clubId, managerId) {
    const normalized = clubId.toUpperCase();
    const holder = room.managers.find(
      (manager) => manager.id !== managerId && manager.clubId?.toUpperCase() === normalized,
    );
    if (holder) throw new RoomError("Este clube ja foi escolhido", "CLUB_UNAVAILABLE", 409);
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
    return structuredClone(room);
  }
}
