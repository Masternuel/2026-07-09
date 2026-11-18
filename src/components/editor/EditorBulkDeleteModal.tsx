import { AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';
import type { EditorEntity, EditorRecord } from '../../types';

interface EditorBulkDeleteModalProps {
  entity: EditorEntity;
  records: EditorRecord[];
  selectedCount: number;
  open: boolean;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

const copy = {
  leagues: { singular: 'liga', plural: 'ligas', dependency: 'clubes vinculados' },
  clubs: { singular: 'clube', plural: 'clubes', dependency: 'jogadores ou torneios vinculados' },
  players: { singular: 'jogador', plural: 'jogadores', dependency: null },
  tournaments: { singular: 'torneio', plural: 'torneios', dependency: null },
} satisfies Record<EditorEntity, { singular: string; plural: string; dependency: string | null }>;

export function EditorBulkDeleteModal({
  entity,
  records,
  selectedCount,
  open,
  pending,
  error,
  onClose,
  onConfirm,
}: EditorBulkDeleteModalProps) {
  const content = copy[entity];
  const label = selectedCount === 1 ? content.singular : content.plural;
  const visibleRecords = records.slice(0, 5);
  const remaining = Math.max(0, selectedCount - visibleRecords.length);
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="EXCLUSÃO EM LOTE"
      title={`Excluir ${selectedCount} ${label}?`}
      size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
          <Button variant="danger" icon={<Trash2 size={15} />} loading={pending} onClick={() => void onConfirm()}>
            Excluir definitivamente
          </Button>
        </>
      )}
    >
      <div className="editor-delete-copy">
        <div className="editor-delete-copy__warning">
          <AlertTriangle size={18} />
          <span>Esta ação removerá definitivamente os registros selecionados da sua base.</span>
        </div>
        {error && <div className="editor-delete-copy__error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        {visibleRecords.length > 0 && (
          <ul className="editor-bulk-delete-list">
            {visibleRecords.map((record) => <li key={record.id}><strong>{record.name}</strong><small>{record.id}</small></li>)}
            {remaining > 0 && <li className="is-more">e mais {remaining} registro{remaining === 1 ? '' : 's'}</li>}
          </ul>
        )}
        <p><strong>Tudo ou nada:</strong> se qualquer registro não puder ser excluído, nenhum deles será apagado.</p>
        {content.dependency && <p>A operação será bloqueada caso existam {content.dependency}.</p>}
      </div>
    </Modal>
  );
}
