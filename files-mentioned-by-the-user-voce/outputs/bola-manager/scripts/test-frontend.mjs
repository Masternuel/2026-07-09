import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const names = await readdir(new URL('../server/tests/', import.meta.url));
const files = names.filter((name) => /(?:Ui|UiSource|View|Client|Typography|Viewport|Preferences|ErrorBoundary|CatalogSafety|LeagueSelector|SnapshotNormalization|ThemeColors|Roster|Navigation|Actions)\.test\.mjs$/.test(name)).sort();
if (!files.length) throw new Error('Nenhum teste frontend encontrado');
console.log(`Frontend: ${files.length} arquivos`);
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files.map((name) => `server/tests/${name}`)], { cwd: root, stdio: 'inherit' });
child.on('error', (error) => { console.error(error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
