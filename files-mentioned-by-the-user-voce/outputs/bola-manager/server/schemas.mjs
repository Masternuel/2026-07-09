import { z } from "zod";
import { FORMATION_IDS } from "./game/tactics.mjs";

const legacyIdentifier = z.string().trim().min(1).max(128).optional();
const clubIdentifier = z.string().trim().min(1).max(128);

export const roomCodeSchema = z.string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^BOLA-[A-Z0-9]{4}$/, "Codigo de sala invalido"));

export const createRoomSchema = z.object({
  operationId: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).optional(),
  requestId: z.string().trim().regex(/^[a-zA-Z0-9_.:-]{1,128}$/).optional(),
  name: z.string().trim().min(3).max(80),
  creatorId: legacyIdentifier,
  creatorName: z.string().trim().min(2).max(60).optional(),
  clubId: clubIdentifier.optional(),
  activeLeagues: z.array(z.string().trim().min(2).max(40)).min(1).max(24).default(["BR-A", "BR-B"]),
  seasonLength: z.coerce.number().int().min(1).max(20).default(1),
  unlimitedSeasons: z.boolean().default(false),
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
  fixtureId: z.string().trim().min(1).max(160).optional(),
  managerId: legacyIdentifier,
}).strict();

export const matchReadySchema = z.object({
  code: roomCodeSchema,
  fixtureId: z.string().trim().min(1).max(160).optional(),
  ready: z.boolean().default(true),
  managerId: legacyIdentifier,
}).strict();

export const matchControlSchema = z.object({
  code: roomCodeSchema,
  managerId: legacyIdentifier,
}).strict();

export const matchSpeedSchema = z.object({
  code: roomCodeSchema,
  matchId: z.string().trim().min(1).max(128),
  speed: z.union([z.literal(0.5), z.literal(1), z.literal(2), z.literal(3)]),
}).strict();

const lineupPlayerIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"), "ID de jogador nao pode conter /");

const setPieceTakerSchema = lineupPlayerIdSchema.nullable();

export const tacticPlanSchema = z.object({
  version: z.literal(1),
  formationId: z.enum([...FORMATION_IDS]),
  mentality: z.enum(["cautious", "balanced", "positive", "attacking"]),
  teamInstructions: z.object({
    pressureLine: z.enum(["very-low", "low", "medium", "high", "very-high"]),
    width: z.enum(["very-narrow", "narrow", "normal", "wide", "very-wide"]),
    tempo: z.enum(["very-slow", "slow", "normal", "fast", "very-fast"]),
    pressing: z.enum(["passive", "moderate", "intense", "aggressive"]),
    offensiveTransition: z.enum(["build-up", "direct", "counter"]),
    defensiveTransition: z.enum(["counter-press", "regroup", "drop"]),
  }).strict(),
  individualInstructions: z.array(z.object({
    playerId: lineupPlayerIdSchema,
    withBall: z.enum(["support-inside", "hold-width", "attack-space"]),
    withoutBall: z.enum(["press-more", "hold-position", "man-mark"]),
  }).strict())
    .max(11)
    .refine(
      (instructions) => new Set(instructions.map((instruction) => instruction.playerId)).size === instructions.length,
      "Instrucao individual nao pode repetir jogador",
    ),
  setPieces: z.object({
    corner: z.object({
      takerId: setPieceTakerSchema,
      routine: z.enum(["short", "near-post", "far-post"]),
    }).strict(),
    freeKick: z.object({
      takerId: setPieceTakerSchema,
      routine: z.enum(["direct", "cross", "short"]),
    }).strict(),
    goalKick: z.object({
      takerId: setPieceTakerSchema,
      routine: z.enum(["short", "mixed", "long"]),
    }).strict(),
  }).strict(),
  secret: z.boolean(),
}).strict();

