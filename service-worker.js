/* University Portal - Service Worker
   NO CACHING. Always fetches fresh from server.
   This prevents stale content across browsers. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener('fetch', () => {});
