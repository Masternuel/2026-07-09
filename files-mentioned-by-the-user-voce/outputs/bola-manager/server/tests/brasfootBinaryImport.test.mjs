import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mapBrasfootLeague, mapBrasfootTeam, planClubIds } from "../../scripts/lib/brasfoot-binary.mjs";
import {
  executeImportCommit, normalizeDataset, runImport, secureAssetPath, uploadBrasfootCrests,
} from "../../scripts/import-brasfoot.mjs";

function javaObject(className, fields) {
  return { $java: "object", $class: className, $fields: fields, $classData: [] };
}

function javaList(values) {
  return { $java: "object", $class: "java.util.ArrayList", $fields: {}, $classData: [], $values: values };
}

function emptyReport(inputPath = "C:/Brasfoot") {
  return {
    sourceFormat: "brasfoot-java-serialization",
    inputPath,
    success: { clubs: 0, players: 0, leagues: 0 },
    errors: [],
    warnings: [],
    duplicates: { clubs: [], clubNames: [], players: [], leagues: [] },
    corrupted: [],
    assets: { shieldsFound: 0, shieldsMissing: 0, miniShieldsFound: 0, shirtsFound: 0 },
  };
}

function fakeDatabase({ failCollection = null } = {}) {
  const documents = new Map();
  let failed = false;
  function reference(collectionName, id) {
    const key = `${collectionName}/${id}`;
    return {
      collectionName,
      id,
      key,
      async set(value, options = {}) {
        const previous = options.merge ? documents.get(key) ?? {} : {};
        documents.set(key, { ...previous, ...structuredClone(value) });
      },
    };
  }
  return {
    documents,
    collection(collectionName) {
      return { doc: (id) => reference(collectionName, id) };
    },
    batch() {
      const operations = [];
      return {
        set(documentReference, value) {
          operations.push([documentReference, value]);
        },
        async commit() {
          if (!failed && operations.some(([item]) => item.collectionName === failCollection)) {
            failed = true;
            throw new Error(`falha em ${failCollection}`);
          }
          for (const [documentReference, value] of operations) await documentReference.set(value, { merge: true });
        },
      };
    },
  };
}

test("mapeia clube, elenco senior e juniores com IDs estaveis", () => {
  const senior = javaObject("e.g", {
    a: "Atacante Teste", b: true, c: 29, d: 21, e: 4, f: 1, g: 9, h: 13, i: 0, j: false, hash: 7,
  });
  const youth = javaObject("e.g", {
    a: "Lateral Jovem", b: false, c: 65, d: 17, e: 1, f: 0, g: 6, h: 7, i: 1, j: false, hash: 4,
  });
  const team = javaObject("e.t", {
    a: 29, b: 25, c: 20, d: "slug-interno-duplicavel", e: "Clube Teste", f: "Arena Teste", g: 40_000,
    h: "Tecnico", valid: true, cor1: "#112233", cor2: "#ffffff", l: javaList([senior]), m: javaList([youth]),
  });

  const result = mapBrasfootTeam(team, {
    filenameStem: "clube_teste_bra",
    countriesById: new Map([[29, "BRA"], [65, "ESP"]]),
  });

  assert.equal(result.club.id, "clube_teste_bra");
  assert.equal(result.club.reputation, 16);
  assert.equal(result.club.stadiumCapacity, 40_000);
  assert.deepEqual(result.club.colors, ["#112233", "#ffffff"]);
  assert.equal(result.players.length, 2);
  assert.equal(result.players[0].position, "ATA");
  assert.equal(result.players[0].starter, true);
  assert.deepEqual(result.players[0].characteristics, ["Finalizacao", "Velocidade"]);
  assert.deepEqual(result.players[0].attributes, { chute: 19, velocidade: 19 });
  assert.equal(result.players[0].brasfootRoster, "senior");
  assert.equal(result.players[1].position, "LE");
  assert.equal(result.players[1].nationality, "ESP");
  assert.equal(result.players[1].brasfootRoster, "youth");
});

