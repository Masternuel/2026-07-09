#!/usr/bin/env node
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeFirebaseAdmin, loadLocalEnvironment } from "../server/config.mjs";
import { buildBuiltinCatalog } from "./lib/builtin-catalog.mjs";

const COLLECTIONS = Object.freeze({
  leagues: "brasfootLeagues",
  clubs: "brasfootClubs",
  players: "brasfootPlayers",
});

function parseArguments(argv) {
  const options = { commit: false };
  for (const argument of argv) {
    if (argument === "--commit") options.commit = true;
    else if (argument === "--dry-run") options.commit = false;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Argumento desconhecido: ${argument}`);
  }
  return options;
}

function summary(catalog) {
  return Object.fromEntries(Object.keys(COLLECTIONS).map((entity) => [entity, catalog[entity].length]));
}

export async function seedBuiltinCatalog(database, { now = () => new Date().toISOString() } = {}) {
  const catalog = buildBuiltinCatalog();
  const entries = Object.entries(COLLECTIONS).flatMap(([entity, collectionName]) => (
    catalog[entity].map((record) => ({ entity, reference: database.collection(collectionName).doc(record.id), record }))
  ));
  const timestamp = now();

  return database.runTransaction(async (transaction) => {
    const snapshots = typeof transaction.getAll === "function"
      ? await transaction.getAll(...entries.map(({ reference }) => reference))
      : await Promise.all(entries.map(({ reference }) => transaction.get(reference)));
    const result = Object.fromEntries(Object.keys(COLLECTIONS).map((entity) => [entity, { created: 0, skipped: 0 }]));

    snapshots.forEach((snapshot, index) => {
      const entry = entries[index];
      if (snapshot.exists) {
        result[entry.entity].skipped += 1;
        return;
      }
      transaction.create(entry.reference, {
        ...entry.record,
        seedSource: "bola-manager-builtin-v1",
        createdAt: timestamp,
        updatedAt: timestamp,
        updatedBy: "builtin-seed",
      });
      result[entry.entity].created += 1;
    });
    return result;
  });
}

function helpText() {
  return [
    "Carrega a base interna do Bola Manager no Firestore sem sobrescrever documentos.",
    "",
    "Uso:",
    "  node scripts/seed-builtin-catalog.mjs --dry-run",
    "  node scripts/seed-builtin-catalog.mjs --commit",
  ].join("\n");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(helpText());
    return;
  }
  const catalog = buildBuiltinCatalog();
  if (!options.commit) {
    console.log(JSON.stringify({ mode: "dry-run", records: summary(catalog) }, null, 2));
    return;
  }

  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadLocalEnvironment({ cwd: projectRoot });
  const firebase = await initializeFirebaseAdmin(process.env);
  if (!firebase.enabled || !firebase.firestore) {
    throw new Error(`Firebase Admin indisponivel: ${firebase.reason ?? "Firestore ausente"}`);
  }
  const records = await seedBuiltinCatalog(firebase.firestore);
  console.log(JSON.stringify({
    mode: "commit",
    projectId: firebase.app.options.projectId ?? process.env.FIREBASE_PROJECT_ID ?? null,
    records,
  }, null, 2));
}

if (resolve(process.argv[1] ?? "") === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
