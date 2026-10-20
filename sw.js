/* Service Worker - Dashboard Terpadu Karhutla Rakumpit
   Naikkan VERSION setiap kali index.html / aset berubah agar cache lama dibersihkan. */
const VERSION = 'v2.0.5';
const SHELL_CACHE = 'karhutla-shell-' + VERSION;
const LIB_CACHE = 'karhutla-lib-' + VERSION;
const TILE_CACHE = 'karhutla-tiles-v1';
const DATA_CACHE = 'karhutla-data-v1';
const KEEP = [SHELL_CACHE, LIB_CACHE, TILE_CACHE, DATA_CACHE];
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];
const LIB_HOSTS = ['unpkg.com', 'cdn.tailwindcss.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com', 'basemaps.cartocdn.com', 'gibs.earthdata.nasa.gov', 'tile.opentopomap.org'];
const DATA_HOSTS = ['script.google.com', 'script.googleusercontent.com', 'api.open-meteo.com', 'air-quality-api.open-meteo.com', 'api.bmkg.go.id', 'cuaca.bmkg.go.id'];
const TILE_MAX = 400;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    // skipWaiting TIDAK otomatis: pengguna diberi tombol "Muat ulang" agar tidak kehilangan data yang sedang diisi.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('karhutla-') && !KEEP.includes(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (e) { /* abaikan */ } }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) self.skipWaiting();
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
  });
}
async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const net = fetch(request).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone()); return res; }).catch(() => null);
  if (cached) { event.waitUntil(net); return cached; }
  return (await net) || Response.error();
}
async function cacheFirst(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === 'opaque')) { cache.put(request, res.clone()); if (max) trim(cacheName, max); }
    return res;
  } catch (e) { return Response.error(); }
}
// Data (GAS / cuaca): jaringan dulu; bila offline pakai salinan terakhir. Tarikan manual (action=update) tidak disimpan.
async function networkFirstData(request) {
  const url = new URL(request.url);
  const key = new Request(url.origin + url.pathname + (url.search ? '?' + [...url.searchParams].filter(([k]) => k !== '_').map(([k, v]) => k + '=' + v).join('&') : ''));
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await withTimeout(fetch(request), 25000);
    if (res && res.ok && url.searchParams.get('action') !== 'update') cache.put(key, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(key);
    if (cached) { const h = new Headers(cached.headers); h.set('X-From-Cache', '1'); return new Response(await cached.blob(), { status: 200, headers: h }); }
    return Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;

  // Halaman utama: jaringan dulu (agar update cepat terlihat), cadangan dari cache
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const pre = event.preloadResponse && await event.preloadResponse;
        const res = pre || await withTimeout(fetch(req), 6000);
        if (res && res.ok) { const c = await caches.open(SHELL_CACHE); c.put('index.html', res.clone()); }
        return res;
      } catch (e) {
        const c = await caches.open(SHELL_CACHE);
        return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) { event.respondWith(staleWhileRevalidate(req, SHELL_CACHE, event)); return; }
  if (TILE_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) { event.respondWith(cacheFirst(req, TILE_CACHE, TILE_MAX)); return; }
  if (LIB_HOSTS.includes(url.hostname)) { event.respondWith(staleWhileRevalidate(req, LIB_CACHE, event)); return; }
  if (DATA_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) { event.respondWith(networkFirstData(req)); return; }
});
