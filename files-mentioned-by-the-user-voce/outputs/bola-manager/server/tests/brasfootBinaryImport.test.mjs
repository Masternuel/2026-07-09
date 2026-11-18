import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mapBrasfootLeague, mapBrasfootTeam, planClubIds } from "../import/brasfoot/binary.mjs";
import {
  executeImportCommit, normalizeDataset, runImport, secureAssetPath, uploadBrasfootCrests,
} from "../import/brasfoot/importer.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

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

function failStagingBatch(database, collectionName, occurrence = 1) {
  const originalBatch = database.batch.bind(database);
  let matches = 0;
  let failed = false;
  database.batch = () => {
    const batch = originalBatch();
    const paths = [];
    const originalSet = batch.set.bind(batch);
    batch.set = (reference, value, options) => {
      paths.push(reference.path);
      return originalSet(reference, value, options);
    };
    const originalCommit = batch.commit.bind(batch);
    batch.commit = async () => {
      if (!failed && paths.some((path) => path.includes(`/${collectionName}/`))) {
        matches += 1;
        if (matches === occurrence) {
          failed = true;
          throw new Error(`falha em ${collectionName}`);
        }
      }
      return originalCommit();
    };
    return batch;
  };
}

function activeRecords(database, collectionName) {
  const generationId = database.read("brasfootImports/current")?.activeGenerationId;
  if (!generationId) return [];
  return [...database.dump(`brasfootCatalogGenerations/${generationId}/${collectionName}`).values()];
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
  assert.equal(result.club.state, "SP");
  assert.deepEqual(result.club.colors, ["#112233", "#ffffff"]);
  assert.equal(result.players.length, 2);
  assert.equal(result.players[0].position, "ATA");
  assert.equal(result.players[0].shirtNumber, 9);
  assert.equal(result.players[0].starter, true);
  assert.equal(result.players[0].overall, 13);
  // Rated 13 (< 15): a "craque" marker alone does not make a star.
  assert.equal(result.players[0].isStar, false);
  assert.equal(result.players[0].brasfootCraque, true);
  assert.deepEqual(result.players[0].characteristics, ["Finalizacao", "Velocidade"]);
  assert.deepEqual(result.players[0].attributes, { chute: 15, velocidade: 15 });
  assert.equal(result.players[0].brasfootRoster, "senior");
  assert.equal(result.players[1].position, "LE");
  assert.equal(result.players[1].shirtNumber, 6);
  assert.equal(result.players[1].nationality, "ESP");
  assert.equal(result.players[1].brasfootRoster, "youth");
});

test("importa camisa explicita e gera camisas estaveis quando o BAN nao possui o campo", () => {
  const player = (name, fields) => javaObject("e.g", {
    a: name, b: false, c: 29, d: 24, f: 0, g: 7, h: 11, hash: 5, i: 0, j: false,
    ...fields,
  });
  const roster = [
    player("Goleiro titular", { e: 0 }),
    player("Goleiro reserva", { e: 0 }),
    player("Lateral direito", { e: 1, i: 0 }),
    player("Lateral esquerdo", { e: 1, i: 1 }),
    player("Zagueiro um", { e: 2 }),
    player("Zagueiro dois", { e: 2 }),
    player("Meia dez", { e: 3 }),
    player("Centroavante", { e: 4, g: 9 }),
    player("Ponta direita", { e: 4, i: 0 }),
    player("Ponta esquerda", { e: 4, i: 1 }),
    player("Camisa da origem", { e: 3, camisa: 77 }),
  ];
  const team = javaObject("e.t", {
    a: 29, c: 18, d: "camisas", e: "Clube Camisas", l: javaList(roster), m: javaList([]),
  });

  const first = mapBrasfootTeam(team, { filenameStem: "clube_camisas" });
  const second = mapBrasfootTeam(team, { filenameStem: "clube_camisas" });
  const expected = [1, 12, 2, 6, 3, 4, 10, 9, 7, 11, 77];

  assert.deepEqual(first.players.map(({ shirtNumber }) => shirtNumber), expected);
  assert.deepEqual(second.players.map(({ shirtNumber }) => shirtNumber), expected);
  assert.equal(new Set(expected).size, expected.length);

  const normalized = normalizeDataset({
    version: "camisas",
    clubs: [first.club],
    players: first.players,
    leagues: [],
    cups: [],
  });
  assert.deepEqual(normalized.players.map(({ shirtNumber }) => shirtNumber), expected);
});

