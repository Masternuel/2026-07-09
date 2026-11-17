// Transfer market use cases (audit Q-02): snapshot, offers, listings, bids,
// cancellations and loan options. RoomStore keeps the public methods and
// delegates here; storage, clock and catalog are injected.
import { syncMarketCareerSideEffects } from "../game/clubCareerSystem.mjs";
import {
  cancelListing as cancelMarketListing,
  createListing as createMarketListing,
  createOffer as createMarketOffer,
  exerciseLoanOption as exerciseMarketLoanOption,
  marketSnapshot,
  placeBid as placeMarketBid,
  registrationForPlayer as marketRegistrationForPlayer,
  respondOffer as respondMarketOffer,
  settleExpiredMarket,
} from "../game/market.mjs";
import { listRoomPlayers } from "../game/roomRoster.mjs";
import { catalogForOwner } from "./catalogScope.mjs";
import { RoomError } from "./roomError.mjs";
import { clubKey } from "./roomKeys.mjs";
import {
  assertMarketRoomActive,
  assertNoticeLongTermDecisionApproved,
  careerPlayerCanEnterMarket,
  careerPlayerIsFreeAgent,
  managedClubFor,
} from "./roomGuards.mjs";

function marketOutcomeForViewer(snapshot, outcome = {}) {
  const listingId = outcome.listing?.id ?? null;
  const offerId = outcome.offer?.id ?? null;
  const transactionId = outcome.transaction?.id ?? null;
  return {
    snapshot,
    revision: snapshot.revision,
    ...(listingId ? { listing: snapshot.listings.find((item) => item.id === listingId) ?? null } : {}),
    ...(offerId ? { offer: snapshot.offers.find((item) => item.id === offerId) ?? null } : {}),
    ...(transactionId
      ? { transaction: snapshot.transactions.find((item) => item.id === transactionId) ?? null }
      : {}),
    ...(outcome.cancelled ? { cancelled: true } : {}),
  };
}

export class MarketService {
  #store;
  #mutate;
  #now;
  #catalogStore;

  constructor({ store, mutate, now, catalogStore }) {
    this.#store = store;
    this.#mutate = mutate;
    this.#now = now;
    this.#catalogStore = catalogStore;
  }

