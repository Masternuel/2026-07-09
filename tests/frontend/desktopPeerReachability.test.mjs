// Internet P2P: the panel warns when this PC only found LAN/VPN addresses (STUN
// blocked), so players know to use a gaming VPN before the connection fails.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createServer } from 'vite';

let vite, React, createRoot, DesktopPeerPanel, signalReachability;
const mounted = [];

before(async () => {
  GlobalRegistrator.register({ url: 'http://localhost/' });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  React = await import('react');
  ({ createRoot } = await import('react-dom/client'));
  vite = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)), configFile: false, envDir: false,
    esbuild: { jsx: 'automatic' }, optimizeDeps: { noDiscovery: true, include: [] },
    appType: 'custom', logLevel: 'silent', server: { middlewareMode: true },
  });
  ({ DesktopPeerPanel } = await vite.ssrLoadModule('/src/components/lobby/DesktopPeerPanel.tsx'));
  ({ signalReachability } = await vite.ssrLoadModule('/src/lib/peerSignal.ts'));
});

afterEach(async () => {
  while (mounted.length) { const root = mounted.pop(); await React.act(async () => root.unmount()); }
  document.body.innerHTML = '';
});

after(async () => {
  await vite?.close();
  await GlobalRegistrator.unregister();
});

const HOST = 'a=candidate:1 1 udp 2122260223 192.168.0.10 54321 typ host generation 0';
const SRFLX = 'a=candidate:2 1 udp 1686052607 203.0.113.7 54321 typ srflx raddr 192.168.0.10 rport 54321 generation 0';
const code = (type, candidates) => `BOLA-P2P1.${Buffer.from(JSON.stringify({
  version: 1, type, id: '00000000-0000-4000-8000-000000000001',
  description: { type, sdp: `v=0\r\n${candidates.join('\r\n')}\r\n` },
})).toString('base64url')}`;

test('reachability: STUN candidate means internet, host-only means local, garbage is unknown', () => {
  assert.equal(signalReachability(code('offer', [HOST, SRFLX])), 'internet');
  assert.equal(signalReachability(code('answer', [HOST])), 'local-only');
  assert.equal(signalReachability(code('offer', [])), 'unknown');
  assert.equal(signalReachability('não é um convite'), 'unknown');
  assert.equal(signalReachability('BOLA-P2P1.%%%'), 'unknown');
});

const identity = { uid: 'host-1', displayName: 'Anfitrião', email: null, photoURL: null, mode: 'local' };
const room = { code: 'BOLA-ABCD', name: 'Carreira online', ownerId: 'host-1', maxManagers: 4 };

function bridgeReturning(offer) {
  return {
    peerStatus: async () => ({ mode: 'host', connected: false, roomCode: room.code, peers: 0, pendingInvites: 0, transport: 'direct-webrtc' }),
    peerCreateOffer: async () => offer,
    peerCreateAnswer: async () => { throw new Error('unused'); },
    peerAcceptAnswer: async () => { throw new Error('unused'); },
    peerEnterGuest: async () => { throw new Error('unused'); },
    peerDisconnect: async () => undefined,
  };
}

async function renderAndInvite(offer) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(DesktopPeerPanel, { identity, room, bridge: bridgeReturning(offer) })));
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Gerar convite'));
  await React.act(async () => { button.click(); });
  return container;
}

test('a local-only invitation shows the gaming VPN guidance', async () => {
  const container = await renderAndInvite(code('offer', [HOST]));
  assert.equal(container.querySelector('textarea[readonly]').value, code('offer', [HOST]));
  assert.match(container.textContent, /não descobriu seu endereço de internet/);
  assert.match(container.textContent, /Radmin VPN, ZeroTier ou Tailscale/);
});

test('an invitation with a public (STUN) address shows no warning', async () => {
  const container = await renderAndInvite(code('offer', [HOST, SRFLX]));
  assert.doesNotMatch(container.textContent, /não descobriu seu endereço de internet/);
  assert.match(container.textContent, /Funciona pela internet na maioria das redes domésticas/);
});

test('a guest answer with only local addresses (same LAN) shows no VPN warning', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  const guestBridge = { ...bridgeReturning(null),
    peerStatus: async () => ({ mode: 'offline', connected: false, roomCode: null, peers: 0, pendingInvites: 0, transport: 'direct-webrtc' }),
    peerCreateAnswer: async () => code('answer', [HOST]) };
  await React.act(async () => root.render(React.createElement(DesktopPeerPanel, { identity, room: null, bridge: guestBridge })));
  const textarea = container.querySelector('textarea');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, code('offer', [HOST, SRFLX]));
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Gerar resposta'));
  await React.act(async () => { button.click(); });
  assert.equal(container.querySelector('textarea[readonly]').value, code('answer', [HOST]));
  assert.doesNotMatch(container.textContent, /não descobriu seu endereço de internet/);
});
