import { useState } from 'react';
import { X, RefreshCw, Trash2, CheckCircle2, AlertTriangle, Clock, Pin, BellOff, Bell } from 'lucide-react';
import { api } from '../lib/api';
import type { ConversationDetail } from '../lib/types';
import { relative, fullDate } from '../lib/format';
import SourceForm from './SourceForm';

export default function InfoPanel({ detail, onClose, reload, toast, onDeleted }: { detail: ConversationDetail; onClose: () => void; reload: () => void; toast: (t: any) => void; onDeleted: () => void }) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<any>, ok?: (r: any) => string) => {
    setBusy(key);
    try { const r = await fn(); if (ok) toast({ title: ok(r), body: '', tone: 'info' }); reload(); }
    catch (e: any) { toast({ title: 'Erreur', body: e.message, tone: 'error' }); }
    finally { setBusy(null); }
  };
  return (
    <aside className="side-panel" aria-label="Sources et réglages">
      <header><h2>{detail.name}</h2><button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header>
      <div className="panel-body">
        {detail.description && <p className="muted">{detail.description}</p>}
        <p className="small muted">{detail.kind === 'company' ? 'Entreprise' : 'Thème'} · {detail.counts.news} actualité(s) · {detail.counts.jobs} offre(s) ouvertes</p>
        <div className="row-btns">
          <button className="btn" onClick={() => run('mute', () => api.patchConversation(detail.id, { muted: !detail.muted }))}>{detail.muted ? <><Bell size={14} /> Réactiver</> : <><BellOff size={14} /> Silencieux</>}</button>
          <button className="btn" onClick={() => run('pin', () => api.patchConversation(detail.id, { pinned: !detail.pinned }))}><Pin size={14} /> {detail.pinned ? 'Désépingler' : 'Épingler'}</button>
        </div>

        <h3>Sources</h3>
        {detail.sources.length === 0 && <p className="muted">Aucune source.</p>}
        <ul className="sources">
          {detail.sources.map(s => (
            <li key={s.id} className={s.enabled ? '' : 'off'}>
              <div className="src-top">
                <span className={`src-state ${s.last_error ? 'ko' : s.last_success_at ? 'ok' : 'wait'}`}>
                  {s.last_error ? <AlertTriangle size={14} /> : s.last_success_at ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                </span>
                <span className="src-label">{s.label}</span>
                <span className="tag">{s.category === 'jobs' ? 'Emplois' : 'Actualités'}</span>
              </div>
              <div className="src-info">
                {s.last_error ? <span className="err">Dernière tentative {relative(s.last_fetched_at)} : {s.last_error}</span>
                  : s.last_success_at ? <span title={fullDate(s.last_success_at)}>OK {relative(s.last_success_at)} · {s.last_item_count ?? 0} élément(s) lus</span>
                  : <span>En attente de la première collecte</span>}
                <span> · toutes les {s.interval_minutes} min</span>
              </div>
              {typeof s.config.url === 'string' && <a className="src-link" href={s.config.url} target="_blank" rel="noopener noreferrer">{s.config.url}</a>}
              <div className="card-actions">
                <button className="btn action" disabled={busy === s.id} onClick={() => run(s.id, () => api.refreshSource(s.id), r => r.ok ? `${r.inserted ?? 0} nouveauté(s)` : `Échec : ${r.error}`)}><RefreshCw size={13} className={busy === s.id ? 'spin' : ''} /> Collecter</button>
                <button className="btn action" onClick={() => run('t' + s.id, () => api.patchSource(s.id, { enabled: !s.enabled }))}>{s.enabled ? 'Désactiver' : 'Activer'}</button>
                <button className="btn action ghost danger" onClick={() => { if (confirm('Retirer cette source ? Les messages déjà reçus sont conservés.')) run('d' + s.id, () => api.deleteSource(s.id)); }}><Trash2 size={13} /></button>
              </div>
            </li>
          ))}
        </ul>
        {adding
          ? <SourceForm defaultQuery={detail.name} busy={busy === 'add'} submitLabel="Ajouter et collecter"
              onSubmit={s => run('add', () => api.addSource(detail.id, s), r => { setAdding(false); return r.firstFetch.ok ? `Source ajoutée : ${r.firstFetch.inserted ?? 0} élément(s)` : `Source ajoutée, mais la collecte a échoué : ${r.firstFetch.error}`; })} />
          : <button className="btn" onClick={() => setAdding(true)}>+ Ajouter une source</button>}

        <h3 className="danger-h">Zone sensible</h3>
        <button className="btn danger" onClick={() => { if (confirm(`Supprimer la veille « ${detail.name} » et tous ses messages ?`)) api.deleteConversation(detail.id).then(onDeleted).catch(e => toast({ title: 'Erreur', body: e.message, tone: 'error' })); }}>Supprimer cette veille</button>
      </div>
    </aside>
  );
}
