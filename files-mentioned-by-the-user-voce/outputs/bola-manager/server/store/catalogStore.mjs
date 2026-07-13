import { calculateStarImpact, sortPlayersForSelection } from "../game/starImpact.mjs";
import { tournamentConsistencySchema } from "../editorSchemas.mjs";

const COLLECTIONS = Object.freeze({
  leagues: "brasfootLeagues",
  clubs: "brasfootClubs",
  players: "brasfootPlayers",
  tournaments: "tournaments",
});

const MEDIA_FIELDS = Object.freeze({
  clubs: Object.freeze({ url: "crestImageUrl", path: "crestImagePath" }),
  players: Object.freeze({ url: "avatarImageUrl", path: "avatarImagePath" }),
  tournaments: Object.freeze({ url: "trophyImageUrl", path: "trophyImagePath" }),
});

const AURORA_DEMO_STARS = Object.freeze([
  { id: "p08", clubId: "AUR", name: "Igor Sampaio", active: true, isStar: true },
  { id: "p10", clubId: "AUR", name: "Felipe Rocha", active: true, isStar: true },
]);
const EDITOR_PAGE_LIMIT = 50;

export class CatalogStoreError extends Error {
  constructor(message, code, status = 400, details) {
    super(message);
    this.name = "CatalogStoreError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function unavailableError() {
  return new CatalogStoreError(
    "Editor indisponivel sem Firestore configurado",
    "EDITOR_CATALOG_UNAVAILABLE",
    503,
  );
}

function notFoundError(entity, id) {
  return new CatalogStoreError(
    `Registro nao encontrado: ${entity}/${id}`,
    "EDITOR_RECORD_NOT_FOUND",
    404,
  );
}

function invalidCursorError() {
  return new CatalogStoreError("Cursor de paginacao invalido", "EDITOR_CURSOR_INVALID", 400);
}

function encodeCursor({ entity, id, query = null, clubId = null }) {
  return Buffer.from(JSON.stringify({ entity, id, query, clubId }), "utf8").toString("base64url");
}

function decodeCursor(value, expected) {
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object"
      || typeof parsed.id !== "string"
      || parsed.entity !== expected.entity
      || (parsed.query ?? null) !== (expected.query ?? null)
      || (parsed.clubId ?? null) !== (expected.clubId ?? null)) {
      throw invalidCursorError();
    }
    return parsed;
  } catch (error) {
    if (error instanceof CatalogStoreError) throw error;
    throw invalidCursorError();
  }
}

function snapshotRecord(document, entity) {
  const record = { ...document.data(), id: document.id };
  return entity === "players" ? { ...record, isStar: record.isStar === true } : record;
}

function sortRecords(records) {
  return records.sort((left, right) => (
    String(left.name ?? left.id).localeCompare(String(right.name ?? right.id), "pt-BR")
  ));
}

function tournamentParticipant(record) {
  return {
    id: record.id,
    name: record.name,
    abbreviation: record.abbreviation ?? "",
    colors: Array.isArray(record.colors) ? record.colors : [],
    country: record.country ?? null,
    division: record.division ?? null,
    crestImageUrl: record.crestImageUrl ?? null,
    crestImagePath: record.crestImagePath ?? null,
  };
}

function publicTournament(record, participantsById) {
  const teamIds = Array.isArray(record.teamIds) ? record.teamIds : [];
  return {
    id: record.id,
    name: record.name,
    format: record.format,
    teamCount: record.teamCount,
    legs: record.legs,
    tiebreakers: Array.isArray(record.tiebreakers) ? record.tiebreakers : [],
    teamIds,
    trophyImageUrl: record.trophyImageUrl ?? null,
    trophyImagePath: record.trophyImagePath ?? null,
    active: true,
    participants: teamIds.map((id) => participantsById.get(id)).filter(Boolean),
  };
}

export class CatalogStore {
  constructor({ firestore = null, now = () => new Date() } = {}) {
    this.firestore = firestore;
    this.now = now;
  }

  get source() {
    return this.firestore ? "firestore" : "brasfoot-not-loaded";
  }

  async list({ limit = EDITOR_PAGE_LIMIT } = {}) {
    this.#assertAvailable();
    const pages = await Promise.all(Object.keys(COLLECTIONS).map((entity) => this.listPage(entity, { limit })));
    const catalog = Object.fromEntries(pages.map((page) => [page.entity, page.records]));
    catalog.meta = Object.fromEntries(pages.map(({ entity, records: _records, ...metadata }) => [entity, metadata]));
    return catalog;
  }