test("converte estado numerico do Brasfoot em UF sem confundir clube estrangeiro", () => {
  const acre = javaObject("e.t", {
    a: 29, b: 0, c: 10, d: "acre", e: "Acre FC", l: javaList([]), m: javaList([]),
  });
  const minas = javaObject("e.t", {
    a: 29, b: 10, c: 10, d: "minas", e: "Minas FC", l: javaList([]), m: javaList([]),
  });
  const england = javaObject("e.t", {
    a: 97, b: 0, c: 10, d: "england", e: "England FC", l: javaList([]), m: javaList([]),
  });

  assert.equal(mapBrasfootTeam(acre, { filenameStem: "acre" }).club.state, "AC");
  assert.equal(mapBrasfootTeam(minas, { filenameStem: "minas" }).club.state, "MG");
  assert.equal(mapBrasfootTeam(england, { filenameStem: "england" }).club.state, null);
});

test("preserva sinais de goleiro e fisicos em atributos especificos", () => {
  const goalkeeper = javaObject("e.g", {
    a: "Goleiro Teste", b: false, c: 29, d: 25, e: 0, f: 1, g: 0, h: 2, i: 0, j: false,
  });
  const goalkeeperSetPieces = javaObject("e.g", {
    a: "Goleiro Reserva", b: false, c: 29, d: 23, e: 0, f: 0, g: 1, h: 3, i: 0, j: false,
  });
  const physicalPlayer = javaObject("e.g", {
    a: "Atleta Fisico", b: false, c: 29, d: 24, e: 4, f: 1, g: 5, h: 12, i: 0, j: false,
  });
  const team = javaObject("e.t", {
    a: 29, b: 25, c: 20, d: "traits", e: "Clube Traits", f: "Arena", g: 20_000,
    h: "Tecnico", valid: true,
    l: javaList([goalkeeper, goalkeeperSetPieces, physicalPlayer]), m: javaList([]),
  });

  const result = mapBrasfootTeam(team, { filenameStem: "clube_traits" });
  assert.deepEqual(result.players[0].attributes, {
    defesa: 15,
    nocao: 15,
    posicionamentoGol: 14,
    reflexos: 14,
  });
  assert.deepEqual(result.players[1].attributes, {
    defesa: 14,
    nocao: 14,
    penaltis: 13,
    saidaGol: 13,
  });
  assert.deepEqual(result.players[2].attributes, {
    nocao: 14,
    chute: 14,
    impulsao: 14,
    forca: 14,
    resistencia: 14,
  });

  const normalized = normalizeDataset({
    version: "traits",
    clubs: [result.club],
    players: result.players,
    leagues: [],
    cups: [],
  });
  assert.ok(normalized.players.every((player) => [
    "forca", "resistencia", "impulsao", "reflexos", "posicionamentoGol", "saidaGol", "penaltis",
  ].every((key) => Number.isFinite(player.attributes[key]))));
});

test("cabeceio de zagueiro fortalece defesa sem criar chute de atacante", () => {
  const defender = javaObject("e.g", {
    a: "Zagueiro Teste", b: false, c: 29, d: 27, e: 2, f: 1, g: 10, h: 5, i: 0, j: false, hash: 5,
  });
  const team = javaObject("e.t", {
    a: 29, c: 20, d: "zagueiro", e: "Clube Zagueiro", l: javaList([defender]), m: javaList([]),
  });
  const mapped = mapBrasfootTeam(team, { filenameStem: "clube_zagueiro" });
  assert.equal(Object.hasOwn(mapped.players[0].attributes, "chute"), false);
  assert.ok(mapped.players[0].attributes.defesa > mapped.players[0].overall);

  const source = { version: "zag", clubs: [mapped.club], players: mapped.players, leagues: [], cups: [] };
  const first = normalizeDataset(source).players[0];
  const second = normalizeDataset(source).players[0];
  assert.deepEqual(first.attributes, second.attributes);
  assert.ok(first.attributes.defesa > first.attributes.chute);
  assert.ok(first.attributes.nocao > first.attributes.drible);
  assert.ok(first.attributes.chute <= Math.ceil(first.overall * 0.6));
});

