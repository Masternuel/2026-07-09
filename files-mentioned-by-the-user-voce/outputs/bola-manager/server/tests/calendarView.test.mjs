import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fixture(overrides = {}) {
  return {
    fixtureId: "fixture-1",
    round: 1,
    scheduledAt: "2026-07-20T19:00:00.000Z",
    competition: "Liga Nacional",
    homeClubId: "AUR",
    awayClubId: "SAN",
    homeTeam: "Aurora FC",
    awayTeam: "Santos",
    homeManagerId: "manager-1",
    awayManagerId: null,
    managerIds: ["manager-1"],
    ...overrides,
  };
}

function room(overrides = {}) {
  return {
    code: "BOLA-CAL",
    status: "active",
    seasonYear: 2026,
    seasonStartedAt: "2026-07-01T00:00:00.000Z",
    currentFixtureId: "fixture-1",
    completedFixtureIds: [],
    fixtureSchedule: [fixture()],
    clubCareerState: {
      currentDate: "2026-07-15T00:00:00.000Z",
      facilityProjects: [],
      staffMembers: [],
      staffContracts: [],
      professionalLifecycle: [],
    },
    ...overrides,
  };
}

let vite;
let CalendarView;
let buildCalendarItems;
let buildCalendarSchedule;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ CalendarView } = await vite.ssrLoadModule("/src/views/season/CalendarView.tsx"));
  ({ buildCalendarItems, buildCalendarSchedule } = await vite.ssrLoadModule("/src/views/season/calendarItems.ts"));
});

after(async () => {
  await vite?.close();
});

function renderCalendar(currentRoom, managerClubId = "AUR") {
  return renderToStaticMarkup(React.createElement(CalendarView, {
    room: currentRoom,
    managerClubId,
    onNavigate() {},
  }));
}

test("calendario vazio carrega sem fixtures ou compromissos inventados", () => {
  const html = renderCalendar(null);

  assert.deepEqual(buildCalendarItems(null, "AUR"), []);
  assert.match(html, /Carregando calend[aá]rio/i);
  assert.doesNotMatch(html, /Aurora FC|Recupera[cç][aã]o|Treinos|Viagens|Descanso|Sincronizar/i);
});

test("agenda usa todos os compromissos reais projetados e a data virtual do save", () => {
  const futureFixtures = [
    fixture({ fixtureId: "fixture-2", round: 2, scheduledAt: "2026-07-27T19:00:00.000Z", awayClubId: "DOI", awayTeam: "Clube Dois" }),
    fixture({ fixtureId: "fixture-3", round: 3, scheduledAt: "2026-08-03T19:00:00.000Z", awayClubId: "TRE", awayTeam: "Clube Três" }),
    fixture({ fixtureId: "fixture-4", round: 4, scheduledAt: "2026-08-10T19:00:00.000Z", awayClubId: "QUA", awayTeam: "Clube Quatro" }),
    fixture({ fixtureId: "fixture-5", round: 5, scheduledAt: "2026-08-17T19:00:00.000Z", awayClubId: "CIN", awayTeam: "Clube Cinco" }),
  ];
  const currentRoom = room({
    fixtureSchedule: [fixture(), ...futureFixtures],
    clubCareerState: {
      currentDate: "2026-07-15T00:00:00.000Z",
      facilityProjects: [{
        id: "project-1",
        clubId: "AUR",
        name: "Centro de treinamento",
        category: "infrastructure",
        expectedAt: "2026-07-22T00:00:00.000Z",
        status: "active",
      }],
      staffMembers: [{ id: "staff-1", clubId: "AUR", name: "Analista Silva", role: "Analista" }],
      staffContracts: [{
        id: "contract-1",
        staffId: "staff-1",
        clubId: "AUR",
        endDate: "2026-08-01T00:00:00.000Z",
        status: "active",
      }],
      professionalLifecycle: [{
        id: "notice-1",
        kind: "notice",
        professionalType: "staff",
        professionalId: "staff-1",
        clubId: "AUR",
        status: "active",
        endsAt: "2026-08-02T00:00:00.000Z",
      }],
    },
  });

  const items = buildCalendarItems(currentRoom, "aur");
  const html = renderCalendar(currentRoom);

  assert.equal(items.filter((item) => item.kind === "fixture").length, 5);
  assert.equal(items.filter((item) => item.kind === "facility-project").length, 1);
  assert.equal(items.filter((item) => item.kind === "staff-contract").length, 1);
  assert.equal(items.filter((item) => item.kind === "lifecycle").length, 1);
  assert.match(html, /Aurora FC/);
  assert.match(html, /Clube Cinco/);
  assert.match(html, /Centro de treinamento/);
  assert.match(html, /Fim do contrato/);
  assert.match(html, /Fim do aviso pr[eé]vio/);
  assert.match(html, /Hoje[^<]*[·]?[^<]*15[^<]*JUL/i);
  assert.doesNotMatch(html, /Recupera[cç][aã]o|Treinos|Viagens|Descanso|Sincronizar/i);
});

