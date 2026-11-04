self.addEventListener('install', (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', () => { /* Preserve the existing network-first app behavior. */ });

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { body: event.data ? event.data.text() : 'Yeni bildirimin var.' }; }
  const title = payload.title || 'AYTAR';
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || 'Yeni bir bildirimin var.',
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: payload.tag || 'aytar-notification', renotify: Boolean(payload.tag),
    data: { url: payload.url || '/', kind: payload.kind || 'general' },
    vibrate: payload.kind === 'incoming_call' ? [250, 100, 250, 100, 500] : [150, 80, 150],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) { await client.focus(); if ('navigate' in client) await client.navigate(target); return; }
    }
    await self.clients.openWindow(target);
  })());
});
