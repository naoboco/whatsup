import type { PoolClient } from 'pg';
import { tx, query } from '../db/pool.js';
import type { NormalizedItem } from '../connectors/types.js';
import { canonicalKey, domainOf } from './url.js';
import { sha1, titleKey } from './text.js';
import { bus } from './events.js';
import { config } from '../config.js';

export interface SourceRow {
  id: string; conversation_id: string; type: string; category: 'news' | 'jobs'; label: string;
  config: any; enabled: boolean; is_demo: boolean; interval_minutes: number;
  last_fetched_at: Date | null; last_success_at: Date | null; last_error: string | null;
}

export interface IngestResult { inserted: NormalizedItem[]; updated: number; merged: number; closed: number; reopened: number; baseline: boolean; }

export function dedupKeyFor(sourceType: string, item: NormalizedItem): string {
  // Actualités : la même URL venant de deux sources = un seul message.
  if (item.kind === 'news') return 'url:' + canonicalKey(item.url);
  return item.externalId ? `job:${sourceType}:${item.externalId}` : 'url:' + canonicalKey(item.url);
}

export function contentHash(i: NormalizedItem): string {
  return sha1([i.title, i.summary, i.location, i.department, i.commitment, i.applyUrl].map(x => x ?? '').join('␟'));
}

const TITLE_WINDOW_DAYS = 4;

async function upsertOne(c: PoolClient, src: SourceRow, item: NormalizedItem, baseline: boolean, seen: Set<string>) {
  const key = dedupKeyFor(src.type, item);
  seen.add(key);
  const hash = contentHash(item);
  const tkey = titleKey(item.title);

  const existing = await c.query<{ id: string; content_hash: string; closed_at: Date | null }>(
    `SELECT id, content_hash, closed_at FROM messages WHERE conversation_id = $1 AND dedup_key = $2 FOR UPDATE`,
    [src.conversation_id, key],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.content_hash === hash && !row.closed_at) return 'same' as const;
    await c.query(
      `UPDATE messages SET title = $2, body = $3, url = $4, apply_url = $5, job_location = $6, job_department = $7, job_commitment = $8,
         content_hash = $9, title_key = $10, closed_at = NULL,
         revised_at = CASE WHEN content_hash <> $9 THEN now() ELSE revised_at END, updated_at = now()
       WHERE id = $1`,
      [row.id, item.title, item.summary, item.url, item.applyUrl ?? null, item.location ?? null, item.department ?? null, item.commitment ?? null, hash, tkey],
    );
    return { updated: row.id, reopened: !!row.closed_at };
  }

  // Même titre déjà publié récemment par une autre source → on rattache au lieu de dupliquer.
  if (item.kind === 'news' && tkey.length >= 20) {
    const dup = await c.query<{ id: string; payload: any }>(
      `SELECT id, payload FROM messages WHERE conversation_id = $1 AND kind = 'news' AND title_key = $2
         AND created_at > now() - make_interval(days => $3) LIMIT 1 FOR UPDATE`,
      [src.conversation_id, tkey, TITLE_WINDOW_DAYS],
    );
    if (dup.rows[0]) {
      const also: { name: string; url: string }[] = dup.rows[0].payload?.alsoReportedBy ?? [];
      if (!also.some(a => a.url === item.url) && also.length < 10) {
        also.push({ name: item.sourceName, url: item.url });
        await c.query(`UPDATE messages SET payload = payload || jsonb_build_object('alsoReportedBy', $2::jsonb), updated_at = now() WHERE id = $1`, [dup.rows[0].id, JSON.stringify(also)]);
        return { updated: dup.rows[0].id, merged: true };
      }
      return 'same' as const;
    }
  }

  const ins = await c.query<{ id: string }>(
    `INSERT INTO messages (conversation_id, source_id, kind, dedup_key, title_key, title, body, url, apply_url, source_name, source_domain,
        published_at, job_location, job_department, job_commitment, payload, content_hash, is_demo, read_at, sort_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
        CASE WHEN $19 THEN now() ELSE NULL END,
        CASE WHEN $19 THEN LEAST(COALESCE($12, now()), now()) ELSE now() END)
     RETURNING id`,
    [src.conversation_id, src.id, item.kind, key, tkey, item.title, item.summary, item.url, item.applyUrl ?? null, item.sourceName,
      domainOf(item.url), item.publishedAt, item.location ?? null, item.department ?? null, item.commitment ?? null,
      JSON.stringify({ ...(item.extra ?? {}), sourceLabel: src.label }), hash, src.is_demo, baseline],
  );
  return { inserted: ins.rows[0].id };
}

