import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';
import { bus, type AppEvent } from '../services/events.js';
import { ConversationInput, SourceInput, addSource, createConversation } from '../services/conversations.js';
import { collectConversation, collectSource } from '../services/collector.js';
import { handleUserText, resolveAssistantAction, updateReminder, cancelReminder, completeReminder, snoozeReminder, ReminderPatch, UserError, remindersConversationId } from '../services/reminders.js';
import { getPreferences, savePreferences } from '../services/preferences.js';
import { saveSubscription, removeSubscription, vapidPublicKey, sendPushToAll } from '../services/push.js';
import { openaiConfigured } from '../services/openaiInterpreter.js';
import { clearDemoContent } from '../db/bootstrap.js';
import { connectors } from '../connectors/index.js';

export const api = Router();

const uuid = z.uuid();
const id = (req: Request, name = 'id') => {
  const r = uuid.safeParse(req.params[name]);
  if (!r.success) throw new UserError('Identifiant invalide');
  return r.data;
};

/* ------------------------------- Authentification optionnelle ------------------------------- */
api.use((req, res, next) => {
  if (!config.appToken) return next();
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : typeof req.query.token === 'string' ? req.query.token : '';
  if (token === config.appToken) return next();
  res.status(401).json({ error: 'Jeton requis' });
});

/* ----------------------------------------- État ----------------------------------------- */
api.get('/status', async (_req, res) => {
  const s = await query(`SELECT count(*) FILTER (WHERE enabled)::int AS sources, count(*) FILTER (WHERE enabled AND last_error IS NOT NULL)::int AS failing,
     count(*) FILTER (WHERE enabled AND last_success_at IS NOT NULL)::int AS healthy FROM sources`);
  const demo = await query(`SELECT count(*)::int AS n FROM messages WHERE is_demo`);
  const subs = await query(`SELECT count(*)::int AS n FROM push_subscriptions`);
  res.json({
    openai: openaiConfigured(), openaiModel: config.openaiModel,
    demoMode: config.demoMode, demoMessages: demo.rows[0].n,
    sources: s.rows[0], pushSubscriptions: subs.rows[0].n, timezone: (await getPreferences()).timezone,
    scheduler: config.schedulerEnabled,
  });
});

/* ------------------------------------- Conversations ------------------------------------- */
const MSG_PREVIEW = `
  SELECT m.id, m.kind, m.title, m.body, m.sort_at, m.is_demo, m.job_location FROM messages m
  WHERE m.conversation_id = c.id ORDER BY m.sort_at DESC, m.id DESC LIMIT 1`;

