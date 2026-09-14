import { careerDateFor } from "./clubCareerSystem.mjs";

export const SCOUTING_READ_PATHS = ["scoutingState"];
export const SCOUTING_WRITE_PATHS = ["scoutingState", "careerState.players", "marketState.registrations", "competitionCatalog", "tournamentCatalog", "clubCareerState.currentDate"];
const key = (value) => String(value ?? "").trim().toUpperCase();
const list = (value) => Array.isArray(value) ? value : Object.values(value ?? {});
const money = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function scoutingError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status, public: true });
}

export function scoutingClub(room, managerId, expectedClubId = null) {
  if (!room?.managerIds?.includes(managerId)) throw scoutingError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  const clubId = room.managers?.find((manager) => manager.id === managerId)?.clubId;
  if (!clubId) throw scoutingError("Assuma um clube para utilizar a observacao", "SCOUTING_CLUB_REQUIRED");
  if (expectedClubId && key(clubId) !== key(expectedClubId)) throw scoutingError("Seu clube mudou. Atualize o perfil antes de continuar", "SCOUTING_CLUB_CHANGED");
  return clubId;
}

function stateFor(room) {
  if (!room.scoutingState) return { version: 1, records: [], operations: [] };
  const state = room.scoutingState;
  if (state.version !== 1 || !Array.isArray(state.records) || !Array.isArray(state.operations)) {
    throw scoutingError("Estado de observacao invalido ou de versao nao suportada", "SCOUTING_STATE_INVALID", 500);
  }
  return state;
}

export function scoutingPlayer(room, playerId, catalogPlayer = null) {
  const career = list(room.careerState?.players).find((player) => key(player.id) === key(playerId));
  const registration = list(room.marketState?.registrations).find((entry) => key(entry.playerId) === key(playerId));
  const base = career ?? registration?.playerSnapshot ?? catalogPlayer;
  if (!base) return null;
  if (key(base.id) !== key(playerId)) throw scoutingError("Catalogo retornou um jogador diferente do solicitado", "SCOUTING_PLAYER_INVALID", 503);
  const player = { ...base, ...career };
  const currentClubId = registration?.currentClubId ?? player.currentClubId ?? player.clubId;
  const free = !currentClubId || key(currentClubId) === "__FREE_AGENT__";
  const clubs = [
    ...(room.competitionCatalog ?? []).flatMap((competition) => competition.clubs ?? []),
    ...(room.tournamentCatalog ?? []).flatMap((competition) => competition.participants ?? []),
  ];
  if (!free && !clubs.some((club) => [club.id, club.code].some((id) => key(id) === key(currentClubId)))) {
    throw scoutingError("Jogador fora das competicoes deste save", "SCOUTING_PLAYER_OUT_OF_SCOPE");
  }
  return { ...player, clubId: free ? null : currentClubId, contract: registration?.contract ?? player.contract ?? null };
}

export function scoutingSnapshot(room, managerId, playerId = null) {
  const clubId = scoutingClub(room, managerId);
  const state = stateFor(room);
  const owns = (entry) => key(entry.clubId) === key(clubId) && (!playerId || key(entry.playerId) === key(playerId));
  return {
    clubId,
    revision: Number(room.revision ?? 0),
    records: structuredClone(state.records.filter(owns)),
    history: structuredClone(state.operations.filter(owns).slice(-20).reverse()),
  };
}

export function scoutingNeedsPlayer(room, managerId, input) {
  const clubId = scoutingClub(room, managerId, input.clubId);
  const state = stateFor(room);
  if (state.operations.some((entry) => entry.managerId === managerId && entry.operationId === input.operationId)) return false;
  return !(['unwatch', 'withdraw-interest'].includes(input.action)
    && state.records.some((entry) => key(entry.clubId) === key(clubId) && key(entry.playerId) === key(input.playerId)));
}

