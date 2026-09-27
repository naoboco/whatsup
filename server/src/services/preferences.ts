import { z } from 'zod';
import { query } from '../db/pool.js';
import { config } from '../config.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const PreferencesSchema = z.object({
  notifyNews: z.boolean().default(true),
  notifyJobs: z.boolean().default(true),
  notifyReminders: z.boolean().default(true),
  /** Regrouper les nouveautés d'une même collecte en une seule notification au-delà de ce seuil. */
  groupThreshold: z.number().int().min(1).max(50).default(3),
  quietHours: z.object({ enabled: z.boolean().default(false), start: hhmm.default('22:00'), end: hhmm.default('07:00') }).default({ enabled: false, start: '22:00', end: '07:00' }),
  /** Les rappels passent-ils outre les heures calmes ? (par défaut oui : vous les avez demandés). */
  remindersIgnoreQuietHours: z.boolean().default(true),
  timezone: z.string().default(config.timezone),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export async function getPreferences(): Promise<Preferences> {
  const r = await query<{ value: unknown }>(`SELECT value FROM settings WHERE key = 'preferences'`);
  return PreferencesSchema.parse(r.rows[0]?.value ?? {});
}

export async function savePreferences(input: unknown): Promise<Preferences> {
  const current = await getPreferences();
  const merged = PreferencesSchema.parse({ ...current, ...(input as object), quietHours: { ...current.quietHours, ...((input as any)?.quietHours ?? {}) } });
  if (!isValidTimeZone(merged.timezone)) throw new Error('Fuseau horaire inconnu');
  await query(`INSERT INTO settings(key, value) VALUES ('preferences', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(merged)]);
  return merged;
}

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('fr', { timeZone: tz }); return true; } catch { return false; }
}

export function inQuietHours(p: Preferences, now = new Date()): boolean {
  if (!p.quietHours.enabled) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: p.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const { start, end } = p.quietHours;
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}