api.get('/conversations', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const filter = z.enum(['all', 'unread', 'news', 'jobs']).catch('all').parse(req.query.filter);
  const like = `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;
  const r = await query(`
    SELECT c.*, row_to_json(lm) AS last_message,
      (SELECT count(*)::int FROM messages m WHERE m.conversation_id = c.id AND m.read_at IS NULL) AS unread,
      (SELECT count(*)::int FROM sources s WHERE s.conversation_id = c.id AND s.enabled AND s.last_error IS NOT NULL) AS failing_sources,
      CASE WHEN $1 <> '' THEN (
        SELECT coalesce(json_agg(x), '[]'::json) FROM (
          SELECT m.id, m.kind, m.title, m.body, m.sort_at FROM messages m
          WHERE m.conversation_id = c.id AND (f_unaccent(m.title) ILIKE f_unaccent($2) OR f_unaccent(m.body) ILIKE f_unaccent($2) OR f_unaccent(m.job_location) ILIKE f_unaccent($2))
          ORDER BY m.sort_at DESC LIMIT 3) x)
      END AS matches
    FROM conversations c
    LEFT JOIN LATERAL (${MSG_PREVIEW}) lm ON true
    WHERE ($1 = '' OR f_unaccent(c.name) ILIKE f_unaccent($2) OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND (f_unaccent(m.title) ILIKE f_unaccent($2) OR f_unaccent(m.body) ILIKE f_unaccent($2) OR f_unaccent(m.job_location) ILIKE f_unaccent($2))))
      AND ($3 <> 'unread' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.read_at IS NULL))
      AND ($3 <> 'news' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'news'))
      AND ($3 <> 'jobs' OR EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.kind = 'job'))
    ORDER BY c.pinned DESC, coalesce(lm.sort_at, c.created_at) DESC`, [q, like, filter]);
  res.json(r.rows);
});

api.get('/conversations/:id', async (req, res) => {
  const cid = id(req);
  const c = await query(`SELECT * FROM conversations WHERE id = $1`, [cid]);
  if (!c.rows[0]) return res.status(404).json({ error: 'Conversation introuvable' });
  const s = await query(`SELECT id, type, category, label, config, enabled, is_demo, interval_minutes, last_fetched_at, last_success_at, last_error, last_item_count FROM sources WHERE conversation_id = $1 ORDER BY created_at`, [cid]);
  const counts = await query(`SELECT count(*) FILTER (WHERE kind='news')::int AS news, count(*) FILTER (WHERE kind='job' AND closed_at IS NULL)::int AS jobs, count(*) FILTER (WHERE is_demo)::int AS demo FROM messages WHERE conversation_id = $1`, [cid]);
  res.json({ ...c.rows[0], sources: s.rows, counts: counts.rows[0] });
});

api.post('/conversations', async (req, res) => {
  const conv = await createConversation(ConversationInput.parse(req.body));
  collectConversation(conv.id).catch(() => {}); // première collecte en arrière-plan
  res.status(201).json(conv);
});

api.patch('/conversations/:id', async (req, res) => {
  const body = z.object({ muted: z.boolean().optional(), pinned: z.boolean().optional(), name: z.string().trim().min(2).max(60).optional(), description: z.string().trim().max(300).nullable().optional() }).parse(req.body);
  const r = await query(`UPDATE conversations SET muted = coalesce($2, muted), pinned = coalesce($3, pinned), name = coalesce($4, name),
      description = CASE WHEN $6 THEN $5 ELSE description END WHERE id = $1 RETURNING *`,
    [id(req), body.muted ?? null, body.pinned ?? null, body.name ?? null, body.description ?? null, body.description !== undefined]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Conversation introuvable' });
  bus.publish({ type: 'conversations:changed' });
  res.json(r.rows[0]);
});

api.delete('/conversations/:id', async (req, res) => {
  const r = await query(`DELETE FROM conversations WHERE id = $1 AND kind <> 'reminders'`, [id(req)]);
  if (!r.rowCount) throw new UserError('Suppression impossible');
  bus.publish({ type: 'conversations:changed' });
  res.status(204).end();
});

api.post('/conversations/:id/read', async (req, res) => {
  const cid = id(req);
  const r = await query(`UPDATE messages SET read_at = now() WHERE conversation_id = $1 AND read_at IS NULL`, [cid]);
  if (r.rowCount) bus.publish({ type: 'conversation:updated', conversationId: cid });
  res.json({ marked: r.rowCount });
});

api.post('/conversations/:id/refresh', async (req, res) => {
  res.json(await collectConversation(id(req)));
});

api.get('/conversations/:id/messages', async (req, res) => {
  const cid = id(req);
  const Q = z.object({
    filter: z.enum(['all', 'news', 'jobs', 'unread']).catch('all'),
    before: z.string().optional(),
    since: z.iso.datetime({ offset: true }).optional().catch(undefined),
    limit: z.coerce.number().int().min(1).max(100).catch(40),
  }).parse(req.query);
  let beforeAt: string | null = null, beforeId: string | null = null;
  if (Q.before) {
    const [a, b] = Q.before.split('|');
    if (!z.iso.datetime({ offset: true }).safeParse(a).success || !uuid.safeParse(b).success) throw new UserError('Curseur invalide');
    beforeAt = a; beforeId = b;
  }
  const r = await query(`
    SELECT m.*, s.label AS source_label, s.type AS source_type,
      CASE WHEN r.id IS NULL THEN NULL ELSE json_build_object('id', r.id, 'text', r.text, 'due_at', r.due_at, 'timezone', r.timezone, 'recurrence', r.recurrence,
        'status', r.status, 'interpreter', r.interpreter, 'fire_count', r.fire_count, 'related_conversation_id', r.related_conversation_id,
        'related_conversation_name', rc.name) END AS reminder
    FROM messages m
    LEFT JOIN sources s ON s.id = m.source_id
    LEFT JOIN reminders r ON r.id = m.reminder_id
    LEFT JOIN conversations rc ON rc.id = r.related_conversation_id
    WHERE m.conversation_id = $1
      AND ($2 = 'all' OR ($2 = 'news' AND m.kind = 'news') OR ($2 = 'jobs' AND m.kind = 'job')
           OR ($2 = 'unread' AND (m.read_at IS NULL OR ($3::timestamptz IS NOT NULL AND m.read_at >= $3::timestamptz))))
      AND ($4::timestamptz IS NULL OR (m.sort_at, m.id) < ($4::timestamptz, $5::uuid))
    ORDER BY m.sort_at DESC, m.id DESC
    LIMIT $6`, [cid, Q.filter, Q.since ?? null, beforeAt, beforeId, Q.limit + 1]);
  const rows = r.rows.slice(0, Q.limit);
  const last = rows[rows.length - 1];
  res.json({
    messages: rows.reverse(),
    nextCursor: r.rows.length > Q.limit && last ? `${new Date(last.sort_at).toISOString()}|${last.id}` : null,
  });
});

/* ----------------------------------------- Sources ----------------------------------------- */
api.get('/source-types', (_req, res) => {
  res.json(Object.values(connectors).map(c => ({ type: c.type, category: c.category })));
});

api.post('/conversations/:id/sources', async (req, res) => {
  const cid = id(req);
  const src = await addSource(cid, SourceInput.parse(req.body));
  const result = await collectSource(src);
  bus.publish({ type: 'conversation:updated', conversationId: cid });
  res.status(201).json({ source: src, firstFetch: result });
});

api.patch('/sources/:id', async (req, res) => {
  const b = z.object({ enabled: z.boolean().optional(), interval_minutes: z.number().int().min(5).max(1440).optional() }).parse(req.body);
  const r = await query(`UPDATE sources SET enabled = coalesce($2, enabled), interval_minutes = coalesce($3, interval_minutes) WHERE id = $1 RETURNING conversation_id`, [id(req), b.enabled ?? null, b.interval_minutes ?? null]);
  if (!r.rows[0]) return res.status(404).json({ error: 'Source introuvable' });
  bus.publish({ type: 'conversation:updated', conversationId: r.rows[0].conversation_id });
  res.json({ ok: true });
});

api.delete('/sources/:id', async (req, res) => {
  const r = await query(`DELETE FROM sources WHERE id = $1 RETURNING conversation_id`, [id(req)]);
  if (r.rows[0]) bus.publish({ type: 'conversation:updated', conversationId: r.rows[0].conversation_id });
  res.status(204).end();
});

api.post('/sources/:id/refresh', async (req, res) => {
  const s = await query(`SELECT * FROM sources WHERE id = $1`, [id(req)]);
  if (!s.rows[0]) return res.status(404).json({ error: 'Source introuvable' });
  res.json(await collectSource(s.rows[0]));
});

/* ----------------------------------------- Rappels ----------------------------------------- */
api.post('/reminders/messages', async (req, res) => {
  const { text } = z.object({ text: z.string().min(1).max(1000) }).parse(req.body);
  await handleUserText(text);
  res.status(201).json({ ok: true, conversationId: await remindersConversationId() });
});

api.post('/assistant/:id/:decision', async (req, res) => {
  const decision = z.enum(['confirm', 'cancel']).parse(req.params.decision);
  res.json(await resolveAssistantAction(id(req), decision));
});

api.get('/reminders', async (req, res) => {
  const status = z.enum(['active', 'all']).catch('active').parse(req.query.status);
  const r = await query(`SELECT * FROM reminders WHERE ($1 = 'all' OR status = 'scheduled') AND status <> 'draft' ORDER BY due_at LIMIT 200`, [status]);
  res.json(r.rows);
});

api.patch('/reminders/:id', async (req, res) => res.json(await updateReminder(id(req), ReminderPatch.parse(req.body))));
api.delete('/reminders/:id', async (req, res) => res.json(await cancelReminder(id(req))));
api.post('/reminders/:id/done', async (req, res) => res.json(await completeReminder(id(req))));
api.post('/reminders/:id/snooze', async (req, res) => {
  const { minutes } = z.object({ minutes: z.number().int() }).parse(req.body);
  res.json(await snoozeReminder(id(req), minutes));
});

/* --------------------------------------- Préférences --------------------------------------- */
api.get('/preferences', async (_req, res) => res.json(await getPreferences()));
api.put('/preferences', async (req, res) => res.json(await savePreferences(req.body)));
api.post('/demo/clear', async (_req, res) => res.json({ deleted: await clearDemoContent() }));

/* --------------------------------------- Notifications --------------------------------------- */
api.get('/push/public-key', (_req, res) => res.json({ publicKey: vapidPublicKey() }));
api.post('/push/subscribe', async (req, res) => {
  const sub = z.object({ endpoint: z.url().refine(u => u.startsWith('https://'), 'Endpoint HTTPS requis'), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) }).parse(req.body);
  await saveSubscription(sub, req.headers['user-agent']);
  res.status(201).json({ ok: true });
});
api.post('/push/unsubscribe', async (req, res) => {
  const { endpoint } = z.object({ endpoint: z.string().max(2048) }).parse(req.body);
  await removeSubscription(endpoint);
  res.json({ ok: true });
});
api.post('/push/test', async (_req, res) => {
  const r = await sendPushToAll({ title: 'Vigie', body: 'Notification de test : tout fonctionne.' });
  bus.publish({ type: 'notify', category: 'reminders', title: 'Vigie', body: 'Notification de test : tout fonctionne.' });
  res.json(r);
});

/* ------------------------------------ Temps réel (SSE) ------------------------------------ */
api.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`retry: 3000\n\n`);
  const send = (e: AppEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  bus.on('event', send);
  req.on('close', () => { clearInterval(ping); bus.off('event', send); });
});

/* ----------------------------------------- Erreurs ----------------------------------------- */
export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) return res.status(400).json({ error: 'Données invalides', details: err.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide' });
  console.error(err);
  res.status(500).json({ error: 'Erreur interne' });
}
