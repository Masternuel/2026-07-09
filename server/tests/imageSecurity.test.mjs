import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import express from "express";
import sharp from "sharp";
import { allowedExternalImage, IMAGE_CSP, HTTP_CSP, MAX_IMAGE_BYTES } from "../../shared/imagePolicy.mjs";
import { prepareCatalogMedia, createCatalogMediaService } from "../services/catalogMedia.mjs";
import { createImagesRouter } from "../routes/images.mjs";
import { png, jpeg, webp } from "./helpers/imageFixtures.mjs";

const origin = "https://res.cloudinary.com/test/image/upload/crest.png";
const responseImage = (bytes = png, headers = {}) => new Response(bytes, { headers: { "content-type": "image/png", ...headers } });
async function proxy(context, options) {
  const app = express();
  app.use("/api/media", createImagesRouter(options));
  const server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return (url = origin, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/media/image?url=${encodeURIComponent(url)}`, options);
}

test("politica permite somente HTTPS e caminhos dos provedores conhecidos", () => {
  for (const url of [origin, "https://firebasestorage.googleapis.com/v0/b/test.appspot.com/o/editor-media%2Fcrest.png?alt=media&token=private", "https://lh3.googleusercontent.com/a/photo=s96-c"]) {
    assert.equal(allowedExternalImage(url), url);
  }
  for (const url of [null, "https://evil.example/crest.png", "http://res.cloudinary.com/test/image/upload/a.png", "https://127.0.0.1/a.png", "https://[::1]/a.png", "https://169.254.169.254/a.png", "https://res.cloudinary.com.evil.example/a.png", "https://res.cloudinary.com@evil.example/a.png", "https://secret@res.cloudinary.com/test/image/upload/a.png", "https://res.cloudinary.com:444/test/image/upload/a.png", "https://res.cloudinary.com/test/image/fetch/https://evil.example/a.png", "https://res.cloudinary.com./test/image/upload/a.png", "data:image/png;base64,abc", "blob:https://res.cloudinary.com/a", `${origin}#fragment`, `${origin}\n`, origin.replace("png", "%73vg"), origin.replace("png", "svgz"), "https://firebasestorage.googleapis.com/v0/b/test/o/a.png?alt=json", "https://lh3.googleusercontent.com/" + "x".repeat(2100)]) {
    assert.equal(allowedExternalImage(url), null, String(url));
  }
});

test("decodifica PNG/JPEG/WebP reais e remove metadados e conteudo adicional", async () => {
  for (const [mime, bytes] of [["image/png", png], ["image/jpeg", jpeg], ["image/webp", webp]]) {
    const result = await prepareCatalogMedia(mime, bytes);
    assert.equal(result.mimeType, mime);
    assert.equal((await sharp(result.bytes).metadata()).width, 2);
  }
  const source = await sharp(jpeg).withMetadata({ exif: { IFD0: { Artist: "PRIVATE METADATA" } } }).jpeg().toBuffer();
  const clean = await prepareCatalogMedia("image/jpeg", source);
  assert.equal((await sharp(clean.bytes).metadata()).exif, undefined);
  const appended = await prepareCatalogMedia("image/png", Buffer.concat([png, Buffer.from("<script>PRIVATE PAYLOAD</script>")]));
  assert.ok(!appended.bytes.includes(Buffer.from("PRIVATE PAYLOAD")));
});

test("rejeita SVG, tipo falso, assinatura sem arquivo, truncamento e excesso de bytes/pixels", async () => {
  for (const [mime, bytes] of [["image/svg+xml", Buffer.from("<svg/>")], ["image/png", jpeg], ["image/png", png.subarray(0, 8)], ["image/jpeg", jpeg.subarray(0, 10)], ["image/png", Buffer.concat([png.subarray(0, 8), Buffer.from("<svg/>")])], ["image/webp", Buffer.from("RIFF0000WEBP")], ["image/png", Buffer.alloc(MAX_IMAGE_BYTES + 1)]]) {
    await assert.rejects(prepareCatalogMedia(mime, bytes));
  }
  for (const [width, height] of [[4097, 2], [4096, 4096]]) {
    const oversized = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
    await assert.rejects(prepareCatalogMedia("image/png", oversized), (error) => ["IMAGE_DIMENSIONS_EXCEEDED", "IMAGE_INVALID"].includes(error.code));
  }
});

test("upload invalido nao grava nem remove objeto anterior no provedor", async () => {
  let writes = 0;
  const service = createCatalogMediaService({ bucket: { name: "test.appspot.com", file() { writes += 1; throw new Error("must not save"); } } });
  await assert.rejects(service.upload({ entity: "clubs", recordId: "one", mimeType: "image/png", bytes: png.subarray(0, 8) }));
  assert.equal(writes, 0);
});

