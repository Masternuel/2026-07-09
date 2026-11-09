import assert from "node:assert/strict";
import test from "node:test";
import { createMediaService } from "../services/mediaService.mjs";
import { mediaHash } from "../services/mediaOwnership.mjs";
import { createFakeFirestore } from "./helpers/fakeFirestore.mjs";
import { png } from "./helpers/imageFixtures.mjs";
import { fakeFirebase, jsonRequest, startTestServer } from "./testHarness.mjs";

function storage(provider) {
  const objects = new Map();
  const deleted = [];
  let generation = 0;
  const bucket = {
    name: "ownership-test.appspot.com",
    file(path) {
      return {
        async save(_bytes, options) { objects.set(path, { ...options.metadata, generation: String(++generation) }); },
        async getMetadata() {
          if (!objects.has(path)) throw Object.assign(new Error("not found"), { code: 404 });
          return [structuredClone(objects.get(path))];
        },
        async delete(options) {
          assert.equal(options.ifGenerationMatch, objects.get(path)?.generation);
          deleted.push(path);
          objects.delete(path);
        },
      };
    },
  };
  const service = createMediaService({
    bucket,
    env: { MEDIA_STORAGE_PROVIDER: provider, CLOUDINARY_URL: "cloudinary://test-key:test-secret@test-cloud" },
    fetchImpl: async (url, { body }) => {
      const path = body.get("public_id");
      if (url.endsWith("/upload")) {
        objects.set(path, {});
        return Response.json({ public_id: path, secure_url: `https://res.cloudinary.com/test-cloud/image/upload/${path}.png` });
      }
      deleted.push(path);
      objects.delete(path);
      return Response.json({ result: "ok" });
    },
  });
  return { service, bucket, objects, deleted };
}

for (const provider of ["firebase", "cloudinary"]) {
  test(`${provider}: Editor impede exclusao cruzada, inclusive dados legados e bulk-delete`, async (context) => {
    const media = storage(provider);
    const firestore = createFakeFirestore();
    const { server, url } = await startTestServer({ firebase: fakeFirebase({ firestore }), mediaService: media.service });
    context.after(() => server.close());
    const request = async (token, path, method, body) => {
      const response = await jsonRequest(`${url}/api/editor/${path}`, token, { method, body });
      return { status: response.status, ...await response.json() };
    };
    const upload = async (token, id) => {
      const response = await fetch(`${url}/api/editor/media?entity=clubs&id=${id}`, {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "image/png" }, body: png,
      });
      assert.equal(response.status, 201);
      return response.json();
    };
    for (const token of ["owner-token", "second-token"]) {
      assert.equal((await request(token, "clubs", "POST", { id: "SAME", name: "Clube" })).status, 201);
    }
    const victim = await upload("second-token", "SAME");
    const victimPath = victim.media.path;
    const patched = await request("owner-token", "clubs/SAME", "PATCH", { name: "Editado", crestImagePath: victimPath });
    assert.equal(patched.status, 200);
    assert.equal(patched.record.crestImagePath, null);
    const created = await request("owner-token", "clubs", "POST", { id: "COPIED", name: "Copia", crestImagePath: victimPath });
    assert.equal(created.record.crestImagePath, null);
    assert.equal((await request("owner-token", "clubs/COPIED", "DELETE")).mediaRemoved, true);
    assert.equal((await request("owner-token", "clubs/SAME", "PATCH", { crestImagePath: victimPath })).status, 400);
    assert.equal((await request("owner-token", "clubs/SAME", "PATCH", { public_id: victimPath })).status, 400);

    const own = await upload("owner-token", "SAME");
    const replaced = await upload("owner-token", "SAME");
    assert.equal(replaced.previousMediaRemoved, true);
    assert.equal(media.objects.has(own.media.path), false);
    assert.equal(media.objects.has(victimPath), true);
    await assert.rejects(media.service.remove(victimPath, { ownerId: "uid-owner", entity: "clubs", recordId: "SAME" }), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
    await assert.rejects(media.service.remove(replaced.media.path, { ownerId: "uid-owner", entity: "clubs", recordId: "OTHER" }), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
    await assert.rejects(media.service.remove(victimPath), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });

    // Simula vinculos maliciosos gravados antes da correcao, sem passar pelo novo filtro HTTP.
    const ownerClubs = firestore.collection("catalogDatabases/uid-owner/brasfootClubs");
    await ownerClubs.doc("SAME").update({ crestImagePath: victimPath });
    const safeReplacement = await upload("owner-token", "SAME");
    assert.equal(safeReplacement.previousMediaRemoved, false);
    assert.equal(media.objects.has(victimPath), true);
    const legitimateRemove = await request("owner-token", "media?entity=clubs&id=SAME", "DELETE");
    assert.equal(legitimateRemove.mediaRemoved, true);
    assert.equal(media.objects.has(safeReplacement.media.path), false);
    for (const action of ["clear", "delete", "bulk"]) {
      const id = action.toUpperCase();
      await request("owner-token", "clubs", "POST", { id, name: id });
      await ownerClubs.doc(id).update({ crestImagePath: victimPath });
      let bulkOwn;
      if (action === "bulk") bulkOwn = await upload("owner-token", "SAME");
      const result = action === "clear"
        ? await request("owner-token", `media?entity=clubs&id=${id}`, "DELETE")
        : action === "delete" ? await request("owner-token", `clubs/${id}`, "DELETE")
          : await request("owner-token", "clubs/bulk-delete", "POST", { ids: [id, "SAME"] });
      assert.equal(result.status, 200);
      assert.equal(result.mediaRemoved, false);
      if (bulkOwn) {
        assert.equal(result.removedMediaCount, 1);
        assert.equal(result.failedMediaCount, 1);
        assert.equal(media.objects.has(bulkOwn.media.path), false);
      }
      assert.equal(media.objects.has(victimPath), true);
      assert.equal(media.deleted.includes(victimPath), false);
    }
    assert.equal((await request("second-token", "clubs/SAME", "DELETE")).mediaRemoved, true);
    assert.equal(media.objects.has(victimPath), false);
  });
}

