import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoomPersistence } from "../store/roomPersistence.mjs";
import { RoomStore } from "../store/roomStore.mjs";

const NOW = new Date("2026-07-21T12:00:00.000Z");

const catalogStore = {
  async listCompetitionCatalog() {
    return [{
      id: "BR-A",
      name: "Brasileirao Serie A",
      country: "Brasil",
      division: "Serie A",
      clubs: [
        { id: "AUR", code: "AUR", name: "Aurora FC", reputation: 72, leagueId: "BR-A" },
        { id: "SAN", code: "SAN", name: "Santos", reputation: 76, leagueId: "BR-A" },
      ],
    }];
  },
};

function createStore(persistence, options = {}) {
  return new RoomStore({
    persistence,
    catalogStore,
    codeFactory: () => "COACH-R1",
    now: () => new Date(NOW),
    coachInterviewAi: options.coachInterviewAi,
  });
}

async function startTwoManagerCareer(persistence = new MemoryRoomPersistence(), options = {}) {
  const store = createStore(persistence, options);
  const created = await store.createRoom({
    name: "Mercado de treinadores",
    creatorId: "manager-1",
    creatorName: "Emanuel",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    maxManagers: 2,
  });
  await store.joinRoom(created.code, {
    managerId: "manager-2",
    managerName: "Carol",
    clubId: "SAN",
  });
  await store.setReady(created.code, "manager-1", true);
  await store.setReady(created.code, "manager-2", true);
  await store.startRoom(created.code, "manager-1");
  await persistence.mutate(created.code, (room) => {
    for (const coach of room.coachCareerState.coaches) {
      if (coach.managerType === "human") coach.reputation = 75;
    }
    return room;
  });
  return { store, persistence, code: created.code };
}

