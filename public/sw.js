const CACHE = 'sellday-v50';
const CORE = ['/', '/index.html', '/version.json', '/css/styles.css', '/js/app.js', '/js/vendor/html5-qrcode.min.js', '/manifest.webmanifest', '/icons/logo.png', '/sfx/love-alarm-notification.mp3'];
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
// ---------- Web Push ----------
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch {}
  const title = data.title || 'SellDay';
  const body = data.body || 'Você tem um aviso novo no SellDay.';
  const tag = data.tag || ('sellday-' + Date.now());
  // som personalizado: com o app fechado o SO toca o som padrão do canal
  // (limite do Web Push); com o app aberto a página toca o SFX (msg abaixo).
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    for (const c of clients) { try { c.postMessage({ type: 'sellday-push-sound' }); } catch {} }
  }).catch(() => {});
  e.waitUntil(
    self.registration.showNotification(title, {
      body, tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      sound: '/sfx/love-alarm-notification.mp3',
      silent: false,
      data: { url: data.url || '/' },
    })
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if (c.url === self.location.origin + url || c.url.startsWith(self.location.origin + url)) {
          if ('focus' in c) return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