test("mapeia configuracao nacional e preserva regras cruas", () => {
  const config = javaObject("est.ConfigLigaType", {
    pais: 29, divisao: 1, nome: "Brasileirao", nomeDivisao: "Serie A", nTimes: 20, nRebaixados: 4,
  });
  const league = mapBrasfootLeague(config, { countryCode: "BRA" });

  assert.equal(league.id, "BRA-1");
  assert.equal(league.name, "Brasileirao - Serie A");
  assert.equal(league.level, 1);
  assert.equal(league.brasfootRaw.nTimes, 20);
  assert.equal(league.brasfootRaw.nRebaixados, 4);
});

test("IDs de jogadores usam tid ou fingerprint e nao mudam ao reordenar elenco", () => {
  const withTid = javaObject("e.g", {
    a: "Jogador Com ID", tid: 7788, c: 29, d: 24, e: 3, f: 1, g: 4, h: 11, i: 0, hash: 7,
  });
  const withoutTid = javaObject("e.g", {
    a: "Jogador Sem ID", tid: 0, c: 29, d: 19, e: 4, f: 0, g: 8, h: 13, i: 1, hash: 3,
  });
  const fields = { a: 29, c: 15, d: "ordem", e: "Ordem FC", l: javaList([withTid, withoutTid]), m: javaList([]) };
  const forward = mapBrasfootTeam(javaObject("e.t", fields), { filenameStem: "ordem" });
  const reversed = mapBrasfootTeam(javaObject("e.t", { ...fields, l: javaList([withoutTid, withTid]) }), {
    filenameStem: "ordem",
  });

  assert.equal(forward.players.find((player) => player.name === "Jogador Com ID").id, "ordem-tid-7788");
  assert.match(forward.players.find((player) => player.name === "Jogador Sem ID").id, /^ordem-fp-[a-f0-9]{20}$/);
  assert.deepEqual(
    forward.players.map((player) => player.id).sort(),
    reversed.players.map((player) => player.id).sort(),
  );
});

test("colisoes de slug de clube recebem IDs deterministas sem descartar caminhos", () => {
  const root = join("C:", "Brasfoot");
  const files = [
    join(root, "teams", "Juarez_mex.ban"),
    join(root, "teams", "Juárez_mex.ban"),
  ];
  const report = emptyReport(root);
  const first = planClubIds(files, root, report);
  const second = planClubIds([...files].reverse(), root, emptyReport(root));

  assert.equal(new Set(first.values()).size, 2);
  assert.equal(report.duplicates.clubs.length, 1);
  assert.equal(report.warnings.every((warning) => warning.code === "DUPLICATE_CLUB_ID_RESOLVED"), true);
  for (const file of files) assert.equal(first.get(file), second.get(file));
});

