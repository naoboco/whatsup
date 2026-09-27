import { query, tx } from './pool.js';
import { config } from '../config.js';
import { bus } from '../services/events.js';

/**
 * Données initiales : la conversation « Rappels » et la veille « Mobileye » branchée sur trois sources réelles
 * et autorisées (communiqués officiels, API publique Lever du site carrières, index ouvert GDELT).
 */
export async function bootstrap() {
  await tx(async c => {
    await c.query('SELECT pg_advisory_xact_lock(71000)');
    const done = await c.query(`SELECT 1 FROM settings WHERE key = 'bootstrapped'`);
    if (done.rowCount) return;
    await c.query(`INSERT INTO conversations (slug, name, kind, description, accent, pinned) VALUES ('rappels', 'Rappels', 'reminders', 'Vos rappels, en langage naturel', '#F2C14E', true) ON CONFLICT (slug) DO NOTHING`);
    const mob = await c.query<{ id: string }>(
      `INSERT INTO conversations (slug, name, kind, description, accent) VALUES ('mobileye', 'Mobileye', 'company', 'Conduite autonome et ADAS — Jérusalem', '#5B8DEF')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`);
    const id = mob.rows[0].id;
    const has = await c.query(`SELECT 1 FROM sources WHERE conversation_id = $1`, [id]);
    if (!has.rowCount) {
      await c.query(`INSERT INTO sources (conversation_id, type, category, label, config, interval_minutes) VALUES
        ($1, 'rss',   'news', 'Mobileye — communiqués officiels (ir.mobileye.com)', $2, 30),
        ($1, 'lever', 'jobs', 'Mobileye Careers — API publique Lever', $3, 120),
        ($1, 'gdelt', 'news', 'Presse mondiale via GDELT — « Mobileye »', $4, 60)`,
        [id,
          JSON.stringify({ url: 'https://ir.mobileye.com/rss/news-releases.xml', publisher: 'Mobileye (communiqué officiel)', itemKind: 'news' }),
          JSON.stringify({ site: 'mobileye', region: 'eu', publisher: 'Mobileye Careers' }),
          JSON.stringify({ query: '"Mobileye"', timespan: '3d', languages: ['english', 'french', 'hebrew'], maxRecords: 50 })]);
    }
    await c.query(`INSERT INTO messages (conversation_id, kind, body, read_at, payload)
      SELECT id, 'assistant', $1, now(), '{"type":"welcome"}'::jsonb FROM conversations WHERE slug = 'rappels'`,
      ['Écrivez simplement ce dont je dois vous rappeler, par exemple : « Rappelle-moi de postuler chez Mobileye demain à 18 h ». Je vous ferai confirmer la date et le contenu avant d’enregistrer quoi que ce soit.']);
    await c.query(`INSERT INTO settings (key, value) VALUES ('bootstrapped', 'true')`);
  });
  console.log('[bootstrap] conversations « Rappels » et « Mobileye » créées');
}

/* -------------------------------------------------------------------------------------------------
 * Démonstration. Chaque élément est marqué is_demo = true, n'a AUCUN lien, et affiche un badge « Démo ».
 * En mode « auto », il n'apparaît que dans une veille dont toutes les sources réelles ont échoué,
 * et disparaît dès que des contenus réels arrivent.
 * ------------------------------------------------------------------------------------------------- */
function demoItems(name: string, kind: string) {
  const news = [
    { title: `${name} : exemple d’annonce de partenariat industriel`, body: 'Contenu fictif de démonstration montrant l’affichage d’une actualité : titre, résumé court, date et source. Aucune publication réelle ne correspond à ce message.' },
    { title: `${name} : exemple de communiqué de résultats trimestriels`, body: 'Exemple fictif. Branchez un flux RSS officiel ou GDELT pour recevoir de vraies publications à la place de ce message.' },
    { title: `Exemple d’article de presse mentionnant ${name}`, body: 'Exemple fictif illustrant un article de presse tierce, avec ses sources secondaires regroupées quand plusieurs médias reprennent la même information.' },
  ];
  const jobs = kind === 'company' ? [
    { title: 'Ingénieur·e vision par ordinateur (exemple)', location: 'Jérusalem, Israël', department: 'R&D — Perception', commitment: 'Temps plein · hybride' },
    { title: 'Développeur·se full stack (exemple)', location: 'Tel Aviv, Israël', department: 'Plateforme', commitment: 'Temps plein' },
  ] : [];
  return { news, jobs };
}

export async function ensureDemoContent() {
  if (config.demoMode === 'off') return;
  const convs = await query<{ id: string; name: string; kind: string }>(`
    SELECT c.id, c.name, c.kind FROM conversations c
    WHERE c.kind <> 'reminders'
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.is_demo)
      AND ($1 = 'on' OR (
            NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.kind IN ('news','job') AND NOT m.is_demo)
        AND NOT EXISTS (SELECT 1 FROM sources s WHERE s.conversation_id = c.id AND s.enabled AND (s.last_fetched_at IS NULL OR s.last_success_at IS NOT NULL))
      ))`, [config.demoMode]);
  for (const c of convs.rows) {
    const { news, jobs } = demoItems(c.name, c.kind);
    await tx(async db => {
      let h = 30;
      for (const [i, n] of news.entries()) {
        await db.query(`INSERT INTO messages (conversation_id, kind, dedup_key, title, body, source_name, published_at, is_demo, payload, sort_at, read_at)
          VALUES ($1,'news',$2,$3,$4,'Données de démonstration', now() - make_interval(hours => $5), true, '{"demo":true}', now() - make_interval(hours => $5), CASE WHEN $6 THEN now() END)`,
          [c.id, `demo:news:${i}`, n.title, n.body, h, i > 0]);
        h -= 9;
      }
      for (const [i, j] of jobs.entries()) {
        await db.query(`INSERT INTO messages (conversation_id, kind, dedup_key, title, body, source_name, published_at, job_location, job_department, job_commitment, is_demo, payload, sort_at)
          VALUES ($1,'job',$2,$3,$4,'Données de démonstration', now() - make_interval(hours => $5), $6, $7, $8, true, '{"demo":true}', now() - make_interval(hours => $5))`,
          [c.id, `demo:job:${i}`, j.title, 'Offre fictive de démonstration : aucun poste réel ne correspond à cette carte.', 6 - i * 4, j.location, j.department, j.commitment]);
      }
    });
    bus.publish({ type: 'conversation:updated', conversationId: c.id });
    console.log(`[démo] exemples étiquetés ajoutés à « ${c.name} »`);
  }
}

export async function clearDemoContent() {
  const r = await query(`DELETE FROM messages WHERE is_demo`);
  bus.publish({ type: 'conversations:changed' });
  return r.rowCount ?? 0;
}
