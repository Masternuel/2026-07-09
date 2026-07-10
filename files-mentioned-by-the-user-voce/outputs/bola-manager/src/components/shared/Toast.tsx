import { Check, X } from 'lucide-react';

interface ToastProps {
  message: string | null;
  onClose: () => void;
}

export function Toast({ message, onClose }: ToastProps) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span className="toast__icon"><Check size={14} /></span>
      <span>{message}</span>
      <button onClick={onClose} aria-label="Fechar aviso"><X size={14} /></button>
    </div>
  );
}
