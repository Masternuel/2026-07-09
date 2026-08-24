import assert from "node:assert/strict";
import test from "node:test";
import {
  CAREER_EVENT_TYPES,
  CAREER_RETENTION_LIMITS,
  CareerEventError,
  appendCareerEvent,
  appendCareerEvents,
  buildCareerNews,
  careerArchiveForSeason,
  careerArchiveSummary,
  careerNewsForManager,
  createCareerEvent,
  ensureClubCareerState,
  markCareerNewsRead,
  projectPendingCareerNews,
  setCareerNewsReadState,
  unreadCareerNewsCount,
} from "../domain/careerEvents.mjs";

const WHEN = "2026-08-02T19:00:00.000Z";

function event(type, operationId, payload = {}) {
  return { type, operationId, occurredAt: WHEN, seasonNumber: 1, payload };
}

test("evento e noticia usam identidade deterministica e nao duplicam em retry", () => {
  const room = { clubCareerState: { customDomain: { preserved: true } } };
  const input = event(CAREER_EVENT_TYPES.MATCH_COMPLETED, "match:fixture-1", {
    fixtureId: "fixture-1",
    homeClubId: "SAN",
    homeClubName: "Santos",
    awayClubId: "PAL",
    awayClubName: "Palmeiras",
    score: [2, 1],
    competitionId: "BRA-A",
    competitionName: "Brasileirão Série A",
    round: 1,
  });

  const first = appendCareerEvent(room, input);
  const retry = appendCareerEvent(room, {
    ...input,
    id: "outro-id-do-mesmo-retry",
    payload: { ...input.payload, score: [9, 9] },
  });

  assert.equal(first.event.id, "MATCH_COMPLETED:match:fixture-1");
  assert.equal(first.created, true);
  assert.equal(first.newsCreated, true);
  assert.equal(retry.created, false);
  assert.equal(retry.newsCreated, false);
  assert.deepEqual(retry.event.payload.score, [2, 1], "evento imutavel vence payload divergente de retry");
  assert.equal(room.clubCareerState.events.length, 1);
  assert.equal(room.clubCareerState.news.length, 1);
  assert.equal(room.clubCareerState.news[0].id, `career-news:${first.event.id}`);
  assert.equal(room.clubCareerState.news[0].eventId, first.event.id);
  assert.match(room.clubCareerState.news[0].title, /Santos 2 x 1 Palmeiras/);
  assert.deepEqual(room.clubCareerState.customDomain, { preserved: true });
  assert.ok(room.clubCareerState.processedEventIds.includes(first.event.id));
  assert.ok(room.clubCareerState.processedEventIds.includes("operation:MATCH_COMPLETED:match:fixture-1"));
});

test("evento exige identificador e data fornecidos pelo dominio", () => {
  assert.throws(
    () => createCareerEvent({ type: "MATCH_COMPLETED", occurredAt: WHEN }),
    (error) => error instanceof CareerEventError && error.code === "CAREER_EVENT_ID_REQUIRED",
  );
  assert.throws(
    () => createCareerEvent({ type: "MATCH_COMPLETED", operationId: "m1" }),
    (error) => error instanceof CareerEventError && error.code === "CAREER_EVENT_OCCURRED_AT_REQUIRED",
  );
  const normalized = createCareerEvent({
    type: " player-injured ",
    operationId: "injury:p1",
    occurredAt: WHEN,
    payload: { playerId: "p1", bad: undefined, infinity: Number.POSITIVE_INFINITY },
  });
  assert.equal(normalized.type, "PLAYER_INJURED");
  assert.equal("bad" in normalized.payload, false);
  assert.equal(normalized.payload.infinity, null);
});