test("Firebase legado exige uploader, entidade, registro e geracao; prefixo sozinho nao autoriza", async () => {
  const media = storage("firebase");
  const path = `editor-media/clubs/${mediaHash("SAME")}/legacy.png`;
  const scope = { ownerId: "uid-owner", entity: "clubs", recordId: "SAME" };
  media.objects.set(path, { generation: "7", metadata: { uploadedBy: "uid-second", mediaEntity: "clubs", mediaKind: "crest" } });
  await assert.rejects(media.service.remove(path, scope), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
  media.objects.get(path).metadata.uploadedBy = "uid-owner";
  media.objects.get(path).metadata.mediaEntity = "players";
  await assert.rejects(media.service.remove(path, scope), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
  media.objects.get(path).metadata.mediaEntity = "clubs";
  await media.service.remove(path, scope);
  assert.deepEqual(media.deleted, [path]);
});

test("Cloudinary exige assinatura vinculada ao dono/registro, preservando legados nao comprovados", async () => {
  const media = storage("cloudinary");
  const victim = await media.service.upload({ entity: "clubs", recordId: "SAME", kind: "crest", uploadedBy: "uid-second", mimeType: "image/png", bytes: png });
  const scope = { ownerId: "uid-owner", entity: "clubs", recordId: "SAME" };
  const forged = victim.path.replace(mediaHash("uid-second"), mediaHash("uid-owner"));
  await assert.rejects(media.service.remove(forged, scope), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
  await assert.rejects(media.service.remove(`editor-media/clubs/cloudinary/${mediaHash("SAME")}/legacy`, scope), { code: "EDITOR_MEDIA_OWNERSHIP_INVALID" });
  assert.deepEqual(media.deleted, []);
});

test("campos de caminhos de clubes, jogadores e trofeus nao sao gravaveis via CRUD", async (context) => {
  const { server, url } = await startTestServer({ firebase: fakeFirebase({ firestore: createFakeFirestore() }) });
  context.after(() => server.close());
  const fixtures = [
    ["clubs", "crestImagePath", { id: "C", name: "Clube" }],
    ["players", "avatarImagePath", { id: "P", clubId: "C", name: "Jogador", age: 20, position: "ATA", attributes: { velocidade: 10, chute: 10, drible: 10, nocao: 10, defesa: 10, passe: 10, peBom: 10, peRuim: 10 } }],
    ["tournaments", "trophyImagePath", { id: "T", name: "Torneio", active: false }],
  ];
  for (const [entity, field, body] of fixtures) {
    const path = `editor-media/${entity}/untrusted/image.png`;
    const created = await jsonRequest(`${url}/api/editor/${entity}`, "owner-token", { method: "POST", body: { ...body, [field]: path } });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).record[field], null);
    const patched = await jsonRequest(`${url}/api/editor/${entity}/${body.id}`, "owner-token", { method: "PATCH", body: { name: "Alterado", [field]: path } });
    assert.equal(patched.status, 200);
    assert.equal((await patched.json()).record[field], null);
  }
});