test("envia escudo detectado e associa URL/path ao clube", async () => {
  const root = await mkdtemp(join(tmpdir(), "brasfoot-assets-"));
  const shieldDirectory = join(root, "teams", "escudos");
  await mkdir(shieldDirectory, { recursive: true });
  await writeFile(join(shieldDirectory, "clube.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const clubs = [{ id: "clube", assets: { shield: "teams/escudos/clube.png" } }];
  const uploaded = [];
  const report = { warnings: [], assets: {} };
  try {
    await uploadBrasfootCrests({
      clubs,
      assetRoot: root,
      report,
      mediaService: {
        async upload(input) {
          uploaded.push(input);
          return { url: "https://storage.example/clube.png", path: "editor-media/clubs/hash/crest.png" };
        },
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(uploaded.length, 1);
  assert.equal(uploaded[0].mimeType, "image/png");
  assert.equal(clubs[0].crestImageUrl, "https://storage.example/clube.png");
  assert.equal(clubs[0].crestImagePath, "editor-media/clubs/hash/crest.png");
  assert.equal(report.assets.uploaded, 1);
  assert.equal(report.assets.failed, 0);
});

test("caminho de escudo rejeita fuga e link simbolico ou junction", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "brasfoot-path-"));
  const root = join(parent, "root");
  const outside = join(parent, "outside");
  await mkdir(join(root, "teams", "escudos"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(root, "teams", "escudos", "ok.png"), "ok");
  await writeFile(join(outside, "escape.png"), "escape");
  try {
    assert.equal(await secureAssetPath(root, "teams/escudos/ok.png"), await secureAssetPath(root, "teams/escudos/ok.png"));
    await assert.rejects(() => secureAssetPath(root, "../outside/escape.png"), /fora da origem/);
    const linked = join(root, "teams", "linked");
    try {
      await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
        context.skip("Ambiente nao permite criar link simbolico/junction");
        return;
      }
      throw error;
    }
    await assert.rejects(() => secureAssetPath(root, "teams/linked/escape.png"), /link simbolico|junction|sai da origem/);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("schema normalizado exige posicao canonica, reputacao inteira e completa ligas", () => {
  const raw = {
    version: "schema",
    clubs: [{ id: "club", name: "Clube", reputation: 10 }],
    players: [{ id: "p1", clubId: "club", name: "Atleta", position: "MC", age: 20, attributes: {} }],
    leagues: [{ id: "liga", name: "Liga" }],
    cups: [],
  };
  const normalized = normalizeDataset(raw);
  assert.deepEqual(
    { country: normalized.leagues[0].country, level: normalized.leagues[0].level, division: normalized.leagues[0].division, active: normalized.leagues[0].active },
    { country: "Brasil", level: 1, division: "Primeira divisao", active: true },
  );
  assert.throws(() => normalizeDataset({ ...raw, clubs: [{ ...raw.clubs[0], reputation: 10.5 }] }), /integer/);
  assert.throws(() => normalizeDataset({ ...raw, players: [{ ...raw.players[0], position: "QUALQUER" }] }), /Invalid enum/);
});

test("commit registra progresso e conclusao em documento por execucao", async () => {
  const database = fakeDatabase();
  const report = emptyReport();
  const data = { version: "teste", clubs: [], players: [], leagues: [], cups: [] };
  await executeImportCommit({
    database,
    data,
    summary: { version: "teste", clubs: 0, players: 0, leagues: 0, cups: 0, playersWithoutClub: 0 },
    parsedSource: { report, assetRoot: null },
    options: { batchSize: 2, skipAssets: true },
    runId: "run-completo",
    now: () => "2026-07-13T00:00:00.000Z",
  });

  assert.equal(database.documents.get("brasfootImports/run-completo").status, "completed");
  assert.equal(database.documents.get("brasfootImports/run-completo").progress.phase, "completed");
  assert.equal(database.documents.get("brasfootImports/current").runId, "run-completo");
  assert.equal(report.commit.status, "completed");
});

test("commit falho marca execucao e remove somente assets enviados nela", async () => {
  const root = await mkdtemp(join(tmpdir(), "brasfoot-cleanup-"));
  await mkdir(join(root, "teams", "escudos"), { recursive: true });
  await writeFile(join(root, "teams", "escudos", "club.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const database = fakeDatabase({ failCollection: "brasfootClubs" });
  const removed = [];
  const report = emptyReport(root);
  const data = {
    version: "teste",
    clubs: [{ id: "club", assets: { shield: "teams/escudos/club.png" } }],
    players: [], leagues: [], cups: [],
  };
  try {
    await assert.rejects(() => executeImportCommit({
      database,
      data,
      summary: { version: "teste", clubs: 1, players: 0, leagues: 0, cups: 0, playersWithoutClub: 0 },
      parsedSource: { report, assetRoot: root },
      options: { batchSize: 2, skipAssets: false },
      mediaService: {
        async upload() { return { url: "https://storage/club.png", path: "editor-media/clubs/run/club.png" }; },
        async remove(path) { removed.push(path); },
      },
      runId: "run-falho",
      now: () => "2026-07-13T00:00:00.000Z",
    }), /falha em brasfootClubs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(removed, ["editor-media/clubs/run/club.png"]);
  assert.equal(report.assets.cleanedUp, 1);
  assert.equal(report.commit.status, "failed");
  assert.equal(database.documents.get("brasfootImports/run-falho").status, "failed");
  assert.equal(database.documents.has("brasfootImports/current"), false);
});

test("runImport grava relatorio final mesmo quando a entrada falha", async () => {
  const root = await mkdtemp(join(tmpdir(), "brasfoot-report-final-"));
  const input = join(root, "invalido.json");
  const reportPath = join(root, "report.json");
  await writeFile(input, "{nao-json");
  try {
    await assert.rejects(() => runImport({ input, report: reportPath, dryRun: true, batchSize: 2 }), /JSON/);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.commit.status, "failed");
    assert.match(report.commit.error, /JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