test("projetor cobre fatos de mercado, disponibilidade, staff, obras, contratos, base e premio", () => {
  const cases = [
    [CAREER_EVENT_TYPES.TRANSFER_COMPLETED, {
      player: { id: "p1", name: "Ana Silva" }, fromClubId: "A", fromClubName: "Aurora",
      toClubId: "B", toClubName: "Boreal", amount: 12_000_000,
    }, "Boreal anuncia Ana Silva", "mercado"],
    [CAREER_EVENT_TYPES.TRANSFER_SCHEDULED, {
      playerName: "Bia", toClubName: "Celta", effectiveSeason: 2,
    }, "Bia acerta transferência futura", "mercado"],
    [CAREER_EVENT_TYPES.LOAN_STARTED, {
      playerName: "Caio", lenderClubName: "Celta", borrowerClubName: "Delta",
    }, "Delta recebe Caio por empréstimo", "mercado"],
    [CAREER_EVENT_TYPES.LOAN_RETURNED, {
      playerName: "Davi", lenderClubName: "Aurora",
    }, "Davi retorna ao Aurora", "mercado"],
    [CAREER_EVENT_TYPES.LOAN_PURCHASED, {
      playerName: "Eva", borrowerClubName: "Boreal", purchaseAmount: 4_000_000,
    }, "Boreal confirma compra de Eva", "mercado"],
    [CAREER_EVENT_TYPES.PLAYER_INJURED, {
      playerName: "Fábio", clubName: "Aurora", injuryMatches: 3,
    }, "Fábio sofre lesão", "departamento_medico"],
    [CAREER_EVENT_TYPES.PLAYER_RETURNED_FROM_INJURY, {
      playerName: "Gabi", clubName: "Aurora",
    }, "Gabi volta a ficar disponível", "departamento_medico"],
    [CAREER_EVENT_TYPES.PLAYER_SUSPENDED, {
      playerName: "Heitor", clubName: "Aurora", suspensionMatches: 1,
    }, "Heitor está suspenso", "disciplina"],
    [CAREER_EVENT_TYPES.STAFF_HIRED, {
      staff: { name: "Iara" }, clubName: "Aurora", role: "Fisioterapeuta",
    }, "Iara chega ao Aurora", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.STAFF_FIRED, {
      staffName: "João", clubName: "Aurora", role: "Olheiro",
    }, "João deixa o Aurora", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.STAFF_CONTRACT_RENEWED, {
      staffName: "Katia", clubName: "Aurora", role: "Analista", endSeason: 3,
    }, "Katia renova com Aurora", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.STAFF_CONTRACT_EXPIRED, {
      staffName: "Leo", clubName: "Aurora", role: "Médico",
    }, "Leo encerra vínculo com Aurora", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_STARTED, {
      professionalType: "coach", coachName: "Marta", clubName: "Aurora",
    }, "Marta inicia afastamento", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.PROFESSIONAL_LEAVE_COMPLETED, {
      professionalType: "staff", staffName: "Nina", clubName: "Aurora",
    }, "Nina retorna ao trabalho", "comissao_tecnica"],
    [CAREER_EVENT_TYPES.STADIUM_UPGRADE_STARTED, {
      clubName: "Aurora", projectName: "Nova cobertura",
    }, "Aurora inicia Nova cobertura", "estadio"],
    [CAREER_EVENT_TYPES.STADIUM_UPGRADE_COMPLETED, {
      clubName: "Aurora", projectName: "Nova cobertura",
    }, "Aurora conclui Nova cobertura", "estadio"],
    [CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_STARTED, {
      clubName: "Aurora", projectName: "Centro médico nível 2",
    }, "Aurora inicia Centro médico nível 2", "infraestrutura"],
    [CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_COMPLETED, {
      clubName: "Aurora", projectName: "Centro médico nível 2",
    }, "Aurora conclui Centro médico nível 2", "infraestrutura"],
    [CAREER_EVENT_TYPES.PLAYER_CONTRACT_RENEWED, {
      playerName: "Mia", clubName: "Aurora", endSeason: 4,
    }, "Mia renova com Aurora", "contratos"],
    [CAREER_EVENT_TYPES.PLAYER_CONTRACT_EXPIRED, {
      playerName: "Nina", clubName: "Aurora",
    }, "Nina deixa o Aurora ao fim do contrato", "contratos"],
    [CAREER_EVENT_TYPES.YOUTH_PROMOTED, {
      playerName: "Otávio", clubName: "Aurora",
    }, "Aurora promove Otávio", "base"],
    [CAREER_EVENT_TYPES.PRIZE_RECEIVED, {
      clubName: "Aurora", competitionName: "Copa Nacional", amount: 8_000_000, reason: "título",
    }, "Aurora recebe premiação", "financas"],
  ];

  for (const [type, payload, title, category] of cases) {
    const news = buildCareerNews(event(type, `operation:${type}`, payload));
    assert.ok(news, type);
    assert.equal(news.title, title, type);
    assert.equal(news.category, category, type);
    assert.equal(news.eventType, type, type);
    assert.equal(news.publishedAt, WHEN, type);
    assert.ok(news.summary.endsWith("."), type);
  }
});

