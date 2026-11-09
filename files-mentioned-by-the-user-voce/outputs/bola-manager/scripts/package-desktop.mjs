import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import sharp from "sharp";
import { build, Platform, Arch } from "electron-builder";
import config from "../desktop/installer.config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--dir")) throw new Error("Supported packaging option: --dir.");
const directoryOnly = args.includes("--dir");
const { version } = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid package version.");
const portableDirectory = join(root, "release-desktop", `Bola-Manager-${version}-portatil-x64`);
if (directoryOnly) {
  // Never overwrite an existing portable copy or any data a player added to it.
  try { await access(portableDirectory); throw new Error("Portable folder already exists; preserve or move it before rebuilding."); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
if (process.platform !== "win32" || process.arch !== "x64") throw new Error("Windows x64 is required for this installer build.");
// No signing credentials, dotenv configuration or automatic publication.
process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
process.env.ELECTRON_BUILDER_CACHE = join(root, ".tmp/electron-builder-cache");
await readFile(join(root, "dist-desktop/index.html"));
await mkdir(join(root, ".tmp/desktop-build"), { recursive: true });
const images = await Promise.all([16, 32, 48, 64, 128, 256].map(async (size) => ({
  size, bytes: await sharp(join(root, "public/assets/brand/bola-manager-logo.png")).resize(size, size).png().toBuffer(),
})));
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach(({ size, bytes }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = header[entry];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(bytes.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += bytes.length;
});
await writeFile(join(root, ".tmp/desktop-build/icon.ico"), Buffer.concat([header, ...images.map(({ bytes }) => bytes)]));

const { listPackage } = createRequire(import.meta.resolve("app-builder-lib"))("@electron/asar");
const artifacts = await build({
  projectDir: root,
  targets: Platform.WINDOWS.createTarget([directoryOnly ? "dir" : "nsis"], Arch.x64),
  publish: "never",
  config: {
    ...config,
    electronDist: join(root, "node_modules/electron/dist"),
    async afterPack({ appOutDir }) {
      const entries = listPackage(join(appOutDir, "resources/app.asar")).map((path) => path.replaceAll("\\", "/"));
      const forbidden = entries.filter((path) => /(?:^|\/)\.env[^/]*$|(?:^|\/)(?:\.tmp|\.git|saves)(?:\/|$)|\.bolasave$|\.log$|\.(?:pem|p12)$|(?:service-account|firebase-adminsdk)[^/]*\.json$/i.test(path)
        || /^\/(?:desktop|server)\/tests(?:\/|$)/.test(path));
      if (forbidden.length) throw new Error(`Unsafe package entries: ${forbidden.length}. Installer creation stopped.`);
      for (const required of ["/desktop/main.mjs", "/desktop/server-worker.mjs", "/desktop/peer/transport.mjs", "/desktop/catalogImport.mjs", "/desktop/localEditorCatalog.mjs", "/desktop/localEditorMedia.mjs", "/desktop/localBrasfootImport.mjs", "/dist-desktop/index.html", "/dist-desktop/assets/brand/bola-manager-icon.png", "/dist-desktop/assets/brand/bola-manager-logo-512.png", "/dist-desktop/assets/brand/bola-manager-favicon.png", "/server/index.mjs", "/scripts/import-brasfoot.mjs", "/scripts/lib/builtin-catalog.mjs"]) {
        if (!entries.includes(required)) throw new Error(`Missing runtime file: ${required}`);
      }
      console.log(`Package verified: ${entries.length} entries; no local env, saves, credentials or test fixtures.`);
    },
  },
});
for (const artifact of artifacts) console.log(`Created: ${artifact}`);
if (directoryOnly) {
  await rename(join(root, "release-desktop/win-unpacked"), portableDirectory);
  console.log(`Created portable folder: ${portableDirectory}`);
}
