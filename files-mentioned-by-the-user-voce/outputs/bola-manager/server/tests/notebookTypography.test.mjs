import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const notebookQuery = "@media (min-width: 1281px) {";
const largeScreenQuery = "@media (min-width: 1600px) and (min-height: 900px) {";

function sliceTier(css, startMarker, endMarker) {
  const start = css.indexOf(startMarker);
  const end = css.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `media query ausente: ${startMarker}`);
  assert.notEqual(end, -1, `limite da media query ausente: ${endMarker}`);
  return css.slice(start + startMarker.length, end);
}

function fontSizeFor(css, selector) {
  let size = null;

  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = block[1].split(",").map((item) => item.trim());
    if (!selectors.includes(selector)) continue;
    const declaration = block[2].match(/font-size:\s*(\d+)px/);
    if (declaration) size = Number(declaration[1]);
  }

  return size;
}

test("notebooks recebem escala de leitura antes do layout espacoso", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8");
  const notebook = sliceTier(css, notebookQuery, largeScreenQuery);
  const representatives = {
    "acao principal": [".button", 13],
    "titulo de painel": [".panel__header h2", 16],
    "titulo de tela": [".view-heading h1", 30],
    sidebar: [".nav-group > button", 13],
    topbar: [".topbar__title h1", 17],
    lobby: [".setup-form input", 14],
    editor: [".editor-table td", 13],
    dashboard: [".fixture-team strong", 20],
    partida: [".match-event p", 13],
    tatica: [".formation-select select", 13],
    "instrucao tatica": [".instruction-options button", 13],
    elenco: [".squad-table td", 13],
    calendario: [".agenda-item p", 13],
    competicoes: [".full-table > div", 13],
    mercado: [".market-player__identity strong", 13],
    financas: [".budget-row strong", 13],
    infraestrutura: [".stadium-info > p", 13],
    "comissao tecnica": [".staff-grid h2", 13],
    rankings: [".ranking-list > div", 13],
    relatorios: [".report-leaders strong", 13],
    configuracoes: [".settings-nav button", 13],
  };

  for (const [area, [selector, minimum]] of Object.entries(representatives)) {
    const size = fontSizeFor(notebook, selector);
    assert.ok(size >= minimum, `${area}: ${selector} deveria ter ao menos ${minimum}px, recebeu ${size}`);
  }
});

test("tier de notebook nao depende da altura nem antecipa geometria de monitor grande", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8");
  const notebook = sliceTier(css, notebookQuery, largeScreenQuery);
  const queryHeader = css.slice(css.indexOf(notebookQuery), css.indexOf(notebookQuery) + notebookQuery.length);

  assert.doesNotMatch(queryHeader, /min-height/, "chrome do navegador nao deve desativar a escala de notebook");

  for (const property of [
    "--sidebar-w",
    "grid-template-columns",
    "grid-template-areas",
    "width",
    "max-width",
    "padding",
    "padding-inline",
    "padding-block",
    "margin",
    "position",
    "transform",
    "zoom",
  ]) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(notebook, new RegExp(`(?:^|;)\\s*${escaped}\\s*:`, "m"), `${property} pertence ao tier espacoso`);
  }

  for (const selector of [
    ".sidebar",
    ".topbar",
    ".dashboard",
    ".dashboard-grid",
    ".tactics-workspace",
    ".match-view",
    ".match-layout",
    ".score-main",
    ".match-feed",
    ".lobby-setup",
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.doesNotMatch(notebook, new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`), `${selector} nao deve mudar geometria no notebook`);
  }

  const largeScreen = css.slice(css.indexOf(largeScreenQuery));
  assert.match(largeScreen, /:root\s*\{[^}]*--sidebar-w:\s*264px/);
  assert.match(largeScreen, /\.topbar\s*\{[^}]*height:\s*72px/);
  assert.match(largeScreen, /\.secondary-view,[^}]*padding:\s*30px 32px 46px/);
  assert.match(largeScreen, /\.match-layout\s*\{[^}]*grid-template-columns:/);
});