test("eventos de treinador geram noticias factuais sem expor termos da proposta", () => {
  const cases = [
    [CAREER_EVENT_TYPES.COACH_APPOINTED, "Aurora anuncia Marta", { coachName: "Marta", clubName: "Aurora", reason: "novo projeto" }],
    [CAREER_EVENT_TYPES.COACH_DISMISSED, "Aurora demite Marta", { coachName: "Marta", clubName: "Aurora", reason: "resultados abaixo da meta" }],
    [CAREER_EVENT_TYPES.COACH_RESIGNED, "Marta deixa o Aurora", { coachName: "Marta", clubName: "Aurora", reason: "decisão pessoal" }],
    [CAREER_EVENT_TYPES.COACH_INTERIM_APPOINTED, "Marta assume interinamente o Aurora", { coachName: "Marta", clubName: "Aurora", reason: "vacância" }],
    [CAREER_EVENT_TYPES.COACH_INTERIM_CONFIRMED, "Aurora efetiva Marta", { coachName: "Marta", clubName: "Aurora", reason: "bom desempenho" }],
    [CAREER_EVENT_TYPES.COACH_CONTRACT_RENEWED, "Marta renova com Aurora", { coachName: "Marta", clubName: "Aurora", endSeason: 3 }],
    [CAREER_EVENT_TYPES.COACH_PROPOSAL_RECEIVED, "Boreal demonstra interesse em Marta", {
      coachName: "Marta", clubName: "Boreal", salary: 900_000, releaseClause: 5_000_000,
    }],
    [CAREER_EVENT_TYPES.COACH_SEARCH_STARTED, "Aurora inicia busca por treinador", { clubName: "Aurora", reason: "cargo vago" }],
    [CAREER_EVENT_TYPES.COACH_NEGOTIATION_FAILED, "Aurora e Marta encerram negociação", { coachName: "Marta", clubName: "Aurora", reason: "sem acordo" }],
    [CAREER_EVENT_TYPES.COACH_BECAME_UNEMPLOYED, "Marta está livre no mercado", { coachName: "Marta", clubName: "Aurora", reason: "fim do contrato" }],
    [CAREER_EVENT_TYPES.COACH_CHANGED_CLUB, "Boreal anuncia Marta", {
      coachName: "Marta", fromClubName: "Aurora", toClubName: "Boreal", reason: "novo desafio",
    }],
  ];

  for (const [type, title, payload] of cases) {
    const news = buildCareerNews(event(type, `coach:${type}`, payload));
    assert.ok(news, type);
    assert.equal(news.title, title, type);
    assert.equal(news.category, "treinadores", type);
    assert.deepEqual(news.coachIds, [], type);
    assert.ok(news.summary.endsWith("."), type);
    assert.equal(news.summary.includes("900.000"), false, "salário não entra em notícia pública");
    assert.equal(news.summary.includes("5.000.000"), false, "cláusula não entra em notícia pública");
  }
});