  async listPage(entityValue, {
    limit = EDITOR_PAGE_LIMIT,
    cursor = null,
    query: searchQuery = null,
    clubId: clubIdValue = null,
  } = {}) {
    const entity = String(entityValue);
    const collection = this.#collection(entity);
    const pageLimit = Math.max(1, Math.min(200, Number(limit) || EDITOR_PAGE_LIMIT));
    const query = searchQuery ? String(searchQuery).trim() : null;
    const clubId = clubIdValue ? this.#validId(clubIdValue) : null;
    if (clubId && entity !== "players") {
      throw new CatalogStoreError("clubId so pode filtrar jogadores", "EDITOR_FILTER_INVALID", 400);
    }

    let baseQuery = collection;
    if (clubId) baseQuery = baseQuery.where("clubId", "==", clubId);
    baseQuery = baseQuery.orderBy("name");
    let filteredQuery = baseQuery;
    if (query) filteredQuery = filteredQuery.startAt(query).endAt(`${query}\uf8ff`);

    const aggregate = typeof filteredQuery.count === "function" ? await filteredQuery.count().get() : null;
    const count = aggregate ? Number(aggregate.data().count) : null;
    let pageQuery = baseQuery;
    if (cursor) {
      const decoded = decodeCursor(cursor, { entity, query, clubId });
      const cursorDocument = await collection.doc(decoded.id).get();
      if (!cursorDocument.exists) throw invalidCursorError();
      pageQuery = pageQuery.startAfter(cursorDocument);
    } else if (query) {
      pageQuery = pageQuery.startAt(query);
    }
    if (query) pageQuery = pageQuery.endAt(`${query}\uf8ff`);
    const snapshot = await pageQuery.limit(pageLimit + 1).get();
    const hasMore = snapshot.docs.length > pageLimit;
    const documents = snapshot.docs.slice(0, pageLimit);
    const records = documents.map((document) => snapshotRecord(document, entity));
    const nextCursor = hasMore && documents.length > 0
      ? encodeCursor({ entity, id: documents.at(-1).id, query, clubId })
      : null;
    return {
      entity,
      records,
      count,
      returned: records.length,
      limit: pageLimit,
      nextCursor,
      hasMore,
      filters: { query, clubId },
    };
  }

  async listActiveTournaments() {
    if (!this.firestore) return { tournaments: [], count: 0, source: this.source };
    const tournamentsSnapshot = await this.firestore
      .collection(COLLECTIONS.tournaments)
      .where("active", "==", true)
      .get();
    const tournamentRecords = tournamentsSnapshot.docs
      .map((document) => snapshotRecord(document, "tournaments"));
    const participantIds = [...new Set(tournamentRecords.flatMap((record) => (
      Array.isArray(record.teamIds) ? record.teamIds : []
    )))];
    const references = participantIds.map((id) => this.firestore.collection(COLLECTIONS.clubs).doc(id));
    const participantDocuments = references.length === 0
      ? []
      : typeof this.firestore.getAll === "function"
        ? await this.firestore.getAll(...references)
        : await Promise.all(references.map((reference) => reference.get()));
    const participantsById = new Map(participantDocuments
      .filter((document) => document.exists && document.data().active === true)
      .map((document) => {
        const club = snapshotRecord(document, "clubs");
        return [club.id, tournamentParticipant(club)];
      }));
    const tournaments = sortRecords(tournamentRecords.map((record) => publicTournament(record, participantsById)));
    return { tournaments, count: tournaments.length, source: "firestore" };
  }

