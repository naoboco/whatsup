import { useCallback, useEffect, useState } from 'react';
import { X, Pencil, Trash2, Repeat, Clock } from 'lucide-react';
import { api } from '../lib/api';
import type { ReminderRow } from '../lib/types';
import { onServerEvent } from '../lib/bus';
import { fullDate, RECURRENCE } from '../lib/format';
import { ReminderEditor } from './ReminderCards';
import { Spinner } from './ui';

export default function RemindersPanel({ onClose, toast }: { onClose: () => void; toast: (t: any) => void }) {
  const [rows, setRows] = useState<ReminderRow[] | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const load = useCallback(() => api.reminders('active').then(setRows).catch(e => toast({ title: 'Erreur', body: e.message, tone: 'error' })), [toast]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => onServerEvent(e => { if (e.type === 'reminder:updated') load(); }), [load]);
  return (
    <aside className="side-panel" aria-label="Rappels programmés">
      <header><h2>Rappels programmés</h2><button className="icon-btn" onClick={onClose} aria-label="Fermer"><X size={18} /></button></header>
      <div className="panel-body">
        {!rows && <Spinner />}
        {rows?.length === 0 && <p className="muted">Aucun rappel programmé. Écrivez une demande dans la conversation.</p>}
        {rows?.map(r => (
          <div key={r.id} className="rem-row">
            {edit === r.id
              ? <ReminderEditor r={{ ...r, status: 'scheduled', interpreter: 'manual', related_conversation_id: null, related_conversation_name: null } as any} toast={toast} onCancel={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />
              : <>
                  <div className="rem-text">{r.text}</div>
                  <div className="rem-when"><Clock size={12} /> {fullDate(r.due_at)}</div>
                  {r.recurrence !== 'none' && <div className="rem-when"><Repeat size={12} /> {RECURRENCE[r.recurrence]}</div>}
                  <div className="card-actions">
                    <button className="btn action" onClick={() => setEdit(r.id)}><Pencil size={13} /> Modifier</button>
                    <button className="btn action ghost danger" onClick={async () => { if (!confirm('Supprimer ce rappel ?')) return; try { await api.deleteReminder(r.id); load(); } catch (e: any) { toast({ title: 'Erreur', body: e.message, tone: 'error' }); } }}><Trash2 size={13} /> Supprimer</button>
                  </div>
                </>}
          </div>
        ))}
      </div>
    </aside>
  );
}
