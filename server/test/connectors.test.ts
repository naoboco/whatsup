import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseFeed } from '../src/connectors/rss.js';
import { parseGdelt, parseGdeltDate, buildGdeltUrl } from '../src/connectors/gdelt.js';
import { parseLever, parseGreenhouse, parseSmartRecruiters } from '../src/connectors/jobs.js';
import { safePublicUrl, canonicalKey } from '../src/services/url.js';
import { titleKey, cleanText } from '../src/services/text.js';

describe('validation des liens', () => {
  it('refuse les schémas et hôtes dangereux', () => {
    for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'http://localhost/x', 'http://127.0.0.1', 'http://10.0.0.2/a', 'https://user:pw@site.com', 'http://intranet/x', 'ftp://a.com'])
      expect(() => safePublicUrl(bad), bad).toThrow();
  });
  it('retire le pistage et le fragment', () => {
    expect(safePublicUrl('https://Example.com/a?utm_source=x&id=3#top')).toBe('https://example.com/a?id=3');
  });
  it('clé canonique commune', () => {
    expect(canonicalKey('http://www.site.com/article/')).toBe(canonicalKey('https://site.com/article?utm_medium=rss'));
  });
});

describe('texte', () => {
  it('nettoie le HTML doublement encodé', () => {
    expect(cleanText('&lt;p&gt;A &amp;amp; B&lt;/p&gt;')).toBe('A & B');
  });
  it('clé de titre ignore le suffixe éditeur', () => {
    expect(titleKey('Mobileye signs deal with X - Reuters')).toBe(titleKey('Mobileye signs deal with X'));
  });
});

describe('RSS', () => {
  const items = parseFeed(readFileSync(new URL('./fixtures/ir-rss.xml', import.meta.url), 'utf8'), { url: 'https://ir.mobileye.com/rss/news-releases.xml', publisher: 'Mobileye (communiqué officiel)', itemKind: 'news' });
  it('extrait les éléments valides et écarte les liens dangereux', () => {
    expect(items).toHaveLength(2);
    expect(items[0].url).toBe('https://ir.mobileye.com/news-releases/news-release-details/fixture-a');
    expect(items[0].summary).toContain('& more text');
    expect(items[0].publishedAt?.toISOString()).toBe('2026-07-30T10:30:00.000Z');
    expect(items[1].summary).toBe('Fixture HTML description.');
    expect(items[0].sourceName).toBe('Mobileye (communiqué officiel)');
  });
  it('Atom', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><entry><title>Post</title><link rel="alternate" href="https://blog.example.org/p1"/><id>p1</id><updated>2026-09-01T10:00:00Z</updated><summary>Résumé</summary></entry></feed>`;
    const r = parseFeed(atom, { url: 'https://blog.example.org/feed', itemKind: 'news' });
    expect(r[0]).toMatchObject({ title: 'Post', url: 'https://blog.example.org/p1', summary: 'Résumé', sourceName: 'Blog' });
  });
});

describe('GDELT', () => {
  it('date et parsing', () => {
    expect(parseGdeltDate('20260927T101500Z')?.toISOString()).toBe('2026-09-27T10:15:00.000Z');
    const r = parseGdelt({ articles: [{ url: 'https://www.news.example.com/a', title: 'T', seendate: '20260927T101500Z', domain: 'news.example.com', language: 'French' }, { url: 'bad', title: 'x', seendate: '', domain: '', language: '' }] });
    expect(r).toHaveLength(1);
    expect(r[0].extra?.language).toBe('français');
    expect(buildGdeltUrl({ query: '"Mobileye"', timespan: '3d', languages: ['english'], maxRecords: 50 })).toContain('sourcelang%3Aenglish');
  });
});

describe('offres d’emploi', () => {
  it('Lever (structure réelle de l’API)', () => {
    const r = parseLever([{ id: 'bb66', text: '3D Algorithm Developer', createdAt: 1779188005917, hostedUrl: 'https://jobs.eu.lever.co/mobileye/bb66', applyUrl: 'https://jobs.eu.lever.co/mobileye/bb66/apply',
      categories: { location: 'Jerusalem', department: 'R&D', team: 'Algorithms', commitment: 'Full-time', allLocations: ['Jerusalem'] }, descriptionPlain: 'Mobileye is looking for...', country: 'IL', workplaceType: 'hybrid' }], { site: 'mobileye', region: 'eu', publisher: 'Mobileye Careers' });
    expect(r[0]).toMatchObject({ kind: 'job', externalId: 'bb66', title: '3D Algorithm Developer', location: 'Jerusalem', department: 'R&D / Algorithms', commitment: 'Full-time · hybride', applyUrl: 'https://jobs.eu.lever.co/mobileye/bb66/apply' });
    expect(parseLever([{ id: 'x', text: 'A', hostedUrl: 'https://jobs.lever.co/a/x', country: 'US' }], { site: 'a', region: 'global', country: 'IL' })).toHaveLength(0);
  });
  it('Greenhouse et SmartRecruiters', () => {
    expect(parseGreenhouse({ jobs: [{ id: 1, title: 'Eng', absolute_url: 'https://boards.greenhouse.io/acme/jobs/1', location: { name: 'Tel Aviv' }, content: '&lt;p&gt;Hi&lt;/p&gt;' }] }, { board: 'acme' })[0])
      .toMatchObject({ location: 'Tel Aviv', summary: 'Hi', externalId: '1' });
    expect(parseSmartRecruiters({ content: [{ id: '77', name: 'PM', location: { city: 'Haifa', country: 'il' } }] }, { company: 'Acme' })[0])
      .toMatchObject({ url: 'https://jobs.smartrecruiters.com/Acme/77', location: 'Haifa, IL' });
  });
});
