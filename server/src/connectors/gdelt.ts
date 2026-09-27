import { z } from 'zod';
import type { Connector, NormalizedItem } from './types.js';
import { fetchJson } from '../services/http.js';
import { cleanText } from '../services/text.js';
import { tryUrl, domainOf } from '../services/url.js';

/**
 * GDELT DOC 2.0 API — index ouvert et gratuit de la presse mondiale (https://www.gdeltproject.org/).
 * Il fournit titre, URL, domaine, langue et date, mais PAS de résumé : l'interface le signale.
 */
const Config = z.object({
  query: z.string().min(2).max(300),
  /** Fenêtre de recherche, ex. « 3d », « 12h ». */
  timespan: z.string().regex(/^\d{1,3}(h|d|w)$/).default('3d'),
  languages: z.array(z.enum(['french', 'english', 'hebrew'])).default(['english', 'french', 'hebrew']),
  maxRecords: z.number().int().min(5).max(250).default(50),
});
export type GdeltConfig = z.infer<typeof Config>;

export interface GdeltArticle { url: string; title: string; seendate: string; domain: string; language: string; sourcecountry?: string; }

export function buildGdeltUrl(c: GdeltConfig): string {
  const langs = c.languages.length ? ` (${c.languages.map(l => `sourcelang:${l}`).join(' OR ')})` : '';
  const q = encodeURIComponent(c.query + langs);
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&sort=datedesc&maxrecords=${c.maxRecords}&timespan=${c.timespan}`;
}

export function parseGdeltDate(s: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s ?? '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

const LANG_FR: Record<string, string> = { English: 'anglais', French: 'français', Hebrew: 'hébreu' };

export function parseGdelt(json: { articles?: GdeltArticle[] }): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const a of json.articles ?? []) {
    const url = tryUrl(a.url);
    const title = cleanText(a.title);
    if (!url || !title) continue;
    const lang = LANG_FR[a.language] ?? a.language;
    out.push({
      kind: 'news',
      url,
      title,
      summary: '',
      publishedAt: parseGdeltDate(a.seendate),
      sourceName: a.domain || domainOf(url),
      extra: { language: lang, country: a.sourcecountry, via: 'GDELT', noSummaryReason: 'GDELT ne fournit que le titre' },
    });
  }
  return out;
}

export const gdeltConnector: Connector<GdeltConfig> = {
  type: 'gdelt',
  category: 'news',
  parseConfig: raw => Config.parse(raw),
  describe: c => `Presse mondiale via GDELT — requête « ${c.query} »`,
  async fetch(c) {
    // GDELT renvoie parfois du texte brut en cas de requête refusée : fetchJson lèvera une erreur explicite.
    const json = await fetchJson<{ articles?: GdeltArticle[] }>(buildGdeltUrl(c), { timeoutMs: 30_000 });
    return parseGdelt(json);
  },
};
