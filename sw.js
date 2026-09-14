/* WEB MSN — Service Worker (PWA + Web Push real) */
const CACHE = 'webmsn-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/config.js',
  '/pwa-push.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Network-first for API; cache-first for static
  if (url.pathname.startsWith('/api') || url.pathname.includes('socket.io')) {
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetched = fetch(event.request)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});

// Push real — payload JSON do backend
self.addEventListener('push', (event) => {
  let data = {
    title: 'WEB MSN',
    body: 'Nova mensagem',
    conversationId: null,
    contactId: null,
    url: '/'
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    try {
      data.body = event.data ? event.data.text() : data.body;
    } catch (__) {}
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.conversationId ? `conv-${data.conversationId}` : 'webmsn-msg',
    renotify: true,
    data: {
      url: data.url || (data.contactId ? `/?chat=${encodeURIComponent(data.contactId)}` : '/'),
      conversationId: data.conversationId,
      contactId: data.contactId
    },
    vibrate: [120, 60, 120],
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(data.title || 'WEB MSN', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            url: target,
            contactId: event.notification.data && event.notification.data.contactId,
            conversationId: event.notification.data && event.notification.data.conversationId
          });
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(target);
      }
    })
  );
});
