import assert from "node:assert/strict";
import test from "node:test";
import {
  CAREER_EVENT_TYPES,
  buildCareerNews,
} from "../domain/careerEvents.mjs";

const WHEN = "2026-08-02T19:00:00.000Z";

function news(type, payload) {
  return buildCareerNews({
    type,
    operationId: `lifecycle-news:${type}`,
    occurredAt: WHEN,
    seasonNumber: 1,
    payload,
  });
}

test("adiamento e cancelamento de aposentadoria geram noticias", () => {
  const payload = {
    professionalType: "coach",
    coachName: "Marta Lima",
    clubName: "Aurora",
  };
  assert.equal(
    news(CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_POSTPONED, payload)?.title,
    "Marta Lima adia aposentadoria",
  );
  assert.equal(
    news(CAREER_EVENT_TYPES.PROFESSIONAL_RETIREMENT_CANCELLED, payload)?.title,
    "Marta Lima cancela aposentadoria",
  );
});

test("rede preferencial, vinculo e pedido de saida da comissao geram noticias", () => {
  const coach = {
    professionalType: "coach",
    coachName: "Marta Lima",
    clubName: "Aurora",
  };
  const staff = {
    professionalType: "staff",
    staffName: "Renata Campos",
    clubName: "Aurora",
  };

  assert.equal(
    news(CAREER_EVENT_TYPES.COACH_PREFERRED_STAFF_UPDATED, coach)?.title,
    "Marta Lima atualiza comissão preferencial",
  );
  assert.equal(
    news(CAREER_EVENT_TYPES.COACH_PREFERRED_STAFF_REMOVED, coach)?.title,
    "Marta Lima altera comissão preferencial",
  );
  assert.equal(
    news(CAREER_EVENT_TYPES.STAFF_COACH_LINK_UPDATED, staff)?.title,
    "Renata Campos atualiza vínculo com treinador",
  );
  assert.equal(
    news(CAREER_EVENT_TYPES.STAFF_RESIGNED, staff)?.title,
    "Renata Campos deixa Aurora",
  );
});