export const matchHalftimePlanSchema = z.object({
  code: roomCodeSchema,
  matchId: z.string().trim().min(1).max(128),
  lineupIds: z.array(lineupPlayerIdSchema)
    .length(11, "Escalacao precisa ter exatamente 11 jogadores")
    .refine((ids) => new Set(ids).size === ids.length, "Escalacao nao pode repetir jogador"),
  tactics: z.object({
    mentality: z.enum(["cautious", "balanced", "positive", "attacking"]),
    instruction: z.enum(["keep-plan", "exploit-right", "keep-possession", "high-line", "slow-tempo"]),
  }).strict(),
}).strict();

export const matchHalftimeReadySchema = z.object({
  code: roomCodeSchema,
  matchId: z.string().trim().min(1).max(128),
  ready: z.boolean().default(true),
}).strict();

export const lineupSaveSchema = z.object({
  code: roomCodeSchema,
  lineupIds: z.array(lineupPlayerIdSchema)
    .length(11, "Escalacao titular deve ter exatamente 11 jogadores")
    .refine((ids) => new Set(ids).size === ids.length, "Escalacao nao pode repetir jogador"),
  tactics: tacticPlanSchema.optional(),
}).strict().superRefine((value, context) => {
  if (!value.tactics) return;
  const lineupIds = new Set(value.lineupIds);
  for (const [index, instruction] of value.tactics.individualInstructions.entries()) {
    if (!lineupIds.has(instruction.playerId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Instrucao individual deve usar jogador escalado",
        path: ["tactics", "individualInstructions", index, "playerId"],
      });
    }
  }
  for (const kind of ["corner", "freeKick", "goalKick"]) {
    const takerId = value.tactics.setPieces[kind].takerId;
    if (takerId && !lineupIds.has(takerId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cobrador de bola parada deve estar escalado",
        path: ["tactics", "setPieces", kind, "takerId"],
      });
    }
  }
});

const marketIdentifierSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !value.includes("/"), "ID de mercado nao pode conter /");
const marketRequestIdSchema = z.string().trim().min(8).max(128);
const marketMoneySchema = z.number().int().positive().max(2_000_000_000);
const marketDealTypeSchema = z.enum(["transfer", "loan"]);
const noticeApprovalSchema = z.boolean().optional();

const marketContractTermsSchema = z.object({
  wage: z.number().int().min(1_000).max(2_000_000_000),
  durationSeasons: z.number().int().min(1).max(8),
  effectiveSeason: z.number().int().min(1).max(10_000).optional(),
}).strict();

const marketLoanTermsSchema = z.object({
  fee: z.number().int().min(0).max(2_000_000_000),
  wageSharePercent: z.number().int().min(0).max(100),
  durationRounds: z.number().int().min(1).max(100),
  purchaseOption: marketMoneySchema.nullable(),
  purchaseObligation: marketMoneySchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.purchaseOption !== null && value.purchaseObligation != null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Emprestimo nao pode ter opcao e obrigacao de compra ao mesmo tempo",
      path: ["purchaseObligation"],
    });
  }
});

export const marketSyncSchema = z.object({
  code: roomCodeSchema,
}).strict();

export const marketOfferSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  playerId: marketIdentifierSchema,
  listingId: marketIdentifierSchema.optional(),
  dealType: marketDealTypeSchema,
  amount: marketMoneySchema,
  message: z.string().trim().min(1).max(500).optional(),
  contractTerms: marketContractTermsSchema.optional(),
  loanTerms: marketLoanTermsSchema.optional(),
  noticeApproval: noticeApprovalSchema,
}).strict();

export const marketRespondSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  offerId: marketIdentifierSchema,
  action: z.enum(["accept", "reject", "counter", "cancel"]),
  counterAmount: marketMoneySchema.optional(),
  noticeApproval: noticeApprovalSchema,
}).strict().superRefine((value, context) => {
  if (value.action === "counter" && value.counterAmount === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Contraproposta exige um valor",
      path: ["counterAmount"],
    });
  }
});

