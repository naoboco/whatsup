import { DateTime } from 'luxon';
import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { bus } from './events.js';
import { notify } from './push.js';
import { getPreferences } from './preferences.js';
import { parseFrenchReminder, nextOccurrence, formatDueFr, RECURRENCE_LABEL, type Recurrence } from './frenchParser.js';
import { interpretWithOpenAI, OpenAIUnavailable, openaiConfigured, type Interpretation } from './openaiInterpreter.js';

export class UserError extends Error { status = 400; }

let remindersConvId: string | null = null;
export async function remindersConversationId(): Promise<string> {
  if (remindersConvId) return remindersConvId;
  const r = await query<{ id: string }>(`SELECT id FROM conversations WHERE kind = 'reminders' LIMIT 1`);
  if (!r.rows[0]) throw new Error('Conversation « Rappels » absente');
  return (remindersConvId = r.rows[0].id);
}

export interface ReminderRow {
  id: string; text: string; due_at: Date; timezone: string; recurrence: Recurrence; status: string;
  original_request: string | null; interpreter: string; related_conversation_id: string | null;
  fire_count: number; last_fired_at: Date | null; created_at: Date; updated_at: Date;
}

async function tz() { return (await getPreferences()).timezone; }

async function postMessage(kind: 'user' | 'assistant' | 'reminder' | 'system', body: string, opts: { reminderId?: string; payload?: object; read?: boolean } = {}) {
  const convId = await remindersConversationId();
  const r = await query<{ id: string }>(
    `INSERT INTO messages (conversation_id, kind, body, reminder_id, payload, read_at) VALUES ($1,$2,$3,$4,$5, CASE WHEN $6 THEN now() END) RETURNING id`,
    [convId, kind, body, opts.reminderId ?? null, JSON.stringify(opts.payload ?? {}), opts.read ?? true],
  );
  bus.publish({ type: 'message:new', conversationId: convId, messageId: r.rows[0].id });
  bus.publish({ type: 'conversation:updated', conversationId: convId });
  return r.rows[0].id;
}

async function relatedConversation(text: string): Promise<string | null> {
  const r = await query<{ id: string; name: string }>(`SELECT id, name FROM conversations WHERE kind <> 'reminders'`);
  const lower = text.toLowerCase();
  return r.rows.find(c => c.name.length >= 3 && lower.includes(c.name.toLowerCase()))?.id ?? null;
}

function describe(r: { text: string; due_at: Date; recurrence: Recurrence; timezone: string }) {
  const d = DateTime.fromJSDate(r.due_at).setZone(r.timezone);
  const rep = r.recurrence === 'none' ? '' : ` (répétition : ${RECURRENCE_LABEL[r.recurrence]})`;
  return `« ${r.text} » — ${formatDueFr(d)}${rep}`;
}

async function activeReminders() {
  return (await query<ReminderRow>(`SELECT * FROM reminders WHERE status = 'scheduled' ORDER BY due_at LIMIT 50`)).rows;
}

/** Convertit « YYYY-MM-DDTHH:mm » (heure locale) en instant, en refusant le passé. */
export function localToInstant(local: string, zone: string, now: DateTime = DateTime.now()): DateTime {
  const d = DateTime.fromISO(local, { zone });
  if (!d.isValid) throw new UserError('Date ou heure invalide');
  if (d <= now.minus({ seconds: 30 })) throw new UserError('Cette échéance est déjà passée');
  if (d > now.plus({ years: 5 })) throw new UserError('Échéance trop lointaine (5 ans maximum)');
  return d;
}

/**
 * Traite un message écrit dans la conversation « Rappels » : enregistre le message de l'utilisateur,
 * l'interprète (OpenAI si configuré, sinon analyseur local) et répond par une carte à confirmer.
 * Rien n'est planifié avant confirmation explicite.
 */
