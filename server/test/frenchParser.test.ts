import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { parseFrenchReminder, nextOccurrence } from '../src/services/frenchParser.js';

const TZ = 'Asia/Jerusalem';
// Lundi 28 septembre 2026, 00:58 à Jérusalem
const now = DateTime.fromISO('2026-09-28T00:58:00', { zone: TZ });
const p = (s: string) => parseFrenchReminder(s, now);
const fmt = (d: DateTime | null) => d?.toFormat('yyyy-LL-dd HH:mm');

describe('parseFrenchReminder', () => {
  it('cas de référence Mobileye', () => {
    const r = p('Rappelle-moi de postuler chez Mobileye demain à 18 h');
    expect(r.text).toBe('Postuler chez Mobileye');
    expect(fmt(r.due)).toBe('2026-09-29 18:00');
    expect(r.recurrence).toBe('none');
    expect(r.missing).toEqual([]);
  });
  it('heure avec minutes et sans « à »', () => {
    const r = p("rappelle moi d'appeler Dana demain 9h30");
    expect(r.text).toBe('Appeler Dana');
    expect(fmt(r.due)).toBe('2026-09-29 09:30');
  });
  it('relatif', () => {
    expect(fmt(p('Rappelle-moi de boire de l’eau dans 2 heures').due)).toBe('2026-09-28 02:58');
    expect(fmt(p('rappelle-moi dans une demi-heure de relancer Yossi').due)).toBe('2026-09-28 01:28');
    expect(p('rappelle-moi dans une demi-heure de relancer Yossi').text).toBe('Relancer Yossi');
  });
  it('date explicite', () => {
    const r = p("Rappelle-moi le 3 octobre à 14h30 d'envoyer le CV");
    expect(fmt(r.due)).toBe('2026-10-03 14:30');
    expect(r.text).toBe("Envoyer le CV");
    expect(fmt(p('rappel: entretien le 05/11 à 10h').due)).toBe('2026-11-05 10:00');
  });
  it('jour de la semaine', () => {
    const r = p('Rappelle-moi jeudi soir de préparer l’entretien');
    expect(fmt(r.due)).toBe('2026-10-01 20:00');
    expect(r.text).toBe("Préparer l'entretien");
  });
  it('heure du soir', () => {
    expect(fmt(p('rappelle-moi à 6h du soir de sortir').due)).toBe('2026-09-28 18:00');
    expect(fmt(p('rappelle-moi ce soir de lire les offres').due)).toBe('2026-09-28 20:00');
  });
  it('heure passée aujourd’hui → demain', () => {
    expect(fmt(p('rappelle-moi à 0h30 de dormir').due)).toBe('2026-09-29 00:30');
  });
  it('répétitions', () => {
    const d = p('Rappelle-moi tous les jours à 8h de lire la veille');
    expect(d.recurrence).toBe('daily');
    expect(fmt(d.due)).toBe('2026-09-28 08:00');
    expect(d.text).toBe('Lire la veille');
    const w = p('chaque dimanche à 9h rappelle-moi de consulter les offres Mobileye');
    expect(w.recurrence).toBe('weekly');
    expect(fmt(w.due)).toBe('2026-10-04 09:00');
    expect(p('rappelle-moi en semaine à 17h de faire le point').recurrence).toBe('weekdays');
    expect(p('rappelle-moi tous les mois le 1er octobre de payer').recurrence).toBe('monthly');
  });
  it('éléments manquants', () => {
    expect(p('rappelle-moi de postuler').missing).toEqual(['date']);
    expect(p('rappelle-moi demain à 10h').missing).toEqual(['text']);
  });
});

describe('nextOccurrence', () => {
  it('jours ouvrés israéliens : jeudi → dimanche', () => {
    const thu = DateTime.fromISO('2026-10-01T17:00', { zone: TZ });
    expect(fmt(nextOccurrence(thu, 'weekdays', thu))).toBe('2026-10-04 17:00');
  });
  it('rattrape les occurrences manquées', () => {
    const old = DateTime.fromISO('2026-09-20T08:00', { zone: TZ });
    expect(fmt(nextOccurrence(old, 'daily', now))).toBe('2026-09-28 08:00');
  });
  it('mensuel', () => {
    const d = DateTime.fromISO('2026-09-15T10:00', { zone: TZ });
    expect(fmt(nextOccurrence(d, 'monthly', d))).toBe('2026-10-15 10:00');
  });
});
