import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Gamepad2, Play, Plus, Trash2, Users } from 'lucide-react';
import type { ManagerIdentity, Room } from '../../types';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

interface SaveManagerProps {
  saves: Room[];
  identity: ManagerIdentity;
  pending: boolean;
  onSelect: (code: string) => Promise<Room>;
  onDelete: (code: string) => Promise<void>;
  onCreateNew: () => void;
  onToast: (message: string) => void;
}

const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});

function roomTimestamp(room: Room) {
  const timestamp = Date.parse(room.updatedAt ?? room.createdAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatRoomDate(room: Room) {
  const timestamp = roomTimestamp(room);
  return timestamp ? dateFormatter.format(timestamp) : 'Data indisponível';
}

function completedGames(room: Room) {
  return Math.max(
    room.completedFixtureIds?.length ?? 0,
    room.completedMatches?.length ?? 0,
  );
}

export function SaveManager({
  saves,
  identity,
  pending,
  onSelect,
  onDelete,
  onCreateNew,
  onToast,
}: SaveManagerProps) {
  const sortedSaves = useMemo(
    () => [...saves].sort((left, right) => roomTimestamp(right) - roomTimestamp(left)),
    [saves],
  );
  const [selectedCode, setSelectedCode] = useState<string | null>(sortedSaves[0]?.code ?? null);
  const [deleteCandidate, setDeleteCandidate] = useState<Room | null>(null);
  const [selectingCode, setSelectingCode] = useState<string | null>(null);
  const [deletingCode, setDeletingCode] = useState<string | null>(null);
  const [focusAfterDelete, setFocusAfterDelete] = useState(0);
  const managerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setSelectedCode((current) => (
      current && sortedSaves.some((room) => room.code === current)
        ? current
        : sortedSaves[0]?.code ?? null
    ));
    setDeleteCandidate((current) => (
      current && sortedSaves.some((room) => room.code === current.code) ? current : null
    ));
  }, [sortedSaves]);

  useEffect(() => {
    if (!focusAfterDelete) return;
    const frame = window.requestAnimationFrame(() => {
      managerRef.current?.querySelector<HTMLElement>(
        '.save-manager__card--selected .save-manager__select, .save-manager__select, .save-manager__create',
      )?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusAfterDelete]);

  const busy = pending || selectingCode !== null || deletingCode !== null;

  async function selectSave(room: Room) {
    setSelectedCode(room.code);
    setSelectingCode(room.code);
    try {
      const selectedRoom = await onSelect(room.code);
      onToast(`${selectedRoom.name} carregado.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível carregar o save.');
    } finally {
      setSelectingCode(null);
    }
  }

  function requestDelete(room: Room) {
    if (room.ownerId !== identity.uid) return;
    setSelectedCode(room.code);
    setDeleteCandidate(room);
  }

  function closeDeleteModal() {
    if (!busy) setDeleteCandidate(null);
  }

  async function deleteSave() {
    if (!deleteCandidate || deleteCandidate.ownerId !== identity.uid) return;
    const candidate = deleteCandidate;
    setDeletingCode(candidate.code);
    try {
      await onDelete(candidate.code);
      setFocusAfterDelete((current) => current + 1);
      setDeleteCandidate(null);
      setSelectedCode((current) => current === candidate.code ? null : current);
      onToast(`${candidate.name} excluído permanentemente.`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Não foi possível excluir o save.');
    } finally {
      setDeletingCode(null);
    }
  }

  return (
    <section className="save-manager" aria-labelledby="save-manager-title" ref={managerRef}>
      <header className="save-manager__header">
        <div>
          <p className="save-manager__eyebrow">CARREIRAS SALVAS</p>
          <h2 id="save-manager-title">Escolha um save</h2>
          <p className="save-manager__description">Continue uma temporada existente ou comece uma nova.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          className="save-manager__create"
          icon={<Plus size={16} aria-hidden="true" />}
          onClick={onCreateNew}
          disabled={busy}
        >
          Novo save
        </Button>
      </header>

      {sortedSaves.length === 0 ? (
        <div className="save-manager__empty">
          <Gamepad2 size={28} aria-hidden="true" />
          <strong>Nenhum save encontrado</strong>
          <p>Crie uma temporada para iniciar sua carreira.</p>
          <Button
            type="button"
            variant="primary"
            icon={<Plus size={16} aria-hidden="true" />}
            onClick={onCreateNew}
            disabled={busy}
          >
            Criar primeiro save
          </Button>
        </div>
      ) : (
        <div className="save-manager__list" aria-label="Saves disponíveis">
          {sortedSaves.map((room) => {
            const selected = selectedCode === room.code;
            const owner = room.ownerId === identity.uid;
            const statusLabel = room.status === 'active' ? 'Em andamento' : 'Preparação';

            return (
              <article
                key={room.code}
                className={selected ? 'save-manager__card save-manager__card--selected' : 'save-manager__card'}
              >
                <button
                  type="button"
                  className="save-manager__select"
                  aria-pressed={selected}
                  aria-label={`Selecionar ${room.name}, código ${room.code}`}
                  onClick={() => setSelectedCode(room.code)}
                  disabled={busy}
                >
                  <span className="save-manager__title-row">
                    <span className="save-manager__name">{room.name}</span>
                    <span className={`save-manager__status save-manager__status--${room.status}`}>{statusLabel}</span>
                  </span>
                  <span className="save-manager__code">{room.code}</span>
                  <span className="save-manager__metrics">
                    <span><CalendarDays size={14} aria-hidden="true" /> {formatRoomDate(room)}</span>
                    <span><Users size={14} aria-hidden="true" /> {room.managers.length}/{room.maxManagers} managers</span>
                    <span><Gamepad2 size={14} aria-hidden="true" /> {completedGames(room)} jogos</span>
                  </span>
                  {selected && <span className="sr-only">Save selecionado</span>}
                </button>

                <div className="save-manager__actions">
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    className="save-manager__continue"
                    icon={<Play size={14} aria-hidden="true" />}
                    loading={selectingCode === room.code}
                    disabled={busy && selectingCode !== room.code}
                    onClick={() => void selectSave(room)}
                  >
                    Continuar
                  </Button>
                  {owner ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      className="save-manager__delete"
                      icon={<Trash2 size={14} aria-hidden="true" />}
                      disabled={busy}
                      onClick={() => requestDelete(room)}
                      aria-label={`Excluir save ${room.name}`}
                    >
                      Excluir
                    </Button>
                  ) : (
                    <span className="save-manager__owner-note">Somente o criador pode excluir</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Modal
        open={Boolean(deleteCandidate)}
        onClose={closeDeleteModal}
        title="Excluir save?"
        eyebrow="AÇÃO PERMANENTE"
        size="sm"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={closeDeleteModal} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="danger"
              className="save-delete__confirm"
              icon={<Trash2 size={15} aria-hidden="true" />}
              loading={Boolean(deleteCandidate && deletingCode === deleteCandidate.code)}
              disabled={!deleteCandidate || deleteCandidate.ownerId !== identity.uid}
              onClick={() => void deleteSave()}
            >
              Excluir permanentemente
            </Button>
          </>
        )}
      >
        {deleteCandidate && (
          <div className="save-delete">
            <p className="save-delete__warning" role="alert">
              Esta ação não pode ser desfeita. O save será apagado permanentemente para todos os managers da sala.
            </p>
            <dl className="save-delete__details">
              <div><dt>Save</dt><dd>{deleteCandidate.name}</dd></div>
              <div><dt>Código</dt><dd>{deleteCandidate.code}</dd></div>
              <div><dt>Managers afetados</dt><dd>{deleteCandidate.managers.length}</dd></div>
            </dl>
          </div>
        )}
      </Modal>
    </section>
  );
}
