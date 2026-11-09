import { createHostGateway } from "./hostGateway.mjs";
import { createGuestRelay } from "./guestRelay.mjs";
import { invitationProof, peerError, peerUid, validateInvitation } from "./identity.mjs";
import { PeerRpc } from "./rpc.mjs";

export function createPeerRuntime(backend, { send, closeTransport, staticDirectory }) {
  const host = createHostGateway(backend, { send, closeTransport });
  let guest = null;
  let closed = false;
  let pairing = false;
  let generation = 0;
  return {
    createInvite: (roomCode) => {
      if (closed || guest) throw peerError("PEER_MODE_CONFLICT");
      return host.createInvite(roomCode);
    },
    async beginGuest(invitation) {
      if (closed || pairing || guest || host.status().mode !== "offline") throw peerError("PEER_MODE_CONFLICT");
      validateInvitation(invitation);
      pairing = true;
      const currentGeneration = generation;
      try {
      if (await backend.database.read((state) => state.matches.some((match) => match._matchRemoved !== true))) throw peerError("PEER_LOCAL_MATCH_IN_PROGRESS");
      const proof = await invitationProof(backend.database, invitation);
      if (closed || currentGeneration !== generation) throw peerError("PEER_DISCONNECTED");
      // Pairing has no access to the local profile key or save path in the renderer.
      guest = { id: invitation.id, invitation, proof, rpc: new PeerRpc((frame) => send(invitation.id, frame)), session: null, relay: null, activated: false };
      return proof;
      } finally { if (currentGeneration === generation) pairing = false; }
    },
    async receive(id, frame) {
      if (closed) return;
      if (guest?.id !== id) { await host.receive(id, frame); return; }
      if (frame?.type === "helloResult") {
        const current = guest;
        if (current.session || frame.session?.identity?.uid !== peerUid(current.proof.publicKey)
          || frame.session?.roomCode !== current.invitation.roomCode || frame.session?.identity?.mode !== "peer"
          || !/^[A-Za-z0-9_-]{43}$/.test(frame.session?.token)) throw peerError("PEER_SESSION_INVALID");
        current.session = frame.session;
        const relay = await createGuestRelay({ rpc: current.rpc, session: current.session, staticDirectory });
        if (guest !== current || current.rpc.closed) { await relay.close(); return; }
        current.relay = relay;
      } else if (frame?.type === "helloError") guest.rpc.close();
      else guest.rpc.receive(frame);
    },
    drop(id) { if (guest?.id === id) guest.rpc.close(); else host.disconnect(id); },
    status() {
      return guest ? { mode: "guest", connected: Boolean(guest.session && guest.relay && !guest.rpc.closed), roomCode: guest.invitation.roomCode,
        peers: guest.session && !guest.rpc.closed ? 1 : 0, pendingInvites: guest.session ? 0 : 1, transport: "direct-webrtc" } : host.status();
    },
    activateGuest() {
      if (!guest?.session || !guest.relay || guest.rpc.closed) throw peerError("PEER_NOT_CONNECTED");
      guest.activated = true;
      return { origin: guest.relay.origin };
    },
    session: () => guest?.activated ? Promise.resolve({ identity: guest.session.identity, token: guest.session.token }) : backend.session(),
    async disconnect() {
      host.close();
      generation += 1;
      pairing = false;
      const current = guest;
      guest = null;
      if (current) {
        current.rpc.close();
        await current.relay?.close();
        closeTransport(current.id);
      }
      return { origin: backend.origin };
    },
    async close() { closed = true; await this.disconnect(); },
  };
}
