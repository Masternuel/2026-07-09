import assert from "node:assert/strict";
import test from "node:test";
import {
  FirestoreMatchSessionPersistence,
  MemoryMatchSessionPersistence,
} from "../store/matchSessionPersistence.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";

for (const [name, createPersistence] of [
  ["memoria", () => new MemoryMatchSessionPersistence()],
  ["Firestore", () => new FirestoreMatchSessionPersistence(createFakeFirestore())],
]) {
  test(`${name}: fencing impede replica antiga de sobrescrever ou remover sessao`, async () => {
    const persistence = createPersistence();
    const first = { token: "replica-a", fence: 1 };
    const second = { token: "replica-b", fence: 2 };

    await persistence.save({ code: "BOLA", matchId: "m1", nextEventIndex: 1 }, first);
    await persistence.save({ code: "BOLA", matchId: "m1", nextEventIndex: 2 }, second);

    await assert.rejects(
      persistence.save({ code: "BOLA", matchId: "m1", nextEventIndex: 3 }, first),
      { code: "MATCH_OWNERSHIP_LOST" },
    );
    await assert.rejects(
      persistence.remove("BOLA", "m1", first),
      { code: "MATCH_OWNERSHIP_LOST" },
    );
    assert.equal((await persistence.get("BOLA")).nextEventIndex, 2);
    assert.equal(await persistence.remove("BOLA", "m1", second), true);
    assert.equal(await persistence.get("BOLA"), null);
    await assert.rejects(
      persistence.save({ code: "BOLA", matchId: "m1", nextEventIndex: 3 }, first),
      { code: "MATCH_OWNERSHIP_LOST" },
    );
    const third = { token: "replica-c", fence: 3 };
    await persistence.save({ code: "BOLA", matchId: "m2", nextEventIndex: 0 }, third);
    assert.equal((await persistence.get("BOLA")).matchId, "m2");
  });
}