test("proxy bloqueia origem antes da rede e retorna somente raster sanitizado sem credenciais", async (context) => {
  const calls = [];
  const get = await proxy(context, { fetchImpl: async (url, options) => {
    calls.push([url, options]);
    assert.equal(options.redirect, "error");
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.headers.Cookie, undefined);
    return responseImage();
  } });
  assert.equal((await get("https://127.0.0.1/private")).status, 400);
  assert.equal(calls.length, 0);
  const response = await get(origin, { headers: { authorization: "Bearer PRIVATE", cookie: "PRIVATE=secret" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await sharp(Buffer.from(await response.arrayBuffer())).metadata()).format, "png");
  assert.equal(calls.length, 1);
});

test("proxy recusa redirecionamento, MIME perigoso, arquivo falso e tamanho sem Content-Length", async (context) => {
  const cases = [
    [() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/private" } }), 502],
    [() => responseImage(Buffer.from("<svg/>"), { "content-type": "image/svg+xml" }), 415],
    [() => responseImage(png.subarray(0, 8)), 400],
    [() => responseImage(png, { "content-length": String(MAX_IMAGE_BYTES + 1) }), 413],
    [() => responseImage(Buffer.alloc(MAX_IMAGE_BYTES + 1)), 413],
  ];
  let index = 0;
  const get = await proxy(context, { fetchImpl: async () => cases[index][0]() });
  for (; index < cases.length; index += 1) {
    const response = await get();
    assert.equal(response.status, cases[index][1]);
    assert.ok(!(await response.text()).includes("169.254"));
  }
});

test("proxy aborta espera e corpo lento; nao armazena falha em cache", async (context) => {
  let calls = 0;
  const get = await proxy(context, { timeoutMs: 25, fetchImpl: async (_url, { signal }) => {
    calls += 1;
    if (calls === 1) return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("PRIVATE")), { once: true }));
    if (calls === 2) return new Response(new ReadableStream({ start(controller) {
      signal.addEventListener("abort", () => controller.error(new Error("PRIVATE")), { once: true });
    } }), { headers: { "content-type": "image/png" } });
    return responseImage();
  } });
  assert.equal((await get()).status, 504);
  assert.equal((await get()).status, 504);
  assert.equal((await get()).status, 200);
  assert.equal(calls, 3);
});

test("proxy limita concorrencia e libera vagas depois de falhas", async (context) => {
  const waiting = [];
  let allStarted;
  const started = new Promise((resolve) => { allStarted = resolve; });
  const get = await proxy(context, { fetchImpl: async () => {
    if (waiting.length >= 4) return responseImage();
    return new Promise((resolve) => {
      waiting.push(resolve);
      if (waiting.length === 4) allStarted();
    });
  } });
  const pending = Array.from({ length: 4 }, (_, i) => get(`${origin}?parallel=${i}`));
  await started;
  const busy = await get();
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("retry-after"), "2");
  waiting.forEach((resolve) => resolve(responseImage(png.subarray(0, 8))));
  assert.deepEqual((await Promise.all(pending)).map((response) => response.status), [400, 400, 400, 400]);
  assert.equal((await get()).status, 200);
});

test("cache do proxy expira e limita entradas; miniaturas nao excedem 512 pixels", async (context) => {
  let time = 0;
  let calls = 0;
  const big = await sharp({ create: { width: 1000, height: 500, channels: 3, background: "red" } }).png().toBuffer();
  const get = await proxy(context, { now: () => time, fetchImpl: async () => { calls += 1; return responseImage(big); } });
  const first = await get();
  assert.equal((await sharp(Buffer.from(await first.arrayBuffer())).metadata()).width, 512);
  await (await get()).arrayBuffer();
  assert.equal(calls, 1);
  time = 300_001;
  await (await get()).arrayBuffer();
  assert.equal(calls, 2);
  for (let i = 0; i < 128; i += 1) await (await get(`${origin}?v=${i}`)).arrayBuffer();
  await (await get()).arrayBuffer();
  assert.equal(calls, 131);
});

test("CSP consistente em desenvolvimento, build e Vercel bloqueia carregamento externo direto", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  const vite = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");
  const vercel = JSON.parse(await readFile(new URL("../../vercel.json", import.meta.url), "utf8"));
  assert.ok(html.includes(`content="${IMAGE_CSP}"`));
  assert.equal(vercel.headers[0].headers.find((header) => header.key === "Content-Security-Policy").value, HTTP_CSP);
  assert.equal((vite.match(/'Content-Security-Policy': HTTP_CSP/g) ?? []).length, 2);
  assert.equal(HTTP_CSP, `${IMAGE_CSP}; frame-ancestors 'none'`);
  assert.equal(vercel.headers[0].headers.find((header) => header.key === "X-Frame-Options").value, "DENY");
  assert.equal(IMAGE_CSP.includes("https:"), false);
  assert.equal(IMAGE_CSP.includes("data:"), false);
});
