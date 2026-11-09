import { createHash, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, timingSafeEqual, verify } from "node:crypto";

export const peerError = (code, message = "A conexao P2P nao pode continuar.") => Object.assign(new Error(message), {
  code, status: code.endsWith("_FORBIDDEN") ? 403 : code === "PEER_BUSY" ? 429 : 503,
});
const PREFIX = "BOLA-P2P1.";
export function parseSignal(text, type) {
  if (typeof text !== "string" || text.length > 256_000 || !text.trim().startsWith(PREFIX)) throw peerError("PEER_SIGNAL_INVALID");
  let value;
  try { value = JSON.parse(Buffer.from(text.trim().slice(PREFIX.length), "base64url").toString("utf8")); } catch { throw peerError("PEER_SIGNAL_INVALID"); }
  if (value?.version !== 1 || value.type !== type || !/^[a-f0-9-]{36}$/.test(value.id)
    || !value.description || value.description.type !== type || typeof value.description.sdp !== "string" || value.description.sdp.length > 128_000) throw peerError("PEER_SIGNAL_INVALID");
  if (type === "offer") validateInvitation(value.invitation, value.id);
  return value;
}
export function encodeSignal(value) { return PREFIX + Buffer.from(JSON.stringify({ version: 1, ...value })).toString("base64url"); }
export function createInvitation(roomCode) {
  return { version: 1, id: randomUUID(), roomCode, secret: randomBytes(32).toString("base64url"), nonce: randomBytes(24).toString("base64url"), expiresAt: Date.now() + 300_000 };
}
export function validateInvitation(value, id = value?.id) {
  if (value?.version !== 1 || value.id !== id || !/^[a-f0-9-]{36}$/.test(String(id))
    || !/^BOLA-[A-Z0-9]{4,7}$/.test(value.roomCode) || !/^[A-Za-z0-9_-]{43}$/.test(value.secret)
    || !/^[A-Za-z0-9_-]{32}$/.test(value.nonce) || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= Date.now() || value.expiresAt > Date.now() + 310_000) throw peerError("PEER_INVITE_EXPIRED_OR_INVALID");
}
function proofBytes(invitation) {
  return Buffer.from(JSON.stringify(["BOLA-MANAGER-PEER-v1", invitation.id, invitation.roomCode, invitation.nonce, invitation.expiresAt]));
}
export function peerUid(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  return `peer-${createHash("sha256").update(key.export({ type: "spki", format: "der" })).digest("hex")}`;
}
export async function invitationProof(database, invitation) {
  validateInvitation(invitation);
  let profile = await database.read((state) => state.profile);
  if (!profile.peerKeys) {
    const pair = generateKeyPairSync("ed25519", { publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    await database.transaction((state) => { state.profile.peerKeys ??= pair; });
    profile = await database.read((state) => state.profile);
  }
  return { invitationId: invitation.id, secret: invitation.secret, publicKey: profile.peerKeys.publicKey,
    displayName: profile.displayName, signature: sign(null, proofBytes(invitation), profile.peerKeys.privateKey).toString("base64url") };
}
export function verifyInvitationProof(invitation, proof) {
  validateInvitation(invitation);
  const expected = Buffer.from(invitation.secret);
  const provided = Buffer.from(String(proof?.secret ?? ""));
  if (proof?.invitationId !== invitation.id || provided.length !== expected.length || !timingSafeEqual(expected, provided)
    || typeof proof.publicKey !== "string" || proof.publicKey.length > 512 || typeof proof.signature !== "string" || proof.signature.length !== 86
    || typeof proof.displayName !== "string" || proof.displayName.trim().length < 2 || proof.displayName.trim().length > 60) throw peerError("PEER_AUTH_REJECTED");
  let key;
  try { key = createPublicKey(proof.publicKey); } catch { throw peerError("PEER_AUTH_REJECTED"); }
  if (key.asymmetricKeyType !== "ed25519" || !verify(null, proofBytes(invitation), key, Buffer.from(proof.signature, "base64url"))) throw peerError("PEER_AUTH_REJECTED");
  return { uid: peerUid(key), name: proof.displayName.trim() };
}
