import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const club = {
  id: "AUR", name: "Aurora", abbreviation: "AUR", colors: ["#c8ff3d"],
  darkThemeColor: null, lightThemeColor: null, stadium: "Boreal", stadiumCapacity: 30_000,
  reputation: 15, division: "Serie A", country: "Brasil", state: "SP", city: "Sao Paulo",
  leagueId: "BR-A", budget: 50_000_000, crestImageUrl: null, crestImagePath: null, active: true,
};

const internalAttributes = {
  velocidade: 12, chute: 13, drible: 14, nocao: 16, defesa: 18, passe: 15, peBom: 16, peRuim: 8,
  forca: 14, resistencia: 15, impulsao: 13, reflexos: 19, posicionamentoGol: 18, saidaGol: 17, penaltis: 12,
};

function editorPlayer(position = "MC") {
  return {
    id: `AUR-${position}`, clubId: "AUR", name: position === "GOL" ? "Caio Goleiro" : "Caio Meio",
    isStar: false, position, age: 24, nationality: "Brasil", shirtNumber: position === "GOL" ? 1 : 8,
    overall: 16, attributes: { ...internalAttributes }, avatarImageUrl: null, avatarImagePath: null, active: true,
  };
}

function visualPlayer(position, overrides = {}) {
  const source = editorPlayer(position);
  return {
    id: source.id, name: source.name, shortName: source.name.split(" ").at(-1), isStar: false,
    number: source.shirtNumber, position, role: position, age: 24, nationality: "Brasil", value: 1_000_000,
    wage: 10_000, condition: 100, morale: "Boa", status: "Disponivel", foot: "Direito",
    personality: "Profissional", worldStar: 5,
    attributes: Object.fromEntries(Object.entries(internalAttributes).map(([key, value]) => [key, value / 2])),
    ...overrides,
  };
}

let vite;
let EditorRecordForm;
let profilePlayersFromLocalRoster;
let SquadView;
let AuthContext;
let mutationPayload;
let calculatePlayerOverall;
let playerGoalkeeperRating;
let playerPhysicalRating;
let playerPositionRating;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    esbuild: { jsx: 'automatic' },
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  ({ EditorRecordForm } = await vite.ssrLoadModule("/src/components/editor/EditorRecordForm.tsx"));
  ({ profilePlayersFromLocalRoster } = await vite.ssrLoadModule("/src/components/player/playerProfileModel.ts"));
  ({ SquadView } = await vite.ssrLoadModule("/src/views/SquadView.tsx"));
  ({ AuthContext } = await vite.ssrLoadModule("/src/auth/AuthContext.tsx"));
  ({ mutationPayload } = await vite.ssrLoadModule("/src/hooks/useEditorCatalog.ts"));
  ({ calculatePlayerOverall, playerGoalkeeperRating, playerPhysicalRating, playerPositionRating } = await vite.ssrLoadModule("/src/utils/playerRating.ts"));
});

after(async () => {
  await vite?.close();
});

function renderEditor(record) {
  return renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "players", mode: "edit", record, leagues: [], clubs: [club], pending: false,
    async onSubmit(next) { return next; }, async onRemoveMedia(next) { return next; },
    onCancel() {}, async onArchive() {}, onDelete() {},
  }));
}

