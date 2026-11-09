import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Link2, Radio, RefreshCw, ShieldCheck, Unplug, Users } from 'lucide-react';
import { desktopBridge, type DesktopBridge, type DesktopPeerStatus } from '../../lib/desktopClient';
import type { ManagerIdentity, Room } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';

interface DesktopPeerPanelProps {
  identity: ManagerIdentity;
  room?: Room | null;
  bridge?: DesktopBridge | null;
}

type PeerAction = 'offer' | 'answer' | 'accept' | 'enter' | 'disconnect' | null;

export function DesktopPeerPanel({ identity, room = null, bridge = desktopBridge }: DesktopPeerPanelProps) {
  const id = useId();
  const [status, setStatus] = useState<DesktopPeerStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [pollVersion, setPollVersion] = useState(0);
  const [action, setAction] = useState<PeerAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitation, setInvitation] = useState('');
  const [guestInvitation, setGuestInvitation] = useState('');
  const [answer, setAnswer] = useState('');
  const [hostAnswer, setHostAnswer] = useState('');
  const invitationRef = useRef<HTMLTextAreaElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const actionPending = useRef(false);
  const mounted = useRef(false);
  const currentRoomCode = useRef(room?.code);
  currentRoomCode.current = room?.code;
  const desktopIdentity = identity.mode === 'local' || identity.mode === 'peer';
  const guest = identity.mode === 'peer' || status?.mode === 'guest' || !room;
  const owner = room?.ownerId === identity.uid;
  const canHost = Boolean(room && owner && room.maxManagers > 1 && identity.mode === 'local');
  const connectedGuest = status?.mode === 'guest' && status.connected;
  const busy = action !== null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (!bridge || !desktopIdentity) return;
    let active = true;
    let inFlight = false;
    let failures = 0;
    let timer: ReturnType<typeof setInterval> | undefined;
    setStatusError(null);
    async function poll() {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const nextStatus = await bridge!.peerStatus();
        if (!active) return;
        failures = 0;
        setStatus(nextStatus);
        setStatusError(null);
      } catch {
        if (!active) return;
        failures += 1;
        setStatusError(failures >= 3
          ? 'A consulta de conexão foi pausada após três falhas. Tente novamente.'
          : 'Não foi possível consultar a conexão P2P.');
        if (failures >= 3 && timer !== undefined) clearInterval(timer);
      } finally {
        inFlight = false;
      }
    }
    timer = setInterval(() => { void poll(); }, 1_000);
    void poll();
    return () => {
      active = false;
      if (timer !== undefined) clearInterval(timer);
      // A conexão pertence ao desktop, não à tela. Navegar não encerra o P2P.
    };
  }, [bridge, desktopIdentity, pollVersion]);

  useEffect(() => {
    setInvitation('');
    setHostAnswer('');
    setError(null);
    setNotice(null);
  }, [room?.code]);

  if (!bridge || !desktopIdentity) return null;

  async function perform(nextAction: Exclude<PeerAction, null>, operation: () => Promise<void>, failureMessage: string) {
    if (actionPending.current) return;
    actionPending.current = true;
    setAction(nextAction);
    setError(null);
    setNotice(null);
    try {
      await operation();
    } catch {
      if (mounted.current) setError(failureMessage);
    } finally {
      actionPending.current = false;
      if (mounted.current) setAction(null);
    }
  }

  async function copyPairing(value: string, textarea: HTMLTextAreaElement | null, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (mounted.current) setNotice(`${label} copiada. Envie em uma conversa privada.`);
    } catch {
      textarea?.focus();
      textarea?.select();
      textarea?.setSelectionRange(0, value.length);
      if (mounted.current) setNotice('Cópia automática indisponível. O texto foi selecionado: use Ctrl+C ou copie manualmente.');
    }
  }

  function generateInvitation() {
    if (!bridge || !canHost || !room) return;
    const code = room.code;
    void perform('offer', async () => {
      const offer = await bridge.peerCreateOffer(code);
      if (mounted.current && currentRoomCode.current === code) {
        setInvitation(offer);
        setHostAnswer('');
        setNotice('Convite pronto. Copie e envie somente ao amigo que vai entrar.');
      }
    }, 'Não foi possível gerar o convite. Confira se você é o anfitrião de uma carreira compartilhada.');
  }

  function generateAnswer() {
    if (!bridge || !guestInvitation.trim()) return;
    void perform('answer', async () => {
      const nextAnswer = await bridge.peerCreateAnswer(guestInvitation.trim());
      if (mounted.current) {
        setAnswer(nextAnswer);
        setNotice('Resposta pronta. Envie ao anfitrião e aguarde a conexão.');
      }
    }, 'Não foi possível gerar a resposta. Cole o convite completo e peça um novo ao anfitrião se ele expirou.');
  }

  function acceptAnswer() {
    if (!bridge || !canHost || !hostAnswer.trim()) return;
    void perform('accept', async () => {
      await bridge.peerAcceptAnswer(hostAnswer.trim());
      if (mounted.current) {
        setHostAnswer('');
        setInvitation('');
        setNotice('Resposta aceita. Aguarde a conexão direta com o convidado.');
      }
    }, 'Não foi possível aceitar a resposta. Confira o texto completo e o convite correspondente.');
  }

  function enterCareer() {
    if (!bridge || !connectedGuest) return;
    void perform('enter', () => bridge.peerEnterGuest(), 'Não foi possível entrar na carreira. Verifique se o anfitrião continua conectado.');
  }

  function disconnect() {
    if (!bridge) return;
    void perform('disconnect', async () => {
      await bridge.peerDisconnect();
      if (mounted.current) {
        setStatus({ mode: 'offline', connected: false, roomCode: null, peers: 0, pendingInvites: 0, transport: 'direct-webrtc' });
        setInvitation('');
        setAnswer('');
        setHostAnswer('');
        setGuestInvitation('');
        setNotice('P2P desconectado. O save continua no computador do anfitrião.');
      }
    }, 'Não foi possível encerrar a conexão. Tente novamente.');
  }

  const statusCopy = !status
    ? 'Consultando conexão…'
    : status.mode === 'host'
      ? `${status.peers} ${status.peers === 1 ? 'convidado conectado' : 'convidados conectados'} · ${status.pendingInvites} ${status.pendingInvites === 1 ? 'convite pendente' : 'convites pendentes'}`
      : status.mode === 'guest'
        ? status.connected ? 'Conexão direta com o anfitrião estabelecida.' : 'Sem conexão com o anfitrião. A carreira remota está pausada.'
        : 'Sem conexão P2P · sua carreira local está preservada.';

  return (
    <section className="desktop-peer-panel" aria-labelledby={`${id}-title`}>
      <header className="desktop-peer-panel__header">
        <div><p className="eyebrow">MULTIPLAYER DIRETO</p><h2 id={`${id}-title`}><Users size={16} aria-hidden="true" /> Jogue com amigos</h2></div>
        <Badge tone={guest ? 'info' : 'positive'}>{guest ? 'Convidado' : 'Anfitrião'}</Badge>
      </header>
      <p className="desktop-peer-panel__status" role="status" aria-live="polite"><Radio size={14} aria-hidden="true" /> {statusCopy}</p>
      {statusError && <div className="desktop-peer-panel__error" role="alert"><p>{statusError}</p><Button size="sm" variant="ghost" disabled={busy} icon={<RefreshCw size={13} />} onClick={() => setPollVersion((current) => current + 1)}>Consultar novamente</Button></div>}

      {guest ? (
        <>
          {identity.mode === 'local' && !room && <p className="desktop-peer-panel__intro">Para hospedar, crie ou selecione uma carreira com 4, 6 ou 8 managers. Para entrar, receba o convite do anfitrião.</p>}
          <ol className="desktop-peer-panel__steps">
            <li><div><h3>Receba o convite</h3><label htmlFor={`${id}-guest-invite`}>Convite do anfitrião</label><textarea id={`${id}-guest-invite`} value={guestInvitation} spellCheck={false} autoComplete="off" wrap="soft" rows={3} disabled={busy} placeholder="Cole o convite completo recebido em particular" onChange={(event) => setGuestInvitation(event.target.value)} /><Button size="sm" variant="secondary" loading={action === 'answer'} disabled={busy || !guestInvitation.trim() || connectedGuest} onClick={generateAnswer} icon={<Link2 size={13} />}>Gerar resposta</Button></div></li>
            <li><div><h3>Responda ao anfitrião</h3><p>Ele precisa colar e aceitar esta resposta para concluir o pareamento.</p>{answer ? <><label htmlFor={`${id}-answer`}>Sua resposta privada</label><textarea id={`${id}-answer`} ref={answerRef} value={answer} readOnly spellCheck={false} wrap="soft" rows={3} /><Button size="sm" variant="ghost" disabled={busy} onClick={() => void copyPairing(answer, answerRef.current, 'Resposta')} icon={<Copy size={13} />}>Copiar resposta</Button></> : <p className="desktop-peer-panel__waiting">A resposta aparecerá após a etapa 1.</p>}</div></li>
            <li><div><h3>Entre quando conectar</h3><p>{identity.mode === 'peer' ? connectedGuest ? 'Você está conectado à carreira do anfitrião. O save permanece no computador dele.' : 'A carreira remota aguarda o anfitrião. Um novo convite permite reconectar com a mesma identidade.' : 'Aguarde o anfitrião aceitar. O save permanece no computador dele.'}</p>{identity.mode !== 'peer' && <Button size="sm" variant="primary" loading={action === 'enter'} disabled={busy || !connectedGuest || Boolean(statusError)} onClick={enterCareer} icon={<Check size={13} />}>Entrar na carreira</Button>}</div></li>
          </ol>
        </>
      ) : (
        <ol className="desktop-peer-panel__steps">
          <li><div><h3>Gere um convite</h3><p>{canHost ? `Carreira: ${room?.name}. Gere um convite por amigo, inclusive para reconectar.` : !owner ? 'Somente o dono desta carreira pode convidar managers.' : 'Esta carreira tem 1 manager e continua offline. Crie uma nova com 4, 6 ou 8 para jogar em grupo.'}</p><Button size="sm" variant="secondary" loading={action === 'offer'} disabled={busy || !canHost} onClick={generateInvitation} icon={<Link2 size={13} />}>Gerar convite</Button></div></li>
          <li><div><h3>Envie em particular</h3>{invitation ? <><label htmlFor={`${id}-invite`}>Convite privado</label><textarea id={`${id}-invite`} ref={invitationRef} value={invitation} readOnly spellCheck={false} wrap="soft" rows={3} /><Button size="sm" variant="ghost" disabled={busy} onClick={() => void copyPairing(invitation, invitationRef.current, 'Convite')} icon={<Copy size={13} />}>Copiar convite</Button></> : <p className="desktop-peer-panel__waiting">O convite aparecerá após a etapa 1.</p>}</div></li>
          <li><div><h3>Aceite a resposta</h3><label htmlFor={`${id}-host-answer`}>Resposta do convidado</label><textarea id={`${id}-host-answer`} value={hostAnswer} spellCheck={false} autoComplete="off" wrap="soft" rows={3} disabled={busy || !canHost} placeholder="Cole a resposta completa enviada pelo amigo" onChange={(event) => setHostAnswer(event.target.value)} /><Button size="sm" variant="primary" loading={action === 'accept'} disabled={busy || !canHost || !hostAnswer.trim()} onClick={acceptAnswer} icon={<Check size={13} />}>Aceitar resposta</Button></div></li>
        </ol>
      )}

      {error && <p className="desktop-peer-panel__error" role="alert">{error}</p>}
      {notice && <p className="desktop-peer-panel__notice" role="status" aria-live="polite">{notice}</p>}
      <div className="desktop-peer-panel__privacy"><ShieldCheck size={15} aria-hidden="true" /><p>Convites e respostas contêm dados privados de pareamento e rede. Compartilhe só com amigos de confiança.</p></div>
      <p className="desktop-peer-panel__network-note">WebRTC direto, sem servidor pago. Use LAN/VPN ou redes alcançáveis. Ainda sem STUN/TURN ou relay Steam; conexões pela internet com NAT não são garantidas. O anfitrião precisa ficar online: sem ele, a carreira remota para. Sem migração de anfitrião.</p>
      {(identity.mode === 'peer' || status?.mode === 'guest' || status?.mode === 'host') && <Button className="desktop-peer-panel__disconnect" size="sm" variant="ghost" loading={action === 'disconnect'} disabled={busy} onClick={disconnect} icon={<Unplug size={13} />}>{guest ? 'Sair do P2P e voltar ao perfil local' : 'Encerrar P2P dos convidados'}</Button>}
    </section>
  );
}