test("entrevista generativa persiste conversa, avaliacao e memoria depois do reload", async () => {
  const persistence = new MemoryRoomPersistence();
  const calls = [];
  const coachInterviewAi = {
    async generateTurn(input) {
      calls.push(structuredClone(input));
      if (input.phase === "start") {
        return {
          source: "gemini",
          model: "gemini-test",
          message: "Como voce pretende recuperar a confianca do elenco do Santos?",
          topic: "leadership",
          shouldEnd: false,
          turnAnalysis: {
            confidenceDelta: 0,
            credibilityDelta: 0,
            strategicAlignment: 50,
            culturalFit: 50,
            perceivedRisk: 50,
            expectedTenure: 50,
          },
          memorySummary: "Entrevista iniciada para a vaga do Santos.",
        };
      }
      return {
        source: "gemini",
        model: "gemini-test",
        message: "A diretoria concluiu a avaliacao.",
        topic: "closing",
        shouldEnd: true,
        turnAnalysis: {
          confidenceDelta: 4,
          credibilityDelta: 3,
          strategicAlignment: 82,
          culturalFit: 78,
          perceivedRisk: 24,
          expectedTenure: 76,
        },
        evaluation: {
          overall: 81,
          boardConfidence: 84,
          clubCompatibility: 82,
          squadCompatibility: 79,
          leadership: 86,
          tacticalVision: 78,
          financialAlignment: 74,
          longTermPotential: 80,
          culturalFit: 78,
          credibility: 83,
          perceivedRisk: 24,
          strengths: ["Lideranca clara"],
          risks: ["Exige tempo para implantar o modelo"],
          recommendation: "hire",
          summary: "Perfil recomendado para conduzir o projeto.",
        },
        negotiationEffects: {
          salaryMultiplier: 1.04,
          bonusMultiplier: 1.1,
          contractYearsDelta: 1,
          transferBudgetMultiplier: 1.05,
          autonomyDelta: 4,
          priorityDelta: 6,
          objectiveDifficultyDelta: 2,
          terminateNegotiation: false,
        },
        memorySummary: "Prometeu lideranca direta e recuperacao gradual da confianca.",
      };
    },
  };
  const { store, code } = await startTwoManagerCareer(persistence, { coachInterviewAi });
  await store.resignCoach(code, "manager-2", {
    requestId: "coach-resign-for-generative-interview",
    reason: "new_challenge",
  });
  await persistence.mutate(code, (room) => {
    const vacancy = room.coachEmploymentState?.vacancies?.find(
      (candidate) => candidate.status === "open" && candidate.clubId === "SAN",
    );
    assert.ok(vacancy);
    vacancy.openedAt = "2026-07-13T12:00:00.000Z";
    room.coachEmploymentState.marketConfig = {
      ...(room.coachEmploymentState.marketConfig ?? {}),
      interviewChance: 100,
      interviewDelayDays: 0,
    };
    return room;
  });

  const searched = await store.setCoachJobSearch(code, "manager-1", {
    requestId: "coach-search-for-generative-interview",
    active: true,
  });
  const pending = searched.coachCareer.interviews.find(({ status }) => status === "awaiting_answers");
  assert.ok(pending, "o processo deve agendar entrevista para o manager");

  const started = await store.startCoachInterview(code, "manager-1", pending.id, {
    requestId: "coach-generative-interview-start",
    depth: "deep",
  });
  const active = started.coachCareer.interviews.find(({ id }) => id === pending.id);
  assert.equal(active.depth, "deep");
  assert.equal(active.source, "gemini");
  assert.equal(active.transcript.length, 1);

  let current = active;
  for (let turn = 1; turn <= 4; turn += 1) {
    const completed = await store.answerCoachInterviewTurn(code, "manager-1", pending.id, {
      requestId: `coach-generative-interview-turn-${turn}`,
      message: `Resposta contextual ${turn}: vou ouvir os lideres e definir responsabilidades claras.`,
      currentQuestionId: current.currentQuestionId,
      expectedRevision: current.revision,
    });
    current = completed.coachCareer.interviews.find(({ id }) => id === pending.id);
  }
  const result = current;
  assert.equal(result.status, "accepted");
  assert.equal(result.transcript.length, 9);
  assert.equal(result.evaluation.overallScore, 81);
  assert.equal(result.negotiationEffects.durationYearsDelta, 1);
  assert.match(result.memorySummary, /lideranca direta/i);
  assert.equal(calls.length, 5);
  assert.equal(calls[0].context.club.name, "Santos");
  assert.equal(calls[1].transcript.length, 1);

  const reloaded = createStore(persistence, { coachInterviewAi });
  const persisted = await reloaded.getCoachCareerSnapshot(code, "manager-1");
  const persistedInterview = persisted.interviews.find(({ id }) => id === pending.id);
  assert.equal(persistedInterview.evaluation.overallScore, 81);
  assert.equal(persistedInterview.transcript.length, 9);
  assert.match(persistedInterview.memorySummary, /lideranca direta/i);
  const persistedRoom = await reloaded.getRoom(code);
  const persistedCoach = persistedRoom.coachCareerState.coaches.find(({ id }) => id === "manager-1");
  assert.equal(persistedCoach.interviewMemories.some(({ interviewId }) => interviewId === pending.id), true);
});

async function prepareImmediateCoachOffer(persistence, code) {
  await persistence.mutate(code, (room) => {
    const vacancy = room.coachEmploymentState?.vacancies?.find(
      (candidate) => candidate.status === "open" && candidate.clubId === "SAN",
    );
    assert.ok(vacancy, "vaga do Santos deve estar aberta");
    vacancy.openedAt = "2026-07-13T12:00:00.000Z";
    room.coachEmploymentState.marketConfig = {
      ...(room.coachEmploymentState.marketConfig ?? {}),
      interviewChance: 0,
    };
    return room;
  });
}

