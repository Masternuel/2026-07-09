import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeSectionValueAsync,
  encodeSectionValue,
  encodeSectionValueAsync,
  splitRoomDomains,
} from "../store/roomPersistenceSections.mjs";

test("async section compression yields to event loop and preserves value", async () => {
  const value = Array.from({ length: 12_000 }, (_, index) => ({
    id: `player-${index}`,
    name: `Jogador ${index}`,
    notes: `perfil-${index}-${"x".repeat(180)}`,
  }));
  let timerRan = false;
  setTimeout(() => {
    timerRan = true;
  }, 0);

  const encoded = await encodeSectionValueAsync("playerCatalog", "catalog", value);

  assert.equal(timerRan, true);
  assert.equal(encoded.manifest.format, "json-array-pages-v2");
  assert.deepEqual(encoded, encodeSectionValue("playerCatalog", "catalog", value));
  assert.deepEqual(await decodeSectionValueAsync(encoded.manifest, encoded.pages), value);
});

test("splitRoomDomains keeps cloning by default and can retain stable commit references", () => {
  const room = {
    code: "ASYNC-ROOM",
    careerState: { players: [{ id: "p-1" }] },
  };

  const cloned = splitRoomDomains(room);
  const referenced = splitRoomDomains(room, { cloneValues: false });

  assert.notEqual(cloned.sections[0].value, room.careerState.players);
  assert.equal(referenced.sections[0].value, room.careerState.players);
});
