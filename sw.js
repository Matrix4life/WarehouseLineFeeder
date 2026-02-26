// ─────────────────────────────────────────────────────────────────────────────
// Warehouse Delivery System — Service Worker
// AUTO-UPDATE: bump CACHE_VERSION on every deploy to force immediate refresh
// Vercel automatically serves the new sw.js on each push — this triggers
// the updatefound → SKIP_WAITING → controllerchange → reload chain in the app
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_VERSION = "wds-v1.0";
const CACHE_NAME = `wds-cache-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

const CDN_HOSTS = ["unpkg.com", "cdn.jsdelivr.net"];

// ── Install: cache shell, activate immediately ────────────────────────────────
self.addEventListener("install", (event) => {
  // skipWaiting so a freshly installed SW activates without waiting for tabs to close
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS).catch((err) =>
        console.warn("[SW] Pre-cache failed:", err)
      )
    )
  );
});

// ── Activate: take control of all clients immediately, clear old caches ───────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      // Claim all open tabs immediately so they use the new SW right away
      self.clients.claim(),
      // Delete any old cache versions
      caches.keys().then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("wds-cache-") && k !== CACHE_NAME)
            .map((k) => {
              console.log("[SW] Clearing old cache:", k);
              return caches.delete(k);
            })
        )
      )
    ])
  );
});

// ── Fetch: network-first for app shell, cache-first for CDN ──────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Always bypass SW for Supabase — must be live
  if (url.hostname.includes("supabase.co")) return;

  // CDN resources: cache-first (they're versioned by unpkg so safe to cache)
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((res) => {
          if (res.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

  // App shell: network-first so updates always land immediately
  // Falls back to cache only when truly offline
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          if (res.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(event.request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === "navigate") {
              return caches.match("./index.html");
            }
          })
        )
    );
    return;
  }
});

// ── Message: manual skip-waiting trigger from app ─────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
