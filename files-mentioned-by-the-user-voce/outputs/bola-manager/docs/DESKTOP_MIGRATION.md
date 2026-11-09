# Desktop migration — first increment

Branch: `codex/desktop-offline`. Web/staging deployment remains unchanged.

## Run locally

Use Node.js 22.12+ and Windows for the currently tested desktop target:

```sh
npm install
npm run desktop
```

`build:desktop` never loads `.env`, `.env.local` or staging configuration, and replaces cloud endpoints in the renderer build with empty values. The app runs its existing Node game engine in an Electron utility process. HTTP and Socket.IO bind only to `127.0.0.1` on an ephemeral port. A per-launch capability authenticates the stable local profile; demo authentication stays disabled.

The sandboxed renderer has no Node access. Its preload exposes session, profile, preferences and narrowly scoped P2P pairing operations. IPC checks the sender/main frame and exact local origin. External navigation, popup windows, permissions and HTTP destinations are blocked. The separate hidden network renderer uses native WebRTC, without Node access or external signaling/STUN/TURN. Firebase, Redis and Cloudinary are not initialized/configured for this mode. Gemini social replies are opt-in with an OS-encrypted personal key; see [DESKTOP_GEMINI.md](DESKTOP_GEMINI.md).

## Local saves

The directory is Electron's `userData/saves`; the single `career.bolasave` includes the profile, immutable starter catalog, rooms/career state, active matches, match archive and news. Existing engine stores still enforce authorization, idempotency, ownership, sequence and tombstone rules. Reads and writes are serialized per database; writes operate on a private copy and publish only after file fsync and atomic rename. A failed write does not publish new memory state. A checksum/schema failure stops startup without overwriting the file. One process owns the save lock. An abandoned lock is removed only when its recorded process is demonstrably absent.

The current format is a versioned Node V8 binary envelope with SHA-256 integrity verification. It is not encryption or anti-cheat, and its format must be migration-tested before changing the embedded Node/V8 version. File fsync/rename protects against partial writes; platform-specific power-loss durability and automatic backups remain future work. The first increment caps a database at 128 MiB and rewrites it per successful mutation; paging/SQLite is a separate optimization, not claimed here.

This does not import or overwrite cloud saves. The starter catalog reuses the existing built-in seed, giving each initial club a complete fictional squad; it is explicitly labeled in the UI. The cloud Editor/import and remote media are unavailable in the initial offline app. Optional Gemini social generation is configured separately; the local fallback text generation remains available without a key or internet.

## Verification

```sh
npm run test:desktop
npm run test:server
npm run test:frontend
npm run build:desktop
```

Desktop regressions cover disk failure, corruption, concurrent writes, save locking, history, deletion tombstones, active-match fencing/sequence, local news/profile/preferences, authenticated HTTP/Socket.IO, origin/host rejection and reload with a rotated session capability. No real cloud integration is used.

### Local validation — 2026-10-07

- Desktop: 11 passed; frontend: 200 passed; Chrome E2E: 4 passed.
- Latest full server run: 1486 passed, 0 failed/cancelled, 1 skipped (real Redis requires `TEST_REDIS_URL`). An earlier run failed the existing `halftimeMatch` reconnection test by timeout; the focused group passed 60/60 and the full rerun passed without changing tests or timeouts. This intermittent occurrence is not declared fixed.
- Typecheck, desktop build and `git diff --check` passed. The existing large-JS-chunk warning remains.
- Real Electron smoke: career creation, roster/profile, tactical change, clean shutdown/relaunch and tactical reload passed. A locally simulated match reached halftime and restored its score/events/paused session after a further restart. The renderer has no `window.require`; QA save directories/processes were removed after clean shutdown.
- Current npm audit reports 6 affected package nodes (1 moderate, 2 high, 3 critical): `@fastify/busboy`, `proxy-addr`, `sharp`, `shell-quote`, `concurrently`, `source-map-js`. Their installed versions are unchanged from the branch baseline. Electron adds 10 package entries and changes no existing resolved package version. These advisories remain a release blocker; this migration does not claim audit=0.
- No commit, push, deploy, staging changes, cloud credentials or cloud-service access were used. The local operational security report and existing external untracked file were left untouched.

## Direct P2P increment

The launcher now offers shared local careers with 4, 6 or 8 managers and manual WebRTC invitation/answer pairing. The host retains authority and the save. Guests access the existing HTTP and Socket.IO game handlers through a room-bound P2P gateway; they do not run a replacement remote career on their own local engine. The transport survives UI navigation/reload. Stable device keys support reconnecting an existing manager with a new invite, including after the season starts.

See [DESKTOP_P2P.md](DESKTOP_P2P.md) for usage, security boundaries and limitations. Direct connectivity requires reachable LAN/VPN networks; internet NAT traversal, Steam relay and host migration are not delivered by this increment.

## Not delivered yet

- Portable packaging, code signing and updates. A Windows x64 test installer is now available; see [DESKTOP_INSTALLER.md](DESKTOP_INSTALLER.md).
- Automatic discovery/signaling, internet NAT traversal/relay and host migration.
- Steamworks login/lobbies/networking/Cloud integration.
- Import of existing cloud careers; catalog import is now separate, documented below.
- macOS/Linux validation, guided backup recovery and format upgrade compatibility.
- Public competitive authority/anti-cheat; a local host is not a trusted public server.

Steamworks integration is a later increment. This desktop shell is not itself a completed Steam release. Existing staging infrastructure is neither shut down nor changed by this work.

## One-time Editor catalog import

The launcher now accepts validated Editor JSON exports, with a native file chooser, expiring preview, explicit confirmation and full pre-import local backup. Existing careers pin the previous catalog; new careers use the imported catalog. Import closes/reopens the local engine and is blocked during P2P sessions or active matches.

For the original localhost workflow, an external browser opens `/desktop-export`, reusing the web version's Google/Firebase authentication and existing authorized export API. No OAuth token or Firebase configuration enters the launcher. The source web server must be running with the original project configuration. This is a manual one-time file transfer, not automatic account synchronization, career migration or media download. See [DESKTOP_CATALOG_IMPORT.md](DESKTOP_CATALOG_IMPORT.md).

## Local Editor

The existing Editor UI now supports local CRUD for leagues, clubs, players and tournaments, local images, JSON merge/export and the original Brasfoot parser. Atomic writes and full backups preserve existing careers on their immutable catalog versions. Editing is restricted to the local owner outside multiplayer/live matches. See [DESKTOP_EDITOR.md](DESKTOP_EDITOR.md).
