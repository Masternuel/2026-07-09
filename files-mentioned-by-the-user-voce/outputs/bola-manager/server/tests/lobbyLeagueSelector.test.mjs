import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const leagues = [
  { id: "ENG-4", name: "League Two", country: "England", division: "4", level: 4, clubCount: 0 },
  { id: "BR-A", name: "Brasileirão Série A", country: "BRA", division: "Série A", level: 1, clubCount: 16 },
  { id: "ENG-2", name: "Championship", country: "ING", division: "2", level: 2, clubCount: 0 },
  { id: "ENG-1", name: "Premier League", country: "Inglaterra", division: "1", level: 1, clubCount: 1 },
  { id: "ENG-3", name: "League One", country: "ENG", division: "3", level: 3, clubCount: 0 },
];

let vite;
let LobbyView;
let countryFlag;
let countryIdentity;
let defaultLeagueIds;
let groupLeaguesByCountry;
let initialOpenCountryKey;
let reconcileLeagueIds;
let resolveLeagueSelectionAfterCatalogChange;

function renderLobby(leagueChoices) {
  return renderToStaticMarkup(React.createElement(LobbyView, {
    clubs: [],
    leagues: leagueChoices,
    catalogLoading: false,
    catalogSource: "firestore",
    catalogError: null,
    leagueCatalogLoading: false,
    leagueCatalogError: null,
    identity: { uid: "manager-1", name: "Emanuel", mode: "demo" },
    room: null,
    savedRooms: [],
    connectionState: "connected",
    loading: false,
    pending: false,
    error: null,
    onBack() {},
    onDeselectRoom() {},
    async onCreate() {},
    async onJoin() {},
    async onSelectSave() {},
    async onDeleteSave() {},
    async onReady() {},
    async onStart() {},
    onEnterGame() {},
    onOpenEditor() {},
    onClubSelected() {},
    onToast() {},
  }));
}

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ LobbyView } = await vite.ssrLoadModule("/src/views/LobbyView.tsx"));
  ({
    countryFlag,
    countryIdentity,
    defaultLeagueIds,
    groupLeaguesByCountry,
    initialOpenCountryKey,
    reconcileLeagueIds,
    resolveLeagueSelectionAfterCatalogChange,
  } = await vite.ssrLoadModule("/src/utils/leagueCountryGroups.ts"));
});

after(async () => {
  await vite?.close();
});

test("agrupa aliases por país e ordena as divisões por nível", () => {
  assert.deepEqual(countryIdentity("BR"), { key: "BRASIL", label: "Brasil" });
  assert.deepEqual(countryIdentity("brásil"), { key: "BRASIL", label: "Brasil" });
  assert.deepEqual(countryIdentity("ARG"), { key: "ARGENTINA", label: "Argentina" });
  assert.deepEqual(countryIdentity("England"), { key: "INGLATERRA", label: "Inglaterra" });
  assert.equal(countryFlag("BRA"), "BR");
  assert.equal(countryFlag("ARG"), "AR");
  assert.equal(countryFlag("England"), "GB");
  assert.equal(countryFlag("Alemanha"), "DE");
  assert.equal(countryFlag("Espanha"), "ES");
  assert.equal(countryFlag("França"), "FR");
  assert.equal(countryFlag("Itália"), "IT");
  assert.equal(countryFlag("Holanda"), "NL");
  assert.equal(countryFlag("Portugal"), "PT");
  assert.equal(countryFlag("Uruguai"), "UY");
  assert.equal(countryFlag("Atlantida"), "GLOBE");

  const groups = groupLeaguesByCountry(leagues);
  assert.deepEqual(groups.map((group) => group.label), ["Brasil", "Inglaterra"]);
  assert.equal(groups[0].clubCount, 16);
  assert.equal(groups[1].clubCount, 1);
  assert.deepEqual(groups[1].leagues.map((league) => league.id), ["ENG-1", "ENG-2", "ENG-3", "ENG-4"]);
  assert.deepEqual(defaultLeagueIds(leagues), ["BR-A", "ENG-1"]);
  assert.deepEqual(defaultLeagueIds(leagues.map((league) => ({ ...league, clubCount: 0 }))), []);
  assert.equal(initialOpenCountryKey(groups, ["eng-1"]), "INGLATERRA");
  assert.equal(initialOpenCountryKey(groups, []), "BRASIL");
  assert.deepEqual(reconcileLeagueIds(["eng-1", "REMOVIDA", "ENG-1"], leagues), ["ENG-1"]);
  assert.deepEqual(reconcileLeagueIds(["ENG-2"], leagues), []);

  const fallbackLeagues = [
    { id: "DEMO-A", name: "Liga Demo", country: "Brasil", division: "1", level: 1, clubCount: 8 },
  ];
  assert.deepEqual(resolveLeagueSelectionAfterCatalogChange(
    ["DEMO-A"],
    defaultLeagueIds(fallbackLeagues),
    leagues,
    false,
  ), ["BR-A", "ENG-1"]);
  assert.deepEqual(resolveLeagueSelectionAfterCatalogChange(
    ["BR-A"],
    defaultLeagueIds(fallbackLeagues),
    leagues,
    true,
  ), ["BR-A"]);
});