function agentResponse(player, clubId, now) {
  const unavailable = player.active === false || player.retired === true
    || ["not_for_sale", "inegociavel", "inegociável", "unavailable"].includes(String(player.negotiability ?? player.transferStatus ?? "").toLowerCase());
  const wage = money(player.contract?.wage ?? player.wage);
  const value = money(player.marketValue ?? player.value);
  const endsAt = player.contract?.endsAt ?? player.contract?.endDate ?? null;
  const expires = Date.parse(endsAt);
  const expiring = Number.isFinite(expires) && expires - Date.parse(now) <= 180 * 86_400_000;
  const status = unavailable ? "unavailable" : !player.clubId || expiring ? "open" : "conditional";
  return {
    status,
    message: unavailable
      ? "A representação não abre negociação: jogador indisponível ou considerado inegociável pelo clube."
      : !player.clubId
        ? "Jogador sem clube. A representação aceita discutir uma proposta; salário e contrato ainda precisam ser negociados."
        : expiring
          ? "Contrato próximo do fim. A representação aceita discutir o projeto; uma transferência ainda depende das regras do mercado."
          : "A representação pode avaliar uma proposta, condicionada à liberação do clube e ao acordo salarial.",
    playerClubId: player.clubId,
    requestingClubId: clubId,
    currentWage: wage,
    marketValue: value,
    contractEndsAt: endsAt,
    contactedAt: now,
    nextContactAt: new Date(Date.parse(now) + 3 * 86_400_000).toISOString(),
  };
}

export function applyScoutingAction(room, managerId, input, catalogPlayer = null, fallbackNow = new Date()) {
  const clubId = scoutingClub(room, managerId, input.clubId);
  if (room.status !== "active" || room.careerCompleted) throw scoutingError("Observacao disponivel apenas em uma carreira ativa", "SCOUTING_CAREER_INACTIVE");
  const state = stateFor(room);
  const receipt = state.operations.find((entry) => entry.operationId === input.operationId && entry.managerId === managerId);
  if (receipt) {
    if (key(receipt.clubId) !== key(clubId) || key(receipt.playerId) !== key(input.playerId) || receipt.action !== input.action) {
      throw scoutingError("Identificador de operacao reutilizado com dados diferentes", "SCOUTING_OPERATION_CONFLICT");
    }
    return { changed: false, duplicate: true };
  }
  const removing = ["unwatch", "withdraw-interest"].includes(input.action);
  let record = state.records.find((entry) => key(entry.clubId) === key(clubId) && key(entry.playerId) === key(input.playerId));
  const player = removing && record ? { id: record.playerId, name: record.playerName, clubId: null } : scoutingPlayer(room, input.playerId, catalogPlayer);
  if (!player) throw scoutingError("Jogador nao encontrado neste save", "SCOUTING_PLAYER_NOT_FOUND", 404);
  if (!removing && key(player.clubId) === key(clubId)) throw scoutingError("Jogador ja pertence ao seu elenco", "SCOUTING_OWN_PLAYER");
  if (!removing && input.action !== "contact-agent" && (player.active === false || player.retired === true)) {
    throw scoutingError("Jogador nao esta ativo", "SCOUTING_PLAYER_INACTIVE");
  }
  if (state.operations.length >= 20_000) throw scoutingError("Limite de registros de observacao atingido neste save", "SCOUTING_HISTORY_LIMIT");
  if (!record) {
    if (state.records.length >= 2_000) throw scoutingError("Limite de jogadores observados atingido neste save", "SCOUTING_PLAYER_LIMIT");
    record = { clubId, playerId: player.id, playerName: player.name, watching: false, interested: false, agentContact: null };
    state.records.push(record);
  }
  const now = careerDateFor(room, fallbackNow);
  let changed = false;
  switch (input.action) {
    case "watch": case "unwatch": {
      const watching = input.action === "watch";
      changed = record.watching !== watching;
      record.watching = watching;
      break;
    }
    case "interest": case "withdraw-interest": {
      const interested = input.action === "interest";
      changed = record.interested !== interested;
      record.interested = interested;
      break;
    }
    case "contact-agent":
      if (!record.agentContact || Date.parse(now) >= Date.parse(record.agentContact.nextContactAt)
        || key(record.agentContact.playerClubId) !== key(player.clubId)) {
        record.agentContact = agentResponse(player, clubId, now);
        changed = true;
      }
      break;
    default: throw scoutingError("Acao de observacao invalida", "SCOUTING_ACTION_INVALID", 400);
  }
  record.playerName = player.name;
  if (changed) record.updatedAt = now;
  state.operations.push({ operationId: input.operationId, managerId, clubId, playerId: player.id,
    action: input.action, changed, occurredAt: now, ...(input.action === "contact-agent" ? { response: structuredClone(record.agentContact) } : {}) });
  room.scoutingState = state;
  return { changed, duplicate: false };
}
