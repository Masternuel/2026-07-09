// Room guards shared by RoomStore and its services.
import { RoomError } from "./roomError.mjs";
import { clubKey } from "./roomKeys.mjs";

export function assertNoticeLongTermDecisionApproved(room, managerId, clubId, input, decision) {
  const notice = (room.professionalLifecycleState?.notices ?? []).find((candidate) => (
    candidate.status === "active"
      && candidate.professionalType === "coach"
      && String(candidate.professionalId) === String(managerId)
      && clubKey(candidate.clubId) === clubKey(clubId)
      && candidate.longTermDecisionApprovalRequired !== false
  ));
  if (!notice || input.noticeApproval === true) return;
  throw new RoomError(
    `A diretoria precisa aprovar ${decision} durante o aviso`,
    "PROFESSIONAL_NOTICE_BOARD_APPROVAL_REQUIRED",
    409,
  );
}

export function assertMarketRoomActive(room) {
  if (room.status !== "active") {
    throw new RoomError(
      "Inicie a temporada antes de usar o mercado",
      "MARKET_ROOM_NOT_ACTIVE",
      409,
    );
  }
}

export function managedClubFor(room, managerId, requestedClubId = null) {
  const manager = (room.managers ?? []).find((candidate) => candidate.id === managerId);
  if (!manager) {
    throw new RoomError("Sala nao encontrada", "ROOM_NOT_FOUND", 404);
  }
  if (!manager?.clubId) {
    throw new RoomError("Manager sem clube", "CLUB_REQUIRED", 409);
  }
  if (requestedClubId && clubKey(requestedClubId) !== clubKey(manager.clubId)) {
    throw new RoomError("Este clube nao pertence ao manager", "CLUB_FORBIDDEN", 403);
  }
  return manager.clubId;
}

export function careerPlayerCanEnterMarket(player) {
  return Boolean(String(player?.id ?? "").trim())
    && player?.active !== false
    && player?.retired !== true
    && player?.academy !== true
    && player?.youth !== true
    && player?.careerStage !== "academy"
    && player?.careerStage !== "retired";
}

export function careerPlayerIsFreeAgent(player) {
  const contractStatus = String(player?.contract?.status ?? "").trim().toLocaleLowerCase("pt-BR");
  return ["free_agent", "expired", "released"].includes(contractStatus)
    || (!player?.currentClubId && !player?.clubId && !player?.contract?.clubId);
}
