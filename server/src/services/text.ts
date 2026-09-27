import { createHash } from 'node:crypto';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', hellip: '…', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Retire le HTML, décode les entités, compacte les espaces. */
export function cleanText(input: unknown): string {
  if (input == null) return '';
  let s = String(input);
  s = decodeEntities(s); // certains flux encodent le HTML deux fois
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/\s+/g, ' ').trim();
}

export function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–-]+$/, '') + '…';
}

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

/** Clé de titre normalisée pour détecter la même info publiée par plusieurs sources. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s[-–|]\s[^-–|]{2,40}$/, '') // « Titre - Reuters » → « Titre »
    .replace(/[^a-z0-9א-ת ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
