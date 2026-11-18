import { Link2, Plus, ShieldCheck, Users } from 'lucide-react';
import type { ManagerIdentity } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { getMenuCapabilities } from './mainMenuModel';
import { InformationDisclosure } from '../shared/InformationDisclosure';

export function MultiplayerPage({ identity, pending, onCreate }: { identity: ManagerIdentity; pending: boolean; onCreate: () => void }) {
  const capabilities = getMenuCapabilities(identity.mode);
  return (
    <section className="menu-multiplayer" aria-labelledby="menu-multiplayer-title">
      <header className="menu-page-heading"><div><h1 id="menu-multiplayer-title">Multiplayer</h1></div><Badge tone={identity.mode === 'demo' ? 'warning' : 'info'}>{capabilities.desktopPeer ? 'P2P' : identity.mode === 'demo' ? 'Demonstração limitada' : 'Sala por código'}</Badge></header>
      {identity.mode === 'demo' ? <div className="menu-empty"><Users size={26} aria-hidden="true" /><h2>Multiplayer real exige outro modo</h2><p>A demonstração não conecta amigos. Use uma conta Firebase para salas web ou o launcher local para P2P.</p></div> : <div className="menu-multiplayer__intro"><ShieldCheck size={22} aria-hidden="true" /><div><h2>{capabilities.desktopPeer ? identity.mode === 'peer' ? 'Save no anfitrião' : 'Hospedar ou entrar' : 'Sala privada'}</h2><p>{capabilities.desktopPeer ? 'Convite privado. O save fica no computador do anfitrião.' : 'Entre com o código recebido ou crie uma sala.'}</p></div>{capabilities.canCreate && <Button variant="secondary" icon={<Plus size={15} aria-hidden="true" />} disabled={pending} onClick={onCreate}>{capabilities.desktopPeer ? 'Criar carreira compartilhada' : 'Criar sala privada'}</Button>}</div>}
      {capabilities.webRooms && <div className="menu-section-title"><Link2 size={17} aria-hidden="true" /><h2>Localizar sala por convite</h2></div>}
      <InformationDisclosure title="Como funciona e próximos recursos">
        {identity.mode !== 'demo' && <p className="menu-notice">{capabilities.desktopPeer ? 'O pareamento usa WebRTC. Navegar pelo menu não desconecta a sessão. Para hospedar, selecione uma carreira com 4, 6 ou 8 managers.' : 'O criador controla o início da temporada; cada manager confirma seu próprio clube.'}</p>}
        <p className="menu-multiplayer__roadmap"><Badge>Planejado</Badge><span>Matchmaking, descoberta pública e integração Steam. Ainda não disponíveis.</span></p>
      </InformationDisclosure>
    </section>
  );
}
