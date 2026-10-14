importScripts('./macro-data.js');
const CACHE_NAME = 'macro-bias-v2-official-2';
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icon.jpg', './macro-data.js', './dashboard-data.js'];
const DATA_URL = new URL('./data/economic-data.json', self.location).href;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('macro-bias-') && key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (url.pathname === new URL(DATA_URL).pathname) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request, { cache: 'no-store' });
        if (!response.ok) throw new Error('Data unavailable');
        const next = MacroData.validateSnapshot(await response.clone().json());
        const oldResponse = await cache.match(DATA_URL);
        if (oldResponse) {
          const old = MacroData.validateSnapshot(await oldResponse.json());
          if (old.generatedAt && (!next.generatedAt || next.generatedAt < old.generatedAt)) throw new Error('Older snapshot');
        }
        await cache.put(DATA_URL, response.clone());
        return response;
      } catch {
        // Preserve timestamps in offline data; never substitute index.html for JSON.
        return (await cache.match(DATA_URL)) || new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && APP_FILES.some(file => new URL(file, self.location).href === event.request.url)) {
        const cache = await caches.open(CACHE_NAME); await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return (await caches.match(event.request)) || (event.request.mode === 'navigate' ? await caches.match('./index.html') : new Response('', { status: 503 }));
    }
  })());
});