test("evento de treinador enriquece nomes do save e permanece idempotente", () => {
  const room = {
    currentSeason: 2,
    competitionCatalog: [{ id: "BRA-A", clubs: [{ id: "A", name: "Aurora" }] }],
    coachEmploymentState: {
      version: 1,
      coaches: [{ id: "coach-1", name: "Marta Lima", managerType: "ai", currentClubId: "A" }],
      contracts: [],
    },
  };
  const input = {
    type: CAREER_EVENT_TYPES.COACH_DISMISSED,
    operationId: "coach-dismiss:coach-1:A:2",
    occurredAt: WHEN,
    coachId: "coach-1",
    clubId: "A",
    payload: { reason: "sequência negativa" },
  };

  const first = appendCareerEvent(room, input);
  const retry = appendCareerEvent(room, { ...input, id: "retry-com-outro-id" });

  assert.equal(first.news.title, "Aurora demite Marta Lima");
  assert.match(first.news.summary, /sequência negativa/);
  assert.deepEqual(first.news.coachIds, ["coach-1"]);
  assert.equal(retry.created, false);
  assert.equal(retry.newsCreated, false);
  assert.equal(room.clubCareerState.events.length, 1);
  assert.equal(room.clubCareerState.news.length, 1);
});

test("fato incompleto ou tipo sem projetor nao inventa noticia e continua idempotente", () => {
  const room = {};
  const missingFacts = appendCareerEvent(room, event(CAREER_EVENT_TYPES.TRANSFER_COMPLETED, "transfer:bad", {
    playerName: "Sem destino",
  }));
  const unsupported = appendCareerEvent(room, event("TRAINING_SESSION_COMPLETED", "training:1", {
    clubName: "Aurora",
  }));
  projectPendingCareerNews(room);

  assert.equal(missingFacts.news, null);
  assert.equal(unsupported.news, null);
  assert.equal(room.clubCareerState.events.length, 2);
  assert.equal(room.clubCareerState.news.length, 0);
  assert.ok(room.clubCareerState.processedEventIds.includes(missingFacts.event.id));
  assert.ok(room.clubCareerState.processedEventIds.includes(unsupported.event.id));
});

test("projecao completa nomes somente a partir das entidades reais do save", () => {
  const room = {
    competitionCatalog: [{
      id: "BRA-A", name: "Brasileirão Série A", clubs: [{ id: "A", name: "Aurora" }, { id: "B", name: "Boreal" }],
    }],
    careerState: { players: [{ id: "p1", name: "Ana", clubId: "A" }] },
    clubCareerState: {},
  };
  const facility = appendCareerEvent(room, {
    type: CAREER_EVENT_TYPES.INFRASTRUCTURE_UPGRADE_STARTED,
    id: "facility-start:upgrade-1",
    operationId: "upgrade-1",
    occurredAt: WHEN,
    clubIds: ["A"],
    payload: { projectId: "facility:upgrade-1", name: "Departamento médico" },
  });
  const transfer = appendCareerEvent(room, {
    type: CAREER_EVENT_TYPES.TRANSFER_COMPLETED,
    operationId: "transfer-1",
    occurredAt: WHEN,
    clubIds: ["A", "B"],
    playerIds: ["p1"],
    payload: { playerId: "p1", fromClubId: "A", toClubId: "B", amount: 1_000_000 },
  });

  assert.equal(facility.news.title, "Aurora inicia Departamento médico");
  assert.equal(transfer.news.title, "Boreal anuncia Ana");
  assert.match(transfer.news.summary, /Aurora/);
});

