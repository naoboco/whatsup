let TZ = 'Asia/Jerusalem';
export const setTimeZone = (tz: string) => { TZ = tz; };
export const getTimeZone = () => TZ;

const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

export function time(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** « 18:04 », « Hier », « lundi », « 12/09/2026 » — comme une liste de discussions. */
export function listStamp(iso: string) {
  const d = new Date(iso), now = new Date();
  const diffDays = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(d))) / 86_400_000);
  if (diffDays <= 0) return time(iso);
  if (diffDays === 1) return 'Hier';
  if (diffDays < 7) return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long' }).format(d);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

export function daySeparator(iso: string) {
  const d = new Date(iso), now = new Date();
  const diffDays = Math.round((Date.parse(dayKey(now)) - Date.parse(dayKey(d))) / 86_400_000);
  if (diffDays === 0) return 'Aujourd’hui';
  if (diffDays === 1) return 'Hier';
  const sameYear = dayKey(d).slice(0, 4) === dayKey(now).slice(0, 4);
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: sameYear ? undefined : 'numeric' }).format(d);
}
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

export function fullDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
export function shortDate(iso: string) {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}
export function relative(iso: string | null) {
  if (!iso) return 'jamais';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return `le ${shortDate(iso)}`;
}
/** Valeurs pour <input type=date/time> dans le fuseau de l'application. */
export function localParts(iso: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` };
}
export const RECURRENCE: Record<string, string> = { none: 'Une seule fois', daily: 'Tous les jours', weekdays: 'Jours ouvrés (dim.–jeu.)', weekly: 'Chaque semaine', monthly: 'Chaque mois' };

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
}
