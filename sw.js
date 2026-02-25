// Minimal PWA service worker (app-shell only).
// NOTE: This does NOT cache Supabase/API data to avoid conflicts.
// Works on https or localhost.
//
// ── HOW TO PUSH UPDATES WITHOUT HARD RESETS ───────────────────────────────
// 1. Bump APP_VERSION below (e.g. v9 → v10) whenever you deploy new HTML
// 2. Upload both WarehouseLineFeeder.html + sw.js
// 3. Devices auto-update next time the user switches back to the tab
//    (the app calls reg.update() on every visibilitychange)
// ─────────────────────────────────────────────────────────────────────────
const APP_VERSION = 'v13'; // ← bump this on every deploy
const CACHE_NAME  = 'warehouse-pwa-' + APP_VERSION;

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
  );
  self.skipWaiting(); // activate immediately, don't wait for old tabs to close
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // take control of all open tabs right away
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin requests; let CDNs (React/Babel/Supabase) pass through.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// Allows the page to trigger immediate activation of a waiting SW
// (sent by the visibilitychange handler in the HTML)
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
