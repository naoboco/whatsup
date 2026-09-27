import { isIP } from 'node:net';

const TRACKING = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|igshid$|ref$|ref_src$|cmpid$|ocid$)/i;

export class InvalidUrlError extends Error {}

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (v === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h === '::';
  return false;
}

/**
 * Valide une URL publique http(s) : pas d'identifiants, pas d'hôte privé, longueur raisonnable.
 * Retourne l'URL normalisée (sans fragment ni paramètres de pistage).
 */
export function safePublicUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new InvalidUrlError('URL absente');
  if (raw.length > 2048) throw new InvalidUrlError('URL trop longue');
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new InvalidUrlError(`URL invalide : ${raw.slice(0, 80)}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new InvalidUrlError('Seuls http et https sont acceptés');
  if (u.username || u.password) throw new InvalidUrlError('Identifiants interdits dans une URL');
  if (!u.hostname.includes('.') || isPrivateHost(u.hostname)) throw new InvalidUrlError('Hôte non public');
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.hostname = u.hostname.toLowerCase();
  return u.toString();
}

export function tryUrl(raw: unknown): string | null {
  try { return safePublicUrl(raw); } catch { return null; }
}

/** Clé de dédoublonnage : hôte sans www + chemin sans slash final + requête triée, protocole ignoré. */
export function canonicalKey(raw: string): string {
  const u = new URL(safePublicUrl(raw));
  const host = u.hostname.replace(/^www\.|^m\.|^amp\./, '');
  const path = u.pathname.replace(/\/amp\/?$/, '/').replace(/\/+$/, '') || '/';
  const params = [...u.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const q = params.length ? '?' + params.map(([k, v]) => `${k}=${v}`).join('&') : '';
  return `${host}${path}${q}`;
}

export function domainOf(raw: string): string {
  try { return new URL(raw).hostname.replace(/^www\./, ''); } catch { return ''; }
}