  async getMarketSnapshot(code, managerId, { withMetadata = false } = {}) {
    let settlementChanged = false;
    const room = await this.#mutate(code, (current) => {
      if (!current.managerIds.includes(managerId)) {
        throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
      }
      if (current.status !== "active") {
        throw new RoomError("Inicie a temporada antes de usar o mercado", "MARKET_ROOM_NOT_ACTIVE", 409);
      }
      const hadState = Boolean(current.marketState);
      const settlement = settleExpiredMarket(current, this.#now());
      const beforeSideEffects = JSON.stringify(current.clubCareerState ?? null);
      syncMarketCareerSideEffects(current);
      const sideEffectsChanged = beforeSideEffects !== JSON.stringify(current.clubCareerState ?? null);
      // Firestore pode repetir o callback transacional; o ultimo snapshot lido
      // determina se esta sincronizacao realmente liquidou algo.
      settlementChanged = settlement.changed;
      return !hadState || settlement.changed || sideEffectsChanged ? current : undefined;
    });
    const snapshot = await this.#marketSnapshotFor(room, managerId);
    return withMetadata ? { snapshot, settlementChanged } : snapshot;
  }

  async createMarketOffer(code, managerId, input) {
    const preview = await this.#store.requireMembership(code, managerId);
    const player = await this.#loadMarketPlayer(preview, input.playerId);
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta proposta de mercado");
      outcome = createMarketOffer(current, managerId, input, player, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async respondMarketOffer(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      if (["accept", "counter"].includes(input.action)) {
        const clubId = managedClubFor(current, managerId);
        assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta negociação");
      }
      outcome = respondMarketOffer(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async createMarketListing(code, managerId, input) {
    const preview = await this.#store.requireMembership(code, managerId);
    const player = await this.#loadMarketPlayer(preview, input.playerId);
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "este anúncio de jogador");
      outcome = createMarketListing(current, managerId, input, player, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async placeMarketBid(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "este lance");
      outcome = placeMarketBid(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async cancelMarketListing(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      outcome = cancelMarketListing(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async exerciseMarketLoanOption(code, managerId, input) {
    let outcome;
    const room = await this.#mutate(code, (current) => {
      assertMarketRoomActive(current);
      const now = this.#now();
      settleExpiredMarket(current, now);
      const clubId = managedClubFor(current, managerId);
      assertNoticeLongTermDecisionApproved(current, managerId, clubId, input, "esta opção de compra");
      outcome = exerciseMarketLoanOption(current, managerId, input, now);
      syncMarketCareerSideEffects(current);
      return current;
    });
    return marketOutcomeForViewer(await this.#marketSnapshotFor(room, managerId), outcome);
  }

  async #marketCatalog(room) {
    const catalog = await catalogForOwner(
      this.#catalogStore,
      room.catalogOwnerId || room.ownerId,
    );
    if (typeof catalog?.listPlayers !== "function") {
      throw new RoomError(
        "Catalogo de jogadores indisponivel",
        "MARKET_CATALOG_UNAVAILABLE",
        503,
      );
    }
    return catalog;
  }

  async #marketClubIds(room) {
    const ids = new Set((room.competitionCatalog ?? []).flatMap((league) => (
      (league.clubs ?? []).map((club) => String(club?.id ?? "").trim()).filter(Boolean)
    )));
    for (const manager of room.managers ?? []) {
      if (manager?.clubId) ids.add(String(manager.clubId));
    }
    return [...ids];
  }

  async #loadMarketPlayer(room, playerId) {
    const normalizedId = String(playerId ?? "").trim();
    const scopedClubIds = await this.#marketClubIds(room);
    const scopedClubKeys = new Set(scopedClubIds.map(clubKey));
    const registration = marketRegistrationForPlayer(room, normalizedId);
    if (registration?.playerSnapshot) {
      const currentClubId = registration.currentClubId || registration.playerSnapshot.clubId;
      if (!scopedClubKeys.has(clubKey(currentClubId))) {
        throw new RoomError("Jogador nao pertence as ligas ativas da sala", "MARKET_PLAYER_OUT_OF_SCOPE", 409);
      }
      return structuredClone(registration.playerSnapshot);
    }

    const careerFreeAgent = (room.careerState?.players ?? []).find((player) => (
      clubKey(player?.id) === clubKey(normalizedId)
      && careerPlayerCanEnterMarket(player)
      && careerPlayerIsFreeAgent(player)
    ));
    if (careerFreeAgent) return structuredClone(careerFreeAgent);

    const catalog = await this.#marketCatalog(room);
    if (typeof catalog.get === "function" && !(room.careerState?.players ?? []).length) {
      try {
        const player = await catalog.get("players", normalizedId);
        if (player?.active !== false && scopedClubKeys.has(clubKey(player?.clubId))) return player;
      } catch {
        // Bases legadas e mocks podem nao oferecer busca direta; tenta por elenco.
      }
    }
    for (const clubId of scopedClubIds) {
      try {
        const roster = await listRoomPlayers(catalog, room, clubId);
        const player = (roster?.players ?? []).find(
          (candidate) => String(candidate?.id ?? "") === normalizedId,
        );
        if (player && player.active !== false
          && player.academy !== true
          && player.youth !== true
          && player.careerStage !== "academy") return player;
      } catch {
        // Um clube corrompido nao impede procurar nos demais.
      }
    }
    throw new RoomError("Jogador nao encontrado", "MARKET_PLAYER_NOT_FOUND", 404);
  }

  async #loadMarketCandidates(room) {
    const catalog = await this.#marketCatalog(room);
    const rosters = await Promise.all((await this.#marketClubIds(room)).map(async (clubId) => {
      try {
        const roster = await listRoomPlayers(catalog, room, clubId);
        return Array.isArray(roster?.players) ? roster.players : [];
      } catch {
        return [];
      }
    }));
    const candidates = [];
    const seen = new Set();
    for (const player of rosters.flat()) {
      const playerId = String(player?.id ?? "").trim();
      if (!careerPlayerCanEnterMarket(player) || seen.has(playerId)) continue;
      seen.add(playerId);
      candidates.push(player);
    }
    for (const player of room.careerState?.players ?? []) {
      const playerId = String(player?.id ?? "").trim();
      if (!careerPlayerCanEnterMarket(player)
        || !careerPlayerIsFreeAgent(player)
        || seen.has(playerId)) continue;
      seen.add(playerId);
      candidates.push(structuredClone(player));
    }
    return candidates;
  }

  async #marketSnapshotFor(room, managerId) {
    return marketSnapshot(
      room,
      managerId,
      await this.#loadMarketCandidates(room),
      this.#now(),
    );
  }
}
