import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import electron from "electron";
import { _electron } from "@playwright/test";

const root = resolve(".tmp/peer-electron-tests");
const packagedExecutable = process.env.BOLA_DESKTOP_TEST_EXECUTABLE;
const env = Object.fromEntries(["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
async function waitFor(predicate, budget = 15000) {
  const deadline = Date.now() + budget;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, "Real WebRTC condition exceeded its deadline");
    await new Promise((done) => setTimeout(done, 25));
  }
}
async function launch(directory) {
  const application = await _electron.launch({
    executablePath: packagedExecutable ? resolve(packagedExecutable) : electron,
    args: [...(packagedExecutable ? [] : ["desktop/main.mjs"]), `--desktop-data-dir=${directory}`],
    env, timeout: 20000,
  });
  let page;
  try {
    await waitFor(() => {
      page = application.windows().find((candidate) => candidate.url().startsWith("http://127.0.0.1:"));
      return Boolean(page);
    });
    await page.waitForFunction(() => Boolean(window.bolaDesktop));
    return { application, page };
  } catch (error) { await application.close(); throw error; }
}
async function api(page, path, method = "GET", body) {
  return page.evaluate(async ({ path, method, body }) => {
    const session = await window.bolaDesktop.session();
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${session.token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  }, { path, method, body });
}

test("Electron: two sandboxed launchers exchange a real WebRTC channel, persist only on host and disconnect fail-closed", { timeout: 90000 }, async (context) => {
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "run-"));
  const hostDirectory = join(directory, "host");
  const guestDirectory = join(directory, "guest");
  let host;
  let guest;
  let roomCode;
  let phase = "launch host";
  context.signal.addEventListener("abort", () => {
    if (phase !== "completed") console.error(`P2P regression aborted during: ${phase}`);
  }, { once: true });
  try {
    host = await launch(hostDirectory);
    phase = "launch guest";
    guest = await launch(guestDirectory);
    phase = "create room";
    const created = await api(host.page, "/api/rooms", "POST", { name: "Real WebRTC regression", clubId: "AUR", activeLeagues: ["BR-A"], seasonLength: 1, maxManagers: 4 });
    assert.equal(created.status, 201);
    roomCode = created.data.room.code;
    phase = "WebRTC pairing";
    const offer = await host.page.evaluate((code) => window.bolaDesktop.peerCreateOffer(code), roomCode);
    const answer = await guest.page.evaluate((value) => window.bolaDesktop.peerCreateAnswer(value), offer);
    await host.page.evaluate((value) => window.bolaDesktop.peerAcceptAnswer(value), answer);
    await waitFor(async () => (await guest.page.evaluate(() => window.bolaDesktop.peerStatus())).connected);
    const hostStatus = await host.page.evaluate(() => window.bolaDesktop.peerStatus());
    assert.equal(hostStatus.mode, "host");
    assert.equal(hostStatus.peers, 1);
    assert.equal(hostStatus.transport, "direct-webrtc");
    phase = "enter guest session";
    await guest.page.evaluate(() => { void window.bolaDesktop.peerEnterGuest(); });
    await waitFor(async () => {
      try { return (await guest.page.evaluate(() => window.bolaDesktop.session())).identity.mode === "peer"; }
      catch { return false; }
    });
    const list = await api(guest.page, "/api/rooms");
    assert.equal(list.status, 200);
    assert.deepEqual(list.data.rooms.map((value) => value.code), [roomCode]);
    const roster = await api(guest.page, `/api/teams/SAN/players?roomCode=${roomCode}`);
    assert.equal(roster.status, 200);
    assert.equal(roster.data.players.length, 20);
    const joined = await api(guest.page, `/api/rooms/${roomCode}/join`, "POST", { clubId: "SAN" });
    assert.equal(joined.status, 200);
    const spoofed = await api(guest.page, `/api/rooms/${roomCode}/ready`, "PATCH", { ready: true, clubId: "AUR", managerId: created.data.room.ownerId });
    assert.notEqual(spoofed.status, 200, "Guest cannot claim the host's club/identity");
    assert.equal((await api(guest.page, `/api/rooms/${roomCode}/ready`, "PATCH", { ready: true, clubId: "SAN" })).status, 200);
    assert.equal((await api(host.page, `/api/rooms/${roomCode}/ready`, "PATCH", { ready: true, clubId: "AUR" })).status, 200);
    assert.equal((await api(host.page, `/api/rooms/${roomCode}/start`, "POST", {})).status, 200);
    // The actual application Socket.IO client now joins the active room through RTC.
    phase = "reload host UI";
    await host.page.reload();
    phase = "reload guest UI";
    await guest.page.reload();
    phase = "verify active room after reload";
    await waitFor(async () => {
      const room = await api(guest.page, `/api/rooms/${roomCode}`);
      return room.status === 200 && room.data.room.status === "active";
    });
    assert.equal((await guest.page.evaluate(() => window.bolaDesktop.peerStatus())).connected, true, "Reloading the UI cannot own/drop the transport");
    phase = "host shutdown";
    await host.application.close(); host = null;
    phase = "verify disconnection";
    await waitFor(async () => !(await guest.page.evaluate(() => window.bolaDesktop.peerStatus())).connected);
    assert.equal((await guest.page.evaluate(() => window.bolaDesktop.session())).identity.mode, "peer");
    assert.equal((await api(guest.page, "/api/rooms")).status, 401);
    phase = "guest shutdown";
    await guest.application.close(); guest = null;
    // Read with the same bundled V8 runtime that wrote this binary save.
    phase = "restart guest";
    guest = await launch(guestDirectory);
    const ownGuestRooms = await api(guest.page, "/api/rooms");
    assert.equal(ownGuestRooms.status, 200);
    assert.equal(ownGuestRooms.data.rooms.length, 0);
    phase = "restart host";
    host = await launch(hostDirectory);
    const restored = await api(host.page, `/api/rooms/${roomCode}`);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.room.status, "active");
    assert.equal(restored.data.room.managers.length, 2);
  } finally {
    phase = "cleanup";
    await guest?.application.close(); await host?.application.close();
    assert.ok(relative(root, directory) && !relative(root, directory).startsWith(".."));
    await rm(directory, { recursive: true, force: true });
    phase = "completed";
  }
});
