import { DateTime } from 'luxon';

export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';

export interface LocalParse {
  text: string;
  due: DateTime | null;
  recurrence: Recurrence;
  missing: ('text' | 'date')[];
}

const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']; // luxon : lundi = 1
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const NUM_WORDS: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, quinze: 15, vingt: 20, trente: 30 };

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'");

/**
 * Analyseur de secours (sans OpenAI) pour les demandes de rappel en français courant.
 * Travaille sur une copie sans accents de même longueur que l'original : les positions
 * trouvées servent à retirer les fragments temporels du texte original.
 */
export function parseFrenchReminder(input: string, now: DateTime): LocalParse {
  const original = input.replace(/[’`]/g, "'").trim();
  let s = strip(original).toLowerCase();
  // Cas exotiques (ligatures…) : on renonce à l'alignement des positions plutôt que d'échouer.
  const aligned = s.length === original.length;
  const cut: [number, number][] = [];
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s);
    if (m) {
      cut.push([m.index, m.index + m[0].length]);
      s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length); // fragment consommé
    }
    return m;
  };

  let recurrence: Recurrence = 'none';
  let weeklyDay: number | null = null;
  let date: DateTime | null = null;
  let hour: number | null = null, minute = 0;
  let relative: DateTime | null = null;
  let periodHint: 'matin' | 'midi' | 'apres-midi' | 'soir' | null = null;

  // --- Répétition ---
  let m: RegExpExecArray | null;
  if (take(/\b(tous les jours|chaque jour|quotidiennement|chaque matin|tous les matins|tous les soirs|chaque soir)\b/)) recurrence = 'daily';
  else if (take(/\b(en semaine|(?:les )?jours (?:ouvres|ouvrables)|du dimanche au jeudi|du lundi au vendredi)\b/)) recurrence = 'weekdays';
  else if ((m = take(new RegExp(`\\b(?:tous les|chaque) (${DAYS.join('|')})s?\\b`)))) { recurrence = 'weekly'; weeklyDay = DAYS.indexOf(m[1]) + 1; }
  else if (take(/\b(toutes les semaines|chaque semaine|une fois par semaine)\b/)) recurrence = 'weekly';
  else if (take(/\b(tous les mois|chaque mois|une fois par mois|mensuellement)\b/)) recurrence = 'monthly';
  if (/\b(chaque matin|tous les matins)\b/.test(s)) periodHint = 'matin';
  if (/\b(chaque soir|tous les soirs)\b/.test(s)) periodHint = 'soir';

  // --- Relatif : « dans 2 heures », « dans une demi-heure » ---
  if (take(/\bdans (?:une )?demi[- ]heure\b/)) relative = now.plus({ minutes: 30 });
  else if (take(/\bdans un quart d'heure\b/)) relative = now.plus({ minutes: 15 });
  else if ((m = take(/\bdans (\d{1,3}|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente) ?(minutes?|mins?|mn|heures?|h|jours?|semaines?)\b/))) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
    const u = m[2];
    relative = u.startsWith('m') ? now.plus({ minutes: n }) : u.startsWith('h') ? now.plus({ hours: n }) : u.startsWith('j') ? now.plus({ days: n }) : now.plus({ weeks: n });
    if (!u.startsWith('m') && !u.startsWith('h')) { date = relative.startOf('day'); relative = null; }
  }

  // --- Jour ---
  if (take(/\bapres[- ]demain\b/)) date = now.plus({ days: 2 }).startOf('day');
  else if (take(/\bdemain\b/)) date = now.plus({ days: 1 }).startOf('day');
  else if (take(/\b(aujourd'hui|ce jour)\b/)) date = now.startOf('day');
  else if (take(/\bce soir\b/)) { date = now.startOf('day'); periodHint = 'soir'; }
  else if (take(/\bce matin\b/)) { date = now.startOf('day'); periodHint = 'matin'; }
  else if (take(/\bcet apres[- ]midi\b/)) { date = now.startOf('day'); periodHint = 'apres-midi'; }
  else if ((m = take(new RegExp(`\\b(?:le )?(\\d{1,2}|1er) (${MONTHS.join('|')})(?: (\\d{4}))?\\b`)))) {
    const day = m[1] === '1er' ? 1 : Number(m[1]);
    const month = MONTHS.indexOf(m[2]) + 1;
    let d = now.set({ month, day }).startOf('day');
    if (m[3]) d = d.set({ year: Number(m[3]) });
    else if (d < now.startOf('day')) d = d.plus({ years: 1 });
    if (d.isValid && d.day === day) date = d;
  } else if ((m = take(/\b(?:le )?(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/))) {
    const day = Number(m[1]), month = Number(m[2]);
    let year = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : now.year;
    let d = DateTime.fromObject({ year, month, day }, { zone: now.zone });
    if (!m[3] && d.isValid && d < now.startOf('day')) d = d.plus({ years: 1 });
    if (d.isValid) date = d;
  } else if (recurrence === 'none' && (m = take(new RegExp(`\\b(?:ce |le )?(${DAYS.join('|')})(?: prochain)?\\b`)))) {
    const target = DAYS.indexOf(m[1]) + 1;
    let delta = (target - now.weekday + 7) % 7;
    if (delta === 0) delta = 7;
    date = now.plus({ days: delta }).startOf('day');
  }

  // --- Heure ---
  if ((m = take(/\b(?:a|vers|pour) midi(?: et demi)?\b|\bmidi\b/))) { hour = 12; minute = /demi/.test(m[0]) ? 30 : 0; }
  else if (take(/\b(?:a|vers) minuit\b/)) { hour = 0; if (!date) date = now.plus({ days: 1 }).startOf('day'); }
  else if ((m = take(/\b(?:(?:a|vers|pour|des) )?(\d{1,2}) ?(?:h|heures?)(?: ?(\d{2}))?(?: (du matin|du soir|de l'apres[- ]midi))?(?![a-z])/)) ||
           (m = take(/\b(\d{1,2}):(\d{2})\b/))) {
    hour = Number(m[1]); minute = m[2] ? Number(m[2]) : 0;
    const p = m[3];
    if (p && /soir|apres/.test(p) && hour < 12) hour += 12;
    if (hour > 23 || minute > 59) { hour = null; minute = 0; }
  }
  if (take(/\b(le |du )?matin\b/)) periodHint ??= 'matin';
  if (take(/\b(l'|dans l')?apres[- ]midi\b/)) periodHint ??= 'apres-midi';
  if (take(/\b(le |du )?soir\b/)) periodHint ??= 'soir';
  if (hour !== null && hour < 12 && (periodHint === 'soir' || periodHint === 'apres-midi')) hour += 12;
  if (hour === null && periodHint) hour = { matin: 9, midi: 12, 'apres-midi': 15, soir: 20 }[periodHint];

  // --- Composition de l'échéance ---
  let due: DateTime | null = null;
  if (relative) due = relative.set({ second: 0, millisecond: 0 });
  else if (date || hour !== null || recurrence !== 'none') {
    const h = hour ?? 9;
    if (weeklyDay && !date) {
      let delta = (weeklyDay - now.weekday + 7) % 7;
      let d = now.plus({ days: delta }).set({ hour: h, minute, second: 0, millisecond: 0 });
      if (d <= now) d = d.plus({ weeks: 1 });
      due = d;
    } else {
      let d = (date ?? now).set({ hour: h, minute, second: 0, millisecond: 0 });
      if (!date && d <= now) d = d.plus({ days: 1 });
      due = d;
    }
  }

  // --- Texte : on retire la formule d'appel et les fragments temporels ---
  let chars = (aligned ? original : strip(original)).split('');
  for (const [a, b] of cut) for (let i = a; i < b; i++) chars[i] = '\u0000';
  let text = chars.join('').replace(/\u0000+/g, ' ');
  text = text
    .replace(/^\s*(s'il te pla[iî]t|stp|peux-tu|tu peux|merci de)\s*,?\s*/i, '')
    .replace(/^\s*(rappelle[- ]?moi|rappelle[- ]nous|fais[- ]moi penser|n'oublie pas de me rappeler|pense à me rappeler|rappel\s*:?|note|programme un rappel( pour)?|mets[- ]moi un rappel( pour)?)\s*/i, '')
    .replace(/^\s*(de |d'|qu'|que |à |a |pour )/i, '')
    .replace(/^\s*(n'oublie pas de |n'oublie pas d')/i, '')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/(\s+(à|a|le|pour|vers|et|,))+\s*$/i, '')
    .replace(/^[\s,.;:–-]+|[\s,;:–-]+$/g, '')
    .trim();
  if (text) text = text[0].toUpperCase() + text.slice(1);

  const missing: LocalParse['missing'] = [];
  if (!text) missing.push('text');
  if (!due) missing.push('date');
  return { text, due, recurrence, missing };
}

/** Prochaine occurrence strictement postérieure à `after`. Semaine ouvrée israélienne (dim.–jeu.) pour Asia/Jerusalem. */
export function nextOccurrence(due: DateTime, rec: Recurrence, after: DateTime): DateTime | null {
  if (rec === 'none') return null;
  const israeli = due.zoneName === 'Asia/Jerusalem';
  const isWorkday = (d: DateTime) => (israeli ? d.weekday === 7 || d.weekday <= 4 : d.weekday <= 5);
  let d = due;
  for (let i = 0; i < 5000; i++) {
    d = rec === 'daily' || rec === 'weekdays' ? d.plus({ days: 1 }) : rec === 'weekly' ? d.plus({ weeks: 1 }) : d.plus({ months: 1 });
    if (rec === 'weekdays' && !isWorkday(d)) continue;
    if (d > after) return d;
  }
  return null;
}

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  none: 'une seule fois',
  daily: 'tous les jours',
  weekdays: 'les jours ouvrés',
  weekly: 'chaque semaine',
  monthly: 'chaque mois',
};

export function formatDueFr(d: DateTime): string {
  return d.setLocale('fr').toFormat("cccc d LLLL yyyy 'à' HH'h'mm");
}