export const marketListingSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  playerId: marketIdentifierSchema,
  mode: z.enum(["direct", "auction"]),
  dealType: marketDealTypeSchema,
  askingPrice: marketMoneySchema.optional(),
  minimumBid: marketMoneySchema.optional(),
  expiresInHours: z.number().int().min(1).max(168).optional(),
  loanTerms: marketLoanTermsSchema.optional(),
  noticeApproval: noticeApprovalSchema,
}).strict().superRefine((value, context) => {
  if (value.mode === "direct" && value.askingPrice === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Venda direta exige preco pedido",
      path: ["askingPrice"],
    });
  }
  if (value.mode === "auction" && value.minimumBid === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Leilao exige lance minimo",
      path: ["minimumBid"],
    });
  }
});

export const marketBidSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  listingId: marketIdentifierSchema,
  amount: marketMoneySchema,
  noticeApproval: noticeApprovalSchema,
}).strict();

export const marketCancelListingSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  listingId: marketIdentifierSchema,
}).strict();

export const marketExerciseLoanOptionSchema = z.object({
  code: roomCodeSchema,
  requestId: marketRequestIdSchema,
  loanId: marketIdentifierSchema,
  noticeApproval: noticeApprovalSchema,
}).strict();

const clubCareerRequestIdSchema = z.string().trim().min(8).max(128);
const clubCareerIdentifierSchema = z.string().trim().min(1).max(128);
const staffMoneySchema = z.coerce.number().int().min(1_000).max(10_000_000);

export const clubUpgradeSchema = z.object({
  code: roomCodeSchema,
  clubId: clubIdentifier,
  areaId: clubCareerIdentifierSchema,
  requestId: clubCareerRequestIdSchema,
  noticeApproval: noticeApprovalSchema,
}).strict();

export const clubStaffHireSchema = z.object({
  code: roomCodeSchema,
  clubId: clubIdentifier,
  staffId: clubCareerIdentifierSchema,
  requestId: clubCareerRequestIdSchema,
  years: z.coerce.number().int().min(1).max(8).default(3),
  wage: staffMoneySchema.optional(),
  signingBonus: z.coerce.number().int().min(0).max(100_000_000).optional(),
}).strict();

export const clubStaffFireSchema = z.object({
  code: roomCodeSchema,
  clubId: clubIdentifier,
  staffId: clubCareerIdentifierSchema,
  requestId: clubCareerRequestIdSchema,
  mutualAgreement: z.boolean().optional(),
}).strict();

export const clubStaffRenewSchema = z.object({
  code: roomCodeSchema,
  clubId: clubIdentifier,
  staffId: clubCareerIdentifierSchema,
  requestId: clubCareerRequestIdSchema,
  years: z.coerce.number().int().min(1).max(8).default(3),
  wage: staffMoneySchema,
  renewalBonus: z.coerce.number().int().min(0).max(100_000_000).optional(),
}).strict();

const professionalLifecycleActionSchema = z.enum([
  "notice_start",
  "notice_end_early",
  "retirement_announce",
  "retirement_postpone",
  "retirement_cancel",
  "mutual_agreement_propose",
  "mutual_agreement_counter",
  "mutual_agreement_accept",
  "mutual_agreement_reject",
  "mutual_agreement_sign",
  "preferred_staff_update",
  "staff_link_update",
  "staff_package_hire",
  "interim_confirm",
  "leave_start",
  "leave_end",
  "leave_cancel",
]);

const professionalLifecycleTermsSchema = z.object({
  confidentiality: z.boolean().optional(),
  preserveBonuses: z.boolean().optional(),
  pendingBonuses: z.coerce.number().finite().min(0).max(2_000_000_000).optional(),
  temporaryBenefits: z.coerce.number().finite().min(0).max(2_000_000_000).optional(),
  noticePay: z.coerce.number().finite().min(0).max(2_000_000_000).optional(),
  benefitsUntil: z.coerce.date().transform((value) => value.toISOString()).nullable().optional(),
  marketRelease: z.boolean().optional(),
  waiverRate: z.coerce.number().finite().min(0).max(1).optional(),
  reputationImpact: z.coerce.number().finite().min(-5).max(2).optional(),
  notes: z.string().trim().max(500).optional(),
}).strict();