test("remarcacao substitui a data anterior sem manter estado derivado antigo", () => {
  const original = room();
  const rescheduled = room({
    revision: 2,
    fixtureSchedule: [fixture({ scheduledAt: "2026-07-29T21:30:00.000Z" })],
  });

  assert.equal(buildCalendarItems(original, "AUR")[0].scheduledAt, "2026-07-20T19:00:00.000Z");
  assert.equal(buildCalendarItems(rescheduled, "AUR")[0].scheduledAt, "2026-07-29T21:30:00.000Z");
  const html = renderCalendar(rescheduled);
  assert.doesNotMatch(html, /<strong>20<\/strong><small>JUL<\/small>/);
  assert.match(html, /<strong>29<\/strong><small>JUL<\/small>/);
});

test("itens concluidos ou cancelados desaparecem da agenda", () => {
  const currentRoom = room({
    completedFixtureIds: ["fixture-completed"],
    fixtureSchedule: [
      fixture({ fixtureId: "fixture-1", status: "cancelled" }),
      fixture({ fixtureId: "fixture-completed", awayTeam: "Partida concluída" }),
    ],
    clubCareerState: {
      currentDate: "2026-07-15T00:00:00.000Z",
      facilityProjects: [{ id: "project-cancelled", clubId: "AUR", name: "Obra cancelada", expectedAt: "2026-07-22T00:00:00.000Z", status: "cancelled" }],
      staffMembers: [],
      staffContracts: [{ id: "contract-ended", staffId: "staff-1", clubId: "AUR", endDate: "2026-08-01T00:00:00.000Z", status: "expired" }],
      professionalLifecycle: [{ id: "notice-ended", kind: "notice", professionalType: "staff", professionalId: "staff-1", clubId: "AUR", status: "completed", endsAt: "2026-08-02T00:00:00.000Z" }],
    },
  });
  const html = renderCalendar(currentRoom);

  assert.deepEqual(buildCalendarItems(currentRoom, "AUR"), []);
  assert.doesNotMatch(html, /Aurora FC|Partida conclu[ií]da|Obra cancelada/);
  assert.match(html, /Nenhum compromisso pendente/);
});

test("agenda filtra todas as fontes pelo clube do manager", () => {
  const currentRoom = room({
    fixtureSchedule: [
      fixture(),
      fixture({ fixtureId: "fixture-other", homeClubId: "BET", awayClubId: "GAM", homeTeam: "Beta", awayTeam: "Gama" }),
    ],
    clubCareerState: {
      currentDate: "2026-07-15T00:00:00.000Z",
      facilityProjects: [
        { id: "project-own", clubId: "AUR", name: "Obra Aurora", category: "infrastructure", expectedAt: "2026-07-22T00:00:00.000Z", status: "active" },
        { id: "project-other", clubId: "BET", name: "Obra rival", category: "infrastructure", expectedAt: "2026-07-23T00:00:00.000Z", status: "active" },
      ],
      staffMembers: [],
      staffContracts: [],
      professionalLifecycle: [],
    },
  });

  const ownSchedule = buildCalendarSchedule(currentRoom, "AUR");
  const rivalSchedule = buildCalendarSchedule(currentRoom, "BET");

  assert.deepEqual(ownSchedule.fixtures.map((item) => item.fixture.fixtureId), ["fixture-1"]);
  assert.deepEqual(rivalSchedule.fixtures.map((item) => item.fixture.fixtureId), ["fixture-other"]);
  assert.match(renderCalendar(currentRoom, "AUR"), /Obra Aurora/);
  assert.doesNotMatch(renderCalendar(currentRoom, "AUR"), /Beta|Gama|Obra rival/);
});

test("fixture legado sem data continua real e aparece como a definir", () => {
  const legacyRoom = room({ fixtureSchedule: [fixture({ scheduledAt: null })] });
  const items = buildCalendarItems(legacyRoom, "AUR");
  const html = renderCalendar(legacyRoom);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "fixture");
  assert.equal(items[0].scheduledAt, null);
  assert.match(html, /Data ainda n[aã]o definida/);
  assert.match(html, /A definir/i);
});

test("problema real do calendario substitui mensagem generica de migracao", () => {
  const issueRoom = room({
    currentFixtureId: null,
    fixtureSchedule: [],
    scheduleIssue: { code: "LEAGUE_NEEDS_CLUBS", message: "Cadastre dois clubes ativos no Editor." },
  });
  const html = renderCalendar(issueRoom);

  assert.match(html, /Calend[aá]rio indispon[ií]vel/);
  assert.match(html, /Cadastre dois clubes ativos no Editor/);
  assert.doesNotMatch(html, /Confirme a pr[oó]xima partida|migrar este save/i);
});
