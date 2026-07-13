import { z } from "zod";

export const editorEntitySchema = z.enum(["leagues", "clubs", "players", "tournaments"]);

const editorPageLimitSchema = z.coerce.number().int().min(1).max(200).default(50);

export const editorCatalogQuerySchema = z.object({
  limit: editorPageLimitSchema,
}).strict();

export const editorListQuerySchema = z.object({
  limit: editorPageLimitSchema,
  cursor: z.string().trim().min(1).max(1024).optional(),
  query: z.string().trim().min(1).max(120).optional(),
  clubId: z.string().trim().min(1).max(128).optional(),
}).strict();

export const brasfootImportSessionIdSchema = z.string().uuid();

export const brasfootImportFileQuerySchema = z.object({
  path: z.string().trim().min(1).max(512),
}).strict();

export const brasfootImportCommitSchema = z.object({
  allowPartial: z.boolean().default(false),
  importAssets: z.boolean().default(false),
}).strict();

export const editorRecordIdSchema = z.union([z.string(), z.number()])
  .transform(String)
  .pipe(z.string()
    .trim()
    .min(1)
    .max(128)
    .refine((value) => !value.includes("/"), "ID nao pode conter /"));

const requiredText = (maximum = 120) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum = 120) => z.union([z.string().trim().max(maximum), z.null()])
  .transform((value) => value === "" ? null : value);
const colorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, "Cor deve usar #RRGGBB");
const nullableHttpUrl = z.union([
  z.literal(""),
  z.string().trim().max(2048).url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "URL deve usar HTTP ou HTTPS"),
  z.null(),
]).transform((value) => value === "" ? null : value);
const mediaPathSchema = (entity) => z.union([
  z.string().trim().min(1).max(512)
    .refine((value) => value.startsWith(`editor-media/${entity}/`), "Caminho de midia invalido")
    .refine((value) => !value.includes("..") && !/[\u0000-\u001f\u007f]/.test(value), "Caminho de midia invalido"),
  z.null(),
]);
const playerPositionSchema = z.enum(["GOL", "ZAG", "LD", "LE", "VOL", "MC", "MEI", "PD", "PE", "ATA"]);
const playerAttributeSchema = z.coerce.number().finite().min(1).max(20);
const attributesSchema = z.object({
  velocidade: playerAttributeSchema,
  chute: playerAttributeSchema,
  drible: playerAttributeSchema,
  nocao: playerAttributeSchema,
  defesa: playerAttributeSchema,
  passe: playerAttributeSchema,
  peBom: playerAttributeSchema,
  peRuim: playerAttributeSchema,
}).strict();

const leagueFields = {
  name: requiredText(),
  country: requiredText(60),
  level: z.coerce.number().int().min(1).max(20),
  division: requiredText(60),
  active: z.boolean(),
};

const clubFields = {
  name: requiredText(),
  abbreviation: z.string().trim().max(8),
  colors: z.array(colorSchema).max(4),
  stadium: requiredText(),
  reputation: z.coerce.number().int().min(1).max(20),
  division: requiredText(60),
  country: requiredText(60),
  state: nullableText(60),
  city: nullableText(80),
  leagueId: editorRecordIdSchema.nullable(),
  budget: z.coerce.number().finite().min(0).max(2_000_000_000),
  crestImageUrl: nullableHttpUrl,
  crestImagePath: mediaPathSchema("clubs"),
  active: z.boolean(),
};

const playerFields = {
  clubId: editorRecordIdSchema,
  name: requiredText(),
  position: playerPositionSchema,
  age: z.coerce.number().int().min(14).max(60),
  nationality: requiredText(60),
  shirtNumber: z.coerce.number().int().min(0).max(99).nullable(),
  overall: z.coerce.number().finite().min(1).max(20),
  attributes: attributesSchema,
  isStar: z.boolean(),
  avatarImageUrl: nullableHttpUrl,
  avatarImagePath: mediaPathSchema("players"),
  active: z.boolean(),
};

export const tournamentFormatSchema = z.enum(["league", "knockout", "groups_knockout"]);
export const tournamentLegsSchema = z.enum(["single", "double"]);
export const tournamentTiebreakerSchema = z.enum([
  "goal_difference",
  "goals_scored",
  "wins",
  "head_to_head",
  "fair_play",
  "away_goals",
  "extra_time",
  "penalties",
  "drawing_lots",
]);

const tournamentTeamIdsSchema = z.array(editorRecordIdSchema)
  .max(256)
  .refine((ids) => new Set(ids).size === ids.length, "Times do torneio nao podem se repetir");
const tournamentTiebreakersSchema = z.array(tournamentTiebreakerSchema)
  .min(1)
  .max(9)
  .refine((items) => new Set(items).size === items.length, "Criterios de desempate nao podem se repetir");
const tournamentFields = {
  name: requiredText(),
  format: tournamentFormatSchema,
  teamCount: z.coerce.number().int().min(2).max(256),
  legs: tournamentLegsSchema,
  tiebreakers: tournamentTiebreakersSchema,
  teamIds: tournamentTeamIdsSchema,
  trophyImageUrl: nullableHttpUrl,
  trophyImagePath: mediaPathSchema("tournaments"),
  active: z.boolean(),
};

