import { randomUUID } from "node:crypto";
import { redactText } from "./redaction.mjs";

const DOMAIN_TYPES = new Set([
  "AuthError", "ValidationError", "RoomError", "CatalogStoreError", "NewsStoreError",
  "CatalogImportTransactionError", "CatalogMediaError", "CatalogDatabaseError",
  "BrasfootImportSessionError", "CareerEventError", "ClubFinanceError", "ClubFacilityError",
  "CoachEmploymentError", "CompetitionEngineError", "GlobalFixtureCalendarError", "MarketError",
  "ProfessionalLeaveError", "ProfessionalLifecycleError", "StaffError",
]);
const CONTROLLED = {
  AUTH_REQUIRED: [401, "Autenticacao obrigatoria"],
  INVALID_AUTH_TOKEN: [401, "Token de autenticacao invalido"],
  AUTH_TOKEN_EXPIRED: [401, "Token expirado. Entre novamente."],
  AUTH_TOKEN_REVOKED: [401, "Sessao revogada. Entre novamente."],
  AUTH_USER_DISABLED: [401, "Usuario desabilitado"],
  AUTH_SESSION_CLOSED: [401, "Sessao encerrada. Entre novamente."],
  AUTH_IDENTITY_CHANGED: [401, "Renove a sessao usando a mesma conta."],
  AUTH_UNAVAILABLE: [503, "Servico de autenticacao indisponivel"],
  REDIS_REQUIRED: [503, "Coordenacao temporariamente indisponivel. Tente novamente."],
  RATE_LIMITED: [429, "Muitas requisicoes. Tente novamente em instantes."],
  AI_USAGE_LIMITED: [429, "Limite de uso da IA atingido. Tente novamente mais tarde."],
  CORS_ORIGIN_DENIED: [403, "Origem nao permitida"],
  DISTRIBUTED_LOCK_TIMEOUT: [409, "Operacao em andamento. Tente novamente."],
  DISTRIBUTED_LOCK_LOST: [409, "Operacao interrompida. Tente novamente."],
  MATCH_OWNERSHIP_LOST: [409, "Partida sendo atualizada. Tente novamente."],
  MATCH_PERSISTENCE_TIMEOUT: [503, "Nao foi possivel salvar a partida agora. Tente novamente."],
  ROOM_PLAYER_STATE_UNAVAILABLE: [503, "Estado dos jogadores temporariamente indisponivel"],
  BRASFOOT_IMPORT_UNAVAILABLE: [503, "Importacao temporariamente indisponivel"],
  CODE_EXHAUSTED: [503, "Nao foi possivel gerar o codigo da sala"],
  EDITOR_CATALOG_UNAVAILABLE: [503, "Catalogo temporariamente indisponivel"],
  EDITOR_MEDIA_UPLOAD_FAILED: [502, "Nao foi possivel salvar a imagem"],
  EDITOR_MEDIA_STORAGE_UNAVAILABLE: [503, "Armazenamento de imagens temporariamente indisponivel"],
  EDITOR_MEDIA_OWNERSHIP_INVALID: [403, "A midia nao pertence a este registro"],
};

export function correlationId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(value) && redactText(value) === value
    ? value : randomUUID();
}

export function publicError(error, requestId) {
  const id = correlationId(requestId);
  const code = error?.code ?? error?.data?.code;
  const controlled = Object.hasOwn(CONTROLLED, code ?? "") ? CONTROLLED[code] : null;
  const status = controlled?.[0] ?? (Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 500);
  const domain = error instanceof Error && status < 500 && (error.public === true || DOMAIN_TYPES.has(error.name));
  const validCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(code);
  const validation = domain && error.name === "ValidationError";
  const result = {
    code: controlled || (domain && validCode) ? code : validation ? "VALIDATION_ERROR" : "SERVER_ERROR",
    message: controlled?.[1] ?? (domain ? redactText(error.message).slice(0, 500) : "Erro interno do servidor"),
    requestId: id,
  };
  if (validation && Array.isArray(error.details)) {
    result.details = error.details.slice(0, 50).map((issue) => ({
      path: typeof issue.path === "string" && /^[a-zA-Z0-9_.]{0,120}$/.test(issue.path) ? issue.path : "",
      message: "Valor invalido para este campo",
    }));
  } else if (domain || controlled) {
    const details = Object.fromEntries(["retryAfterMs", "maximumBytes"].flatMap((key) => {
      const value = error?.details?.[key] ?? error?.data?.[key];
      return Number.isFinite(value) && value >= 0 ? [[key, value]] : [];
    }));
    if (Object.keys(details).length) result.details = details;
  }
  return { status, error: result };
}

export function publicConnectionError(error, requestId) {
  const serialized = publicError(error, requestId);
  return Object.assign(new Error(serialized.error.message), { data: { ...serialized.error, status: serialized.status } });
}