test("lobby renderiza bandeira decorativa antes do nome de cada pais", () => {
  const html = renderLobby([
    { id: "BR-A", name: "Serie A", country: "BRA", division: "1", level: 1, clubCount: 1 },
    { id: "AR-A", name: "Primera", country: "ARG", division: "1", level: 1, clubCount: 1 },
    { id: "ENG-1", name: "Premier League", country: "England", division: "1", level: 1, clubCount: 1 },
    { id: "ATL-A", name: "Liga Oceanica", country: "Atlantida", division: "1", level: 1, clubCount: 1 },
  ]);

  assert.equal(html.match(/data-country-flag=/g)?.length, 4);
  assert.equal(/[\u{1F1E6}-\u{1F1FF}\u{1F310}]/u.test(html), false);
  assert.match(html, /<strong><svg[^>]*class="[^"]*league-country__flag[^"]*"[^>]*aria-hidden="true"[^>]*data-country-flag="BR"[^>]*>[\s\S]*?<\/svg><span class="league-country__name">Brasil<\/span><\/strong>/u);
  assert.match(html, /<strong><svg[^>]*class="[^"]*league-country__flag[^"]*"[^>]*aria-hidden="true"[^>]*data-country-flag="AR"[^>]*>[\s\S]*?<\/svg><span class="league-country__name">Argentina<\/span><\/strong>/u);
  assert.match(html, /<strong><svg[^>]*class="[^"]*league-country__flag[^"]*"[^>]*aria-hidden="true"[^>]*data-country-flag="GB"[^>]*>[\s\S]*?<\/svg><span class="league-country__name">Inglaterra<\/span><\/strong>/u);
  assert.match(html, /<strong><svg[^>]*class="[^"]*league-country__flag[^"]*"[^>]*aria-hidden="true"[^>]*data-country-flag="GLOBE"[^>]*>[\s\S]*?<\/svg><span class="league-country__name">Atlantida<\/span><\/strong>/u);
  assert.match(html, /class="lucide lucide-chevron-down league-country__chevron"/);
});

test("lobby abre o país selecionado e exibe somente suas divisões", () => {
  const selectorLeagues = leagues.map((league) => (
    league.id === "BR-A" ? { ...league, clubCount: 0 } : league
  ));
  const html = renderLobby(selectorLeagues);

  assert.match(html, /aria-expanded="false" aria-controls="league-country-brasil"/);
  assert.match(html, /aria-expanded="true" aria-controls="league-country-inglaterra"/);
  assert.match(html, /id="league-country-brasil" role="region" aria-labelledby="league-country-brasil-heading" hidden=""/);
  assert.match(html, /0\/1 divisão selecionada/);
  assert.match(html, /1\/4 divisões selecionadas/);
  assert.match(html, /Premier League/);
  assert.match(html, /Championship/);
  assert.match(html, /League One/);
  assert.match(html, /League Two/);
  assert.match(html, /league-division-row--disabled/);
  assert.match(html, /type="checkbox" disabled=""/);
  assert.match(html, /type="checkbox" checked=""/);
  assert.match(html, /<strong>1<\/strong> de 1 divisões disponíveis · 1 clube no save/);
  assert.match(html, /Brasileirão Série A/);
});
