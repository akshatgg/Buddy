// Buddy on iPhone's service worker. The app's own files (and the sign-in SDK) come from the network first, so a deploy
// shows the next time the app opens, and each one fetched is kept, for opening the app with no network. CACHE changes
// only to drop what an older version kept. Everything else (/api, sign-in's /__/auth) goes to the network as usual.

const CACHE = 'buddy-app-1';
const SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** A file worth keeping: a GET of the app's own files under /app, or of the sign-in SDK. */
function kept(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.href.startsWith(SDK)) return true;
  return url.origin === self.location.origin && /^\/app(\/|$)/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  if (!kept(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (err) {
      const copy = await cache.match(event.request, { ignoreSearch: true });
      if (copy) return copy;
      throw err;
    }
  })());
});