  async get(entity, idValue) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const current = await collection.doc(id).get();
    if (!current.exists) throw notFoundError(entity, id);
    return snapshotRecord(current, entity);
  }

  async create(entity, input, updatedBy) {
    const collection = this.#collection(entity);
    const id = this.#validId(input?.id);
    const reference = collection.doc(id);
    const timestamp = this.now().toISOString();
    const record = {
      ...input,
      ...(entity === "players" ? { isStar: input?.isStar === true } : {}),
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      updatedBy,
    };
    this.#assertRecordConsistency(entity, record);

    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (current.exists) {
        throw new CatalogStoreError(
          `Ja existe um registro com o ID ${id}`,
          "EDITOR_RECORD_EXISTS",
          409,
        );
      }
      await this.#assertReferences(transaction, entity, record);
      transaction.set(reference, record);
    });
    return { ...record };
  }

  async getStarImpact(clubIdValue, { lineupIds } = {}) {
    const clubId = this.#validId(clubIdValue);
    if (!this.firestore) {
      return { ...calculateStarImpact(clubId, [], { lineupIds }), source: this.source };
    }
    const snapshot = await this.firestore
      .collection(COLLECTIONS.players)
      .where("clubId", "==", clubId)
      .get();
    const players = snapshot.docs.map((document) => snapshotRecord(document, "players"));
    if (clubId === "AUR" && players.length === 0) {
      return {
        ...calculateStarImpact(clubId, AURORA_DEMO_STARS, { lineupIds }),
        source: "demo-fallback",
      };
    }
    return { ...calculateStarImpact(clubId, players, { lineupIds }), source: "firestore" };
  }

  async listPlayers(clubIdValue) {
    const clubId = this.#validId(clubIdValue);
    if (!this.firestore) {
      return { players: [], count: 0, source: this.source };
    }
    const snapshot = await this.firestore
      .collection(COLLECTIONS.players)
      .where("clubId", "==", clubId)
      .get();
    const players = sortPlayersForSelection(snapshot.docs
      .map((document) => snapshotRecord(document, "players"))
      .filter((player) => player.active !== false));
    return {
      players,
      count: players.length,
      source: clubId === "AUR" && snapshot.docs.length === 0 ? "demo-fallback" : "firestore",
    };
  }

  async update(entity, idValue, changes, updatedBy) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    if (Object.hasOwn(changes ?? {}, "id")) {
      throw new CatalogStoreError("O ID do registro e imutavel", "EDITOR_ID_IMMUTABLE", 400);
    }
    const reference = collection.doc(id);
    let result;

    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      result = {
        ...existing,
        ...changes,
        id,
        createdAt: existing.createdAt ?? timestamp,
        updatedAt: timestamp,
        updatedBy,
      };
      this.#assertRecordConsistency(entity, result);
      await this.#assertReferences(transaction, entity, result);
      if (entity === "clubs" && result.active === false) {
        await this.#assertClubNotInActiveTournament(transaction, id);
      }
      const persistedChanges = {
        ...changes,
        ...(existing.createdAt ? {} : { createdAt: result.createdAt }),
        updatedAt: result.updatedAt,
        updatedBy,
      };
      transaction.update(reference, persistedChanges);
    });
    return { ...result };
  }

  async associateMedia(entity, idValue, media, updatedBy) {
    const fields = MEDIA_FIELDS[entity];
    if (!fields) {
      throw new CatalogStoreError("Entidade nao aceita imagem", "EDITOR_MEDIA_ENTITY_INVALID", 400);
    }
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);
    let result;
    let previousPath = null;

    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      previousPath = existing[fields.path] ?? null;
      const changes = {
        [fields.url]: media.url,
        [fields.path]: media.path,
        updatedAt: timestamp,
        updatedBy,
      };
      result = { ...existing, ...changes, id };
      transaction.update(reference, changes);
    });

    return { record: { ...result }, previousPath };
  }

  async clearMedia(entity, idValue, updatedBy) {
    const fields = MEDIA_FIELDS[entity];
    if (!fields) {
      throw new CatalogStoreError("Entidade nao aceita imagem", "EDITOR_MEDIA_ENTITY_INVALID", 400);
    }
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);
    let result;
    let previousPath = null;

    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const existing = snapshotRecord(current, entity);
      const timestamp = this.now().toISOString();
      previousPath = existing[fields.path] ?? null;
      const changes = {
        [fields.url]: null,
        [fields.path]: null,
        updatedAt: timestamp,
        updatedBy,
      };
      result = { ...existing, ...changes, id };
      transaction.update(reference, changes);
    });

    return { record: { ...result }, previousPath };
  }

  async delete(entity, idValue) {
    const collection = this.#collection(entity);
    const id = this.#validId(idValue);
    const reference = collection.doc(id);

    let previousPath = null;
    await this.firestore.runTransaction(async (transaction) => {
      const current = await transaction.get(reference);
      if (!current.exists) throw notFoundError(entity, id);
      const mediaFields = MEDIA_FIELDS[entity];
      previousPath = mediaFields ? current.data()?.[mediaFields.path] ?? null : null;
      if (entity === "leagues") {
        await this.#assertNoDependents(
          transaction,
          "clubs",
          "leagueId",
          id,
          "EDITOR_LEAGUE_IN_USE",
          "Arquive a liga: ainda existem clubes vinculados a ela",
        );
      } else if (entity === "clubs") {
        await this.#assertNoDependents(
          transaction,
          "tournaments",
          "teamIds",
          id,
          "EDITOR_CLUB_IN_TOURNAMENT",
          "Remova o clube dos torneios antes de exclui-lo",
          "array-contains",
        );
        await this.#assertNoDependents(
          transaction,
          "players",
          "clubId",
          id,
          "EDITOR_CLUB_IN_USE",
          "Arquive o clube: ainda existem jogadores vinculados a ele",
        );
      }
      transaction.delete(reference);
    });
    return { deleted: true, id, previousPath };
  }

  #assertAvailable() {
    if (!this.firestore) throw unavailableError();
  }

  #collection(entity) {
    this.#assertAvailable();
    const collectionName = COLLECTIONS[entity];
    if (!collectionName) {
      throw new CatalogStoreError("Entidade do editor invalida", "EDITOR_ENTITY_INVALID", 400);
    }
    return this.firestore.collection(collectionName);
  }

  #validId(value) {
    const id = String(value ?? "").trim();
    if (!id || id.length > 128 || id.includes("/")) {
      throw new CatalogStoreError("ID de registro invalido", "EDITOR_ID_INVALID", 400);
    }
    return id;
  }

  async #assertReferences(transaction, entity, record) {
    if (entity === "tournaments") {
      const clubIds = record.teamIds ?? [];
      const references = clubIds.map((clubId) => this.#collection("clubs").doc(this.#validId(clubId)));
      const targets = references.length === 0
        ? []
        : typeof transaction.getAll === "function"
          ? await transaction.getAll(...references)
          : await Promise.all(references.map((reference) => transaction.get(reference)));
      for (let index = 0; index < targets.length; index += 1) {
        const clubId = clubIds[index];
        const target = targets[index];
        if (!target.exists) {
          throw new CatalogStoreError(
            `Referencia inexistente: clubs/${clubId}`,
            "EDITOR_REFERENCE_NOT_FOUND",
            409,
          );
        }
        if (record.active === true && target.data()?.active !== true) {
          throw new CatalogStoreError(
            `Torneio ativo referencia clube inativo: ${clubId}`,
            "EDITOR_TOURNAMENT_CLUB_INACTIVE",
            409,
            { clubId },
          );
        }
      }
      return;
    }
    let targetEntity;
    let targetId;
    if (entity === "clubs" && record.leagueId) {
      targetEntity = "leagues";
      targetId = record.leagueId;
    } else if (entity === "players" && record.clubId) {
      targetEntity = "clubs";
      targetId = record.clubId;
    } else {
      return;
    }
    const reference = this.#collection(targetEntity).doc(this.#validId(targetId));
    const target = await transaction.get(reference);
    if (!target.exists) {
      throw new CatalogStoreError(
        `Referencia inexistente: ${targetEntity}/${targetId}`,
        "EDITOR_REFERENCE_NOT_FOUND",
        409,
      );
    }
  }

  #assertRecordConsistency(entity, record) {
    if (entity !== "tournaments") return;
    const result = tournamentConsistencySchema.safeParse(record);
    if (!result.success) {
      throw new CatalogStoreError(
        "Configuracao de torneio invalida",
        "EDITOR_TOURNAMENT_INVALID",
        400,
        result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
  }

  async #assertNoDependents(transaction, entity, field, id, code, message, operator = "==") {
    const query = this.#collection(entity).where(field, operator, id).limit(1);
    const snapshot = await transaction.get(query);
    if (!snapshot.empty) throw new CatalogStoreError(message, code, 409);
  }

  async #assertClubNotInActiveTournament(transaction, id) {
    const query = this.#collection("tournaments")
      .where("teamIds", "array-contains", id)
      .where("active", "==", true)
      .limit(1);
    const snapshot = await transaction.get(query);
    if (!snapshot.empty) {
      throw new CatalogStoreError(
        "Arquive o torneio ativo antes de arquivar este clube",
        "EDITOR_CLUB_IN_ACTIVE_TOURNAMENT",
        409,
      );
    }
  }
}
