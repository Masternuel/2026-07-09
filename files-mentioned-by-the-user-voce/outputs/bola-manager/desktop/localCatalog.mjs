import { buildBuiltinCatalog } from "../scripts/lib/builtin-catalog.mjs";
import { CatalogStoreError, publicLeague, publicCompetitionClub, publicTournament, tournamentParticipant } from "../server/store/catalogStore.mjs";
import { calculateStarImpact, sortPlayersForSelection } from "../server/game/starImpact.mjs";

export function createStarterCatalog() {
  const seed = buildBuiltinCatalog();
  // Offline starter database, explicitly fictional; never copies a cloud catalog.
  seed.players = seed.clubs.flatMap((club) => seed.players.map((player) => ({
    ...structuredClone(player),
    id: `${club.id}-${player.id}`,
    clubId: club.id,
    name: club.id === "AUR" ? player.name : `${player.name} (${club.abbreviation})`,
  })));
  return { ...seed, tournaments: [] };
}

export class LocalCatalog {
  constructor(catalog, ownerId, canRead = () => false, { archives = {}, imported = false } = {}) {
    this.catalog = structuredClone(catalog);
    this.ownerId = ownerId;
    this.canRead = canRead;
    this.source = imported ? "local-import" : "local-starter";
    this.archives = new Map(Object.entries(archives).map(([id, records]) => [id, new LocalCatalog(records, id)]));
  }
  forOwner(ownerId) {
    if (this.archives.has(ownerId)) return this.archives.get(ownerId);
    if (ownerId !== this.ownerId && !this.canRead(ownerId)) throw new CatalogStoreError("Catalogo local pertence a outro perfil", "ROOM_FORBIDDEN", 403);
    return this;
  }
  async ensureInitialized() {}
  async readInitialized() {}
  async get(entity, id) {
    const record = this.catalog[entity]?.find((item) => item.id === id);
    if (!record) throw new CatalogStoreError("Registro nao encontrado", "EDITOR_RECORD_NOT_FOUND", 404);
    return structuredClone(record);
  }
  async listTeams({ country, division, cursor, limit = 40 } = {}) {
    const all = this.catalog.clubs.filter((club) => club.active !== false
      && (!country || club.country === country) && (!division || club.division === division))
      .sort((a, b) => a.id.localeCompare(b.id));
    const start = cursor ? all.findIndex((club) => club.id === cursor) + 1 : 0;
    const teams = structuredClone(all.slice(start, start + limit));
    return { teams, count: teams.length, nextCursor: start + limit < all.length ? teams.at(-1)?.id : null, source: this.source };
  }
  async listCompetitionCatalog(leagueIds) {
    return this.catalog.leagues.filter((league) => league.active !== false && (!leagueIds || leagueIds.includes(league.id)))
      .map((league) => ({ ...structuredClone(league), clubs: this.catalog.clubs
        .filter((club) => club.active !== false && club.leagueId === league.id).map(publicCompetitionClub) }));
  }
  async listActiveLeagues() {
    const leagues = (await this.listCompetitionCatalog()).map((league) => publicLeague(league, league.clubs.length));
    return { leagues, count: leagues.length, source: this.source };
  }
  async listActiveTournaments() {
    const participants = new Map(this.catalog.clubs.filter((club) => club.active !== false).map((club) => [club.id, tournamentParticipant(club)]));
    const tournaments = (this.catalog.tournaments ?? []).filter((item) => item.active !== false).map((item) => publicTournament(item, participants));
    return { tournaments, count: tournaments.length, source: this.source };
  }
  async listPlayers(clubId) {
    const players = sortPlayersForSelection(structuredClone(this.catalog.players.filter((player) => player.clubId === clubId && player.active !== false)));
    return { players, count: players.length, source: this.source };
  }
  async getStarImpact(clubId) { return { ...calculateStarImpact(clubId, (await this.listPlayers(clubId)).players), source: this.source }; }
}
