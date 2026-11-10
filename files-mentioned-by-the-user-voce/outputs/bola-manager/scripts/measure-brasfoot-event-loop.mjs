// D-02 (Etapa 3): measures how long the Brasfoot parser blocks the event loop.
// Uses SYNTHETIC .ban files in the real Java Serialization format: a team object holding an
// array of player objects (int attributes + name), which exercises handles, references and
// nested objects like a real save. Field layout is not Brasfoot's; repeat this measurement
// with a real install when one is available:  node scripts/measure-brasfoot-event-loop.mjs [--inline] [C:\Brasfoot]
// Default measures the worker-thread parser used by the server; --inline measures the old path.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { parseBrasfootSource } from "./lib/brasfoot-binary.mjs";
import { parseBrasfootSourceInWorker } from "./lib/brasfoot-parse-worker.mjs";

const inline = process.argv.includes("--inline");
const parse = inline ? parseBrasfootSource : parseBrasfootSourceInWorker;

const THRESHOLD_MS = 250;

function javaObject(className, fields) {
  const utf = (text) => { const bytes = Buffer.from(text); const size = Buffer.alloc(2); size.writeUInt16BE(bytes.length); return Buffer.concat([size, bytes]); };
  const count = Buffer.alloc(2); count.writeUInt16BE(fields.length);
  const definitions = fields.map(([type, name]) => Buffer.concat([Buffer.from(type), utf(name), ...(type === "L" ? [Buffer.from([0x74]), utf("Ljava/lang/String;")] : [])]));
  const values = fields.map(([type, , value]) => { if (type === "L") return Buffer.concat([Buffer.from([0x74]), utf(value)]); const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes; });
  return Buffer.concat([Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]), utf(className), Buffer.from("0000000000000001", "hex"), Buffer.from([0x02]), count, ...definitions, Buffer.from([0x78, 0x70]), ...values]);
}

const utf = (text) => { const bytes = Buffer.from(text); const size = Buffer.alloc(2); size.writeUInt16BE(bytes.length); return Buffer.concat([size, bytes]); };
const int = (value) => { const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes; };
const reference = (handle) => Buffer.concat([Buffer.from([0x71]), int(0x7e0000 + handle)]);
const UID = Buffer.from("0000000000000001", "hex");

// Handles: e.t desc=0, "Ljava/lang/String;"=1, "[Le.j;" type=2, team=3, d=4, e=5,
// array desc=6, array=7, e.j desc=8, then one object + one name string per player.
function syntheticTeam(index, players, attributes) {
  const parts = [Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]), utf("e.t"), UID, Buffer.from([0x02]), Buffer.from([0x00, 0x04]),
    Buffer.from("I"), utf("a"),
    Buffer.from("L"), utf("d"), Buffer.from([0x74]), utf("Ljava/lang/String;"),
    Buffer.from("L"), utf("e"), reference(1),
    Buffer.from("["), utf("p"), Buffer.from([0x74]), utf("[Le.j;"),
    Buffer.from([0x78, 0x70]),
    int(29), Buffer.from([0x74]), utf(`team-${index}`), Buffer.from([0x74]), utf(`Clube Sintetico ${index}`),
    Buffer.from([0x75, 0x72]), utf("[Le.j;"), UID, Buffer.from([0x02, 0x00, 0x00, 0x78, 0x70]), int(players)];
  const fieldCount = Buffer.alloc(2); fieldCount.writeUInt16BE(attributes + 1);
  const definitions = [fieldCount];
  for (let field = 0; field < attributes; field++) definitions.push(Buffer.from("I"), utf(`a${field}`));
  definitions.push(Buffer.from("L"), utf("n"), reference(1));
  for (let player = 0; player < players; player++) {
    parts.push(Buffer.from([0x73]));
    parts.push(player === 0 ? Buffer.concat([Buffer.from([0x72]), utf("e.j"), UID, Buffer.from([0x02]), ...definitions, Buffer.from([0x78, 0x70])]) : reference(8));
    for (let field = 0; field < attributes; field++) parts.push(int((player * 7 + field) % 100));
    parts.push(Buffer.from([0x74]), utf(`Jogador Sintetico ${index}-${player}`));
  }
  return Buffer.concat(parts);
}

async function measure(label, source) {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  let lastTick = performance.now(); let maxGap = 0;
  const heartbeat = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick); lastTick = now; }, 5);
  histogram.enable();
  const started = performance.now();
  const result = await parse(source);
  const total = performance.now() - started;
  const now = performance.now(); maxGap = Math.max(maxGap, now - lastTick);
  clearInterval(heartbeat); histogram.disable();
  const row = {
    label, clubs: result.clubs?.length ?? result.report?.success?.clubs,
    parseErrors: (result.report?.errors ?? []).filter((error) => /JAVA/.test(error.code ?? "")).length, totalMs: Math.round(total),
    maxBlockMs: Math.round(maxGap), p99DelayMs: Math.round(histogram.percentile(99) / 1e6), maxDelayMs: Math.round(histogram.max / 1e6),
  };
  row.overThreshold = row.maxBlockMs > THRESHOLD_MS;
  console.log(JSON.stringify(row));
  return row;
}

console.log(`modo: ${inline ? "inline (thread principal)" : "worker thread"}`);
const realSource = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (realSource) {
  await measure(`real:${realSource}`, realSource);
} else {
  const scenarios = [
    { label: "200 times x 30 jogadores (base tipica)", files: 200, players: 30, attributes: 20 },
    { label: "1 time x 10 mil jogadores", files: 1, players: 10_000, attributes: 20 },
    { label: "1 time x 100 mil jogadores (limite de array, ~28 MB)", files: 1, players: 100_000, attributes: 60 },
  ];
  const root = await mkdtemp(join(tmpdir(), "bola-brasfoot-lag-"));
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const source = join(root, `s${index}`, "teams");
      await mkdir(source, { recursive: true });
      for (let file = 0; file < scenario.files; file++) {
        await writeFile(join(source, `t${String(file).padStart(3, "0")}_bra.ban`), syntheticTeam(file, scenario.players, scenario.attributes));
      }
      await measure(scenario.label, join(root, `s${index}`));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
