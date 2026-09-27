import { z } from 'zod';
import { query, tx } from '../db/pool.js';
import { connectors } from '../connectors/index.js';
import { bus } from './events.js';
import { UserError } from './reminders.js';

const ACCENTS = ['#E8A33D', '#5B8DEF', '#E0605E', '#43B39A', '#A77BE0', '#D9774B', '#3FA7C9', '#C7B144'];

export function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'veille';
}

export const SourceInput = z.object({
  type: z.enum(['rss', 'gdelt', 'lever', 'greenhouse', 'smartrecruiters']),
  label: z.string().trim().min(2).max(120).optional(),
  config: z.record(z.string(), z.unknown()),
  interval_minutes: z.number().int().min(5).max(24 * 60).optional(),
});

export const ConversationInput = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(['company', 'topic']),
  description: z.string().trim().max(300).optional(),
  sources: z.array(SourceInput).max(10).default([]),
});

export async function addSource(conversationId: string, input: z.infer<typeof SourceInput>, c?: { query: typeof query }) {
  const conn = connectors[input.type];
  let cfg: any;
  try { cfg = conn.parseConfig(input.config); }
  catch (e: any) { throw new UserError(`Source ${input.type} invalide : ${e?.issues?.map((i: any) => `${i.path.join('.')} ${i.message}`).join(', ') ?? e.message}`); }
  const label = input.label ?? conn.describe(cfg);
  const interval = input.interval_minutes ?? (input.type === 'gdelt' ? 60 : conn.category === 'jobs' ? 120 : 30);
  const q = c?.query ?? query;
  const r = await q(`INSERT INTO sources (conversation_id, type, category, label, config, interval_minutes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [conversationId, input.type, (cfg.itemKind === 'job' ? 'jobs' : conn.category), label, JSON.stringify(cfg), interval]);
  return r.rows[0];
}

export async function createConversation(input: z.infer<typeof ConversationInput>) {
  const base = slugify(input.name);
  const exists = await query(`SELECT 1 FROM conversations WHERE lower(name) = lower($1)`, [input.name]);
  if (exists.rowCount) throw new UserError('Une veille porte déjà ce nom');
  const conv = await tx(async c => {
    const n = (await c.query(`SELECT count(*)::int AS n FROM conversations`)).rows[0].n;
    let slug = base, i = 2;
    while ((await c.query(`SELECT 1 FROM conversations WHERE slug = $1`, [slug])).rowCount) slug = `${base}-${i++}`;
    const conv = (await c.query(`INSERT INTO conversations (slug, name, kind, description, accent) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [slug, input.name, input.kind, input.description ?? null, ACCENTS[n % ACCENTS.length]])).rows[0];
    for (const s of input.sources) await addSource(conv.id, s, { query: ((t: string, p?: unknown[]) => c.query(t, p)) as any });
    await c.query(`INSERT INTO messages (conversation_id, kind, body, read_at) VALUES ($1, 'system', $2, now())`,
      [conv.id, input.sources.length ? `Veille créée avec ${input.sources.length} source(s). Première collecte en cours…` : 'Veille créée sans source : ajoutez-en une depuis la fiche de la conversation.']);
    return conv;
  });
  bus.publish({ type: 'conversations:changed' });
  return conv;
}
