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
      // Keeping a copy is on the side: if it fails (storage full), the good answer still goes to the page.
      if (response.ok) cache.put(event.request, response.clone()).catch(() => {});
      return response;
    } catch (err) {
      const copy = await cache.match(event.request, { ignoreSearch: true });
      if (copy) return copy;
      throw err;
    }
  })());
});

// ---- notifications ----
// Buddy's server sends { title, body, session, tag } (web/lib/push.js message). Each one is shown; tapping it opens the
// app on that session (/app#claude/<session>), in the app's window if it is open.

self.addEventListener('push', (event) => {
  let data;
  try {
    data = (event.data ? event.data.json() : null) ?? {};
  } catch {
    data = {}; // not JSON: a notification with Buddy's name only
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Buddy';
  const session = typeof data.session === 'string' && /^[\w-]{1,100}$/.test(data.session) ? data.session : '';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : 'buddy',
    icon: '/icon-192.png',
    data: { url: session ? `/app#claude/${session}` : '/app' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).pathname.startsWith('/app'));
    if (!open) return self.clients.openWindow(url);
    open.postMessage({ type: 'open', url });
    return open.focus();
  })());
});
