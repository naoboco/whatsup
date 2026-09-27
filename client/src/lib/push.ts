import { api } from './api';

function urlBase64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try { return await navigator.serviceWorker.register('/sw.js'); } catch { return null; }
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<string> {
  if (!pushSupported()) throw new Error('Ce navigateur ne prend pas en charge les notifications push.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Autorisation de notification refusée dans le navigateur.');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api.pushKey();
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
  await api.subscribe(sub.toJSON());
  return 'Notifications activées sur cet appareil.';
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (sub) { await api.unsubscribe(sub.endpoint); await sub.unsubscribe(); }
}
