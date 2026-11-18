import assert from "node:assert/strict";
import test from "node:test";
import {
  coachProfessionalLifecycleSchema,
  professionalLifecycleSocketSchema,
} from "../schemas.mjs";

const base = {
  requestId: "lifecycle-schema-001",
  action: "retirement_announce",
  professionalType: "coach",
  professionalId: "coach-1",
};

test("aposentadoria sem data aceita somente modos com data calculada pelo dominio", () => {
  for (const retirementType of [
    "immediate",
    "end_season",
    "end_contract",
    "end_of_season",
    "end_of_contract",
  ]) {
    assert.equal(coachProfessionalLifecycleSchema.safeParse({
      ...base,
      retirementType,
    }).success, true, retirementType);
  }

  for (const retirementType of ["scheduled", "planned"]) {
    const result = coachProfessionalLifecycleSchema.safeParse({
      ...base,
      retirementType,
    });
    assert.equal(result.success, false, retirementType);
  }
});

test("saida imediata nao exige data e aviso comum continua validado", () => {
  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "notice_start",
    noticeType: "immediate",
    immediateExit: true,
  }).success, true);

  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "notice_start",
    noticeType: "standard",
  }).success, false);
});

test("termos financeiros e observacoes atravessam HTTP e socket", () => {
  const terms = {
    confidentiality: true,
    preserveBonuses: true,
    pendingBonuses: "12000",
    temporaryBenefits: "8000",
    noticePay: "24000",
    reputationImpact: "-1.5",
    notes: "Beneficio medico mantido por 60 dias.",
  };
  const http = coachProfessionalLifecycleSchema.parse({
    ...base,
    action: "mutual_agreement_propose",
    proposedExitAt: "2026-09-01T12:00:00.000Z",
    terms,
  });
  const socket = professionalLifecycleSocketSchema.parse({
    ...base,
    code: "BOLA-A123",
    clubId: "club-1",
    action: "mutual_agreement_propose",
    proposedExitAt: "2026-09-01T12:00:00.000Z",
    terms,
  });

  assert.deepEqual(http.terms, {
    ...terms,
    pendingBonuses: 12_000,
    temporaryBenefits: 8_000,
    noticePay: 24_000,
    reputationImpact: -1.5,
  });
  assert.deepEqual(socket.terms, http.terms);
});

test("afastamento valida periodo, motivo, pagamento e identificador de retorno", () => {
  const valid = coachProfessionalLifecycleSchema.parse({
    ...base,
    action: "leave_start",
    reason: "tratamento medico",
    startsAt: "2026-08-01T12:00:00.000Z",
    expectedEndAt: "2026-09-01T12:00:00.000Z",
    paymentType: "partial",
    paymentRate: "0.6",
    actingStaffId: "assistant-1",
    temporaryBonus: "25000",
    authorityLevel: "70",
  });
  assert.equal(valid.paymentRate, 0.6);
  assert.equal(valid.temporaryBonus, 25_000);
  assert.equal(valid.authorityLevel, 70);

  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "leave_start",
    expectedEndAt: "2026-09-01T12:00:00.000Z",
  }).success, false, "motivo obrigatorio");
  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "leave_start",
    reason: "motivo pessoal",
    paymentType: "partial",
    durationDays: 30,
  }).success, false, "percentual parcial obrigatorio");
  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "leave_end",
  }).success, false, "retorno exige leaveId");
  assert.equal(coachProfessionalLifecycleSchema.safeParse({
    ...base,
    action: "leave_cancel",
    leaveId: "leave-1",
  }).success, true);
});
