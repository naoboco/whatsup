import { z } from 'zod';
import type { Connector, NormalizedItem } from './types.js';
import { fetchJson } from '../services/http.js';
import { cleanText, truncate } from '../services/text.js';
import { tryUrl } from '../services/url.js';

const slug = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/, 'Identifiant de tableau invalide');

/* ------------------------------ Lever ------------------------------ */
// API publique documentée : https://github.com/lever/postings-api
const LeverConfig = z.object({
  site: slug,
  region: z.enum(['global', 'eu']).default('global'),
  publisher: z.string().max(120).optional(),
  /** Filtre optionnel sur le pays (code ISO, ex. « IL »). */
  country: z.string().length(2).optional(),
});
export type LeverConfig = z.infer<typeof LeverConfig>;

export interface LeverPosting {
  id: string; text: string; createdAt?: number; hostedUrl: string; applyUrl?: string;
  categories?: { location?: string; department?: string; team?: string; commitment?: string; allLocations?: string[] };
  descriptionPlain?: string; openingPlain?: string; country?: string; workplaceType?: string;
}

const WORKPLACE: Record<string, string> = { hybrid: 'hybride', remote: 'télétravail', onsite: 'sur site' };

export function parseLever(postings: LeverPosting[], c: LeverConfig): NormalizedItem[] {
  const out: NormalizedItem[] = [];
  for (const p of postings) {
    if (c.country && p.country && p.country.toUpperCase() !== c.country.toUpperCase()) continue;
    const url = tryUrl(p.hostedUrl);
    if (!url || !p.text) continue;
    const cat = p.categories ?? {};
    const locs = cat.allLocations?.length ? cat.allLocations.join(' · ') : cat.location;
    out.push({
      kind: 'job',
      externalId: p.id,
      url,
      applyUrl: tryUrl(p.applyUrl) ?? url,
      title: cleanText(p.text),
      summary: truncate(cleanText(p.openingPlain || p.descriptionPlain), 240),
      publishedAt: p.createdAt ? new Date(p.createdAt) : null,
      sourceName: c.publisher ?? `${c.site} — offres (Lever)`,
      location: locs ? cleanText(locs) : undefined,
      department: cleanText([cat.department, cat.team].filter(Boolean).join(' / ')) || undefined,
      commitment: [cat.commitment, p.workplaceType ? WORKPLACE[p.workplaceType] ?? p.workplaceType : null].filter(Boolean).join(' · ') || undefined,
    });
  }
  return out;
}

export const leverConnector: Connector<LeverConfig> = {
  type: 'lever',
  category: 'jobs',
  parseConfig: raw => LeverConfig.parse(raw),
  describe: c => `API publique Lever — jobs${c.region === 'eu' ? '.eu' : ''}.lever.co/${c.site}`,
  async fetch(c) {
    const host = c.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const data = await fetchJson<LeverPosting[]>(`https://${host}/v0/postings/${encodeURIComponent(c.site)}?mode=json`);
    if (!Array.isArray(data)) throw new Error('Réponse Lever inattendue');
    return parseLever(data, c);
  },
};

/* ---------------------------- Greenhouse ---------------------------- */
// API publique documentée : https://developers.greenhouse.io/job-board.html
const GreenhouseConfig = z.object({ board: slug, publisher: z.string().max(120).optional() });
export type GreenhouseConfig = z.infer<typeof GreenhouseConfig>;

export interface GreenhouseJob {
  id: number; title: string; absolute_url: string; updated_at?: string; first_published?: string;
  location?: { name?: string }; departments?: { name: string }[]; content?: string;
}

export function parseGreenhouse(data: { jobs?: GreenhouseJob[] }, c: GreenhouseConfig): NormalizedItem[] {
  return (data.jobs ?? []).flatMap(j => {
    const url = tryUrl(j.absolute_url);
    if (!url || !j.title) return [];
    const d = j.first_published ?? j.updated_at;
    return [{
      kind: 'job' as const,
      externalId: String(j.id),
      url,
      applyUrl: url,
      title: cleanText(j.title),
      summary: truncate(cleanText(j.content), 240),
      publishedAt: d ? new Date(d) : null,
      sourceName: c.publisher ?? `${c.board} — offres (Greenhouse)`,
      location: j.location?.name ? cleanText(j.location.name) : undefined,
      department: j.departments?.map(x => x.name).join(' / ') || undefined,
    }];
  });
}

export const greenhouseConnector: Connector<GreenhouseConfig> = {
  type: 'greenhouse',
  category: 'jobs',
  parseConfig: raw => GreenhouseConfig.parse(raw),
  describe: c => `API publique Greenhouse — boards.greenhouse.io/${c.board}`,
  async fetch(c) {
    const data = await fetchJson<{ jobs?: GreenhouseJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(c.board)}/jobs?content=true`);
    return parseGreenhouse(data, c);
  },
};

/* -------------------------- SmartRecruiters -------------------------- */
// API publique documentée : https://developers.smartrecruiters.com/docs/posting-api
const SmartRecruitersConfig = z.object({ company: slug, publisher: z.string().max(120).optional(), country: z.string().length(2).optional() });
export type SmartRecruitersConfig = z.infer<typeof SmartRecruitersConfig>;

export interface SRPosting {
  id: string; name: string; releasedDate?: string;
  location?: { city?: string; country?: string; remote?: boolean };
  department?: { label?: string }; typeOfEmployment?: { label?: string };
}

export function parseSmartRecruiters(data: { content?: SRPosting[] }, c: SmartRecruitersConfig): NormalizedItem[] {
  return (data.content ?? []).flatMap(p => {
    if (c.country && p.location?.country && p.location.country.toUpperCase() !== c.country.toUpperCase()) return [];
    const url = tryUrl(`https://jobs.smartrecruiters.com/${encodeURIComponent(c.company)}/${encodeURIComponent(p.id)}`);
    if (!url || !p.name) return [];
    const loc = [p.location?.city, p.location?.country?.toUpperCase()].filter(Boolean).join(', ') + (p.location?.remote ? ' · télétravail' : '');
    return [{
      kind: 'job' as const,
      externalId: p.id,
      url,
      applyUrl: url,
      title: cleanText(p.name),
      summary: '',
      publishedAt: p.releasedDate ? new Date(p.releasedDate) : null,
      sourceName: c.publisher ?? `${c.company} — offres (SmartRecruiters)`,
      location: loc || undefined,
      department: p.department?.label,
      commitment: p.typeOfEmployment?.label,
    }];
  });
}

export const smartRecruitersConnector: Connector<SmartRecruitersConfig> = {
  type: 'smartrecruiters',
  category: 'jobs',
  parseConfig: raw => SmartRecruitersConfig.parse(raw),
  describe: c => `API publique SmartRecruiters — ${c.company}`,
  async fetch(c) {
    const all: SRPosting[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await fetchJson<{ content?: SRPosting[]; totalFound?: number }>(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(c.company)}/postings?limit=100&offset=${offset}`);
      all.push(...(page.content ?? []));
      if (!page.content?.length || all.length >= (page.totalFound ?? 0)) break;
    }
    return parseSmartRecruiters({ content: all }, c);
  },
};
