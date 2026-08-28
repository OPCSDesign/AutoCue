// Cache-first app shell so TracingBoard keeps working with no signal.
// voice.js and moonshine.js find this cache by its 'tracingboard-' prefix.
const CACHE = 'tracingboard-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './matcher.js',
               './voice.js', './moonshine.js', './webdav.js',
               './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  // cache:'reload' bypasses the HTTP cache — otherwise a new version can
  // precache stale files served from the browser cache (Pages max-age=600).
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Never touch cross-origin requests (Nextcloud, etc.) or WebDAV paths —
  // cache-first would serve stale bodies and the offline fallback would
  // corrupt failed API responses with index.html.
  if (url.origin !== location.origin || url.pathname.includes('/remote.php/')) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        if (res.ok && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html'))
    )
  );
});
