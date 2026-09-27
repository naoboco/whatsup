export interface Toast { id: string; title: string; body: string; conversationId?: string; tone: 'info' | 'error' | 'reminder' }

export function Toasts({ items, onOpen, onClose }: { items: Toast[]; onOpen: (id: string) => void; onClose: (id: string) => void }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => { if (t.conversationId) { onOpen(t.conversationId); onClose(t.id); } }} role={t.conversationId ? 'button' : undefined}>
          <strong>{t.tone === 'reminder' ? '⏰ ' : ''}{t.title}</strong>
          {t.body && <span>{t.body}</span>}
          <button className="toast-x" onClick={e => { e.stopPropagation(); onClose(t.id); }} aria-label="Fermer">✕</button>
        </div>
      ))}
    </div>
  );
}
