const CACHE = 'shahzap-shell-v1';
const APP_SHELL = ['/'];

// ShahZap logo used on the notification / lock screen.
const ICON = '/android-chrome-192x192.png';
const BADGE = '/favicon-32x32.png';

// Re-upload the cached app shell once per deploy (invalidate stale copies).
const VERSION = '1';
const CACHED = 'shahzap-cache-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)),
      caches.open(CACHED).then((cache) => cache.addAll([ICON, BADGE])),
      self.skipWaiting(),
    ]),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match('/')),
    ),
  );
});

// ── Web Push ───────────────────────────────────────────────────────────────
// The service worker stays alive in the background after the page is closed,
// so pushes delivered while the user is offline/away still surface here.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'ShahZap' };
  }

  const title = data.title || 'ShahZap';
  const clickPath = data.clickPath || '/';
  const body = data.text || data.body || '';

  const options = {
    body,
    icon: ICON,
    badge: BADGE,
    tag: data.kind || 'notification',
    renotify: true,
    vibrate: data.kind === 'friend_request' ? [60, 60, 60] : [70, 140, 70],
    data: { clickPath, conversationId: data.conversationId || null },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.clickPath) || '/';

  const open = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(new URL(target, self.location.origin).href);
    });

  event.waitUntil(open());
});