test("RoomStore persiste carreira, renuncia e snapshot privado depois do reload", async () => {
  const persistence = new MemoryRoomPersistence();
  const store = createStore(persistence);
  const created = await store.createRoom({
    name: "Carreira dos treinadores",
    creatorId: "manager-1",
    creatorName: "Emanuel",
    clubId: "AUR",
    activeLeagues: ["BR-A"],
    seasonLength: 3,
    maxManagers: 2,
  });
  await store.setReady(created.code, "manager-1", true);
  await store.startRoom(created.code, "manager-1");

  const employed = await store.getCoachCareerSnapshot(created.code, "manager-1");
  assert.equal(employed.coach.id, "manager-1");
  assert.equal(employed.activeEmployment.clubId, "AUR");
  assert.equal(employed.contracts.filter(({ status }) => status === "active").length, 1);

  const resigned = await store.resignCoach(created.code, "manager-1", {
    requestId: "coach-resign-store-1",
    reason: "new_challenge",
  });
  assert.equal(resigned.coachCareer.activeEmployment, null);
  assert.equal(resigned.coachCareer.coach.currentClubId, null);
  assert.equal(resigned.coachCareer.vacancies.some(({ club }) => club.id === "AUR"), true);

  const reloadedStore = createStore(persistence);
  const reloaded = await reloadedStore.getCoachCareerSnapshot(created.code, "manager-1");
  assert.equal(reloaded.activeEmployment, null);
  assert.equal(reloaded.coach.status, "resigned");
  assert.equal(reloaded.assignments.some(({ club }) => club.id === "AUR" && Boolean(club)), true);
  const persistedRoom = await reloadedStore.getRoom(created.code);
  assert.equal(persistedRoom.managers.find(({ id }) => id === "manager-1").clubId, null);
  assert.equal(persistedRoom.coachEmploymentState.appointments.some((appointment) => (
    appointment.clubId === "AUR" && appointment.status === "active" && appointment.role === "interim"
  )), true);
  assert.deepEqual(
    persistedRoom.clubCareerState.events
      .filter(({ type }) => ["COACH_RESIGNED", "COACH_INTERIM_APPOINTED", "COACH_SEARCH_STARTED"].includes(type))
      .map(({ type }) => type)
      .sort(),
    ["COACH_INTERIM_APPOINTED", "COACH_RESIGNED", "COACH_SEARCH_STARTED"],
  );
  assert.equal(
    persistedRoom.clubCareerState.news.filter(({ eventType }) => eventType === "COACH_SEARCH_STARTED").length,
    1,
    "a abertura da vaga gera uma unica noticia mesmo quando renuncia e interino referenciam a vaga",
  );
});

test("proposta de treinador fica privada e somente o fracasso vira noticia publica sem termos", async () => {
  const { store, persistence, code } = await startTwoManagerCareer();
  await store.resignCoach(code, "manager-2", {
    requestId: "coach-resign-for-private-proposal",
    reason: "new_challenge",
  });
  await prepareImmediateCoachOffer(persistence, code);
  const searched = await store.setCoachJobSearch(code, "manager-1", {
    requestId: "coach-search-private-proposal",
    active: true,
  });
  const proposal = searched.coachCareer.proposals.find(({ status }) => status === "pending");
  assert.ok(proposal, "a vaga deve gerar proposta privada ao manager interessado");
  assert.equal((await store.getCoachCareerSnapshot(code, "manager-2")).proposals.length, 0);

  const beforeResponse = await store.getRoom(code);
  assert.equal(
    beforeResponse.clubCareerState.events.some(({ type }) => type === "COACH_PROPOSAL_RECEIVED"),
    false,
    "a proposta ainda pendente nao entra no historico publico",
  );
  assert.equal(
    beforeResponse.clubCareerState.news.some(({ eventType }) => eventType === "COACH_PROPOSAL_RECEIVED"),
    false,
  );

  await store.respondCoachProposal(code, "manager-1", proposal.id, {
    requestId: "coach-reject-private-proposal",
    action: "reject",
  });
  const afterResponse = await store.getRoom(code);
  const failedEvents = afterResponse.clubCareerState.events
    .filter(({ type }) => type === "COACH_NEGOTIATION_FAILED");
  const failedNews = afterResponse.clubCareerState.news
    .filter(({ eventType }) => eventType === "COACH_NEGOTIATION_FAILED");
  assert.equal(failedEvents.length, 1);
  assert.equal(failedNews.length, 1);
  assert.equal(JSON.stringify(failedNews).includes(String(proposal.terms.salary)), false);
  assert.equal(JSON.stringify(failedNews).includes(String(proposal.terms.releaseClause)), false);

  const reloaded = createStore(persistence);
  const persisted = await reloaded.getRoom(code);
  assert.equal(
    persisted.clubCareerState.news.filter(({ eventType }) => eventType === "COACH_NEGOTIATION_FAILED").length,
    1,
    "reload nao reprojeta a mesma noticia",
  );
});

