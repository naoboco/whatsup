import { useState } from 'react';
import { Check, X, Pencil, Trash2, Clock, Repeat, Sparkles, Cpu, ArrowUpRight, AlarmClock } from 'lucide-react';
import type { Message, ReminderInfo, Recurrence } from '../lib/types';
import { api } from '../lib/api';
import { fullDate, time, localParts, RECURRENCE } from '../lib/format';

type ToastFn = (t: { title: string; body: string; tone: 'info' | 'error' | 'reminder' }) => void;

function InterpreterBadge({ m }: { m: Message }) {
  const i = m.payload?.interpreter;
  if (!i) return null;
  return i === 'openai'
    ? <span className="tag ai"><Sparkles size={11} /> Interprété par OpenAI</span>
    : <span className="tag local" title={m.payload?.fallbackReason ? `OpenAI indisponible : ${m.payload.fallbackReason}` : 'Aucune clé OpenAI configurée'}><Cpu size={11} /> Analyseur local{m.payload?.fallbackReason ? ' (repli)' : ''}</span>;
}

export function ReminderEditor({ r, onDone, onCancel, toast }: { r: ReminderInfo; onDone: () => void; onCancel: () => void; toast: ToastFn }) {
  const init = localParts(r.due_at);
  const [text, setText] = useState(r.text);
  const [date, setDate] = useState(init.date);
  const [hm, setHm] = useState(init.time);
  const [rec, setRec] = useState<Recurrence>(r.recurrence);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api.patchReminder(r.id, { text, due_local: `${date}T${hm}`, recurrence: rec }); onDone(); }
    catch (e: any) { toast({ title: 'Modification impossible', body: e.message, tone: 'error' }); }
    finally { setBusy(false); }
  };
  return (
    <form className="rem-editor" onSubmit={e => { e.preventDefault(); save(); }}>
      <label>Contenu<input value={text} onChange={e => setText(e.target.value)} maxLength={300} required /></label>
      <div className="row">
        <label>Date<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label>
        <label>Heure<input type="time" value={hm} onChange={e => setHm(e.target.value)} required /></label>
      </div>
      <label>Répétition
        <select value={rec} onChange={e => setRec(e.target.value as Recurrence)}>
          {Object.entries(RECURRENCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <p className="hint">Fuseau : {r.timezone}</p>
      <div className="card-actions">
        <button type="submit" className="btn action primary" disabled={busy}><Check size={14} /> Enregistrer</button>
        <button type="button" className="btn action ghost" onClick={onCancel}>Annuler</button>
      </div>
    </form>
  );
}

function ReminderSummary({ r }: { r: ReminderInfo }) {
  return (
    <div className="rem-summary">
      <div className="rem-text">{r.text}</div>
      <div className="rem-when"><Clock size={13} /> {fullDate(r.due_at)}</div>
      {r.recurrence !== 'none' && <div className="rem-when"><Repeat size={13} /> {RECURRENCE[r.recurrence]}</div>}
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { draft: 'En attente de confirmation', scheduled: 'Programmé', fired: 'Envoyé', done: 'Fait', cancelled: 'Annulé' };

export function AssistantBubble({ m, toast, onOpen }: { m: Message; toast: ToastFn; onOpen: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const type = m.payload?.type as string | undefined;
  const r = m.reminder;
  const resolved = m.payload?.resolved as 'confirm' | 'cancel' | undefined;
  const pending = !resolved && (type === 'confirm_create' || type === 'confirm_update' || type === 'confirm_delete');
  const act = async (d: 'confirm' | 'cancel') => {
    setBusy(true);
    try { await api.resolve(m.id, d); } catch (e: any) { toast({ title: 'Action impossible', body: e.message, tone: 'error' }); }
    finally { setBusy(false); }
  };

  return (
    <div className={`bubble assistant ${pending ? 'pending' : ''}`}>
      <div className="assistant-head"><span className="who">Assistant</span><InterpreterBadge m={m} /></div>
      {type === 'confirm_create' && r ? (
        <>
          <p className="assistant-q">Je programme ce rappel ?</p>
          {editing && r.status === 'draft'
            ? <ReminderEditor r={r} toast={toast} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
            : <ReminderSummary r={r} />}
          {r.related_conversation_id && r.related_conversation_name && (
            <button className="link-btn" onClick={() => onOpen(r.related_conversation_id!)}>Lié à la veille {r.related_conversation_name} <ArrowUpRight size={12} /></button>
          )}
        </>
      ) : (
        <p className="assistant-text">{m.body}</p>
      )}
      {pending && !editing && (
        <div className="card-actions">
          <button className="btn action primary" disabled={busy} onClick={() => act('confirm')}><Check size={14} /> Confirmer</button>
          {type === 'confirm_create' && r?.status === 'draft' && <button className="btn action" disabled={busy} onClick={() => setEditing(true)}><Pencil size={14} /> Modifier</button>}
          <button className="btn action ghost" disabled={busy} onClick={() => act('cancel')}><X size={14} /> Annuler</button>
        </div>
      )}
      {resolved && <div className={`resolved ${resolved}`}>{resolved === 'confirm' ? '✓ Confirmé' : 'Annulé'}</div>}
      {type === 'confirm_create' && r && resolved === 'confirm' && <div className="rem-status">État actuel : {STATUS_LABEL[r.status]}</div>}
      <div className="card-meta"><span className="stamp">{time(m.sort_at)}</span></div>
    </div>
  );
}

export function FiredReminder({ m, unread, toast, onOpen }: { m: Message; unread: boolean; toast: ToastFn; onOpen: (id: string) => void }) {
  const r = m.reminder;
  const [editing, setEditing] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast({ title: ok, body: '', tone: 'info' }); } catch (e: any) { toast({ title: 'Action impossible', body: e.message, tone: 'error' }); }
  };
  return (
    <article className={`bubble card reminder ${unread ? 'unread' : ''}`}>
      <div className="card-kind rem"><AlarmClock size={13} /> Rappel{m.payload?.late && <span className="tag">envoyé en retard</span>}</div>
      <h3>{m.body}</h3>
      {m.payload?.scheduledFor && <p className="rem-when">Prévu pour {fullDate(m.payload.scheduledFor)}</p>}
      {r && r.recurrence !== 'none' && r.status === 'scheduled' && <p className="rem-when"><Repeat size={13} /> Prochaine occurrence : {fullDate(r.due_at)}</p>}
      {r?.related_conversation_id && r.related_conversation_name && (
        <button className="link-btn" onClick={() => onOpen(r.related_conversation_id!)}>Ouvrir la veille {r.related_conversation_name} <ArrowUpRight size={12} /></button>
      )}
      {r && editing && <ReminderEditor r={r} toast={toast} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />}
      {r && !editing && r.status !== 'cancelled' && r.status !== 'done' && (
        <div className="card-actions">
          {r.recurrence === 'none' && r.status === 'fired' && <button className="btn action primary" onClick={() => run(() => api.doneReminder(r.id), 'Marqué comme fait')}><Check size={14} /> Fait</button>}
          <button className="btn action" onClick={() => run(() => api.snoozeReminder(r.id, 10), 'Reporté de 10 minutes')}>+10 min</button>
          <button className="btn action" onClick={() => run(() => api.snoozeReminder(r.id, 60), 'Reporté d’une heure')}>+1 h</button>
          <button className="btn action" onClick={() => setEditing(true)}><Pencil size={14} /> Modifier</button>
          <button className="btn action ghost danger" onClick={() => { if (confirm('Supprimer ce rappel ?')) run(() => api.deleteReminder(r.id), 'Rappel supprimé'); }}><Trash2 size={14} /></button>
        </div>
      )}
      {r && (r.status === 'done' || r.status === 'cancelled') && <div className="rem-status">{STATUS_LABEL[r.status]}</div>}
      <div className="card-meta"><span className="stamp">{time(m.sort_at)}</span></div>
    </article>
  );
}