export async function handleUserText(input: string) {
  const text = input.trim();
  if (!text) throw new UserError('Message vide');
  if (text.length > 1000) throw new UserError('Message trop long (1000 caractères max.)');
  await postMessage('user', text);

  const zone = await tz();
  const now = DateTime.now().setZone(zone);
  const active = await activeReminders();
  let interp: Interpretation | null = null;
  let interpreter: 'openai' | 'local' = 'local';
  let fallbackReason: string | null = null;

  if (openaiConfigured()) {
    try {
      const convs = (await query<{ name: string }>(`SELECT name FROM conversations WHERE kind <> 'reminders'`)).rows.map(r => r.name);
      interp = await interpretWithOpenAI(text, {
        now,
        conversations: convs,
        reminders: active.map(r => ({ id: r.id, text: r.text, due_local: DateTime.fromJSDate(r.due_at).setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm"), recurrence: r.recurrence })),
      });
      interpreter = 'openai';
    } catch (e) {
      fallbackReason = e instanceof OpenAIUnavailable ? e.message : 'erreur inattendue';
      console.warn('[rappels] OpenAI indisponible, analyseur local :', fallbackReason);
    }
  }

  if (!interp) {
    // Analyseur local : création uniquement ; « liste » reconnue par mot-clé.
    if (/^\s*(liste|mes rappels|quels (sont mes )?rappels|affiche (mes )?rappels)/i.test(text)) {
      interp = { intent: 'list', text: null, due_local: null, recurrence: 'none', target_reminder_id: null, question: null };
    } else {
      const p = parseFrenchReminder(text, now);
      if (p.missing.length) {
        const q = p.missing.includes('date') && p.missing.includes('text')
          ? 'Je n’ai compris ni quoi, ni quand. Essayez par exemple : « Rappelle-moi de postuler chez Mobileye demain à 18 h ».'
          : p.missing.includes('date')
            ? `Quand dois-je vous rappeler « ${p.text} » ? Précisez un jour et/ou une heure (ex. « demain à 18 h »).`
            : 'De quoi dois-je vous rappeler ? Précisez le contenu (ex. « de postuler chez Mobileye »).';
        interp = { intent: 'clarify', text: p.text || null, due_local: null, recurrence: p.recurrence, target_reminder_id: null, question: q };
      } else {
        interp = { intent: 'create', text: p.text, due_local: p.due!.toFormat("yyyy-LL-dd'T'HH:mm"), recurrence: p.recurrence, target_reminder_id: null, question: null };
      }
    }
  }

  const meta = { interpreter, fallbackReason };

  switch (interp.intent) {
    case 'list': {
      const lines = active.map((r, i) => `${i + 1}. ${describe(r)}`);
      return postMessage('assistant', lines.length ? `Rappels programmés :\n${lines.join('\n')}` : 'Aucun rappel programmé.', { payload: { type: 'list', ...meta } });
    }
    case 'clarify':
      return postMessage('assistant', interp.question ?? 'Pouvez-vous préciser votre demande ?', { payload: { type: 'clarify', ...meta } });
    case 'create': {
      if (!interp.text || !interp.due_local) return postMessage('assistant', 'Il me manque le contenu ou l’échéance du rappel.', { payload: { type: 'clarify', ...meta } });
      let due: DateTime;
      try { due = localToInstant(interp.due_local, zone, now); }
      catch (e: any) { return postMessage('assistant', `${e.message}. Pouvez-vous indiquer une autre date ?`, { payload: { type: 'clarify', ...meta } }); }
      const related = await relatedConversation(`${interp.text} ${text}`);
      const r = await query<ReminderRow>(
        `INSERT INTO reminders (text, due_at, timezone, recurrence, status, original_request, interpreter, related_conversation_id)
         VALUES ($1,$2,$3,$4,'draft',$5,$6,$7) RETURNING *`,
        [interp.text.slice(0, 300), due.toJSDate(), zone, interp.recurrence, text, interpreter, related],
      );
      return postMessage('assistant', `Je programme ce rappel ? ${describe(r.rows[0])}`, { reminderId: r.rows[0].id, payload: { type: 'confirm_create', ...meta } });
    }
    case 'update':
    case 'delete': {
      const target = active.find(r => r.id === interp!.target_reminder_id);
      if (!target) return postMessage('assistant', 'Je n’ai pas identifié de quel rappel il s’agit. Utilisez les boutons « Modifier » ou « Supprimer » sur la carte du rappel.', { payload: { type: 'clarify', ...meta } });
      if (interp.intent === 'delete') {
        return postMessage('assistant', `Je supprime ce rappel ? ${describe(target)}`, { reminderId: target.id, payload: { type: 'confirm_delete', ...meta } });
      }
      const changes = {
        text: interp.text?.slice(0, 300) || target.text,
        due_local: interp.due_local || DateTime.fromJSDate(target.due_at).setZone(zone).toFormat("yyyy-LL-dd'T'HH:mm"),
        recurrence: interp.recurrence,
      };
      let due: DateTime;
      try { due = localToInstant(changes.due_local, zone, now); }
      catch (e: any) { return postMessage('assistant', `${e.message}. Pouvez-vous indiquer une autre date ?`, { payload: { type: 'clarify', ...meta } }); }
      return postMessage('assistant', `Je modifie ce rappel ? Avant : ${describe(target)}\nAprès : ${describe({ text: changes.text, due_at: due.toJSDate(), recurrence: changes.recurrence, timezone: zone })}`,
        { reminderId: target.id, payload: { type: 'confirm_update', changes, ...meta } });
    }
  }
}

/** Réponse de l'utilisateur à une carte de confirmation. */
export async function resolveAssistantAction(messageId: string, decision: 'confirm' | 'cancel') {
  return tx(async c => {
    const m = await c.query<{ id: string; conversation_id: string; payload: any; reminder_id: string | null }>(
      `SELECT id, conversation_id, payload, reminder_id FROM messages WHERE id = $1 AND kind = 'assistant' FOR UPDATE`, [messageId]);
    const msg = m.rows[0];
    if (!msg) throw new UserError('Message introuvable');
    const type = msg.payload?.type;
    if (!['confirm_create', 'confirm_update', 'confirm_delete'].includes(type)) throw new UserError('Rien à confirmer ici');
    if (msg.payload.resolved) throw new UserError('Déjà traité');
    const rem = (await c.query<ReminderRow>(`SELECT * FROM reminders WHERE id = $1 FOR UPDATE`, [msg.reminder_id])).rows[0];
    if (!rem) throw new UserError('Rappel introuvable');

    let reply = '';
    if (decision === 'cancel') {
      if (type === 'confirm_create') await c.query(`UPDATE reminders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [rem.id]);
      reply = 'Entendu, rien n’a été modifié.';
    } else if (type === 'confirm_create') {
      if (rem.status !== 'draft') throw new UserError('Ce rappel n’est plus en attente');
      if (rem.due_at.getTime() <= Date.now()) throw new UserError('L’échéance est passée entre-temps : reformulez la demande');
      await c.query(`UPDATE reminders SET status = 'scheduled', updated_at = now() WHERE id = $1`, [rem.id]);
      reply = `C’est programmé. ${describe(rem)}`;
    } else if (type === 'confirm_update') {
      if (rem.status !== 'scheduled') throw new UserError('Ce rappel n’est plus actif');
      const ch = msg.payload.changes;
      const due = localToInstant(ch.due_local, rem.timezone);
      await c.query(`UPDATE reminders SET text = $2, due_at = $3, recurrence = $4, updated_at = now() WHERE id = $1`, [rem.id, ch.text, due.toJSDate(), ch.recurrence]);
      reply = `Rappel modifié. ${describe({ ...rem, text: ch.text, due_at: due.toJSDate(), recurrence: ch.recurrence })}`;
    } else {
      await c.query(`UPDATE reminders SET status = 'cancelled', updated_at = now() WHERE id = $1`, [rem.id]);
      reply = `Rappel supprimé : « ${rem.text} ».`;
    }
    await c.query(`UPDATE messages SET payload = payload || jsonb_build_object('resolved', $2::text), updated_at = now() WHERE id = $1`, [msg.id, decision]);
    return { reply, reminderId: rem.id, conversationId: msg.conversation_id };
  }).then(async r => {
    bus.publish({ type: 'message:updated', conversationId: r.conversationId, messageId });
    bus.publish({ type: 'reminder:updated', reminderId: r.reminderId });
    await postMessage('assistant', r.reply, { reminderId: r.reminderId, payload: { type: 'info' } });
    return r;
  });
}

export const ReminderPatch = z.object({
  text: z.string().trim().min(1).max(300).optional(),
  due_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
  recurrence: z.enum(['none', 'daily', 'weekdays', 'weekly', 'monthly']).optional(),
});

/** Modification directe depuis le formulaire de la carte (l'action du formulaire vaut confirmation). */
export async function updateReminder(id: string, patch: z.infer<typeof ReminderPatch>) {
  const rem = (await query<ReminderRow>(`SELECT * FROM reminders WHERE id = $1`, [id])).rows[0];
  if (!rem) throw new UserError('Rappel introuvable');
  if (!['scheduled', 'fired', 'draft'].includes(rem.status)) throw new UserError('Ce rappel est clos');
  const due = patch.due_local ? localToInstant(patch.due_local, rem.timezone) : DateTime.fromJSDate(rem.due_at);
  if (!patch.due_local && rem.status === 'fired' && due <= DateTime.now()) throw new UserError('Choisissez une nouvelle échéance');
  const status = rem.status === 'fired' ? 'scheduled' : rem.status;
  const r = await query<ReminderRow>(
    `UPDATE reminders SET text = $2, due_at = $3, recurrence = $4, status = $5, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, patch.text ?? rem.text, due.toJSDate(), patch.recurrence ?? rem.recurrence, status],
  );
  bus.publish({ type: 'reminder:updated', reminderId: id });
  if (rem.status !== 'draft') await postMessage('assistant', `Rappel modifié. ${describe(r.rows[0])}`, { reminderId: id, payload: { type: 'info' } });
  return r.rows[0];
}

export async function cancelReminder(id: string) {
  const r = await query<ReminderRow>(`UPDATE reminders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status IN ('draft','scheduled','fired') RETURNING *`, [id]);
  if (!r.rows[0]) throw new UserError('Rappel introuvable ou déjà clos');
  bus.publish({ type: 'reminder:updated', reminderId: id });
  await postMessage('assistant', `Rappel supprimé : « ${r.rows[0].text} ».`, { reminderId: id, payload: { type: 'info' } });
  return r.rows[0];
}

export async function completeReminder(id: string) {
  const r = await query<ReminderRow>(`UPDATE reminders SET status = 'done', updated_at = now() WHERE id = $1 AND status IN ('fired','scheduled') AND recurrence = 'none' RETURNING *`, [id]);
  if (!r.rows[0]) throw new UserError('Impossible de marquer ce rappel comme fait');
  bus.publish({ type: 'reminder:updated', reminderId: id });
  return r.rows[0];
}

export async function snoozeReminder(id: string, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) throw new UserError('Durée de report invalide');
  const rem = (await query<ReminderRow>(`SELECT * FROM reminders WHERE id = $1`, [id])).rows[0];
  if (!rem || rem.status === 'cancelled') throw new UserError('Rappel introuvable');
  const due = new Date(Date.now() + minutes * 60_000);
  let row: ReminderRow;
  if (rem.recurrence === 'none') {
    row = (await query<ReminderRow>(`UPDATE reminders SET status = 'scheduled', due_at = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, due])).rows[0];
  } else {
    // Rappel récurrent : on crée un rappel ponctuel, la série continue.
    row = (await query<ReminderRow>(
      `INSERT INTO reminders (text, due_at, timezone, recurrence, status, original_request, interpreter, related_conversation_id)
       VALUES ($1,$2,$3,'none','scheduled',$4,'manual',$5) RETURNING *`, [rem.text, due, rem.timezone, rem.original_request, rem.related_conversation_id])).rows[0];
  }
  bus.publish({ type: 'reminder:updated', reminderId: row.id });
  await postMessage('assistant', `Reporté. ${describe(row)}`, { reminderId: row.id, payload: { type: 'info' } });
  return row;
}

/**
 * Tâche planifiée : déclenche les rappels échus. Verrouillage SKIP LOCKED → aucun doublon,
 * même avec plusieurs instances du serveur.
 */
export async function fireDueReminders(): Promise<number> {
  const convId = await remindersConversationId();
  const fired = await tx(async c => {
    const due = await c.query<ReminderRow>(
      `SELECT * FROM reminders WHERE status = 'scheduled' AND due_at <= now() ORDER BY due_at LIMIT 25 FOR UPDATE SKIP LOCKED`);
    const out: { rem: ReminderRow; messageId: string; next: DateTime | null }[] = [];
    for (const rem of due.rows) {
      const dueLocal = DateTime.fromJSDate(rem.due_at).setZone(rem.timezone);
      const next = nextOccurrence(dueLocal, rem.recurrence, DateTime.now().setZone(rem.timezone));
      const late = Date.now() - rem.due_at.getTime() > 10 * 60_000;
      const body = rem.text;
      const msg = await c.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, kind, body, reminder_id, payload) VALUES ($1, 'reminder', $2, $3, $4) RETURNING id`,
        [convId, body, rem.id, JSON.stringify({ scheduledFor: rem.due_at.toISOString(), late, next: next?.toISO() ?? null })]);
      await c.query(
        `UPDATE reminders SET status = $2, due_at = COALESCE($3, due_at), fire_count = fire_count + 1, last_fired_at = now(), updated_at = now() WHERE id = $1`,
        [rem.id, next ? 'scheduled' : 'fired', next?.toJSDate() ?? null]);
      out.push({ rem, messageId: msg.rows[0].id, next });
    }
    return out;
  });
  for (const f of fired) {
    bus.publish({ type: 'message:new', conversationId: convId, messageId: f.messageId });
    bus.publish({ type: 'reminder:updated', reminderId: f.rem.id });
    await notify({ type: 'notify', category: 'reminders', title: '⏰ Rappel', body: f.rem.text, conversationId: convId, tag: `reminder-${f.rem.id}` });
  }
  if (fired.length) bus.publish({ type: 'conversation:updated', conversationId: convId });
  return fired.length;
}
