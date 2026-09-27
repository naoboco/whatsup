import type { ReactNode } from 'react';
import { initials } from '../lib/format';

export function Lighthouse({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="lighthouse">
      <path className="beam" d="M32 20 L62 8 L62 32 Z" />
      <path className="beam b2" d="M32 20 L2 8 L2 32 Z" />
      <path d="M32 12 L40 52 H24 Z" fill="var(--accent)" />
      <rect x="18" y="52" width="28" height="4" rx="2" fill="var(--text)" opacity=".85" />
    </svg>
  );
}

export function Avatar({ name, accent, kind, size = 46 }: { name: string; accent: string; kind: string; size?: number }) {
  return (
    <div className={`avatar ${kind}`} style={{ width: size, height: size, ['--av' as any]: accent }} aria-hidden="true">
      {kind === 'reminders' ? <span className="av-bell">⏰</span> : initials(name)}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <span><span className="toggle-label">{label}</span>{hint && <span className="hint">{hint}</span>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

export function Spinner() { return <span className="spinner" aria-label="Chargement" />; }
