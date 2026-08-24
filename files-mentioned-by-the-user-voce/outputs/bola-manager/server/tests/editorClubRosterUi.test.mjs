import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import reactPlugin from "@vitejs/plugin-react";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const club = {
  id: "CHE", name: "Chelsea", abbreviation: "CHE", colors: ["#143c8c"],
  darkThemeColor: "#4d83e5", lightThemeColor: "#143c8c", stadium: "Stamford Bridge",
  stadiumCapacity: 40_341, reputation: 18, division: "Premier League", country: "Inglaterra",
  state: null, city: "Londres", leagueId: "ENG-1", budget: 180_000_000,
  crestImageUrl: null, crestImagePath: null, active: true,
};
const players = [
  {
    id: "CHE-10", clubId: "CHE", name: "Cole Palmer", isStar: true, position: "MEI", age: 23,
    nationality: "Inglaterra", shirtNumber: 10, overall: 18,
    attributes: { velocidade: 17, chute: 18, drible: 18, nocao: 18, defesa: 8, passe: 18, peBom: 19, peRuim: 12 },
    avatarImageUrl: null, avatarImagePath: null, active: true,
  },
  {
    id: "CHE-1", clubId: "CHE", name: "Robert Sanchez", isStar: false, position: "GOL", age: 27,
    nationality: "Espanha", shirtNumber: 1, overall: 15,
    attributes: { velocidade: 8, chute: 6, drible: 7, nocao: 15, defesa: 17, passe: 12, peBom: 14, peRuim: 8 },
    avatarImageUrl: null, avatarImagePath: null, active: false,
  },
  {
    id: "ARS-7", clubId: "ARS", name: "Bukayo Saka", isStar: true, position: "PD", age: 23,
    nationality: "Inglaterra", shirtNumber: 7, overall: 18,
    attributes: { velocidade: 18, chute: 17, drible: 18, nocao: 18, defesa: 8, passe: 17, peBom: 19, peRuim: 12 },
    avatarImageUrl: null, avatarImagePath: null, active: true,
  },
];

let vite;
let EditorClubRosterPanel;
let EditorRecordForm;
let nextEditorClubInspectorTab;
let geography;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    plugins: [reactPlugin()],
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ EditorClubRosterPanel, nextEditorClubInspectorTab } = await vite.ssrLoadModule("/src/components/editor/EditorClubRosterPanel.tsx"));
  ({ EditorRecordForm } = await vite.ssrLoadModule("/src/components/editor/EditorRecordForm.tsx"));
  geography = await vite.ssrLoadModule("/src/utils/editorGeography.ts");
});

after(async () => {
  await vite?.close();
});

function renderRoster(overrides = {}) {
  return renderToStaticMarkup(React.createElement(EditorClubRosterPanel, {
    club,
    players,
    playerCount: 2,
    activeTab: "players",
    loading: false,
    loadingMore: false,
    hasMore: true,
    error: null,
    pending: false,
    onTabChange() {},
    onAdd() {},
    onEdit() {},
    onDelete() {},
    onLoadMore() {},
    ...overrides,
  }));
}

test("painel contextual mostra apenas o elenco do clube, estrela, status e acoes", () => {
  const html = renderRoster();
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /Chelsea/);
  assert.match(html, /2 jogadores/);
  assert.match(html, /Cole Palmer/);
  assert.match(html, /Jogador estrela/);
  assert.match(html, /MEI · 23 anos · #10/);
  assert.match(html, /OVR/);
  assert.match(html, /Arquivado/);
  assert.match(html, /aria-label="Editar Cole Palmer"/);
  assert.match(html, /aria-label="Excluir Cole Palmer"/);
  assert.match(html, /Carregar mais/);
  assert.doesNotMatch(html, /Bukayo Saka/);
});

test("painel contextual cobre estado vazio em portugues", () => {
  const html = renderRoster({ players: [], playerCount: 0, hasMore: false });
  assert.match(html, /Este clube ainda não tem jogadores/);
  assert.match(html, /Adicionar jogador/);
  assert.doesNotMatch(html, /Carregar mais/);
});

