import { query } from '../db/pool.js';
import { connectors } from '../connectors/index.js';
import { ingest, markSourceResult, type SourceRow } from './ingest.js';
import { notify } from './push.js';
import { getPreferences } from './preferences.js';
import { bus } from './events.js';

const running = new Set<string>();

export async function collectSource(src: SourceRow): Promise<{ ok: boolean; inserted?: number; updated?: number; closed?: number; error?: string }> {
  if (src.is_demo || src.type === 'demo') return { ok: true, inserted: 0 };
  const conn = connectors[src.type];
  if (!conn) return { ok: false, error: `Type de source inconnu : ${src.type}` };
  if (running.has(src.id)) return { ok: false, error: 'Collecte déjà en cours' };
  running.add(src.id);
  try {
    const cfg = conn.parseConfig(src.config);
    const items = await conn.fetch(cfg);
    const r = await ingest(src, items);
    await markSourceResult(src.id, true, { count: items.length });
    if (!r.baseline && r.inserted.length) await notifyNew(src, r.inserted);
    bus.publish({ type: 'conversation:updated', conversationId: src.conversation_id });
    return { ok: true, inserted: r.inserted.length, updated: r.updated + r.merged, closed: r.closed };
  } catch (e: any) {
    const error = e?.issues ? `Configuration invalide : ${e.issues.map((i: any) => i.message).join(', ')}` : String(e?.message ?? e);
    await markSourceResult(src.id, false, { error });
    bus.publish({ type: 'conversation:updated', conversationId: src.conversation_id });
    console.warn(`[collecte] ${src.label} : ${error}`);
    return { ok: false, error };
  } finally {
    running.delete(src.id);
  }
}

async function notifyNew(src: SourceRow, items: { title: string; kind: string; location?: string }[]) {
  const conv = (await query<{ name: string; muted: boolean }>(`SELECT name, muted FROM conversations WHERE id = $1`, [src.conversation_id])).rows[0];
  if (!conv) return;
  const p = await getPreferences();
  const category = src.category === 'jobs' ? 'jobs' : 'news';
  if (items.length > p.groupThreshold) {
    const what = category === 'jobs' ? 'nouvelles offres d’emploi' : 'nouvelles actualités';
    await notify({ type: 'notify', category, title: conv.name, body: `${items.length} ${what}`, conversationId: src.conversation_id, tag: `batch-${src.id}` }, { muted: conv.muted });
  } else {
    for (const i of items) {
      const prefix = i.kind === 'job' ? '💼 ' : '📰 ';
      await notify({ type: 'notify', category, title: conv.name, body: prefix + i.title + (i.location ? ` — ${i.location}` : ''), conversationId: src.conversation_id }, { muted: conv.muted });
    }
  }
}

/** Sources dont l'intervalle est écoulé (avec recul exponentiel léger après erreur). */
export async function collectDue() {
  const due = await query<SourceRow>(
    `SELECT * FROM sources
     WHERE enabled AND NOT is_demo AND type <> 'demo'
       AND (last_fetched_at IS NULL
            OR last_fetched_at < now() - make_interval(mins => CASE WHEN last_error IS NULL THEN interval_minutes ELSE LEAST(interval_minutes * 4, 360) END))
     ORDER BY last_fetched_at NULLS FIRST LIMIT 10`);
  for (const s of due.rows) await collectSource(s);
  return due.rowCount ?? 0;
}

export async function collectConversation(conversationId: string) {
  const srcs = await query<SourceRow>(`SELECT * FROM sources WHERE conversation_id = $1 AND enabled`, [conversationId]);
  const results = [];
  for (const s of srcs.rows) results.push({ source: s.label, ...(await collectSource(s)) });
  return results;
}