const professionalStaffPackageMemberSchema = z.object({
  staffId: clubCareerIdentifierSchema,
  years: z.coerce.number().int().min(1).max(8).default(3),
  wage: staffMoneySchema.optional(),
  signingBonus: z.coerce.number().int().min(0).max(100_000_000).optional(),
  affiliationType: z.enum([
    "independent",
    "personal_team",
    "personal_staff",
    "coach_recommended",
    "inherited",
  ]).optional(),
}).strict();

const professionalLifecycleFields = {
  requestId: clubCareerRequestIdSchema,
  action: professionalLifecycleActionSchema,
  professionalType: z.enum(["coach", "staff"]).optional(),
  professionalId: clubCareerIdentifierSchema.optional(),
  coachId: clubCareerIdentifierSchema.optional(),
  staffId: clubCareerIdentifierSchema.optional(),
  lifecycleId: clubCareerIdentifierSchema.optional(),
  noticeId: clubCareerIdentifierSchema.optional(),
  retirementId: clubCareerIdentifierSchema.optional(),
  agreementId: clubCareerIdentifierSchema.optional(),
  leaveId: clubCareerIdentifierSchema.optional(),
  initiatedBy: z.enum(["coach", "club", "mutual", "system"]).optional(),
  reason: z.string().trim().min(2).max(500).optional(),
  noticeType: z.enum(["standard", "worked", "negotiated", "immediate"]).optional(),
  immediateExit: z.boolean().optional(),
  durationDays: z.coerce.number().int().min(0).max(730).optional(),
  effectiveAt: z.coerce.date().transform((value) => value.toISOString()).optional(),
  newEffectiveAt: z.coerce.date().transform((value) => value.toISOString()).optional(),
  proposedExitAt: z.coerce.date().transform((value) => value.toISOString()).optional(),
  startsAt: z.coerce.date().transform((value) => value.toISOString()).optional(),
  startDate: z.coerce.date().transform((value) => value.toISOString()).optional(),
  expectedEndAt: z.coerce.date().transform((value) => value.toISOString()).optional(),
  endDate: z.coerce.date().transform((value) => value.toISOString()).optional(),
  retirementType: z.enum([
    "planned",
    "scheduled",
    "immediate",
    "end_season",
    "end_contract",
    "end_of_season",
    "end_of_contract",
  ]).optional(),
  earlyExitAllowed: z.boolean().optional(),
  interviewPermission: z.boolean().optional(),
  compensation: z.coerce.number().finite().min(0).max(2_000_000_000).optional(),
  affiliationType: z.enum([
    "independent",
    "personal_team",
    "personal_staff",
    "coach_recommended",
    "inherited",
  ]).optional(),
  linkType: z.enum([
    "independent",
    "personal_team",
    "personal_staff",
    "coach_recommended",
    "inherited",
  ]).optional(),
  linkedCoachId: clubCareerIdentifierSchema.nullable().optional(),
  preferred: z.boolean().optional(),
  staffIds: z.array(clubCareerIdentifierSchema).max(30).optional(),
  members: z.array(professionalStaffPackageMemberSchema).min(1).max(30).optional(),
  maximumFirstYearCost: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  paymentType: z.enum(["full", "partial", "unpaid"]).optional(),
  paymentRate: z.coerce.number().finite().min(0).max(1).optional(),
  paymentNotes: z.string().trim().max(500).optional(),
  actingStaffId: clubCareerIdentifierSchema.optional(),
  temporaryBonus: z.coerce.number().int().min(0).max(100_000_000).optional(),
  authorityLevel: z.coerce.number().int().min(0).max(100).optional(),
  terms: professionalLifecycleTermsSchema.optional(),
};