test("eventos da comissao tecnica usam o schema real do staff engine", () => {
  const room = {
    competitionCatalog: [{ id: "BRA-A", clubs: [{ id: "A", name: "Aurora" }] }],
    clubCareerState: {
      staffMembers: [],
      staffCandidates: [{ id: "staff-1", name: "Renata Campos", role: "fitness_coach" }],
      staffContracts: [{
        id: "staff-contract-1",
        staffId: "staff-1",
        clubId: "A",
        status: "expired",
        endDate: "2026-08-02T19:00:00.000Z",
        endSeason: 1,
      }],
    },
  };
  const result = appendCareerEvent(room, {
    id: "staff-event:expire-1",
    operationId: "staff-expire:staff-contract-1",
    type: CAREER_EVENT_TYPES.STAFF_CONTRACT_EXPIRED,
    staffId: "staff-1",
    clubId: "A",
    contractId: "staff-contract-1",
    occurredAt: WHEN,
    seasonNumber: 1,
    metadata: { role: "fitness_coach" },
  });

  assert.equal(result.event.staffId, "staff-1");
  assert.equal(result.event.contractId, "staff-contract-1");
  assert.equal(result.event.payload.role, "fitness_coach");
  assert.equal(result.news.title, "Renata Campos encerra vínculo com Aurora");
  assert.match(result.news.summary, /fitness_coach/);
});

test("eventos podem ser registrados antes da projecao e processados depois uma unica vez", () => {
  const room = {};
  appendCareerEvents(room, [
    event(CAREER_EVENT_TYPES.YOUTH_PROMOTED, "youth:1", { playerName: "Rui", clubName: "Aurora" }),
    event(CAREER_EVENT_TYPES.PLAYER_INJURED, "injury:1", { playerName: "Sara", clubName: "Aurora" }),
  ], { projectNews: false });
  assert.equal(room.clubCareerState.news.length, 0);
  assert.equal(room.clubCareerState.processedEventIds.length, 0);

  const first = projectPendingCareerNews(room);
  const second = projectPendingCareerNews(room);
  assert.deepEqual(first.map((item) => item.created), [true, true]);
  assert.deepEqual(second.map((item) => item.created), [false, false]);
  assert.equal(room.clubCareerState.news.length, 2);
});

test("estado de leitura pertence ao manager e sobrevive serializacao e retry", () => {
  const room = {};
  const { news } = appendCareerEvent(room, event(CAREER_EVENT_TYPES.YOUTH_PROMOTED, "youth:2", {
    playerName: "Téo", playerId: "p2", clubName: "Aurora", clubId: "A",
  }));
  assert.equal(unreadCareerNewsCount(room, "manager-a", { clubId: "A" }), 1);

  markCareerNewsRead(room, news.id, "manager-a", "2026-08-02T20:00:00.000Z");
  assert.equal(unreadCareerNewsCount(room, "manager-a", { clubId: "A" }), 0);
  assert.equal(unreadCareerNewsCount(room, "manager-b", { clubId: "A" }), 1);
  assert.equal(careerNewsForManager(room, "manager-a", { clubId: "A" })[0].read, true);

  appendCareerEvent(room, event(CAREER_EVENT_TYPES.YOUTH_PROMOTED, "youth:2", {
    playerName: "Téo", clubName: "Aurora", clubId: "A",
  }));
  const reloaded = JSON.parse(JSON.stringify(room));
  ensureClubCareerState(reloaded);
  assert.equal(careerNewsForManager(reloaded, "manager-a", { clubId: "A" })[0].read, true);
  assert.equal(reloaded.clubCareerState.news[0].readAtByManagerId["manager-a"], "2026-08-02T20:00:00.000Z");

  setCareerNewsReadState(reloaded, news.id, "manager-a", false);
  assert.equal(unreadCareerNewsCount(reloaded, "manager-a", { clubId: "A" }), 1);
});

