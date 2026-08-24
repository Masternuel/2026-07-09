import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("tela de taticas mantem textos legiveis no desktop", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/tactics.css"), "utf8");

  assert.match(css, /\.formation-select select\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.pitch-player__name\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.instruction-options button\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.bench-list button > span:nth-child\(3\) strong\s*\{[^}]*font-size:\s*12px/);
});

test("monitor grande recebe escala de leitura maior", async () => {
  const css = await readFile(path.join(projectRoot, "src/styles/responsive.css"), "utf8");
  const largeScreen = css.match(/@media \(min-width: 1600px\) and \(min-height: 900px\) \{([\s\S]*)\n\}/)?.[1] ?? "";

  assert.match(largeScreen, /\.formation-select select\s*\{[^}]*font-size:\s*13px/);
  assert.match(largeScreen, /\.pitch-player__name\s*\{[^}]*font-size:\s*12px/);
  assert.match(largeScreen, /\.instruction-options button\s*\{[^}]*font-size:\s*13px/);
  assert.match(largeScreen, /\.bench-list button > span:nth-child\(3\) strong[^}]*font-size:\s*12px/);
});
