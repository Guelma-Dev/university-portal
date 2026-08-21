const CACHE_NAME = 'university-portal-v6';
const STATIC_ASSETS = ['/', '/index.html', '/css/styles.css', '/js/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/') || e.request.url.includes('/files/')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
