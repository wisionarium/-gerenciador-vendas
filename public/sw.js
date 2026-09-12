const CACHE = 'sellday-v27';
const CORE = ['/', '/index.html', '/version.json', '/css/styles.css', '/js/app.js', '/js/vendor/html5-qrcode.min.js', '/manifest.webmanifest', '/icons/logo.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return; // nunca cachear API
  if (e.request.method !== 'GET') return;
  // shell do app (html/js/css): sempre rede (pulando cache HTTP), com fallback offline
  const isShell = url.origin === self.location.origin && (
    url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') || url.pathname.endsWith('.webmanifest') || url.pathname === '/version.json'
  );
  const req = isShell ? new Request(url.href, { method: 'GET', mode: 'cors', credentials: 'same-origin', redirect: 'follow', cache: 'reload' }) : e.request;
  e.respondWith(
    fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request).then((m) => m || caches.match('/index.html')))
  );
});