test("notas: forca do time, craque, idade e base definem a nota; campo f nao altera", () => {
  const player = (name, fields = {}) => javaObject("e.g", {
    a: name, b: false, c: 29, d: 27, e: 3, f: 0, g: 4, h: 11, hash: 5, i: 0, j: false,
    ...fields,
  });
  const strongTeam = javaObject("e.t", {
    a: 29, c: 22, d: "forte", e: "Forte FC",
    l: javaList([
      player("Normal"), player("Normal marcado f", { f: 1 }), player("Craque", { b: true }),
      player("Top mundial", { j: true }), player("Veterano craque", { b: true, d: 40 }), player("Garoto", { d: 18 }),
    ]),
    m: javaList([player("Base", { d: 17 })]),
  });
  const byName = Object.fromEntries(mapBrasfootTeam(strongTeam, { filenameStem: "forte" }).players.map((item) => [item.name, item]));
  assert.equal(byName.Normal.overall, byName["Normal marcado f"].overall, "field f is not a starter flag");
  assert.ok(byName.Craque.overall > byName.Normal.overall);
  assert.ok(byName["Top mundial"].overall > byName.Craque.overall);
  assert.ok(byName["Veterano craque"].overall < byName.Craque.overall - 3);
  assert.ok(byName.Garoto.overall < byName.Normal.overall);
  assert.ok(byName.Base.overall < byName.Garoto.overall);
  assert.equal(byName.Normal.overall, 13);
  assert.equal(byName["Top mundial"].overall, 18);

  const weakTeam = javaObject("e.t", {
    a: 29, c: 1, d: "fraco", e: "Fraco FC",
    l: javaList([player("Fraco normal", { hash: 0 }), player("Fraco craque", { b: true, hash: 10 })]),
    m: javaList([]),
  });
  const weak = mapBrasfootTeam(weakTeam, { filenameStem: "fraco" }).players;
  assert.ok(weak.every(({ overall }) => overall >= 1 && overall <= 6));
  assert.ok(weak.every(({ isStar }) => isStar === false));
});

test("estrelas: so craques nota 15+ e craques mundiais, no maximo 3 por clube, nunca da base", () => {
  const player = (name, fields = {}) => javaObject("e.g", {
    a: name, b: true, c: 29, d: 27, e: 3, f: 0, g: 4, h: 11, hash: 5, i: 0, j: false,
    ...fields,
  });
  const team = javaObject("e.t", {
    a: 29, c: 22, d: "estrelas", e: "Estrelas FC",
    l: javaList([
      ...Array.from({ length: 8 }, (_, index) => player(`Craque ${index}`, { hash: index })),
      player("Craque idoso", { d: 40 }),
      player("Mundial fraco de nota", { b: false, j: true, d: 36 }),
    ]),
    m: javaList([player("Craque da base", { d: 17, hash: 10 })]),
  });
  const players = mapBrasfootTeam(team, { filenameStem: "estrelas" }).players;
  const stars = players.filter((item) => item.isStar);
  assert.equal(stars.length, 3);
  assert.ok(stars.some((item) => item.name === "Mundial fraco de nota"), "world-class players always rank first");
  assert.ok(stars.every((item) => item.worldClass || item.overall >= 15));
  assert.ok(!stars.some((item) => ["Craque idoso", "Craque da base"].includes(item.name)));
});

test("mapeia configuracao nacional e preserva regras cruas", () => {
  const config = javaObject("est.ConfigLigaType", {
    pais: 29, divisao: 1, nome: "Brasileirao", nomeDivisao: "Serie A", nTimes: 20, nRebaixados: 4,
    doisTurnos: true,
  });
  const league = mapBrasfootLeague(config, { countryCode: "BRA" });

  assert.equal(league.id, "BRA-1");
  assert.equal(league.name, "Brasileirao - Serie A");
  assert.equal(league.level, 1);
  assert.equal(league.legs, "double");
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
      ownerId: "owner-asset",
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
  assert.equal(uploaded[0].uploadedBy, "owner-asset");
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
  // Assert on the rejected field, not on zod's wording (it changed between zod 3 and 4).
  const rejects = (path) => (error) => error.issues?.some((issue) => issue.path.join(".") === path);
  assert.throws(() => normalizeDataset({ ...raw, clubs: [{ ...raw.clubs[0], reputation: 10.5 }] }), rejects("clubs.0.reputation"));
  assert.throws(() => normalizeDataset({ ...raw, players: [{ ...raw.players[0], position: "QUALQUER" }] }), rejects("players.0.position"));
});