function validateProfessionalLifecycle(value, context) {
  const recordId = value.lifecycleId
    ?? value.noticeId
    ?? value.retirementId
    ?? value.agreementId
    ?? value.leaveId;
  if ([
    "notice_end_early",
    "retirement_postpone",
    "retirement_cancel",
    "mutual_agreement_counter",
    "mutual_agreement_accept",
    "mutual_agreement_reject",
    "mutual_agreement_sign",
    "leave_end",
    "leave_cancel",
  ].includes(value.action) && !recordId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o ciclo profissional que sera alterado",
      path: ["lifecycleId"],
    });
  }
  const immediateNotice = value.immediateExit === true || value.noticeType === "immediate";
  if (value.action === "notice_start"
    && !immediateNotice
    && !value.effectiveAt
    && value.durationDays === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a data final ou a duracao do aviso",
      path: ["effectiveAt"],
    });
  }
  const retirementNeedsDate = !value.retirementType
    || ["planned", "scheduled"].includes(value.retirementType);
  if (value.action === "retirement_announce" && retirementNeedsDate && !value.effectiveAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a data prevista para aposentadoria",
      path: ["effectiveAt"],
    });
  }
  if (value.action === "retirement_postpone" && !value.effectiveAt && !value.newEffectiveAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a nova data da aposentadoria",
      path: ["effectiveAt"],
    });
  }
  if (value.action === "mutual_agreement_propose" && !value.proposedExitAt && !value.effectiveAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a data proposta para a saida",
      path: ["proposedExitAt"],
    });
  }
  if (value.action === "staff_link_update"
    && !value.affiliationType
    && !value.linkType) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o tipo de vinculo com o treinador",
      path: ["affiliationType"],
    });
  }
  if (value.action === "preferred_staff_update"
    && !value.staffId
    && !value.staffIds?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe ao menos um profissional da comissao",
      path: ["staffId"],
    });
  }
  if (value.action === "staff_package_hire" && !value.members?.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe os profissionais da contratacao conjunta",
      path: ["members"],
    });
  }
  if (value.action === "leave_start" && !value.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o motivo do afastamento",
      path: ["reason"],
    });
  }
  if (value.action === "leave_start"
    && !value.expectedEndAt
    && !value.endDate
    && !value.effectiveAt
    && value.durationDays === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o retorno previsto ou a duracao do afastamento",
      path: ["expectedEndAt"],
    });
  }
  if (value.action === "leave_start"
    && value.paymentType === "partial"
    && value.paymentRate === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o percentual de pagamento parcial",
      path: ["paymentRate"],
    });
  }
}

export const coachProfessionalLifecycleSchema = z.object({
  ...professionalLifecycleFields,
}).strict().superRefine(validateProfessionalLifecycle);

export const professionalLifecycleSocketSchema = z.object({
  code: roomCodeSchema,
  clubId: clubIdentifier,
  ...professionalLifecycleFields,
}).strict().superRefine(validateProfessionalLifecycle);

export const clubNewsReadSchema = z.object({
  code: roomCodeSchema,
  newsIds: z.array(z.string().trim().min(1).max(256)).min(1).max(100),
}).strict();

const careerPlayerIdSchema = z.string().trim().min(1).max(128);

export const careerTrainingPlanSchema = z.object({
  playerId: careerPlayerIdSchema,
  focus: z.enum(["balanced", "technical", "attacking", "defending", "physical", "goalkeeping", "recovery"]),
  intensity: z.enum(["low", "normal", "high"]),
  active: z.boolean().default(true),
}).strict();

export const careerContractRenewalSchema = z.object({
  playerId: careerPlayerIdSchema,
  years: z.coerce.number().int().min(1).max(8),
  wage: z.coerce.number().finite().min(0).max(10_000_000),
}).strict();

export const careerAcademyPromotionSchema = z.object({
  playerId: careerPlayerIdSchema,
  years: z.coerce.number().int().min(1).max(8).default(3),
  wage: z.coerce.number().finite().min(0).max(10_000_000).optional(),
}).strict();

