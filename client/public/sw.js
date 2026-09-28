const CACHE = 'vigie-shell-v2';
const SHELL = ['/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  const page = await fetch('/index.html', { cache: 'reload' });
  if (!page.ok) throw new Error('Interface indisponible');
  const assets = [...new Set((await page.clone().text()).match(/\/assets\/[^"'\s]+/g) || [])];
  await cache.put('/index.html', page);
  await cache.addAll([...SHELL.slice(1), ...assets]);
  await self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('vigie-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.open(CACHE)).match('/index.html')));
  } else if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) || fetch(request);
    })());
  }
});

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