export async function ingest(src: SourceRow, items: NormalizedItem[]): Promise<IngestResult> {
  const baseline = !src.last_success_at;
  const res: IngestResult = { inserted: [], updated: 0, merged: 0, closed: 0, reopened: 0, baseline };
  const touched: { id: string; isNew: boolean }[] = [];

  await tx(async c => {
    const seen = new Set<string>();
    for (const item of items) {
      const r = await upsertOne(c, src, item, baseline, seen);
      if (r === 'same') continue;
      if ('inserted' in r) { res.inserted.push(item); touched.push({ id: r.inserted!, isNew: true }); }
      else if ('merged' in r) { res.merged++; touched.push({ id: r.updated!, isNew: false }); }
      else { res.updated++; if (r.reopened) res.reopened++; touched.push({ id: r.updated!, isNew: false }); }
    }
    // Offres disparues de la source : marquées « retirées » (jamais supprimées). Garde-fou : liste non vide.
    if (src.category === 'jobs' && items.length > 0) {
      const closed = await c.query<{ id: string }>(
        `UPDATE messages SET closed_at = now(), updated_at = now()
         WHERE source_id = $1 AND kind = 'job' AND closed_at IS NULL AND NOT (dedup_key = ANY($2::text[])) RETURNING id`,
        [src.id, [...seen]],
      );
      res.closed = closed.rowCount ?? 0;
      closed.rows.forEach(r => touched.push({ id: r.id, isNew: false }));
    }
    // Des contenus réels sont arrivés : les exemples de démonstration de cette conversation s'effacent (mode auto).
    if (!src.is_demo && res.inserted.length > 0 && config.demoMode === 'auto') {
      await c.query(`DELETE FROM messages WHERE conversation_id = $1 AND is_demo = true`, [src.conversation_id]);
    }
    if (baseline && res.inserted.length > 0) {
      const what = src.category === 'jobs' ? 'offre(s) d’emploi' : 'publication(s)';
      await c.query(
        `INSERT INTO messages (conversation_id, source_id, kind, body, read_at, payload) VALUES ($1, $2, 'system', $3, now(), $4)`,
        [src.conversation_id, src.id, `Source connectée : ${src.label} — ${res.inserted.length} ${what} importée(s). Les prochaines nouveautés arriveront comme messages non lus.`, JSON.stringify({ sourceId: src.id })],
      );
    }
  });

  for (const t of touched.slice(0, 200)) bus.publish({ type: t.isNew ? 'message:new' : 'message:updated', conversationId: src.conversation_id, messageId: t.id });
  if (touched.length) bus.publish({ type: 'conversation:updated', conversationId: src.conversation_id });
  return res;
}

export async function markSourceResult(sourceId: string, ok: boolean, info: { error?: string; count?: number }) {
  await query(
    ok
      ? `UPDATE sources SET last_fetched_at = now(), last_success_at = now(), last_error = NULL, last_item_count = $2 WHERE id = $1`
      : `UPDATE sources SET last_fetched_at = now(), last_error = $2 WHERE id = $1`,
    [sourceId, ok ? info.count ?? 0 : (info.error ?? 'Erreur inconnue').slice(0, 500)],
  );
}
