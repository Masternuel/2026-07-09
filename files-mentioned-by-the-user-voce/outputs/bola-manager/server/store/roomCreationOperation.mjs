import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);

export function roomCreationError(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

export function roomCreationOperation(input) {
  const operationId = input.operationId?.trim();
  const requestId = input.requestId?.trim();
  if (operationId == null && requestId == null) return null;
  if ((operationId != null && !validId(operationId)) || (requestId != null && !validId(requestId))
    || (operationId && requestId && operationId !== requestId)) {
    throw roomCreationError("Identificador de criacao invalido", "VALIDATION_ERROR", 400);
  }
  const id = operationId ?? requestId;
  return {
    version: 1,
    key: digest([input.creatorId, id]),
    ownerId: input.creatorId,
    operationId: id,
    fingerprint: digest({
      name: input.name.trim(),
      clubId: input.clubId?.trim() || null,
      activeLeagues: [...new Set(input.activeLeagues.map((league) => league.trim()))].sort(),
      seasonLength: input.seasonLength,
      unlimitedSeasons: input.unlimitedSeasons,
      maxManagers: input.maxManagers,
    }),
  };
}

export function creationReceipt(operation, room) {
  return { ...operation, code: room.code, roomId: room.id, createdAt: room.createdAt };
}

export function validateCreationReceipt(receipt, operation) {
  if (!receipt) return null;
  if (receipt.version !== 1 || receipt.ownerId !== operation.ownerId
    || receipt.operationId !== operation.operationId || receipt.key !== operation.key
    || !/^BOLA-[A-Z0-9]{4}$/.test(receipt.code ?? "") || !receipt.roomId || !receipt.fingerprint) {
    throw roomCreationError("Recibo de criacao inconsistente", "ROOM_CREATION_RECEIPT_INVALID", 503);
  }
  if (receipt.fingerprint !== operation.fingerprint) {
    throw roomCreationError("Esta operacao ja foi usada para outra configuracao de sala", "ROOM_CREATION_CONFLICT");
  }
  return receipt;
}
