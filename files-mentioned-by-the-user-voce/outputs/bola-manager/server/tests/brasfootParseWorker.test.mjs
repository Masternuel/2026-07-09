import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBrasfootSource } from "../../scripts/lib/brasfoot-binary.mjs";
import { parseBrasfootSourceInWorker } from "../../scripts/lib/brasfoot-parse-worker.mjs";

function javaObject(className, fields) {
  const utf = (text) => { const bytes = Buffer.from(text); const size = Buffer.alloc(2); size.writeUInt16BE(bytes.length); return Buffer.concat([size, bytes]); };
  const count = Buffer.alloc(2); count.writeUInt16BE(fields.length);
  const definitions = fields.map(([type, name]) => Buffer.concat([Buffer.from(type), utf(name), ...(type === "L" ? [Buffer.from([0x74]), utf("Ljava/lang/String;")] : [])]));
  const values = fields.map(([type, , value]) => { if (type === "L") return Buffer.concat([Buffer.from([0x74]), utf(value)]); const bytes = Buffer.alloc(4); bytes.writeInt32BE(value); return bytes; });
  return Buffer.concat([Buffer.from([0xac, 0xed, 0x00, 0x05, 0x73, 0x72]), utf(className), Buffer.from("0000000000000001", "hex"), Buffer.from([0x02]), count, ...definitions, Buffer.from([0x78, 0x70]), ...values]);
}

async function source(t, teams) {
  const root = await mkdtemp(join(tmpdir(), "bola-brasfoot-worker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "teams"));
  for (const [index, name] of teams.entries()) {
    await writeFile(join(root, "teams", `t${index}_bra.ban`), javaObject("e.t", [["I", "a", 29], ["L", "d", `team-${index}`], ["L", "e", name]]));
  }
  return root;
}

test("D-02: o worker devolve exatamente o mesmo resultado do parser na thread principal", async (t) => {
  const root = await source(t, ["Clube Um", "Clube Dois", "Clube Ação"]);
  const [inline, worker] = await Promise.all([parseBrasfootSource(root), parseBrasfootSourceInWorker(root)]);
  assert.equal(worker.dataset.clubs.length, 3);
  assert.deepEqual(worker, inline);
});

test("D-02: erros do parser atravessam o worker com a mensagem original", async (t) => {
  const root = await source(t, ["A", "B"]);
  await assert.rejects(parseBrasfootSourceInWorker(root, { maxFiles: 1 }), /excede o limite de arquivos/);
  await assert.rejects(parseBrasfootSourceInWorker(join(root, "nao-existe")), (error) => error instanceof Error && error.message.length > 0);
});

test("D-02: leitura que estoura o tempo limite e interrompida com erro publico", async (t) => {
  const root = await source(t, ["A"]);
  await assert.rejects(parseBrasfootSourceInWorker(root, {}, { timeoutMs: 1 }), { code: "BRASFOOT_IMPORT_PARSE_TIMEOUT", status: 413 });
});

test("D-02: falta de memoria no worker vira erro de limite, sem derrubar o processo", async () => {
  const { EventEmitter } = await import("node:events");
  const fake = new EventEmitter(); fake.terminate = async () => {};
  const pending = parseBrasfootSourceInWorker("x", {}, { createWorker: () => fake });
  fake.emit("error", Object.assign(new Error("oom"), { code: "ERR_WORKER_OUT_OF_MEMORY" }));
  await assert.rejects(pending, { code: "BRASFOOT_IMPORT_PARSE_MEMORY", status: 413 });
});
