// ─────────────────────────────────────────────────────────────────────────────
// Warehouse Delivery System — Service Worker
// AUTO-UPDATE: bump CACHE_VERSION on every deploy to force immediate refresh
// Vercel automatically serves the new sw.js on each push — this triggers
// the updatefound → SKIP_WAITING → controllerchange → reload chain in the app
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_VERSION = "wds-v1.4";
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
      self.clients.claim(),
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
  if (url.hostname.includes("supabase.co")) return;
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
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Push: fires even when app is closed/locked ────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Warehouse Update", body: "Tap to open", icon: "./icons/icon-192.png" };
  if (event.data) {
    try { data = { ...data, ...event.data.json() }; }
    catch(e) { data.body = event.data.text(); }
  }
  const vibrate = {
    new_request:   [100, 50, 100, 50, 100],
    high_priority: [150, 80, 150, 80, 150, 80, 200],
    completed:     [100, 50, 200],
    cancelled:     [200, 100, 200],
    chat:          [80, 40, 80],
    break:         [120, 60, 120],
  }[data.type] || [100, 50, 100];

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body || "",
      icon:    data.icon || "./icons/icon-192.png",
      badge:   "./icons/icon-72.png",
      tag:     data.tag || data.type || "wds",
      renotify: true,
      vibrate,
      data:    data.data || { url: "/" },
      requireInteraction: data.type === "high_priority",
    })
  );
});

// ── Notification click: open/focus the app ────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      const existing = clients.find(c => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url || "/");
    })
  );
});
