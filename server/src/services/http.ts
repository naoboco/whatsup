import { config } from '../config.js';

export class FetchError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

const MAX_BYTES = 5 * 1024 * 1024;

export async function fetchText(url: string, opts: { timeoutMs?: number; accept?: string } = {}): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': config.httpUserAgent, Accept: opts.accept ?? '*/*' },
    });
    if (!res.ok) throw new FetchError(`HTTP ${res.status} sur ${new URL(url).hostname}`, res.status);
    const len = Number(res.headers.get('content-length') ?? 0);
    if (len > MAX_BYTES) throw new FetchError('Réponse trop volumineuse');
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new FetchError('Réponse trop volumineuse');
    return text;
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new FetchError(`Délai dépassé sur ${new URL(url).hostname}`);
    if (e instanceof FetchError) throw e;
    throw new FetchError(`Réseau : ${e?.cause?.code ?? e?.message ?? 'erreur inconnue'}`);
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson<T = unknown>(url: string, opts: { timeoutMs?: number } = {}): Promise<T> {
  const text = await fetchText(url, { ...opts, accept: 'application/json' });
  try { return JSON.parse(text) as T; } catch { throw new FetchError(`JSON invalide depuis ${new URL(url).hostname}`); }
}
