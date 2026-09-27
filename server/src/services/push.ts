import webpush from 'web-push';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { bus, type AppEvent } from './events.js';
import { getPreferences, inQuietHours } from './preferences.js';

let vapid: { publicKey: string; privateKey: string } | null = null;

/** Clés VAPID : depuis l'environnement, sinon générées une fois et conservées en base. */
export async function initPush() {
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    vapid = { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  } else {
    const r = await query<{ value: any }>(`SELECT value FROM settings WHERE key = 'vapid'`);
    if (r.rows[0]) vapid = r.rows[0].value;
    else {
      vapid = webpush.generateVAPIDKeys();
      await query(`INSERT INTO settings(key, value) VALUES ('vapid', $1) ON CONFLICT DO NOTHING`, [JSON.stringify(vapid)]);
      console.log('[push] clés VAPID générées et enregistrées en base');
    }
  }
  webpush.setVapidDetails(config.vapidSubject, vapid!.publicKey, vapid!.privateKey);
}

export const vapidPublicKey = () => vapid?.publicKey ?? '';

export async function saveSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, ua?: string) {
  await query(
    `INSERT INTO push_subscriptions(endpoint, keys, user_agent) VALUES ($1, $2, $3)
     ON CONFLICT (endpoint) DO UPDATE SET keys = EXCLUDED.keys, user_agent = EXCLUDED.user_agent`,
    [sub.endpoint, JSON.stringify(sub.keys), ua?.slice(0, 300) ?? null],
  );
}

export async function removeSubscription(endpoint: string) {
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [endpoint]);
}

export async function sendPushToAll(payload: { title: string; body: string; conversationId?: string; tag?: string }) {
  if (!vapid) return { sent: 0, failed: 0 };
  const subs = await query<{ endpoint: string; keys: any }>(`SELECT endpoint, keys FROM push_subscriptions`);
  let sent = 0, failed = 0;
  await Promise.all(subs.rows.map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e: any) {
      failed++;
      if (e?.statusCode === 404 || e?.statusCode === 410) await removeSubscription(s.endpoint); // abonnement expiré
      else console.warn('[push] échec :', e?.statusCode ?? e?.message);
    }
  }));
  return { sent, failed };
}

/** Point d'entrée unique : applique les préférences, puis diffuse (SSE + Web Push). */
export async function notify(n: Extract<AppEvent, { type: 'notify' }>, opts: { muted?: boolean } = {}) {
  const p = await getPreferences();
  const allowed = n.category === 'news' ? p.notifyNews : n.category === 'jobs' ? p.notifyJobs : p.notifyReminders;
  if (!allowed || opts.muted) return false;
  if (inQuietHours(p) && !(n.category === 'reminders' && p.remindersIgnoreQuietHours)) return false;
  bus.publish(n);
  await sendPushToAll({ title: n.title, body: n.body, conversationId: n.conversationId, tag: n.tag });
  return true;
}
