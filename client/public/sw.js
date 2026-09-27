// Service worker Vigie : notifications push.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Vigie', body: event.data?.text() }; }
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const visible = wins.find(w => w.visibilityState === 'visible' && w.focused);
    if (visible) { visible.postMessage({ type: 'push', data }); return; } // l'application affiche déjà un bandeau
    await self.registration.showNotification(data.title || 'Vigie', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: data.tag,
      data: { conversationId: data.conversationId },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.conversationId;
  const url = id ? `/#/c/${id}` : '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) { await w.focus(); w.postMessage({ type: 'open', conversationId: id }); return; }
    await self.clients.openWindow(url);
  })());
});
