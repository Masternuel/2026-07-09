import { LogOut } from 'lucide-react';
import { Button } from '../shared/Button';
import { Modal } from '../shared/Modal';

export function ExitMenuModal({ open, desktop, pending, onCancel, onConfirm }: { open: boolean; desktop: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal open={open} onClose={pending ? () => {} : onCancel} title={desktop ? 'Sair do Bola Manager?' : 'Sair da sessão?'} eyebrow="CONFIRMAR SAÍDA" size="sm" footer={<><Button variant="ghost" disabled={pending} onClick={onCancel}>Cancelar</Button><Button className="main-menu-exit__confirm" variant="danger" icon={<LogOut size={15} aria-hidden="true" />} loading={pending} onClick={onConfirm}>{desktop ? 'Fechar jogo' : 'Sair da conta'}</Button></>}><p className="menu-exit-copy">{desktop ? 'A janela do jogo será fechada. Os saves locais já gravados permanecem neste computador. Se você hospeda uma conexão P2P, a carreira dos convidados ficará offline.' : 'Você será desconectado e voltará à tela de entrada. Esta ação não fecha a aba do navegador.'}</p></Modal>;
}
