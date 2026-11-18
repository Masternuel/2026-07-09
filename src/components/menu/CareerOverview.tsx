import { ArrowRight, Clock3, Database, Play, Plus, Users } from 'lucide-react';
import type { ClubOption } from '../../constants/clubs';
import type { ManagerIdentity, Room } from '../../types';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { ClubMark } from '../shared/ClubMark';
import { formatSaveDate, getMenuCapabilities, saveMetadata, type MainMenuPageId } from './mainMenuModel';

interface CareerOverviewProps {
  identity: ManagerIdentity;
  latest: Room | null;
  clubs: ClubOption[];
  loading: boolean;
  pending: boolean;
  continueReason: string;
  onContinue: () => void;
  onNavigate: (page: MainMenuPageId) => void;
}

export function CareerOverview(props: CareerOverviewProps) {
  const capabilities = getMenuCapabilities(props.identity.mode);
  const managerClubId = props.latest?.managers.find((manager) => manager.id === props.identity.uid)?.clubId;
  const club = props.clubs.find((candidate) => candidate.id.toLocaleUpperCase('pt-BR') === managerClubId?.toLocaleUpperCase('pt-BR'));
  const metadata = props.latest ? saveMetadata(props.latest) : null;
  return (
    <section className="menu-career" aria-labelledby="menu-career-title">
      <header className="menu-page-heading"><div><h1 id="menu-career-title">Carreira</h1></div></header>
      <div className="menu-career__command">
        <div className="menu-career__command-copy">
          <h2>{props.loading ? 'Carregando carreiras…' : props.latest?.name ?? (props.identity.mode === 'peer' ? 'Carreira compartilhada' : 'Nova carreira')}</h2>
          {props.identity.mode === 'peer' ? <p>Conecte-se ao anfitrião. O save permanece no computador dele.</p>
            : props.identity.mode === 'demo' ? <p>Modo demonstração: esta temporada não é um save persistido na conta.</p>
              : !props.latest && <p>Escolha as ligas e seu clube para começar.</p>}
          {props.latest && metadata && <div className="menu-career__save-details"><Badge tone={metadata.status === 'completed' ? 'neutral' : metadata.status === 'active' ? 'positive' : 'warning'}>{metadata.statusLabel}</Badge><span>Temporada {metadata.season ?? 'não informada'} · {metadata.year ?? 'ano não informado'}</span><span><Clock3 size={14} aria-hidden="true" /> {formatSaveDate(props.latest)}</span></div>}
          <div className="menu-career__actions">
            {props.latest ? <Button variant="primary" icon={<Play size={16} aria-hidden="true" />} loading={props.pending} disabled={props.loading} onClick={props.onContinue}>Continuar carreira</Button> : <Button variant="primary" icon={capabilities.canCreate ? <Plus size={16} aria-hidden="true" /> : <Users size={16} aria-hidden="true" />} disabled={props.pending || props.loading} onClick={() => props.onNavigate(capabilities.canCreate ? 'new-game' : 'multiplayer')}>{capabilities.canCreate ? 'Iniciar novo jogo' : 'Conectar ao anfitrião'}</Button>}
            {props.latest && capabilities.canCreate && <Button variant="ghost" icon={<Plus size={15} aria-hidden="true" />} disabled={props.pending} onClick={() => props.onNavigate('new-game')}>Novo Jogo</Button>}
          </div>
          {!props.latest && !props.loading && <p className="menu-career__availability">{props.continueReason}</p>}
        </div>
        {club && <div className="menu-career__club" aria-label={`Clube salvo: ${club.name}`}><ClubMark code={club.code} color={club.color} darkThemeColor={club.darkThemeColor} lightThemeColor={club.lightThemeColor} imageUrl={club.crestImageUrl} size="xl" /><strong>{club.name}</strong><span>{club.leagueName ?? 'Clube da carreira'}</span></div>}
      </div>
      <div className="menu-career__destinations">
        <button type="button" onClick={() => props.onNavigate('multiplayer')}><Users size={20} aria-hidden="true" /><span><strong>Multiplayer</strong><small>{capabilities.desktopPeer ? 'Convites P2P.' : capabilities.webRooms ? 'Salas por código.' : 'Indisponível na demonstração.'}</small></span><ArrowRight size={17} aria-hidden="true" /></button>
        <button type="button" onClick={() => props.onNavigate('editor')}><Database size={20} aria-hidden="true" /><span><strong>Editor</strong><small>{capabilities.canEdit ? 'Jogadores, clubes e competições.' : 'Consulte a disponibilidade.'}</small></span><ArrowRight size={17} aria-hidden="true" /></button>
      </div>
    </section>
  );
}
