import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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

test("dez telas de gestao mantem fonte minima de 12px no desktop grande", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8");
  const largeScreen = css.match(/@media \(min-width: 1600px\) and \(min-height: 900px\) \{([\s\S]*)\n\}/)?.[1] ?? "";
  const representatives = {
    Elenco: ".squad-table td",
    Calendario: ".agenda-item p",
    Competicoes: ".full-table > div",
    Mercado: ".market-player__identity small",
    Financas: ".finance-kpi small",
    Infraestrutura: ".upgrade-level",
    "Comissao tecnica": ".staff-grid header small",
    Rankings: ".ranking-list > div",
    Relatorios: ".report-kpis small",
    Configuracoes: ".settings-nav button",
  };

  for (const [screen, selector] of Object.entries(representatives)) {
    const size = fontSizeFor(largeScreen, selector);
    assert.ok(size >= 12, `${screen}: ${selector} deve ter ao menos 12px, recebeu ${size}`);
  }
});

test("modais das telas de gestao tambem recebem a escala desktop", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8");
  const largeScreen = css.match(/@media \(min-width: 1600px\) and \(min-height: 900px\) \{([\s\S]*)\n\}/)?.[1] ?? "";

  for (const selector of [".player-profile__status small", ".bid-form label > small", ".upgrade-modal dt"]) {
    assert.ok(fontSizeFor(largeScreen, selector) >= 12, `${selector} deve ter ao menos 12px`);
  }
});
