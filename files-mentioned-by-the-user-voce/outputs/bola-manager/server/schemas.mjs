import { z } from "zod";

const legacyIdentifier = z.string().trim().min(1).max(128).optional();
const clubIdentifier = z.string().trim().min(1).max(128);

export const roomCodeSchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^BOLA-[A-Z0-9]{4}$/, "Codigo de sala invalido"));

export const createRoomSchema = z.object({
  name: z.string().trim().min(3).max(80),
  creatorId: legacyIdentifier,
  creatorName: z.string().trim().min(2).max(60).optional(),
  clubId: clubIdentifier.optional(),
  activeLeagues: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(["BR-A", "BR-B"]),
  seasonLength: z.coerce.number().int().min(1).max(20).default(1),
  maxManagers: z.coerce.number().int().min(1).max(16).default(6),
}).strict();

export const joinRoomSchema = z.object({
  managerId: legacyIdentifier,
  managerName: z.string().trim().min(2).max(60).optional(),
  clubId: clubIdentifier.optional(),
}).strict();

export const readyRoomSchema = z.object({
  managerId: legacyIdentifier,
  ready: z.boolean().default(true),
  clubId: clubIdentifier.optional(),
}).strict();

export const startRoomSchema = z.object({ managerId: legacyIdentifier }).strict();

export const chatMessageSchema = z.object({
  code: roomCodeSchema,
  managerId: legacyIdentifier,
  message: z.string().trim().min(1).max(500),
}).strict();

export const matchStartSchema = z.object({
  code: roomCodeSchema,
  fixtureId: z.string().trim().min(1).max(80).optional(),
  managerId: legacyIdentifier,
}).strict();

export const matchReadySchema = z.object({
  code: roomCodeSchema,
  fixtureId: z.string().trim().min(1).max(80).optional(),
  ready: z.boolean().default(true),
  managerId: legacyIdentifier,
}).strict();

export const matchControlSchema = z.object({
  code: roomCodeSchema,
  managerId: legacyIdentifier,
}).strict();

export const marketOfferSchema = z.object({
  code: roomCodeSchema,
  managerId: legacyIdentifier,
  recipientId: z.string().trim().min(1).max(128),
  playerId: z.string().trim().min(1).max(128),
  amount: z.coerce.number().int().positive().max(2_000_000_000),
  message: z.string().trim().max(500).optional(),
}).strict();

export const marketBidSchema = z.object({
  code: roomCodeSchema,
  managerId: legacyIdentifier,
  auctionId: z.string().trim().min(1).max(128),
  amount: z.coerce.number().int().positive().max(2_000_000_000),
}).strict();

export function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const error = new Error("Dados de entrada invalidos");
    error.name = "ValidationError";
    error.status = 400;
    error.details = result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    throw error;
  }
  return result.data;
}
