// Reads a P2P invite/answer code (BOLA-P2P1.<base64url JSON>) to tell whether this
// PC found a public internet address. It only inspects the SDP candidate types; the
// code itself is never sent anywhere.
const PREFIX = 'BOLA-P2P1.';

export type PeerReachability = 'internet' | 'local-only' | 'unknown';

function decodeBase64Url(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/**
 * internet   – a server-reflexive (STUN) candidate exists: reachable across home routers.
 * local-only – only LAN/VPN addresses: STUN was blocked, so internet play needs a gaming VPN.
 * unknown    – the code could not be read.
 */
export function signalReachability(code: string): PeerReachability {
  try {
    const trimmed = code.trim();
    if (!trimmed.startsWith(PREFIX)) return 'unknown';
    const value = JSON.parse(decodeBase64Url(trimmed.slice(PREFIX.length)));
    const sdp: unknown = value?.description?.sdp;
    if (typeof sdp !== 'string') return 'unknown';
    const types = [...sdp.matchAll(/a=candidate:[^\r\n]* typ (host|srflx|prflx|relay)/g)].map((match) => match[1]);
    if (!types.length) return 'unknown';
    return types.some((type) => type === 'srflx' || type === 'prflx' || type === 'relay') ? 'internet' : 'local-only';
  } catch {
    return 'unknown';
  }
}
