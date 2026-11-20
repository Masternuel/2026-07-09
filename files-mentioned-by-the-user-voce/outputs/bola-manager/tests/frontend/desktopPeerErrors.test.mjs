// The host's "Aceitar resposta" names the actual cause (expired or unknown invite, wrong
// or cut text) instead of one generic message, using the PEER_* code the desktop sends.
import assert from 'node:assert/strict';
import { after, afterEach, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createServer } from 'vite';

let vite, React, createRoot, panel;
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
  panel = await vite.ssrLoadModule('/src/components/lobby/DesktopPeerPanel.tsx');
});
afterEach(async () => {
  while (mounted.length) { const root = mounted.pop(); await React.act(async () => root.unmount()); }
  document.body.innerHTML = '';
});
after(async () => { await vite?.close(); await GlobalRegistrator.unregister(); });

test('the PEER_* code is read from the Electron IPC error text', () => {
  assert.equal(panel.peerErrorCode(new Error("Error invoking remote method 'desktop:peerAcceptAnswer': Error: PEER_SIGNAL_STATE")), 'PEER_SIGNAL_STATE');
  assert.equal(panel.peerErrorCode(new Error('LOCAL_IPC_FORBIDDEN')), null);
  assert.match(panel.acceptFailureMessage('PEER_SIGNAL_STATE'), /vale 5 minutos e aceita uma única resposta/);
  assert.match(panel.acceptFailureMessage('PEER_SIGNAL_WRONG_TYPE'), /é um convite, não a resposta/);
  assert.match(panel.acceptFailureMessage('PEER_SIGNAL_INVALID'), /incompleta ou alterada/);
  assert.match(panel.answerFailureMessage('PEER_INVITE_EXPIRED_OR_INVALID'), /expirou/);
  assert.match(panel.acceptFailureMessage(null), /Gere um novo convite/);
});

test('an answer for a closed invitation tells the host the invite expired or was used', async () => {
  const identity = { uid: 'host-1', displayName: 'Anfitrião', email: null, photoURL: null, mode: 'local' };
  const room = { code: 'BOLA-ABCD', name: 'Carreira online', ownerId: 'host-1', maxManagers: 4 };
  const bridge = {
    peerStatus: async () => ({ mode: 'host', connected: false, roomCode: room.code, peers: 0, pendingInvites: 0, transport: 'direct-webrtc' }),
    peerCreateOffer: async () => 'BOLA-P2P1.x', peerCreateAnswer: async () => '',
    peerAcceptAnswer: async () => { throw new Error("Error invoking remote method 'desktop:peerAcceptAnswer': Error: PEER_SIGNAL_STATE"); },
    peerEnterGuest: async () => undefined, peerDisconnect: async () => undefined,
  };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push(root);
  await React.act(async () => root.render(React.createElement(panel.DesktopPeerPanel, { identity, room, bridge })));
  const textarea = container.querySelector('textarea[placeholder^="Cole a resposta"]');
  const setValue = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  await React.act(async () => { setValue.call(textarea, 'BOLA-P2P1.resposta'); textarea.dispatchEvent(new window.Event('input', { bubbles: true })); });
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent.includes('Aceitar resposta'));
  await React.act(async () => { button.click(); });
  assert.match(container.querySelector('[role="alert"]').textContent, /não corresponde a nenhum convite aberto/);
});
