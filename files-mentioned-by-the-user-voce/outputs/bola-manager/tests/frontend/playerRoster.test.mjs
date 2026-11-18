import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function loadPlayerRoster() {
  const source = await readFile(path.join(projectRoot, "src/utils/playerRoster.ts"), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

function player(id, position, status = "Disponivel") {
  return { id, position, status };
}

const formation = {
  slots: [
    { id: "gk", role: "GOL" },
    { id: "cb", role: "ZAG" },
    { id: "cm", role: "MC" },
    { id: "st", role: "ATA" },
  ],
};

test("escalação salva preserva os slots mesmo quando um atleta não existe", async () => {
  const { buildSavedLineup } = await loadPlayerRoster();
  const players = [
    player("keeper", "GOL"),
    player("defender", "ZAG"),
    player("midfielder", "MC"),
    player("striker", "ATA"),
  ];

  const lineup = buildSavedLineup(players, formation, ["keeper", "removed-player", "midfielder"]);

  assert.deepEqual(lineup.map((item) => item?.id), ["keeper", undefined, "midfielder", "striker"]);
});

test("somente slots sem ID salvo recebem preenchimento automático", async () => {
  const { buildSavedLineup } = await loadPlayerRoster();
  const players = [
    player("keeper", "GOL"),
    player("defender", "ZAG"),
    player("midfielder", "MC"),
    player("striker", "ATA"),
  ];

  const lineup = buildSavedLineup(players, formation, ["keeper", "defender"]);

  assert.deepEqual(lineup.map((item) => item?.id), ["keeper", "defender", "midfielder", "striker"]);
});

test("banco mantém disponíveis antes de lesionados e suspensos", async () => {
  const { createBench } = await loadPlayerRoster();
  const players = [
    player("injured", "ZAG", "Lesionado"),
    player("available-1", "MC"),
    player("suspended", "ATA", "Suspenso"),
    player("available-2", "ATA"),
  ];

  const bench = createBench(players, [], 4);

  assert.deepEqual(bench.map((item) => item.id), [
    "available-1",
    "available-2",
    "injured",
    "suspended",
  ]);
});

test("banco sem limite inclui todos os jogadores que não são titulares", async () => {
  const { createBench } = await loadPlayerRoster();
  const players = Array.from({ length: 14 }, (_, index) => player(`player-${index}`, index === 0 ? "GOL" : "MC"));

  const bench = createBench(players, players.slice(0, 4));

  assert.equal(bench.length, 10);
  assert.deepEqual(bench.map((item) => item.id), players.slice(4).map((item) => item.id));
});

test("campo permite selecionar slot vazio", async () => {
  const source = await readFile(
    path.join(projectRoot, "src/components/tactics/TacticsField.tsx"),
    "utf8",
  );

  assert.match(source, /onClick=\{\(\) => onSelect\?\.\(index\)\}/);
  assert.doesNotMatch(source, /if \(activePlayer\) onSelect/);
});

test("reserva pode ser arrastado para uma posição titular", async () => {
  const tacticsView = await readFile(path.join(projectRoot, "src/views/TacticsView.tsx"), "utf8");
  const tacticsField = await readFile(path.join(projectRoot, "src/components/tactics/TacticsField.tsx"), "utf8");

  assert.match(tacticsView, /draggable=\{available\}/);
  assert.match(tacticsView, /setData\(BENCH_PLAYER_DRAG_TYPE, player\.id\)/);
  assert.match(tacticsField, /onBenchPlayerDrop\?\.\(benchPlayerId, index\)/);
});

test("duplo clique abre os stats de titulares e reservas sem escalar o reserva antes", async () => {
  const tacticsView = await readFile(path.join(projectRoot, "src/views/TacticsView.tsx"), "utf8");
  const tacticsField = await readFile(path.join(projectRoot, "src/components/tactics/TacticsField.tsx"), "utf8");
  const profileHost = await readFile(path.join(projectRoot, "src/components/player/PlayerProfileHost.tsx"), "utf8");

  assert.match(tacticsField, /onPlayerDoubleClick\?\.\(activePlayer\)/);
  assert.match(tacticsView, /onPlayerDoubleClick=\{\(player\) => setProfilePlayerId\(player\.id\)\}/);
  assert.match(tacticsView, /onDoubleClick=\{\(event\) => \{[\s\S]*?openBenchProfile\(player\)/);
  assert.match(tacticsView, /window\.setTimeout\(\(\) => \{[\s\S]*?selectFromBench\(player\)/);
  assert.match(tacticsView, /<PlayerProfileHost[\s\S]*?playerId=\{profilePlayerId\}/);
  assert.doesNotMatch(tacticsView, /\sdisabled=\{!available\}/);
  assert.match(profileHost, /<RankingPlayerProfile/);
});