test("commit registra progresso e conclusao em documento por execucao", async () => {
  const database = createFakeFirestore({
    initialDocuments: { "brasfootClubs/original": { id: "original", name: "Original" } },
  });
  const report = emptyReport();
  const data = {
    version: "teste",
    clubs: [{ id: "club", name: "Clube", leagueId: "league" }],
    players: [{ id: "player", name: "Atleta", clubId: "club" }],
    leagues: [{ id: "league", name: "Liga" }],
    cups: [{ id: "cup", name: "Copa" }],
  };
  await executeImportCommit({
    database,
    data,
    summary: { version: "teste", clubs: 1, players: 1, leagues: 1, cups: 1, playersWithoutClub: 0 },
    parsedSource: { report, assetRoot: null },
    options: { batchSize: 2, skipAssets: true },
    runId: "run-completo",
    now: () => "2026-07-13T00:00:00.000Z",
  });

  assert.equal(database.read("brasfootImports/run-completo").status, "completed");
  assert.equal(database.read("brasfootImports/run-completo").progress.phase, "completed");
  assert.equal(database.read("brasfootImports/current").runId, "run-completo");
  assert.deepEqual(activeRecords(database, "brasfootClubs").map(({ id }) => id).sort(), ["club", "original"]);
  assert.deepEqual(activeRecords(database, "brasfootPlayers").map(({ id }) => id), ["player"]);
  assert.deepEqual(activeRecords(database, "brasfootLeagues").map(({ id }) => id), ["league"]);
  assert.deepEqual(activeRecords(database, "brasfootCups").map(({ id }) => id), ["cup"]);
  assert.equal(report.commit.status, "completed");
});

test("falha no inicio nao altera a base e remove assets enviados", async () => {
  const root = await mkdtemp(join(tmpdir(), "brasfoot-cleanup-"));
  await mkdir(join(root, "teams", "escudos"), { recursive: true });
  await writeFile(join(root, "teams", "escudos", "club.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const database = createFakeFirestore({
    initialDocuments: { "brasfootClubs/original": { id: "original", name: "Original" } },
  });
  failStagingBatch(database, "brasfootClubs");
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
        async upload(input) {
          assert.equal(input.uploadedBy, "owner-rollback");
          return { url: "https://storage/club.png", path: "editor-media/clubs/run/club.png" };
        },
        async remove(path, scope) {
          assert.equal(scope.ownerId, "owner-rollback");
          assert.equal(scope.entity, "clubs");
          assert.equal(scope.recordId, "club");
          removed.push(path);
        },
      },
      ownerId: "owner-rollback",
      runId: "run-falho",
      now: () => "2026-07-13T00:00:00.000Z",
    }), /falha em brasfootClubs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(removed, ["editor-media/clubs/run/club.png"]);
  assert.equal(report.assets.cleanedUp, 1);
  assert.equal(report.commit.status, "failed");
  assert.equal(database.read("brasfootImports/run-falho").status, "failed");
  assert.equal(database.has("brasfootImports/current"), false);
  assert.deepEqual(database.read("brasfootClubs/original"), { id: "original", name: "Original" });
  assert.equal(database.has("brasfootClubs/club"), false);
  assert.equal(database.dump("brasfootCatalogGenerations").size, 0);
});