test("tabs suportam teclado e nao antecipam contador zero durante a busca", () => {
  assert.equal(nextEditorClubInspectorTab("details", "ArrowRight"), "players");
  assert.equal(nextEditorClubInspectorTab("players", "ArrowLeft"), "details");
  assert.equal(nextEditorClubInspectorTab("players", "Home"), "details");
  assert.equal(nextEditorClubInspectorTab("details", "End"), "players");
  assert.equal(nextEditorClubInspectorTab("details", "Enter"), null);

  const html = renderRoster({ players: [], playerCount: null, loading: true, hasMore: false });
  assert.match(html, /Quantidade de jogadores carregando/);
  assert.match(html, /Carregando…/);
  assert.doesNotMatch(html, /0 jogadores/);
});

test("formulario contextual predefine e bloqueia o clube do novo jogador", () => {
  const html = renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "players",
    mode: "create",
    record: null,
    leagues: [],
    clubs: [club],
    pending: false,
    initialClubId: club.id,
    lockedClubId: club.id,
    async onSubmit(record) { return record; },
    async onRemoveMedia(record) { return record; },
    onCancel() {},
    async onArchive() {},
    onDelete() {},
  }));
  assert.match(html, /Definido pelo clube aberto/);
  assert.match(html, /<select[^>]*disabled="">/);
  assert.match(html, /<option value="CHE" selected="">Chelsea<\/option>/);
});

test("formulario tolera clube legado sem cores", () => {
  const html = renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "clubs",
    mode: "edit",
    record: { ...club, colors: undefined },
    leagues: [],
    clubs: [],
    pending: false,
    async onSubmit(record) { return record; },
    async onRemoveMedia(record) { return record; },
    onCancel() {},
    async onArchive() {},
    onDelete() {},
  }));
  assert.match(html, /aria-label="Cor primária hexadecimal"[^>]*value="#c8ff3d"/);
});

test("formulario nomeia nacionalidade e estado legados em seletores com seta", () => {
  assert.equal(geography.normalizeNationality("29"), "Brasil");
  assert.equal(geography.normalizeNationality("PAIS-65"), "Espanha");
  assert.equal(geography.normalizeNationality(97), "Inglaterra");
  assert.equal(geography.normalizeBrazilianState("0"), "AC");
  assert.equal(geography.normalizeBrazilianState(10), "MG");
  assert.equal(geography.normalizeBrazilianState("25"), "SP");
  assert.equal(geography.normalizeBrazilianState("Minas Gerais"), "MG");
  assert.deepEqual(
    geography.nationalityOptionsFor("PAIS-999")[0],
    { value: "PAIS-999", label: "Código importado: PAIS-999" },
  );

  const clubHtml = renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "clubs",
    mode: "edit",
    record: { ...club, country: "BRA", state: "10" },
    leagues: [],
    clubs: [],
    pending: false,
    async onSubmit(record) { return record; },
    async onRemoveMedia(record) { return record; },
    onCancel() {},
    async onArchive() {},
    onDelete() {},
  }));
  assert.match(clubHtml, /aria-label="Selecionar estado do clube"/);
  assert.match(clubHtml, /<option value="MG" selected="">Minas Gerais \(MG\)<\/option>/);

  const playerHtml = renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "players",
    mode: "edit",
    record: { ...players[0], nationality: "PAIS-65" },
    leagues: [],
    clubs: [club],
    pending: false,
    async onSubmit(record) { return record; },
    async onRemoveMedia(record) { return record; },
    onCancel() {},
    async onArchive() {},
    onDelete() {},
  }));
  assert.match(playerHtml, /aria-label="Selecionar nacionalidade do jogador"/);
  assert.match(playerHtml, /<option value="Espanha" selected="">Espanha<\/option>/);
  assert.match(`${clubHtml}${playerHtml}`, /lucide-chevron-down/);
});

test("exclusao pelo elenco abre o modal com a entidade players", async () => {
  const source = await readFile(path.join(projectRoot, "src/views/editor/EditorView.tsx"), "utf8");
  assert.match(source, /onDelete=\{\(player\) => openDelete\('players', player, true\)\}/);
  assert.match(source, /entity=\{deleteTarget\?\.entity \?\? entity\}/);
  assert.equal(source.includes("key={`club-player-${selectedClub.id}-${clubRosterMode}"), true);
  assert.equal(source.includes("key={`record-${entity}-${mode}"), true);
});
