import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import type { Connector, NormalizedItem } from './types.js';
import { fetchText } from '../services/http.js';
import { cleanText, truncate } from '../services/text.js';
import { safePublicUrl, tryUrl, domainOf } from '../services/url.js';

const Config = z.object({
  url: z.string().transform(v => safePublicUrl(v)),
  /** Nom de l'éditeur affiché (sinon : titre du flux). */
  publisher: z.string().max(120).optional(),
  /** news (défaut) ou job : un flux RSS peut aussi publier des offres. */
  itemKind: z.enum(['news', 'job']).default('news'),
  /** Filtre optionnel : ne garder que les éléments contenant l'un de ces mots. */
  keywords: z.array(z.string().min(2)).max(20).optional(),
});
export type RssConfig = z.infer<typeof Config>;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#text', trimValues: true });

const text = (v: any): string => (v == null ? '' : typeof v === 'object' ? String(v['#text'] ?? '') : String(v));
const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

function parseDate(v: any): Date | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseFeed(xml: string, cfg: Pick<RssConfig, 'publisher' | 'itemKind' | 'keywords'> & { url: string }): NormalizedItem[] {
  const doc = parser.parse(xml);
  const out: NormalizedItem[] = [];
  if (doc?.rss?.channel || doc?.['rdf:RDF']) {
    const ch = doc.rss?.channel ?? doc['rdf:RDF'].channel;
    const feedTitle = cleanText(text(ch?.title));
    const items = arr(doc.rss?.channel?.item ?? doc['rdf:RDF']?.item);
    for (const it of items) {
      const link = tryUrl(text(it.link)) ?? tryUrl(it.guid?.['@isPermaLink'] !== 'false' ? text(it.guid) : '');
      const title = cleanText(text(it.title));
      if (!link || !title) continue;
      out.push({
        kind: cfg.itemKind,
        externalId: text(it.guid) || undefined,
        url: link,
        title,
        summary: truncate(cleanText(text(it.description) || text(it['content:encoded']))),
        publishedAt: parseDate(it.pubDate ?? it['dc:date']),
        sourceName: cfg.publisher || feedTitle || domainOf(cfg.url),
      });
    }
  } else if (doc?.feed) {
    const feedTitle = cleanText(text(doc.feed.title));
    for (const e of arr<any>(doc.feed.entry)) {
      const links = arr<any>(e.link);
      const alt = links.find(l => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
      const link = tryUrl(alt?.['@href']);
      const title = cleanText(text(e.title));
      if (!link || !title) continue;
      out.push({
        kind: cfg.itemKind,
        externalId: text(e.id) || undefined,
        url: link,
        title,
        summary: truncate(cleanText(text(e.summary) || text(e.content))),
        publishedAt: parseDate(e.published ?? e.updated),
        sourceName: cfg.publisher || feedTitle || domainOf(cfg.url),
      });
    }
  } else {
    throw new Error('Format de flux non reconnu (ni RSS ni Atom)');
  }
  const kw = cfg.keywords?.map(k => k.toLowerCase());
  return kw?.length ? out.filter(i => kw.some(k => `${i.title} ${i.summary}`.toLowerCase().includes(k))) : out;
}

export const rssConnector: Connector<RssConfig> = {
  type: 'rss',
  category: 'news',
  parseConfig: raw => Config.parse(raw),
  describe: c => `Flux RSS/Atom — ${domainOf(c.url)}`,
  async fetch(c) {
    const xml = await fetchText(c.url, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' });
    return parseFeed(xml, c);
  },
};