test("diretoria da sala responde contraproposta em transacao owner-only e persiste no reload", async () => {
  const { store, persistence, code } = await startTwoManagerCareer();
  await store.resignCoach(code, "manager-2", {
    requestId: "coach-resign-for-board-decision",
    reason: "new_challenge",
  });
  await prepareImmediateCoachOffer(persistence, code);
  const searched = await store.setCoachJobSearch(code, "manager-1", {
    requestId: "coach-search-for-board-decision",
    active: true,
  });
  const proposal = searched.coachCareer.proposals.find(({ status }) => status === "pending");
  assert.ok(proposal);

  const countered = await store.respondCoachProposal(code, "manager-1", proposal.id, {
    requestId: "coach-counter-for-board-decision",
    action: "counter",
    salary: Number(proposal.terms.salary ?? 100_000) + 10_000,
    contractYears: 3,
  });
  assert.equal(
    countered.coachCareer.proposals.find(({ id }) => id === proposal.id).status,
    "aguardando_resposta_diretoria",
  );

  await assert.rejects(
    () => store.respondCoachBoardDecision(code, "manager-2", proposal.id, {
      requestId: "coach-board-decision-forbidden",
      action: "approve",
      justification: "Tentativa sem autoridade",
    }),
    (error) => error.code === "OWNER_REQUIRED" && error.status === 403,
  );

  const approved = await store.respondCoachBoardDecision(code, "manager-1", proposal.id, {
    requestId: "coach-board-decision-approved",
    action: "approve",
    justification: "Termos aprovados pela diretoria",
  });
  assert.equal(
    approved.coachCareer.proposals.find(({ id }) => id === proposal.id).status,
    "aprovada_diretoria",
  );

  const reloaded = createStore(persistence);
  const persisted = await reloaded.getCoachCareerSnapshot(code, "manager-1");
  assert.equal(
    persisted.proposals.find(({ id }) => id === proposal.id).status,
    "aprovada_diretoria",
  );
});

test("troca de clube gera um unico evento factual com origem e destino", async () => {
  const { store, persistence, code } = await startTwoManagerCareer();
  await store.resignCoach(code, "manager-2", {
    requestId: "coach-resign-for-club-change",
    reason: "new_challenge",
  });
  await prepareImmediateCoachOffer(persistence, code);
  const searched = await store.setCoachJobSearch(code, "manager-1", {
    requestId: "coach-search-for-club-change",
    active: true,
  });
  const proposal = searched.coachCareer.proposals.find(({ status }) => status === "pending");
  assert.ok(proposal);

  await store.respondCoachProposal(code, "manager-1", proposal.id, {
    requestId: "coach-accept-club-change",
    action: "accept",
  });
  const room = await store.getRoom(code);
  const changedEvents = room.clubCareerState.events.filter(({ type }) => type === "COACH_CHANGED_CLUB");
  const changedNews = room.clubCareerState.news.filter(({ eventType }) => eventType === "COACH_CHANGED_CLUB");
  assert.equal(changedEvents.length, 1);
  assert.deepEqual(changedEvents[0].payload.fromClubId, "AUR");
  assert.deepEqual(changedEvents[0].payload.toClubId, "SAN");
  assert.deepEqual(changedEvents[0].clubIds, ["AUR", "SAN"]);
  assert.equal(changedNews.length, 1);
  assert.match(changedNews[0].summary, /Aurora FC/);
  assert.match(changedNews[0].summary, /Santos/);

  const reloaded = createStore(persistence);
  const persisted = await reloaded.getRoom(code);
  assert.equal(
    persisted.clubCareerState.news.filter(({ eventType }) => eventType === "COACH_CHANGED_CLUB").length,
    1,
  );
});
