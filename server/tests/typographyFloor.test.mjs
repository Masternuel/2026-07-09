import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourceRoot = path.join(projectRoot, "src");

async function collectCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".css") ? [entryPath] : [];
  }));

  return files.flat();
}

test("frontend mantém piso tipográfico explícito de 12px", async () => {
  const cssFiles = await collectCssFiles(sourceRoot);
  const violations = [];

  for (const file of cssFiles) {
    const css = await readFile(file, "utf8");
    const sourceWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));

    for (const declaration of sourceWithoutComments.matchAll(/font-size\s*:\s*(?<value>[^;}]+)/gi)) {
      for (const match of declaration.groups.value.matchAll(/(?<![\d.])(?<size>(?:\d+(?:\.\d+)?|\.\d+))px\b/gi)) {
        const size = Number(match.groups.size);
        if (size === 0 || size >= 12) continue;

        const line = sourceWithoutComments.slice(0, declaration.index).split("\n").length;
        violations.push(`${path.relative(projectRoot, file)}:${line} usa ${size}px`);
      }
    }

    for (const declaration of sourceWithoutComments.matchAll(/(?<![-\w])font\s*:\s*(?<value>[^;}]+)/gi)) {
      // In the shorthand, font-size appears before the optional `/ line-height`.
      // Numeric font-weight is unitless, while px values after `/` belong to line-height.
      const sizeSection = declaration.groups.value.split("/", 1)[0];

      for (const match of sizeSection.matchAll(/(?<![\d.])(?<size>(?:\d+(?:\.\d+)?|\.\d+))px\b/gi)) {
        const size = Number(match.groups.size);
        if (size === 0 || size >= 12) continue;

        const line = sourceWithoutComments.slice(0, declaration.index).split("\n").length;
        violations.push(`${path.relative(projectRoot, file)}:${line} usa ${size}px em font shorthand`);
      }
    }
  }

  assert.deepEqual(
    violations,
    [],
    `font-size positivo abaixo de 12px encontrado:\n${violations.join("\n")}`,
  );
});
