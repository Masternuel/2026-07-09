import { Activity, CalendarClock, Flag, Footprints, LockKeyhole, Shield, Sparkles, UserRound } from 'lucide-react';
import type { Player } from '../../types';
import { formatCurrency } from '../../utils/formatters';
import { Badge } from '../shared/Badge';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import { ProgressBar } from '../shared/ProgressBar';
import { ResilientImage } from '../shared/ResilientImage';
import { StarPlayerMark } from '../shared/StarPlayerMark';
import { StarRating } from '../shared/StarRating';

interface PlayerModalProps {
  player: Player | null;
  onClose: () => void;
  onAction: (message: string) => void;
}

const attributeLabels: Array<[keyof Player['attributes'], string]> = [
  ['velocidade', 'Velocidade'], ['chute', 'Chute'], ['drible', 'Drible'], ['nocao', 'Noção'],
  ['defesa', 'Defesa'], ['passe', 'Passe'], ['peBom', 'Pé bom'], ['peRuim', 'Pé ruim'],
];

export function PlayerModal({ player, onClose, onAction }: PlayerModalProps) {
  if (!player) return null;
  const statusTone = player.status === 'Disponível' ? 'positive' : player.status === 'Lesionado' ? 'danger' : 'warning';

  return (
    <Modal open={Boolean(player)} onClose={onClose} title={player.name} eyebrow={`${player.position} · CAMISA ${player.number}`} size="lg" footer={(
      <><Button variant="ghost" onClick={() => onAction('Jogador adicionado à lista de observação.')}>Adicionar à observação</Button><Button variant="primary" onClick={() => onAction('Conversa individual agendada para amanhã.')}>Conversar com jogador</Button></>
    )}>
      <div className="player-profile">
        <aside className="player-profile__identity">
          <div className={`player-silhouette ${player.avatarImageUrl ? 'has-avatar' : ''}`}>
            <ResilientImage src={player.avatarImageUrl} alt={`Foto de ${player.name}`} />
            <span>{player.number}</span><strong>{player.shortName.toUpperCase()}</strong>
          </div>
          <div className="player-world-star"><Sparkles size={14} /> Fama mundial <strong>{player.worldStar}/10</strong></div>
          {player.isStar && (
            <div className="player-star-callout">
              <StarPlayerMark size="md" />
              <span><strong>ESTRELA DO ELENCO</strong><small>Impulsiona patrocinadores e entrega um pequeno bônus coletivo em campo.</small></span>
            </div>
          )}
          <dl>
            <div><dt><CalendarClock size={14} /> Idade</dt><dd>{player.age} anos</dd></div>
            <div><dt><Flag size={14} /> Nacionalidade</dt><dd>{player.nationality}</dd></div>
            <div><dt><Footprints size={14} /> Pé preferido</dt><dd>{player.foot}</dd></div>
            <div><dt><UserRound size={14} /> Personalidade</dt><dd>{player.personality}</dd></div>
          </dl>
          <div className="profile-contract"><small>CONTRATO ATÉ DEZ/2028</small><strong>{formatCurrency(player.wage, false)}<span>/mês</span></strong><p>Valor estimado: {formatCurrency(player.value)}</p></div>
        </aside>

        <div className="player-profile__main">
          <div className="player-profile__status">
            <span><small>FUNÇÃO PREFERIDA</small><strong>{player.role}</strong></span>
            <Badge tone={statusTone} dot>{player.status}</Badge>
          </div>
          <section>
            <h3>Atributos visíveis <span>ESCALA 1–10</span></h3>
            <div className="attribute-grid">
              {attributeLabels.map(([key, label]) => (
                <div key={key}><span>{label}</span><StarRating value={player.attributes[key]} /></div>
              ))}
            </div>
          </section>
          <section className="physical-status">
            <h3>Estado atual</h3>
            <div><span><Activity size={15} /> Condição física <strong>{player.condition}%</strong></span><ProgressBar value={player.condition} tone={player.condition > 85 ? 'accent' : 'warning'} /></div>
            <div><span><Shield size={15} /> Moral <strong>{player.morale}</strong></span><ProgressBar value={player.morale === 'Excelente' ? 95 : player.morale === 'Boa' ? 78 : player.morale === 'Neutra' ? 55 : 32} tone="info" /></div>
          </section>
          <section className="hidden-attributes">
            <h3>Relatório de scout <span>NÍVEL 2</span></h3>
            {['Consistência', 'Grandes jogos', 'Profissionalismo', 'Adaptabilidade'].map((label, index) => (
              <div key={label}><span>{label}</span>{index < 2 ? <strong>{index === 0 ? 'Muito boa' : 'Boa'}</strong> : <span className="locked"><LockKeyhole size={12} /> Oculto</span>}</div>
            ))}
          </section>
        </div>
      </div>
    </Modal>
  );
}
