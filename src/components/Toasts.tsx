// ─── Toast notifications ─────────────────────────────────────────────────────
import { Info, CheckCircle2, AlertTriangle, OctagonX, X } from 'lucide-react';
import { useApp } from '../state/AppContext';

const ICONS = {
  info: <Info size={16} color="#22d3ee" />,
  success: <CheckCircle2 size={16} color="#34d399" />,
  warn: <AlertTriangle size={16} color="#fbbf24" />,
  error: <OctagonX size={16} color="#fb7185" />,
};

export default function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          <span style={{ marginTop: 1 }}>{ICONS[t.kind]}</span>
          <span>{t.text}</span>
          <button aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={15} /></button>
        </div>
      ))}
    </div>
  );
}
