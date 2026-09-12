import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { after, before, test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { editorCreateSchemas, editorPatchSchemas } from "../editorSchemas.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clubRecord = {
  id: "SAN",
  name: "Santos",
  abbreviation: "SAN",
  colors: ["#ffffff", "#000000", "#112233"],
  darkThemeColor: "#e7e7e7",
  lightThemeColor: "#171a17",
  stadium: "Vila Belmiro",
  stadiumCapacity: 16_068,
  reputation: 15,
  division: "Serie A",
  country: "Brasil",
  state: "SP",
  city: "Santos",
  leagueId: null,
  budget: 50_000_000,
  crestImageUrl: null,
  crestImagePath: null,
  active: true,
};

let vite;
let theme;
let AppShell;
let appShellThemeStyle;
let ClubBackdrop;
let ClubMark;
let EditorRecordForm;
let MatchScore;
let StadiumView;
let normalizeClub;
let mutationPayload;

before(async () => {
  vite = await createServer({
    root: projectRoot,
    configFile: false, envFile: false,
    esbuild: { jsx: 'automatic' },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  theme = await vite.ssrLoadModule("/src/utils/clubThemeColors.ts");
  ({ AppShell, appShellThemeStyle } = await vite.ssrLoadModule("/src/components/layout/AppShell.tsx"));
  ({ ClubBackdrop } = await vite.ssrLoadModule("/src/components/shared/ClubBackdrop.tsx"));
  ({ ClubMark } = await vite.ssrLoadModule("/src/components/shared/ClubMark.tsx"));
  ({ EditorRecordForm } = await vite.ssrLoadModule("/src/components/editor/EditorRecordForm.tsx"));
  ({ MatchScore } = await vite.ssrLoadModule("/src/components/match/MatchScore.tsx"));
  ({ StadiumView } = await vite.ssrLoadModule("/src/views/club/StadiumView.tsx"));
  ({ normalizeClub } = await vite.ssrLoadModule("/src/hooks/useClubCatalog.ts"));
  ({ mutationPayload } = await vite.ssrLoadModule("/src/hooks/useEditorCatalog.ts"));
});

after(async () => {
  await vite?.close();
});

test("resolve contraste para clubes legados e preserva cores explicitas", () => {
  assert.equal(theme.normalizeHexColor(" #ABCDEF "), "#abcdef");
  assert.equal(theme.normalizeHexColor("branco"), null);
  assert.ok(theme.contrastRatio("#ffffff", "#111214") > 4.5);
  assert.deepEqual(theme.resolveClubThemeColors({ color: "#ffffff" }), {
    darkThemeColor: "#ffffff",
    lightThemeColor: "#171a17",
  });
  assert.deepEqual(theme.resolveClubThemeColors({ color: "#000000" }), {
    darkThemeColor: "#f0f0f0",
    lightThemeColor: "#000000",
  });
  assert.deepEqual(theme.resolveClubThemeColors({
    color: "#ffffff",
    darkThemeColor: "#e7e7e7",
    lightThemeColor: "#202420",
  }), {
    darkThemeColor: "#e7e7e7",
    lightThemeColor: "#202420",
  });
  assert.equal(theme.foregroundForAccent("#ffffff"), "#101311");
  assert.equal(theme.foregroundForAccent("#101010"), "#ffffff");
  const boundaryForeground = theme.foregroundForAccent("#797979");
  const boundaryHover = theme.hoverForAccent("#797979", boundaryForeground);
  assert.equal(boundaryForeground, "#000000");
  assert.ok(theme.contrastRatio(boundaryForeground, "#797979") >= 4.5);
  assert.ok(theme.contrastRatio(boundaryForeground, boundaryHover) >= 4.5);
  assert.deepEqual(
    theme.replacePrimaryClubColor(["#ffffff", "#000000", "#112233"], "#abcdef"),
    ["#abcdef", "#000000", "#112233"],
  );
});

test("AppShell escolhe o accent real de cada tema e calcula o foreground", () => {
  const club = {
    id: "SAN", name: "Santos", code: "SAN", city: "Santos", stars: 4,
    budget: "R$ 50 mi", color: "#ffffff", darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17",
  };
  const dark = appShellThemeStyle(club, false);
  const light = appShellThemeStyle(club, true);
  assert.equal(dark["--accent"], "#e7e7e7");
  assert.equal(dark["--on-accent"], "#101311");
  assert.equal(light["--accent"], "#171a17");
  assert.equal(light["--on-accent"], "#ffffff");
  assert.match(dark["--accent-hover"], /^#[0-9a-f]{6}$/);
  assert.ok(theme.contrastRatio(dark["--on-accent"], dark["--accent-hover"]) >= 4.5);
});

test("AppShell deriva divisorias do Flamengo escuro e Santos claro", () => {
  const flamengo = {
    id: "FLA", name: "Flamengo", code: "FLA", city: "Rio de Janeiro", stars: 5,
    budget: "R$ 180 mi", color: "#c8102e", darkThemeColor: "#c8102e", lightThemeColor: "#8f0000",
  };
  const santos = {
    id: "SAN", name: "Santos", code: "SAN", city: "Santos", stars: 4,
    budget: "R$ 50 mi", color: "#ffffff", darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17",
  };

  const dark = appShellThemeStyle(flamengo, false);
  assert.equal(dark["--team-line"], "color-mix(in srgb, #c8102e 34%, transparent)");
  assert.equal(dark["--team-line-soft"], "color-mix(in srgb, #c8102e 20%, transparent)");
  assert.equal(dark["--team-line-strong"], "color-mix(in srgb, #c8102e 48%, transparent)");
  assert.equal(dark["--team-surface"], "color-mix(in srgb, #c8102e 6%, transparent)");
  assert.equal(dark["--team-surface-strong"], "color-mix(in srgb, #c8102e 10%, transparent)");
  assert.equal(dark["--line"], "var(--team-line)");
  assert.equal(dark["--line-soft"], "var(--team-line-soft)");

  const light = appShellThemeStyle(santos, true);
  assert.equal(light["--accent"], "#171a17");
  assert.equal(light["--team-line"], "color-mix(in srgb, #171a17 30%, transparent)");
  assert.equal(light["--team-line-soft"], "color-mix(in srgb, #171a17 17%, transparent)");
  assert.equal(light["--team-line-strong"], "color-mix(in srgb, #171a17 44%, transparent)");
  assert.equal(light["--line"], "var(--team-line)");
  assert.equal(light["--line-soft"], "var(--team-line-soft)");
});

test("AppShell renderiza um unico backdrop apenas quando existe clube controlado", () => {
  const club = {
    id: "SAN", name: "Santos", code: "SAN", city: "Santos", stars: 4,
    budget: "R$ 50 mi", color: "#ffffff", darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17",
    crestImageUrl: "/assets/santos.png",
  };
  const props = {
    route: "home",
    club,
    manager: { uid: "manager-1", displayName: "Emanuel", email: null, photoURL: null, mode: "demo" },
    room: null,
    nextFixture: null,
    onNavigate() {},
    onExit() {},
  };
  const withClub = renderToStaticMarkup(React.createElement(AppShell, {
    ...props,
    hasClub: true,
    children: React.createElement("main", null, "Conteudo"),
  }));
  const withoutClub = renderToStaticMarkup(React.createElement(AppShell, {
    ...props,
    hasClub: false,
    children: React.createElement("main", null, "Carreira sem clube"),
  }));

  assert.equal((withClub.match(/class="club-backdrop"/g) ?? []).length, 1);
  assert.match(withClub, /class="view-wrap"><div class="club-backdrop"/);
  assert.match(withClub, /class="view-content"><main>Conteudo<\/main>/);
  assert.doesNotMatch(withoutClub, /class="club-backdrop"/);
});

test("ClubMark mantem imagem e emite variantes para fallback por tema", () => {
  const fallback = renderToStaticMarkup(React.createElement(ClubMark, {
    code: "SAN", color: "#ffffff", darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17",
  }));
  const image = renderToStaticMarkup(React.createElement(ClubMark, {
    code: "SAN", color: "#ffffff", darkThemeColor: "#e7e7e7", lightThemeColor: "#171a17",
    imageUrl: "/assets/santos.png",
  }));
  assert.match(fallback, /--club-color-dark:#e7e7e7/);
  assert.match(fallback, /--club-color-light:#171a17/);
  assert.match(fallback, />SAN<\/span>/);
  assert.match(image, /club-mark--image/);
  assert.match(image, /<img src="\/assets\/santos\.png"/);
});

test("ClubBackdrop usa o escudo do clube e oferece monograma sem imagem", async () => {
  const image = renderToStaticMarkup(React.createElement(ClubBackdrop, {
    club: { name: "Santos", code: "SAN", crestImageUrl: "/assets/santos.png" },
  }));
  const fallback = renderToStaticMarkup(React.createElement(ClubBackdrop, {
    club: { name: "Santos", code: "SAN", crestImageUrl: null },
  }));
  const [dashboardCss, responsiveCss, layoutCss, homeSource] = await Promise.all([
    readFile(path.join(projectRoot, "src/styles/dashboard.css"), "utf8"),
    readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8"),
    readFile(path.join(projectRoot, "src/styles/layout.css"), "utf8"),
    readFile(path.join(projectRoot, "src/views/HomeView.tsx"), "utf8"),
  ]);
  const panorama = await stat(path.join(projectRoot, "public/assets/club-stadium-panorama.jpg"));

  assert.match(image, /class="club-backdrop" aria-hidden="true"/);
  assert.match(image, /class="club-backdrop__stadium"/);
  assert.match(image, /class="club-backdrop__horizon"/);
  assert.match(image, /class="club-backdrop__crest-image" src="\/assets\/santos\.png"/);
  assert.match(fallback, /class="club-backdrop__monogram">SAN<\/span>/);
  assert.ok(panorama.size > 0 && panorama.size <= 180_000);
  assert.match(dashboardCss, /height:\s*294px/);
  assert.match(dashboardCss, /url\('\/assets\/club-stadium-panorama\.jpg'\)/);
  assert.match(dashboardCss, /pointer-events:\s*none/);
  assert.match(dashboardCss, /var\(--accent\)/);
  assert.match(dashboardCss, /\.theme-light \.club-backdrop/);
  assert.match(dashboardCss, /\.theme-light \.dashboard-heading::before/);
  assert.match(dashboardCss, /\.theme-light \.dashboard-heading h1 \{ color: var\(--ink\)/);
  assert.match(dashboardCss, /prefers-reduced-motion:\s*reduce/);
  assert.match(dashboardCss, /prefers-contrast:\s*more/);
  assert.doesNotMatch(dashboardCss, /club-backdrop__beam/);
  assert.doesNotMatch(homeSource, /ClubBackdrop/);
  assert.match(layoutCss, /\.view-wrap \{ position: relative; isolation: isolate; overflow-x: clip; \}/);
  assert.match(layoutCss, /\.view-content \{ position: relative; z-index: 1;/);
  assert.match(responsiveCss, /@media \(max-width:\s*900px\)[\s\S]*?\.club-backdrop/);
  assert.match(responsiveCss, /right:\s*12%;\s*width:\s*170px/);
  assert.match(responsiveCss, /right:\s*16px;\s*width:\s*120px/);
});

test("Editor exibe seletores tematicos e previa compacta", () => {
  const html = renderToStaticMarkup(React.createElement(EditorRecordForm, {
    entity: "clubs",
    mode: "edit",
    record: clubRecord,
    leagues: [],
    clubs: [clubRecord],
    pending: false,
    async onSubmit(record) { return record; },
    async onRemoveMedia(record) { return record; },
    onCancel() {},
    async onArchive() {},
    onDelete() {},
  }));
  assert.match(html, /Cor no tema escuro/);
  assert.match(html, /Cor no tema claro/);
  assert.match(html, /aria-label="Prévia das cores do clube"/);
  assert.match(html, /value="#e7e7e7"/);
  assert.match(html, /value="#171a17"/);
  assert.match(html, /editor-theme-preview/);
  assert.match(html, /Nome do estádio/);
  assert.match(html, /Capacidade/);
  assert.match(html, /value="16068"/);
});

test("schema aceita legado, persiste os campos e rejeita hexadecimal invalido", () => {
  const explicit = editorCreateSchemas.clubs.parse(clubRecord);
  assert.equal(explicit.darkThemeColor, "#e7e7e7");
  assert.equal(explicit.lightThemeColor, "#171a17");
  const legacy = { ...clubRecord };
  delete legacy.darkThemeColor;
  delete legacy.lightThemeColor;
  delete legacy.stadiumCapacity;
  assert.equal(editorCreateSchemas.clubs.parse(legacy).darkThemeColor, null);
  assert.equal(editorCreateSchemas.clubs.parse(legacy).lightThemeColor, null);
  assert.equal(editorCreateSchemas.clubs.parse(legacy).stadiumCapacity, 0);
  assert.equal(editorPatchSchemas.clubs.safeParse({ lightThemeColor: "white" }).success, false);
  assert.equal(editorPatchSchemas.clubs.safeParse({ darkThemeColor: null }).success, true);
});

test("catalogos do cliente nao descartam campos tematicos nem cores secundarias", () => {
  const catalogClub = normalizeClub({
    ...clubRecord,
    crestImageUrl: "/assets/santos.png",
  }, new Map());
  assert.equal(catalogClub.darkThemeColor, "#e7e7e7");
  assert.equal(catalogClub.lightThemeColor, "#171a17");
  assert.equal(catalogClub.stadium, "Vila Belmiro");
  assert.equal(catalogClub.stadiumCapacity, 16_068);
  const payload = mutationPayload("clubs", clubRecord, true);
  assert.deepEqual(payload.colors, ["#ffffff", "#000000", "#112233"]);
  assert.equal(payload.darkThemeColor, "#e7e7e7");
  assert.equal(payload.lightThemeColor, "#171a17");
  assert.equal(payload.stadium, "Vila Belmiro");
  assert.equal(payload.stadiumCapacity, 16_068);
});

test("telas do jogo exibem o estadio configurado no Editor", () => {
  const club = {
    id: "SAN", name: "Santos", code: "SAN", city: "Santos, SP", stars: 4,
    budget: "R$ 50 mi", color: "#ffffff", stadium: "Vila Belmiro",
    stadiumCapacity: 16_068,
  };
  const infrastructure = renderToStaticMarkup(React.createElement(StadiumView, {
    club,
    onToast() {},
  }));
  const scoreboard = renderToStaticMarkup(React.createElement(MatchScore, {
    minute: 12,
    score: [0, 0],
    finished: false,
    events: [],
    homeTeam: "Santos",
    awayTeam: "Bahia",
    homeCode: "SAN",
    awayCode: "BAH",
    stadium: club.stadium,
    stadiumCapacity: club.stadiumCapacity,
    competition: "Brasileirão",
    roundLabel: "Rodada 1",
  }));
  assert.match(infrastructure, /VILA BELMIRO/);
  assert.match(infrastructure, /16\.068/);
  assert.match(infrastructure, /Casa do Santos/);
  assert.match(scoreboard, /Vila Belmiro · 16\.068/);
  assert.doesNotMatch(scoreboard, /17 °C|°C/);
  assert.doesNotMatch(`${infrastructure}${scoreboard}`, /Estádio Boreal/);
});

test("gameplay usa tokens do clube sem contaminar entrada e editor", async () => {
  const gameplayFiles = [
    "layout.css",
    "dashboard.css",
    "squad.css",
    "tactics.css",
    "match.css",
    "press-conference.css",
    "season.css",
    "club.css",
    "media.css",
  ];

  for (const filename of gameplayFiles) {
    const css = await readFile(path.join(projectRoot, "src/styles", filename), "utf8");
    assert.doesNotMatch(css, /rgba\(\s*200\s*,\s*255\s*,\s*61/i, filename);
    assert.match(css, /var\(--team-(?:line|surface)/, filename);
  }

  const [entryCss, editorCss, globalCss] = await Promise.all([
    readFile(path.join(projectRoot, "src/styles/entry.css"), "utf8"),
    readFile(path.join(projectRoot, "src/styles/editor.css"), "utf8"),
    readFile(path.join(projectRoot, "src/styles.css"), "utf8"),
  ]);
  assert.doesNotMatch(entryCss, /--team-(?:line|surface)/);
  assert.doesNotMatch(editorCss, /--team-(?:line|surface)/);
  assert.match(entryCss, /rgba\(\s*200\s*,\s*255\s*,\s*61/i);
  assert.match(editorCss, /rgba\(\s*200\s*,\s*255\s*,\s*61/i);
  assert.match(globalCss, /--team-line:/);
  assert.match(globalCss, /--team-surface-strong:/);
});
