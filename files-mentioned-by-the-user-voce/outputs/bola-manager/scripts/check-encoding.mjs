import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectories = new Set(['src', 'server', 'shared', 'scripts', 'docs', 'e2e', '.github']);
const excludedDirectories = new Set(['node_modules', '.git', '.tmp', 'dist', 'coverage', 'release']);
const textExtensions = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.css', '.html', '.json', '.md', '.yml', '.yaml']);
const rootFiles = new Set(['.editorconfig', '.gitattributes', '.gitignore', '.firebaserc']);
// UTF-8 bytes decoded as Latin-1/Windows-1252. Escapes keep intentional signatures out of the source scan.
const mojibake = /\u00c3[\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2026\u2030\u2039\u203a\u20ac\u2122]|\u00c2[\u0080-\u00bf]|\u00e2[\u0080-\u00bf\u0152\u0153\u2013-\u2026\u20ac\u2122]|\u00f0\u0178|\u00ef\u00bb\u00bf|\u00ef\u00bf\u00bd|\ufffd/gu;

export function inspectEncoding(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return [{ line: 1, code: 'INVALID_UTF8' }];
  }
  const issues = [];
  if (text.startsWith('\ufeff')) issues.push({ line: 1, code: 'UTF8_BOM' });
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (line.includes('\0')) issues.push({ line: index + 1, code: 'NUL_BYTE' });
    if ([...line.matchAll(mojibake)].length) issues.push({ line: index + 1, code: 'MOJIBAKE' });
  }
  return issues;
}

export async function checkSourceEncoding(root = projectRoot) {
  const issues = [];
  let checkedFiles = 0;
  async function visit(directory, topLevel = false) {
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name) && (!topLevel || sourceDirectories.has(entry.name))) await visit(absolute);
      } else if (entry.isFile() && entry.name !== 'package-lock.json'
        && (textExtensions.has(path.extname(entry.name)) || (topLevel && rootFiles.has(entry.name)))) {
        const file = path.relative(root, absolute).split(path.sep).join('/');
        const findings = inspectEncoding(await readFile(absolute));
        checkedFiles += 1;
        issues.push(...findings.map((finding) => ({ file, ...finding })));
      }
    }
  }
  await visit(root, true);
  return { checkedFiles, issues };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { checkedFiles, issues } = await checkSourceEncoding();
    for (const { file, line, code } of issues) console.error(`${file}:${line}: ${code}`);
    console.log(`Encoding: ${checkedFiles} arquivos; ${issues.length} problema(s).`);
    process.exitCode = issues.length ? 1 : 0;
  } catch (error) {
    console.error(`Encoding: verificação incompleta (${error.code ?? error.name}).`);
    process.exitCode = 1;
  }
}