const coachCareerRequestIdSchema = z.string().trim().min(8).max(128);
const coachCareerRecordIdSchema = z.string().trim().min(1).max(160);
const coachSalarySchema = z.coerce.number().int().min(1_000).max(50_000_000);
const coachBonusesSchema = z.record(
  z.coerce.number().int().min(0).max(2_000_000_000),
).refine((value) => Object.keys(value).length <= 20, "Informe no maximo 20 bonus");
const coachSportingTargetsSchema = z.array(z.string().trim().min(2).max(160)).max(20);
const coachSpecialClausesSchema = z.array(z.string().trim().min(2).max(240)).max(20);

export const coachProposalResponseSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  action: z.enum(["accept", "reject", "counter", "extend", "guarantee", "end", "provide_information"]),
  salary: coachSalarySchema.optional(),
  contractYears: z.coerce.number().int().min(1).max(8).optional(),
  signingBonus: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  terminationClause: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  bonuses: coachBonusesSchema.optional(),
  transferBudget: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  objectives: coachSportingTargetsSchema.optional(),
  specialClauses: coachSpecialClausesSchema.optional(),
  guarantee: z.string().trim().min(2).max(240).optional(),
  guaranteeResponsible: z.string().trim().min(2).max(120).optional(),
  guaranteeDeadline: z.coerce.date().transform((value) => value.toISOString()).optional(),
  guaranteeRequired: z.boolean().optional(),
  information: z.string().trim().min(2).max(1_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "counter"
    && value.salary === undefined
    && value.contractYears === undefined
    && value.signingBonus === undefined
    && value.terminationClause === undefined
    && value.bonuses === undefined
    && value.transferBudget === undefined
    && value.objectives === undefined
    && value.specialClauses === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Contraproposta exige salario ou duracao",
      path: ["salary"],
    });
  }
  if (value.action === "guarantee" && !value.guarantee) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a garantia solicitada",
      path: ["guarantee"],
    });
  }
  if (value.action === "provide_information" && !value.information) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe a resposta solicitada pela diretoria",
      path: ["information"],
    });
  }
});

const coachGuaranteeResolutionSchema = z.object({
  guaranteeId: coachCareerRecordIdSchema,
  status: z.enum(["formalized", "waived", "fulfilled"]),
  description: z.string().trim().min(2).max(240).optional(),
  responsible: z.string().trim().min(2).max(120).optional(),
  deadline: z.coerce.date().transform((value) => value.toISOString()).optional(),
  justification: z.string().trim().min(2).max(500).optional(),
  effects: z.array(z.object({
      type: z.enum([
        "salary_adjustment",
        "signing_bonus",
        "termination_clause",
        "benefit",
        "task",
        "contract_clause",
        "completion_block",
        "deadline_alert",
      ]),
    description: z.string().trim().min(2).max(240).optional(),
    amount: z.coerce.number().finite().min(0).max(2_000_000_000).optional(),
    required: z.boolean().optional(),
  }).strict()).max(20).optional(),
}).strict();

export const coachBoardProposalResponseSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  action: z.enum(["approve", "reject", "new_offer", "request_information"]),
  responsible: z.string().trim().min(2).max(120).optional(),
  justification: z.string().trim().min(2).max(500),
  salary: coachSalarySchema.optional(),
  contractYears: z.coerce.number().int().min(1).max(8).optional(),
  signingBonus: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  terminationClause: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  bonuses: coachBonusesSchema.optional(),
  transferBudget: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  objectives: coachSportingTargetsSchema.optional(),
  specialClauses: coachSpecialClausesSchema.optional(),
  informationRequest: z.string().trim().min(2).max(1_000).optional(),
  guaranteeResolutions: z.array(coachGuaranteeResolutionSchema).max(20).default([]),
}).strict().superRefine((value, context) => {
  if (value.action === "new_offer"
    && value.salary === undefined
    && value.contractYears === undefined
    && value.signingBonus === undefined
    && value.terminationClause === undefined
    && value.bonuses === undefined
    && value.transferBudget === undefined
    && value.objectives === undefined
    && value.specialClauses === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Nova proposta exige ao menos um valor ou condicao",
      path: ["salary"],
    });
  }
  if (value.action === "request_information" && !value.informationRequest) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Informe o que a diretoria precisa esclarecer",
      path: ["informationRequest"],
    });
  }
});