function fold(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function renderSquad(props) {
  return renderToStaticMarkup(React.createElement(AuthContext.Provider, {
    value: { identity: null, getIdToken: async () => null },
  }, React.createElement(SquadView, props)));
}

test("Editor separa tecnicos e fisicos e so mostra bloco de goleiro para GOL", () => {
  const outfield = renderEditor(editorPlayer("MC"));
  assert.match(fold(outfield), /ATRIBUTOS TECNICOS/i);
  assert.match(fold(outfield), /ATRIBUTOS FISICOS/i);
  assert.match(fold(outfield), /Forca/i);
  assert.match(fold(outfield), /Resistencia/i);
  assert.doesNotMatch(outfield, /ATRIBUTOS DE GOLEIRO/i);

  const goalkeeper = renderEditor(editorPlayer("GOL"));
  assert.match(goalkeeper, /ATRIBUTOS DE GOLEIRO/i);
  assert.match(goalkeeper, /Reflexos/i);
  assert.match(fold(goalkeeper), /Saida do gol/i);
  assert.match(fold(goalkeeper), /Penaltis/i);
});

test("normalizacao do Editor preserva legado e envia defaults internos novos", () => {
  const legacy = editorPlayer("ZAG");
  legacy.attributes = {
    velocidade: 12, chute: 8, drible: 7, nocao: 14, defesa: 16, passe: 11, peBom: 13, peRuim: 6,
  };
  const payload = mutationPayload("players", legacy, true);
  assert.equal(payload.attributes.forca, 10);
  assert.equal(payload.attributes.resistencia, 10);
  assert.equal(payload.attributes.impulsao, 10);
  assert.equal(payload.attributes.reflexos, 10);
  assert.equal(payload.attributes.posicionamentoGol, 10);
  assert.equal(payload.attributes.saidaGol, 10);
  assert.equal(payload.attributes.penaltis, 10);
  assert.equal(payload.overall, calculatePlayerOverall({ position: "ZAG", attributes: payload.attributes }));
});

test("Editor mostra overall automatico e ignora valor manual no payload", () => {
  const record = editorPlayer("MC");
  record.overall = 1;
  const html = renderEditor(record);
  assert.match(html, /editor-overall-output/);
  assert.match(fold(html), /Calculado pelos atributos e posicao/i);
  assert.match(html, /editor-overall-output[^>]*>15<\/output>/);
  assert.equal(mutationPayload("players", record, true).overall, 15);
});

test("ratings usam pesos posicionais e nunca a media bruta dos atributos", () => {
  const goalkeeper = visualPlayer("GOL", { attributes: {
    ...visualPlayer("GOL").attributes,
    reflexos: 10, posicionamentoGol: 8, saidaGol: 6, penaltis: 4, resistencia: 2,
  } });
  assert.equal(playerGoalkeeperRating(goalkeeper), 7.3);
  assert.equal(playerPositionRating(goalkeeper), 7.3);

  const defender = visualPlayer("ZAG", { attributes: {
    ...visualPlayer("ZAG").attributes,
    defesa: 10, nocao: 8, passe: 6, velocidade: 5, forca: 4, resistencia: 3, impulsao: 2,
  } });
  assert.equal(playerPositionRating(defender), 6.8);
  assert.equal(Number.isFinite(playerPhysicalRating(defender)), true);

  const midfielder = visualPlayer("MC", { attributes: {
    ...visualPlayer("MC").attributes,
    passe: 10, nocao: 8, drible: 6, velocidade: 4, forca: 2, resistencia: 1, chute: 9, peBom: 7,
  } });
  assert.equal(playerPositionRating(midfielder), 6.5);

  const attacker = visualPlayer("ATA", { attributes: {
    ...visualPlayer("ATA").attributes,
    chute: 10, drible: 8, velocidade: 6, nocao: 4, peBom: 2, forca: 1, resistencia: 3, impulsao: 5,
  } });
  assert.equal(playerPositionRating(attacker), 6.1);
});

test("Perfil compartilhado preserva atributos fisicos e de goleiro", () => {
  const [outfield] = profilePlayersFromLocalRoster([visualPlayer("MC")], club);
  assert.equal(outfield.attributes.forca, 7);
  assert.equal(outfield.attributes.resistencia, 7.5);

  const [goalkeeper] = profilePlayersFromLocalRoster([visualPlayer("GOL")], club);
  assert.equal(goalkeeper.attributes.reflexos, 9.5);
  assert.equal(goalkeeper.attributes.posicionamentoGol, 9);
  assert.equal(goalkeeper.attributes.saidaGol, 8.5);
});

test("Elenco resume nota posicional, fisico e GK sem inflar colunas", () => {
  const html = renderSquad({
    players: [visualPlayer("GOL"), visualPlayer("MC")], club, room: null, socket: null, managerId: "", onToast() {},
  });
  assert.match(html, /Nota pos\./i);
  assert.match(fold(html), /FIS/i);
  assert.match(html, />GK</i);
  assert.match(html, /player-rating-cell--goalkeeper">—/);
});

test("Elenco abre ordenado por goleiros, zagueiros, meias e atacantes", () => {
  const html = renderSquad({
    players: [
      visualPlayer("ATA", { id: "ata", name: "Atacante Ordem" }),
      visualPlayer("MEI", { id: "mei", name: "Meia Ordem" }),
      visualPlayer("ZAG", { id: "zag", name: "Zagueiro Ordem" }),
      visualPlayer("GOL", { id: "gol", name: "Goleiro Ordem" }),
    ],
    club,
    room: null,
    socket: null,
    managerId: "",
    onToast() {},
  });

  const goalkeeper = html.indexOf("Goleiro Ordem");
  const defender = html.indexOf("Zagueiro Ordem");
  const midfielder = html.indexOf("Meia Ordem");
  const attacker = html.indexOf("Atacante Ordem");
  assert.ok(goalkeeper < defender && defender < midfielder && midfielder < attacker);
  assert.match(html, />GOL<\/button>/);
  assert.match(html, />Zagueiros<\/button>/);
  assert.match(html, />Meias<\/button>/);
  assert.match(html, />Atacantes<\/button>/);
});

test("Taticas e fallback local dos rankings usam a funcao posicional compartilhada", async () => {
  const [tactics, rankings] = await Promise.all([
    readFile(path.join(projectRoot, "src/views/TacticsView.tsx"), "utf8"),
    readFile(path.join(projectRoot, "src/utils/rankings.ts"), "utf8"),
  ]);
  assert.match(tactics, /playerPositionRating\(player\)/);
  assert.match(rankings, /playerPositionRating\(player\)/);
  assert.match(rankings, /right\.goals - left\.goals/);
  assert.doesNotMatch(`${tactics}\n${rankings}`, /Object\.values\([^\n]*attributes/);
});