test("migracao segura preserva outros dominios e elimina somente duplicatas invalidas", () => {
  const originalEvent = createCareerEvent(event(CAREER_EVENT_TYPES.PLAYER_INJURED, "injury:migrate", {
    playerName: "Uma", clubName: "Aurora",
  }));
  const room = {
    clubCareerState: {
      financialTransactions: [{ id: "tx-1" }],
      events: [originalEvent, { ...originalEvent, id: "retry-id" }, { id: "legacy-facility-event" }, null],
      news: [{
        id: "legacy-news",
        eventId: originalEvent.id,
        eventType: originalEvent.type,
        title: "Notícia preservada",
        readByManagerIds: ["m1", "m1"],
      }],
      processedEventIds: [originalEvent.id, originalEvent.id],
    },
  };
  const state = ensureClubCareerState(room);

  assert.equal(state.events.length, 2);
  assert.equal(state.events.some((item) => item.id === "legacy-facility-event"), true);
  assert.equal(state.news.length, 1);
  assert.deepEqual(state.news[0].readByManagerIds, ["m1"]);
  assert.deepEqual(state.financialTransactions, [{ id: "tx-1" }]);
  assert.equal(state.processedEventIds.filter((id) => id === originalEvent.id).length, 1);
  assert.deepEqual(state.careerArchive, { version: 1, seasons: [] });
});

test("retencao limita eventos, noticias e ids recentes sem alterar fatos ou leitura retidos", () => {
  const total = CAREER_RETENTION_LIMITS.events + 7;
  const events = [];
  const news = [];
  for (let index = 0; index < total; index += 1) {
    const current = createCareerEvent({
      type: CAREER_EVENT_TYPES.YOUTH_PROMOTED,
      operationId: `retention:${index}`,
      occurredAt: new Date(Date.parse(WHEN) + index * 1_000).toISOString(),
      clubId: "A",
      payload: { playerName: `Atleta ${index}`, clubName: "Aurora", clubId: "A" },
    });
    const bulletin = buildCareerNews(current);
    if (index === total - 1) {
      bulletin.readByManagerIds = ["manager-a"];
      bulletin.readAtByManagerId = { "manager-a": "2026-08-03T00:00:00.000Z" };
    }
    events.push(current);
    news.push(bulletin);
  }
  const room = {
    clubCareerState: {
      events,
      news,
      processedEventIds: Array.from(
        { length: CAREER_RETENTION_LIMITS.recentProcessedIds + 23 },
        (_, index) => `processed:${index}`,
      ),
    },
  };

  const state = ensureClubCareerState(room);

  assert.equal(state.events.length, CAREER_RETENTION_LIMITS.events);
  assert.equal(state.news.length, CAREER_RETENTION_LIMITS.news);
  assert.equal(state.processedEventIds.length, CAREER_RETENTION_LIMITS.recentProcessedIds);
  assert.equal(state.events.at(-1).payload.playerName, `Atleta ${total - 1}`);
  assert.equal(state.news.at(-1).title, `Aurora promove Atleta ${total - 1}`);
  assert.deepEqual(state.news.at(-1).readByManagerIds, ["manager-a"]);
  assert.equal(state.news.at(-1).readAtByManagerId["manager-a"], "2026-08-03T00:00:00.000Z");
  assert.equal(careerNewsForManager(room, "manager-a", { clubId: "A" })[0].read, true);
  assert.equal(state.processedEventArchive.version, 1);
  assert.ok(state.processedEventArchive.count >= 23);
  assert.ok(Object.keys(state.processedEventArchive.buckets).length > 0);
  assert.equal("processedEventBloom" in state, false);
});

