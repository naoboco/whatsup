import { Search, Plus, Settings as Cog, BellOff, Pin, AlertTriangle, Newspaper, Briefcase, X, WifiOff } from 'lucide-react';
import type { Conversation, Status } from '../lib/types';
import { listStamp } from '../lib/format';
import { Avatar, Lighthouse } from './ui';

const FILTERS = [
  { id: 'all', label: 'Toutes' },
  { id: 'unread', label: 'Non lus' },
  { id: 'news', label: 'Actualités' },
  { id: 'jobs', label: 'Emplois' },
];

function preview(c: Conversation) {
  const m = c.last_message;
  if (!m) return <span className="muted">Aucun message</span>;
  const icon = m.kind === 'news' ? <Newspaper size={14} /> : m.kind === 'job' ? <Briefcase size={14} /> : null;
  const text = m.kind === 'news' || m.kind === 'job' ? m.title : m.body;
  return (
    <>
      {m.is_demo && <span className="tag demo">Démo</span>}
      {icon && <span className="pv-icon">{icon}</span>}
      <span className="pv-text">{m.kind === 'user' ? 'Vous : ' : ''}{text}</span>
    </>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 90);
  const start = Math.max(0, i - 30);
  return <>{start > 0 && '…'}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 50)}</>;
}

export default function Sidebar(p: {
  convs: Conversation[] | null; error: string | null; q: string; setQ: (s: string) => void; filter: string; setFilter: (f: string) => void;
  selected: string | null; onOpen: (id: string) => void; onNew: () => void; onSettings: () => void; status: Status | null; online: boolean; onRetry: () => void;
}) {
  const { convs, q } = p;
  return (
    <aside className="sidebar">
      <header className="side-head">
        <div className="brand"><Lighthouse /> <span>Vigie</span></div>
        <div className="head-actions">
          <button className="icon-btn" onClick={p.onNew} aria-label="Nouvelle veille" title="Nouvelle veille"><Plus size={20} /></button>
          <button className="icon-btn" onClick={p.onSettings} aria-label="Préférences" title="Préférences"><Cog size={20} /></button>
        </div>
      </header>
      {!p.online && <div className="banner warn"><WifiOff size={14} /> Connexion temps réel interrompue — reconnexion…</div>}
      {p.status && !p.status.openai && (
        <div className="banner subtle">Rappels : analyseur local actif (aucune clé OpenAI).</div>
      )}
      <div className="search">
        <Search size={16} />
        <input value={q} onChange={e => p.setQ(e.target.value)} placeholder="Rechercher une veille, un poste, un article…" aria-label="Rechercher" />
        {q && <button className="icon-btn sm" onClick={() => p.setQ('')} aria-label="Effacer"><X size={14} /></button>}
      </div>
      <div className="chips" role="tablist">
        {FILTERS.map(f => (
          <button key={f.id} role="tab" aria-selected={p.filter === f.id} className={`chip ${p.filter === f.id ? 'on' : ''}`} onClick={() => p.setFilter(f.id)}>{f.label}</button>
        ))}
      </div>
      <nav className="conv-list" aria-label="Conversations">
        {p.error && <div className="empty"><p>{p.error}</p><button className="btn" onClick={p.onRetry}>Réessayer</button></div>}
        {!convs && !p.error && Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="conv skeleton"><div className="avatar sk" /><div className="sk-lines"><span /><span /></div></div>
        ))}
        {convs && convs.length === 0 && (
          <div className="empty">
            {q ? <p>Aucun résultat pour « {q} ».</p> : p.filter !== 'all' ? <p>Aucune conversation dans ce filtre.</p> : <p>Aucune veille pour l’instant.</p>}
            {!q && p.filter === 'all' && <button className="btn primary" onClick={p.onNew}>Ajouter une veille</button>}
          </div>
        )}
        {convs?.map(c => (
          <button key={c.id} className={`conv ${p.selected === c.id ? 'active' : ''} ${c.unread ? 'has-unread' : ''}`} onClick={() => p.onOpen(c.id)}>
            <Avatar name={c.name} accent={c.accent} kind={c.kind} />
            <div className="conv-main">
              <div className="conv-top">
                <span className="conv-name">{c.name}</span>
                <span className="conv-time">{c.last_message ? listStamp(c.last_message.sort_at) : ''}</span>
              </div>
              <div className="conv-bottom">
                <span className="conv-preview">{preview(c)}</span>
                <span className="conv-flags">
                  {c.failing_sources > 0 && <span title={`${c.failing_sources} source(s) en erreur`} className="flag warn"><AlertTriangle size={14} /></span>}
                  {c.muted && <BellOff size={14} className="flag" aria-label="Silencieux" />}
                  {c.pinned && <Pin size={14} className="flag" aria-label="Épinglée" />}
                  {c.unread > 0 && <span className="badge" aria-label={`${c.unread} non lus`}>{c.unread > 99 ? '99+' : c.unread}</span>}
                </span>
              </div>
              {q && c.matches && c.matches.length > 0 && (
                <ul className="matches">
                  {c.matches.map(m => <li key={m.id}>{highlight(m.title ?? m.body ?? '', q)}</li>)}
                </ul>
              )}
            </div>
          </button>
        ))}
      </nav>
    </aside>
  );
}
