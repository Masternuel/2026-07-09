import { Archive, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import type { EditorEntity, EditorRecord } from '../../types';

interface EditorDeleteModalProps {
  entity: EditorEntity;
  record: EditorRecord | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  onArchive: () => Promise<void>;
}

const copy = {
  leagues: {
    label: 'liga',
    impact: 'A exclusão será bloqueada se houver clubes vinculados a esta liga.',
  },
  clubs: {
    label: 'clube',
    impact: 'A exclusão será bloqueada se houver jogadores ou torneios vinculados a este clube.',
  },
  players: {
    label: 'jogador',
    impact: 'O jogador será removido definitivamente da sua base.',
  },
  tournaments: {
    label: 'torneio',
    impact: 'O torneio personalizado e seu regulamento serão removidos da sua base.',
  },
} satisfies Record<EditorEntity, { label: string; impact: string }>;

export function EditorDeleteModal({ entity, record, pending, error, onClose, onConfirm, onArchive }: EditorDeleteModalProps) {
  const content = copy[entity];
  return (
    <Modal
      open={Boolean(record)}
      onClose={onClose}
      eyebrow="AÇÃO IRREVERSÍVEL"
      title={`Excluir ${content.label}?`}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
          {record?.active && <Button variant="secondary" icon={<Archive size={15} />} onClick={() => void onArchive()} disabled={pending}>Arquivar</Button>}
          <Button variant="danger" icon={<Trash2 size={15} />} loading={pending} onClick={() => void onConfirm()}>Excluir definitivamente</Button>
        </>
      )}
    >
      <div className="editor-delete-copy">
        <div className="editor-delete-copy__warning"><AlertTriangle size={18} /><span>Você está prestes a excluir <strong>{record?.name}</strong> ({record?.id}).</span></div>
        {error && <div className="editor-delete-copy__error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        <p>{content.impact}</p>
        <p><strong>Alternativa segura:</strong> arquive o registro para mantê-lo no catálogo sem excluí-lo permanentemente.</p>
      </div>
    </Modal>
  );
}