test("arquivo compacto preserva fatos por temporada, leitura e limites depois do reload", () => {
  const total = CAREER_RETENTION_LIMITS.events + 10;
  const inputs = Array.from({ length: total }, (_, index) => ({
    type: CAREER_EVENT_TYPES.YOUTH_PROMOTED,
    operationId: `archive:${index}`,
    occurredAt: new Date(Date.parse(WHEN) + index * 1_000).toISOString(),
    seasonNumber: index < 400 ? 1 : index < 800 ? 2 : 3,
    clubId: "A",
    payload: { playerName: `Atleta ${index}`, clubName: "Aurora", clubId: "A" },
  }));
  const events = inputs.map(createCareerEvent);
  const room = {
    currentSeason: 3,
    clubCareerState: {
      events,
      news: events.map(buildCareerNews),
      processedEventIds: [],
    },
  };

  ensureClubCareerState(room);

  const firstSeason = careerArchiveForSeason(room, 1);
  const secondSeason = careerArchiveForSeason(room, 2);
  assert.equal(firstSeason.eventCount, 10);
  assert.equal(firstSeason.newsCount, 400);
  assert.equal(firstSeason.eventTypeCounts.YOUTH_PROMOTED, 10);
  assert.equal(secondSeason.eventCount, 0);
  assert.equal(secondSeason.newsCount, 110);
  assert.ok(firstSeason.highlights.length <= CAREER_RETENTION_LIMITS.archiveHighlightsPerSeason);
  assert.ok(secondSeason.highlights.length <= CAREER_RETENTION_LIMITS.archiveHighlightsPerSeason);
  assert.equal(room.clubCareerState.events.length, CAREER_RETENTION_LIMITS.events);
  assert.equal(room.clubCareerState.news.length, CAREER_RETENTION_LIMITS.news);
  assert.ok(JSON.stringify(careerArchiveSummary(room)).length < 30_000);

  const archivedNewsId = `career-news:${events[399].id}`;
  setCareerNewsReadState(room, archivedNewsId, "manager-a", true, "2028-01-02T00:00:00.000Z");
  const archivedNews = careerNewsForManager(room, "manager-a", {
    clubId: "A",
    limit: Number.MAX_SAFE_INTEGER,
    includeArchived: true,
  }).find((item) => item.id === archivedNewsId);
  assert.equal(archivedNews.archived, true);
  assert.equal(archivedNews.read, true);
  assert.equal(careerArchiveForSeason(room, 1).readNewsCountByManagerId["manager-a"], 1);

  const beforeRetry = careerArchiveSummary(room);
  const reloaded = JSON.parse(JSON.stringify(room));
  ensureClubCareerState(reloaded);
  assert.deepEqual(careerArchiveSummary(reloaded), beforeRetry);
  const retry = appendCareerEvent(reloaded, inputs[0]);
  assert.equal(retry.created, false);
  assert.equal(retry.newsCreated, false);
  assert.deepEqual(careerArchiveSummary(reloaded), beforeRetry);
  assert.equal(
    careerNewsForManager(reloaded, "manager-a", {
      clubId: "A",
      limit: Number.MAX_SAFE_INTEGER,
      includeArchived: true,
    }).find((item) => item.id === archivedNewsId)?.read,
    true,
  );
});

test("evento podado permanece idempotente depois de salvar e recarregar", () => {
  const inputs = Array.from({ length: CAREER_RETENTION_LIMITS.events + 1 }, (_, index) => ({
    type: CAREER_EVENT_TYPES.YOUTH_PROMOTED,
    operationId: `pruned:${index}`,
    occurredAt: new Date(Date.parse(WHEN) + index * 1_000).toISOString(),
    clubId: "A",
    payload: { playerName: `Atleta ${index}`, clubName: "Aurora", clubId: "A" },
  }));
  const firstEvent = createCareerEvent(inputs[0]);
  const room = {
    clubCareerState: {
      events: inputs.map(createCareerEvent),
      news: [],
      processedEventIds: [],
    },
  };

  ensureClubCareerState(room);
  assert.equal(room.clubCareerState.events.some((item) => item.id === firstEvent.id), false);

  const reloaded = JSON.parse(JSON.stringify(room));
  const retry = appendCareerEvent(reloaded, inputs[0]);
  const secondRetry = appendCareerEvent(reloaded, { ...inputs[0], id: "retry-com-id-divergente" });

  assert.equal(retry.created, false);
  assert.equal(retry.newsCreated, false);
  assert.equal(secondRetry.created, false, "a chave por operacao tambem sobrevive a poda");
  assert.equal(reloaded.clubCareerState.events.length, CAREER_RETENTION_LIMITS.events);
  assert.equal(reloaded.clubCareerState.events.some((item) => item.operationId === "pruned:0"), false);
  assert.equal(reloaded.clubCareerState.news.length, 0);
});