export const coachVacancyApplicationSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  message: z.string().trim().min(2).max(500).optional(),
}).strict();

export const coachInterviewResponseSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  answers: z.array(z.object({
    questionId: coachCareerRecordIdSchema,
    answerId: coachCareerRecordIdSchema,
  }).strict())
    .min(1)
    .max(12)
    .refine(
      (answers) => new Set(answers.map((answer) => answer.questionId)).size === answers.length,
      "Cada pergunta da entrevista aceita uma resposta",
    ),
}).strict();

export const coachInterviewStartSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  depth: z.enum(["quick", "standard", "deep"]).default("standard"),
}).strict();

export const coachInterviewTurnSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  message: z.string().trim().min(2).max(1_500),
  currentQuestionId: coachCareerRecordIdSchema.optional(),
  expectedRevision: z.coerce.number().int().min(0).max(10_000).optional(),
}).strict();

export const coachContractRenewalSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  years: z.coerce.number().int().min(1).max(8),
  salary: coachSalarySchema.optional(),
  signingBonus: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  terminationClause: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  bonuses: coachBonusesSchema.optional(),
  transferBudget: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  objectives: coachSportingTargetsSchema.optional(),
  specialClauses: coachSpecialClausesSchema.optional(),
}).strict();

export const coachResignationSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  reasonCode: z.enum([
    "personal_reasons",
    "new_challenge",
    "sporting_disagreement",
    "family_reasons",
    "health_reasons",
    "prolonged_squad_unrest",
    "prolonged_board_conflict",
    "persistent_financial_crisis",
    "unpaid_wages",
    "broken_promises",
    "toxic_environment",
    "board_breach",
  ]).optional(),
  reason: z.string().trim().min(2).max(240).optional(),
}).strict();

export const coachJobSearchSchema = z.object({
  requestId: coachCareerRequestIdSchema,
  active: z.boolean().default(true),
}).strict();

const socialSourceTypeSchema = z.enum(["imprensa", "clube", "jogador", "torcida"]);

export const socialAiFeedSchema = z.object({
  posts: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    source: z.string().trim().min(1).max(80),
    sourceType: socialSourceTypeSchema,
    headline: z.string().trim().min(1).max(180),
    body: z.string().trim().max(800),
    tag: z.string().trim().min(1).max(40).optional(),
    reactions: z.coerce.number().int().min(0).max(10_000_000).optional(),
  }).strict()).min(1).max(8),
}).strict();

export const socialPostCreateSchema = z.object({
  message: z.string().trim().min(1).max(500),
  requestId: z.string().trim().min(8).max(128).optional(),
}).strict();

const pressConferenceQuestionIdSchema = z.enum(["result", "possession", "performance"]);

export const pressConferenceCreateSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  answers: z.array(z.object({
    questionId: pressConferenceQuestionIdSchema,
    answerId: z.string().trim().min(1).max(64),
  }).strict())
    .length(3)
    .refine(
      (answers) => new Set(answers.map((answer) => answer.questionId)).size === 3,
      "Cada pergunta deve possuir exatamente uma resposta",
    ),
}).strict();

export const newsPostIdSchema = z.string().trim().min(1).max(128);

export const socialCommentCreateSchema = z.object({
  message: z.string().trim().min(1).max(320),
  parentCommentId: z.string().trim().min(1).max(128),
  requestId: z.string().trim().min(8).max(128).optional(),
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
