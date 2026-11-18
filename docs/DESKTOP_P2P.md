# Desktop direct P2P

## Use

Run the game (`Bola Manager Desktop.exe`, or `npm run desktop` from source) on each computer.

### Jogar pela internet (guia rápido)

1. O anfitrião cria uma carreira nova com 4, 6 ou 8 managers e clica em **Gerar convite** (leva de 1 a 3 segundos).
2. Ele copia o convite e manda **em particular** para o amigo (WhatsApp, Discord…). O convite vale por 5 minutos e serve para um amigo só.
3. O amigo cola o convite em **Receba o convite**, clica em **Gerar resposta** e manda a resposta de volta.
4. O anfitrião cola a resposta em **Aceite a resposta**. Quando conectar, o amigo clica em **Entrar na carreira** e escolhe o clube.

Funciona entre casas diferentes na maioria das redes domésticas: o jogo usa servidores STUN públicos e gratuitos (Google e Cloudflare) **só para descobrir o endereço de internet** de cada PC. Nenhum dado do jogo passa por eles, e não há servidor do jogo nem relay.

**Se não conectar** (internet de operadora com NAT restritivo/CGNAT, internet móvel, rede corporativa) ou se o painel avisar que o computador **não descobriu seu endereço de internet**: instalem nos dois PCs a mesma VPN de jogos gratuita — **Radmin VPN**, **ZeroTier** ou **Tailscale** —, entrem na mesma rede dela e repitam o pareamento com um convite novo. Para o jogo, isso equivale a jogar na mesma rede local.

Na mesma casa (mesma rede local), funciona sem VPN.

### Details

1. The host creates a **new** career with 4, 6 or 8 managers. Existing single-manager saves are not silently expanded.
2. In the lobby, or **Configurações → Multiplayer P2P** during an active career, the host generates an invitation and sends it privately.
3. The guest pastes the invitation, generates a reply and sends the reply privately to the host.
4. The host accepts the reply. Once connected, the guest selects **Entrar na carreira**, chooses an available club, and uses the usual ready/start workflow.

Generate one invitation per guest. Invitations expire after five minutes and can be consumed only once. Invite/reply text contains pairing credentials and network metadata: do not publish it or include it in bug reports.

The host must stay running. Disconnecting the host stops guest access instead of silently simulating a separate career. Explicitly leave P2P to return to your own offline profile. Reconnect using a new invitation on the same local profile/device: the device identity remains stable. New managers must join before the season starts; existing managers can reconnect later. There is no automatic host migration or host-side removal/replacement of an occupied manager slot in this increment.

## Architecture and boundaries

- `desktop/peer/transport.mjs` runs native, ordered/reliable WebRTC DataChannels in a hidden sandboxed Electron renderer. ICE uses public STUN servers (Google, Cloudflare) only to learn each PC's public address; there is no TURN relay. The invite/answer is ready as soon as a public (srflx) address is found (plus a 400 ms settle), or after an 8 s budget with local candidates if STUN is blocked. A brief ICE `disconnected` state gets an 8 s grace before the peer is closed. It owns the connection independently of React views. Manual SDP pairing pins DTLS fingerprints; data is encrypted by the browser's WebRTC implementation.
- The host's existing engine stays bound to `127.0.0.1` on an ephemeral port. No public HTTP listener, Redis proxy, firewall rule or port-forwarding is added.
- `hostGateway.mjs` proxies only an allowlist of operations for the invited room into the real HTTP/Socket.IO handlers. Existing authorization still decides club/ownership/game actions using the authenticated device-derived UID, not IDs supplied by the guest.
- `guestRelay.mjs` exposes a separate loopback-only frontend gateway protected by a per-connection capability and exact Host/Origin policy. Unauthorized/other-room/catalog-edit/save-creation/deletion operations are rejected. The renderer receives no Node, filesystem, shell or general network API.
- `identity.mjs` persists an Ed25519 key pair in the guest's local binary profile. Only the signed invitation proof and public key cross IPC/network; the private key is not exposed to the renderer. The host derives the manager UID from the public key and revokes the session capability on disconnect. Copying this profile copies its identity: this is local device identity, not Steam authentication.
- Frames and reassembly are size-bounded; send queues use backpressure. RPCs have concurrency/deadline limits, cancellation and fail-closed disconnection. Timed-out mutations are not automatically retried. A lost response can still be ambiguous if the host already committed the action; reload/sync before resubmitting, preserving the engine's existing idempotency rules.
- Saves, matches and simulation remain on the host's file-backed stores. Guests retain only their own local profile/preferences/key, not a duplicate shared career. Paid AI/media, cloud import/editor and cloud saves remain unavailable in desktop mode.

## Verification

`npm run test:desktop` builds the desktop renderer, then tests bounded framing, device proof/stability, room/API scope, RPC abort/deadline, real engine authorization, shared tactics/match events and host-loss/reconnect. It also launches two actual Electron applications and tests a real WebRTC channel, shared save/roster flow, UI reload, fail-closed loss, host restart and absence of a guest career copy. Test profiles are disposable and created only below `.tmp`.

The automated direct-transport validation uses two instances on one Windows machine. Cross-computer LAN/VPN, firewalls, sleep/resume and varying NAT topology still need user-environment validation. This increment does not claim public competitive anti-cheat, Steam authentication/Cloud/lobbies, code signing, updating, a TURN relay or host migration. Internet play relies on STUN plus, for restrictive NATs, a gaming VPN chosen by the players. A local host can inspect/modify its own career and is not a trusted public authority.

### Local results — 2026-10-07

- Desktop: 26 passed, including eight protocol/engine regressions, eight UI regressions and the real two-launcher WebRTC test. Shared tactics and match events, stable reconnect, host-save restoration and guest fail-closed behavior passed.
- Server: final complete run 1486 passed, 0 failed/cancelled, 1 skipped (`TEST_REDIS_URL`). The first full run detected sub-12px text in the new panel; only those sizes were raised, and the unchanged typography regression plus full rerun passed.
- Frontend: 200 passed. Chrome E2E: 4 passed. Typecheck, desktop build and diff check passed. Existing bundle-size warning remains.
- Independent visual review passed for lobby and active-career settings at 1440, 900 and 375px, after enforcing the existing 12px typography floor. No UI redesign was introduced.
- No new P2P dependency. Audit still reports six preexisting affected dependency nodes (1 moderate, 2 high, 3 critical), as documented in DESKTOP_MIGRATION.md; no audit=0 or release-ready claim.
- No cloud providers, staging infrastructure, commit, push or deploy were used. No private pairing material is included in these documents.
