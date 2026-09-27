/**
 * Tests d'intégration sur une vraie base PostgreSQL (TEST_DATABASE_URL, par défaut vigie_test).
 * Réinitialise entièrement la base de test.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://vigie:vigie@localhost:5432/vigie_test';
process.env.OPENAI_API_KEY = '';
process.env.DEMO_MODE = 'auto';

const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { bootstrap, ensureDemoContent } = await import('../src/db/bootstrap.js');
const { ingest } = await import('../src/services/ingest.js');
const reminders = await import('../src/services/reminders.js');
const { initPush } = await import('../src/services/push.js');
import type { NormalizedItem } from '../src/connectors/types.js';

let mobileye: string;
const src = async (type: string) => (await query(`SELECT * FROM sources WHERE conversation_id = $1 AND type = $2`, [mobileye, type])).rows[0];
const msgs = async () => (await query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY sort_at`, [mobileye])).rows;

const job = (id: string, title: string, loc = 'Jerusalem'): NormalizedItem => ({ kind: 'job', externalId: id, url: `https://jobs.eu.lever.co/mobileye/${id}`, applyUrl: `https://jobs.eu.lever.co/mobileye/${id}/apply`, title, summary: 's', publishedAt: new Date('2026-09-01'), sourceName: 'Mobileye Careers', location: loc });
const news = (url: string, title: string, summary = 'r'): NormalizedItem => ({ kind: 'news', url, title, summary, publishedAt: new Date('2026-09-20'), sourceName: 'X' });

beforeAll(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(() => {});
  await bootstrap();
  await initPush();
  mobileye = (await query(`SELECT id FROM conversations WHERE slug = 'mobileye'`)).rows[0].id;
});
afterAll(() => pool.end());

describe('collecte, dédoublonnage, mise à jour', () => {
  it('démo étiquetée seulement quand toutes les sources réelles ont échoué', async () => {
    await ensureDemoContent();
    expect((await msgs()).filter(m => m.is_demo)).toHaveLength(0); // sources jamais essayées
    await query(`UPDATE sources SET last_fetched_at = now(), last_error = 'HTTP 403'`);
    await ensureDemoContent();
    const demo = (await msgs()).filter(m => m.is_demo);
    expect(demo.length).toBe(5);
    expect(demo.every(m => m.url === null)).toBe(true);
  });

  it('première collecte = import silencieux (lu), message système, démo effacée', async () => {
    const lever = await src('lever');
    const r = await ingest(lever, [job('a1', 'Algo Dev'), job('a2', 'Full Stack Dev')]);
    expect(r.baseline).toBe(true);
    expect(r.inserted).toHaveLength(2);
    const all = await msgs();
    expect(all.filter(m => m.is_demo)).toHaveLength(0);
    expect(all.filter(m => m.kind === 'job' && m.read_at === null)).toHaveLength(0);
    expect(all.some(m => m.kind === 'system' && /2 offre/.test(m.body))).toBe(true);
    await query(`UPDATE sources SET last_success_at = now() WHERE id = $1`, [lever.id]);
  });

  it('collecte suivante : doublon ignoré, modification détectée, nouveauté non lue, offre retirée', async () => {
    const lever = await src('lever');
    const r = await ingest(lever, [job('a1', 'Algo Dev', 'Jerusalem · Tel Aviv'), job('a3', 'Data Engineer')]);
    expect(r.baseline).toBe(false);
    expect(r.inserted.map(i => i.title)).toEqual(['Data Engineer']);
    expect(r.updated).toBe(1);
    expect(r.closed).toBe(1);
    const all = await msgs();
    expect(all.find(m => m.dedup_key === 'job:lever:a1').revised_at).not.toBeNull();
    expect(all.find(m => m.dedup_key === 'job:lever:a2').closed_at).not.toBeNull();
    expect(all.find(m => m.dedup_key === 'job:lever:a3').read_at).toBeNull();
    const again = await ingest(lever, [job('a1', 'Algo Dev', 'Jerusalem · Tel Aviv'), job('a3', 'Data Engineer')]);
    expect(again.inserted.length + again.updated + again.closed).toBe(0);
  });

  it('même article via deux sources (URL identique à la normalisation près) → un seul message', async () => {
    const rss = await src('rss'); const gdelt = await src('gdelt');
    await query(`UPDATE sources SET last_success_at = now() WHERE id IN ($1, $2)`, [rss.id, gdelt.id]);
    await ingest(rss, [news('https://www.ir.example.com/pr/1?utm_source=rss', 'Mobileye expands partnership with an automaker')]);
    const r = await ingest({ ...gdelt, last_success_at: new Date() }, [news('https://ir.example.com/pr/1', 'Mobileye expands partnership with an automaker')]);
    expect(r.inserted).toHaveLength(0);
  });

  it('même titre chez un autre média → rattaché comme « également rapporté par »', async () => {
    const gdelt = await src('gdelt');
    const r = await ingest(gdelt, [news('https://press.example.net/story', 'Mobileye expands partnership with an automaker - Press')]);
    expect(r.inserted).toHaveLength(0);
    expect(r.merged).toBe(1);
    const m = (await msgs()).find(x => x.title === 'Mobileye expands partnership with an automaker');
    expect(m.payload.alsoReportedBy[0].url).toBe('https://press.example.net/story');
  });
});

describe('rappels', () => {
  it('création → carte de confirmation → programmation → déclenchement', async () => {
    await reminders.handleUserText('Rappelle-moi de postuler chez Mobileye demain à 18 h');
    const conv = await reminders.remindersConversationId();
    const card = (await query(`SELECT * FROM messages WHERE conversation_id = $1 AND kind = 'assistant' AND payload->>'type' = 'confirm_create'`, [conv])).rows[0];
    expect(card).toBeTruthy();
    let rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [card.reminder_id])).rows[0];
    expect(rem.status).toBe('draft');
    expect(rem.text).toBe('Postuler chez Mobileye');
    expect(rem.related_conversation_id).toBe(mobileye);
    expect(rem.interpreter).toBe('local');
    // non confirmé = jamais déclenché
    await query(`UPDATE reminders SET due_at = now() + interval '1 minute' WHERE id = $1`, [rem.id]);
    await reminders.resolveAssistantAction(card.id, 'confirm');
    await expect(reminders.resolveAssistantAction(card.id, 'confirm')).rejects.toThrow(/Déjà traité/);
    rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [rem.id])).rows[0];
    expect(rem.status).toBe('scheduled');
    await query(`UPDATE reminders SET due_at = now() - interval '5 seconds' WHERE id = $1`, [rem.id]);
    expect(await reminders.fireDueReminders()).toBe(1);
    expect(await reminders.fireDueReminders()).toBe(0);
    rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [rem.id])).rows[0];
    expect(rem.status).toBe('fired');
    const fired = (await query(`SELECT * FROM messages WHERE reminder_id = $1 AND kind = 'reminder'`, [rem.id])).rows;
    expect(fired).toHaveLength(1);
    expect(fired[0].read_at).toBeNull();
  });

  it('répétition quotidienne : reprogrammée après déclenchement ; report ; modification ; suppression', async () => {
    await reminders.handleUserText('Rappelle-moi tous les jours à 8h de lire la veille');
    const conv = await reminders.remindersConversationId();
    const card = (await query(`SELECT * FROM messages WHERE conversation_id = $1 AND payload->>'type' = 'confirm_create' ORDER BY created_at DESC LIMIT 1`, [conv])).rows[0];
    await reminders.resolveAssistantAction(card.id, 'confirm');
    await query(`UPDATE reminders SET due_at = now() - interval '1 minute' WHERE id = $1`, [card.reminder_id]);
    await reminders.fireDueReminders();
    let rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [card.reminder_id])).rows[0];
    expect(rem.status).toBe('scheduled');
    expect(rem.due_at.getTime()).toBeGreaterThan(Date.now());
    expect(rem.fire_count).toBe(1);

    const snoozed = await reminders.snoozeReminder(rem.id, 10);
    expect(snoozed.id).not.toBe(rem.id); // série conservée, rappel ponctuel créé
    const upd = await reminders.updateReminder(rem.id, { text: 'Lire la veille Mobileye', recurrence: 'weekdays' });
    expect(upd.recurrence).toBe('weekdays');
    await expect(reminders.updateReminder(rem.id, { due_local: '2020-01-01T10:00' })).rejects.toThrow(/passée/);
    await reminders.cancelReminder(rem.id);
    rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [rem.id])).rows[0];
    expect(rem.status).toBe('cancelled');
  });

  it('demande incomplète → question, aucun rappel créé', async () => {
    const before = (await query(`SELECT count(*)::int n FROM reminders`)).rows[0].n;
    await reminders.handleUserText('Rappelle-moi de relancer Dana');
    expect((await query(`SELECT count(*)::int n FROM reminders`)).rows[0].n).toBe(before);
    const conv = await reminders.remindersConversationId();
    const last = (await query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`, [conv])).rows[0];
    expect(last.payload.type).toBe('clarify');
    expect(last.body).toMatch(/Quand/);
  });
});

describe('rappels via OpenAI (serveur simulé compatible Chat Completions)', () => {
  it('update interprété par le modèle, confirmé, appliqué ; repli local si erreur', async () => {
    const { createServer } = await import('node:http');
    const { config } = await import('../src/config.js');
    let next: any = null; let status = 200; let lastBody: any = null;
    const srv = createServer((req, res) => {
      let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
        lastBody = JSON.parse(b);
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }) : JSON.stringify({ error: { message: 'Incorrect API key' } }));
      });
    });
    await new Promise<void>(r => srv.listen(0, r));
    Object.assign(config, { openaiApiKey: 'sk-test', openaiBaseUrl: `http://127.0.0.1:${(srv.address() as any).port}` });
    try {
      const conv = await reminders.remindersConversationId();
      const { DateTime } = await import('luxon');
      const tomorrow = DateTime.now().setZone('Asia/Jerusalem').plus({ days: 1 }).toFormat('yyyy-LL-dd');
      next = { intent: 'create', text: 'Envoyer le CV à Mobileye', due_local: `${tomorrow}T18:00`, recurrence: 'none', target_reminder_id: null, question: null };
      await reminders.handleUserText('rappelle moi d’envoyer mon CV à Mobileye demain 18h');
      expect(lastBody.response_format.type).toBe('json_schema');
      expect(lastBody.messages[0].content).toContain('Asia/Jerusalem');
      const card = (await query(`SELECT * FROM messages WHERE conversation_id = $1 AND payload->>'type' = 'confirm_create' ORDER BY created_at DESC LIMIT 1`, [conv])).rows[0];
      expect(card.payload.interpreter).toBe('openai');
      await reminders.resolveAssistantAction(card.id, 'confirm');

      // modification : le modèle doit citer un id existant
      next = { intent: 'update', text: 'Envoyer le CV à Mobileye', due_local: `${tomorrow}T19:30`, recurrence: 'none', target_reminder_id: card.reminder_id, question: null };
      await reminders.handleUserText('décale le rappel du CV à 19h30');
      const upd = (await query(`SELECT * FROM messages WHERE payload->>'type' = 'confirm_update' ORDER BY created_at DESC LIMIT 1`)).rows[0];
      await reminders.resolveAssistantAction(upd.id, 'confirm');
      const rem = (await query(`SELECT * FROM reminders WHERE id = $1`, [card.reminder_id])).rows[0];
      expect(DateTime.fromJSDate(rem.due_at).setZone('Asia/Jerusalem').toFormat('HH:mm')).toBe('19:30');

      // id inventé par le modèle → refus, rien ne change
      next = { intent: 'delete', text: null, due_local: null, recurrence: 'none', target_reminder_id: '00000000-0000-0000-0000-000000000000', question: null };
      await reminders.handleUserText('supprime le rappel');
      const last = (await query(`SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1`, [conv])).rows[0];
      expect(last.payload.type).toBe('clarify');

      // clé refusée → analyseur local, raison conservée
      status = 401;
      await reminders.handleUserText('Rappelle-moi de préparer l’entretien jeudi à 10h');
      const fb = (await query(`SELECT * FROM messages WHERE conversation_id = $1 AND payload->>'type' = 'confirm_create' ORDER BY created_at DESC LIMIT 1`, [conv])).rows[0];
      expect(fb.payload.interpreter).toBe('local');
      expect(fb.payload.fallbackReason).toContain('401');
    } finally {
      Object.assign(config, { openaiApiKey: '' });
      srv.close();
    }
  });
});