test("falha no meio desfaz todo staging e todos os assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "brasfoot-preserve-"));
  await mkdir(join(root, "teams", "escudos"), { recursive: true });
  await writeFile(join(root, "teams", "escudos", "club.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const database = createFakeFirestore({
    initialDocuments: { "brasfootClubs/original": { id: "original", name: "Original" } },
  });
  failStagingBatch(database, "brasfootClubs", 2);
  const removed = [];
  const report = emptyReport(root);
  const data = {
    version: "teste",
    clubs: [
      { id: "club", assets: { shield: "teams/escudos/club.png" } },
      { id: "club-2" },
    ],
    players: [{ id: "player", clubId: "club" }],
    leagues: [], cups: [],
  };
  try {
    await assert.rejects(() => executeImportCommit({
      database,
      data,
      summary: { version: "teste", clubs: 2, players: 1, leagues: 0, cups: 0, playersWithoutClub: 0 },
      parsedSource: { report, assetRoot: root },
      options: { batchSize: 1, skipAssets: false },
      mediaService: {
        async upload() { return { url: "https://storage/club.png", path: "editor-media/clubs/run/club.png" }; },
        async remove(path) { removed.push(path); },
      },
      runId: "run-parcial",
      now: () => "2026-07-13T00:00:00.000Z",
    }), /falha em brasfootClubs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  assert.deepEqual(removed, ["editor-media/clubs/run/club.png"]);
  assert.equal(report.assets.preserved, 0);
  assert.equal(report.assets.cleanedUp, 1);
  assert.deepEqual(database.read("brasfootClubs/original"), { id: "original", name: "Original" });
  assert.equal(database.has("brasfootImports/current"), false);
  assert.equal(database.dump("brasfootCatalogGenerations").size, 0);
});

test("falha na ativacao final preserva integralmente a geracao anterior", async () => {
  const database = createFakeFirestore({
    initialDocuments: { "brasfootClubs/original": { id: "original", name: "Original" } },
  });
  const originalTransaction = database.runTransaction.bind(database);
  let transactionCalls = 0;
  database.runTransaction = async (operation, options) => {
    transactionCalls += 1;
    if (transactionCalls === 3) throw new Error("falha na ativacao final");
    return originalTransaction(operation, options);
  };
  const report = emptyReport();
  await assert.rejects(() => executeImportCommit({
    database,
    data: { version: "teste", clubs: [{ id: "club" }], players: [], leagues: [], cups: [] },
    summary: { version: "teste", clubs: 1, players: 0, leagues: 0, cups: 0, playersWithoutClub: 0 },
    parsedSource: { report, assetRoot: null },
    options: { batchSize: 2, skipAssets: true },
    runId: "run-final",
    now: () => "2026-07-13T00:00:00.000Z",
  }), /falha na ativacao final/);

  assert.deepEqual(database.read("brasfootClubs/original"), { id: "original", name: "Original" });
  assert.equal(database.has("brasfootClubs/club"), false);
  assert.equal(database.has("brasfootImports/current"), false);
  assert.equal(database.dump("brasfootCatalogGenerations").size, 0);
});

test("nova tentativa apos rollback conclui sem duplicatas ou residuos", async () => {
  const database = createFakeFirestore({
    initialDocuments: { "brasfootClubs/original": { id: "original", name: "Original" } },
  });
  failStagingBatch(database, "brasfootClubs");
  const data = { version: "teste", clubs: [{ id: "club" }], players: [], leagues: [], cups: [] };
  const summary = { version: "teste", clubs: 1, players: 0, leagues: 0, cups: 0, playersWithoutClub: 0 };
  await assert.rejects(() => executeImportCommit({
    database,
    data,
    summary,
    parsedSource: { report: emptyReport(), assetRoot: null },
    options: { batchSize: 1, skipAssets: true },
    runId: "run-retry",
    now: () => "2026-07-13T00:00:00.000Z",
  }), /falha em brasfootClubs/);
  await executeImportCommit({
    database,
    data,
    summary,
    parsedSource: { report: emptyReport(), assetRoot: null },
    options: { batchSize: 1, skipAssets: true },
    runId: "run-retry",
    now: () => "2026-07-13T00:00:01.000Z",
  });

  assert.deepEqual(activeRecords(database, "brasfootClubs").map(({ id }) => id).sort(), ["club", "original"]);
  assert.equal(database.dump("brasfootCatalogGenerations").size, 2);
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

test("divisoes: clubes de cada pais preenchem as ligas por forca, sem copias duplicadas", async () => {
  const { assignClubsToLeagues } = await import("../import/brasfoot/binary.mjs");
  const club = (id, name, country, c, g = 0) => ({ id, name, country, active: true, leagueId: null, division: "Sem divisao", brasfootRaw: { c, g } });
  const clubs = [
    club("fra", "Fraco", "BRA", 5), club("gra", "Grande", "BRA", 22, 50_000), club("med", "Medio", "BRA", 15),
    club("gra2", "Grande", "BRA", 21), club("emp", "Empate menor torcida", "BRA", 15, 10), club("emp2", "Empate maior torcida", "BRA", 15, 900),
    club("arg", "Argentino", "ARG", 20), club("sem", "Sem liga", "XYZ", 25),
  ];
  const leagues = [
    { id: "BRA-2", country: "BRA", level: 2, division: "Serie B", brasfootRaw: { nTimes: 2 } },
    { id: "BRA-1", country: "BRA", level: 1, division: "Serie A", brasfootRaw: { nTimes: 2 } },
    { id: "ARG-1", country: "ARG", level: 1, division: "Primera", brasfootRaw: { nTimes: 20 } },
  ];
  assert.equal(assignClubsToLeagues(clubs, leagues), 5);
  const byId = Object.fromEntries(clubs.map((item) => [item.id, item]));
  assert.equal(byId.gra.leagueId, "BRA-1");
  assert.equal(byId.emp2.leagueId, "BRA-1", "same strength: bigger fan base first");
  assert.equal(byId.med.leagueId, "BRA-2");
  assert.equal(byId.emp.leagueId, "BRA-2");
  assert.equal(byId.emp.division, "Serie B");
  assert.equal(byId.gra2.leagueId, null, "a duplicate copy of a club is not placed twice");
  assert.equal(byId.fra.leagueId, null, "clubs beyond the configured sizes stay out of the leagues");
  assert.equal(byId.arg.leagueId, "ARG-1");
  assert.equal(byId.sem.leagueId, null);
});