function tournamentConsistency(schema) {
  return schema.superRefine((value, context) => {
    if (value.active === true
      && Array.isArray(value.teamIds)
      && Number.isInteger(value.teamCount)
      && value.teamIds.length !== value.teamCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teamIds"],
        message: "Torneio ativo exige exatamente teamCount times vinculados",
      });
    } else if (Array.isArray(value.teamIds)
      && Number.isInteger(value.teamCount)
      && value.teamIds.length > value.teamCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["teamIds"],
        message: "Quantidade de times vinculados excede teamCount",
      });
    }
    if (value.tiebreakers?.includes("away_goals") && value.legs !== "double") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiebreakers"],
        message: "away_goals exige confrontos em ida e volta",
      });
    }
    const penaltiesIndex = value.tiebreakers?.indexOf("penalties") ?? -1;
    if (penaltiesIndex >= 0 && penaltiesIndex !== value.tiebreakers.length - 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiebreakers"],
        message: "penalties deve ser o ultimo criterio de desempate",
      });
    }
    const extraTimeIndex = value.tiebreakers?.indexOf("extra_time") ?? -1;
    if (extraTimeIndex >= 0 && penaltiesIndex >= 0 && extraTimeIndex > penaltiesIndex) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tiebreakers"],
        message: "extra_time deve vir antes de penalties",
      });
    }
  });
}

export const tournamentConsistencySchema = tournamentConsistency(z.object({
  teamCount: tournamentFields.teamCount,
  legs: tournamentFields.legs,
  tiebreakers: tournamentFields.tiebreakers,
  teamIds: tournamentFields.teamIds,
  active: tournamentFields.active,
}).passthrough());

const mediaKinds = {
  clubs: "crest",
  players: "avatar",
  tournaments: "trophy",
};

export const editorMediaUploadQuerySchema = z.object({
  entity: z.enum(["clubs", "players", "tournaments"]),
  id: editorRecordIdSchema,
  kind: z.enum(["crest", "avatar", "trophy"]).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind && mediaKinds[value.entity] !== value.kind) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["kind"],
      message: `Tipo de midia incompativel com ${value.entity}`,
    });
  }
});

export function mediaKindForEntity(entity) {
  return mediaKinds[entity] ?? null;
}

export const editorCreateSchemas = {
  leagues: z.object({
    id: editorRecordIdSchema,
    ...leagueFields,
    country: leagueFields.country.default("Brasil"),
    level: leagueFields.level.default(1),
    division: leagueFields.division.default("Primeira divisao"),
    active: leagueFields.active.default(true),
  }).strict(),
  clubs: z.object({
    id: editorRecordIdSchema,
    ...clubFields,
    abbreviation: clubFields.abbreviation.default(""),
    colors: clubFields.colors.default([]),
    stadium: clubFields.stadium.default("A definir"),
    reputation: clubFields.reputation.default(10),
    division: clubFields.division.default("Sem divisao"),
    country: clubFields.country.default("Brasil"),
    state: clubFields.state.optional().default(null),
    city: clubFields.city.optional().default(null),
    leagueId: clubFields.leagueId.optional().default(null),
    budget: clubFields.budget.default(0),
    crestImageUrl: clubFields.crestImageUrl.optional().default(null),
    crestImagePath: clubFields.crestImagePath.optional().default(null),
    active: clubFields.active.default(true),
  }).strict(),
  players: z.object({
    id: editorRecordIdSchema,
    ...playerFields,
    nationality: playerFields.nationality.default("Brasil"),
    shirtNumber: playerFields.shirtNumber.optional().default(null),
    overall: playerFields.overall.default(10),
    attributes: playerFields.attributes,
    isStar: playerFields.isStar.default(false),
    avatarImageUrl: playerFields.avatarImageUrl.optional().default(null),
    avatarImagePath: playerFields.avatarImagePath.optional().default(null),
    active: playerFields.active.default(true),
  }).strict(),
  tournaments: tournamentConsistency(z.object({
    id: editorRecordIdSchema,
    ...tournamentFields,
    format: tournamentFields.format.default("league"),
    teamCount: tournamentFields.teamCount.default(2),
    legs: tournamentFields.legs.default("single"),
    tiebreakers: tournamentFields.tiebreakers.default(["goal_difference", "goals_scored", "head_to_head"]),
    teamIds: tournamentFields.teamIds.default([]),
    trophyImageUrl: tournamentFields.trophyImageUrl.optional().default(null),
    trophyImagePath: tournamentFields.trophyImagePath.optional().default(null),
    active: tournamentFields.active.default(true),
  }).strict()),
};

function patchSchema(fields) {
  return z.object(fields)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo para alterar");
}

export const editorPatchSchemas = {
  leagues: patchSchema(leagueFields),
  clubs: patchSchema(clubFields),
  players: patchSchema(playerFields),
  tournaments: patchSchema(tournamentFields),
};
