// ─────────────────────────────────────────────────────────────────────────────
// Warehouse Delivery System — Service Worker
// AUTO-UPDATE: bump CACHE_VERSION on every deploy to force immediate refresh
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_VERSION = "wds-v1.6";
const CACHE_NAME = `wds-cache-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
const CDN_HOSTS = ["unpkg.com", "cdn.jsdelivr.net"];

// ── Install ──────────────────────────────────────────────────────────────────
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

// ── Activate ─────────────────────────────────────────────────────────────────
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

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch Supabase traffic
  if (url.hostname.includes("supabase.co")) return;

  // Only cache GET requests
  if (request.method !== "GET") return;

  // CDN: cache-first
  if (CDN_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      const res = await fetch(request);
      if (!res || !res.ok) return res;

      const resForCache = res.clone();
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, resForCache);

      return res;
    })());
    return;
  }

  // App shell / same-origin: network-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);

        if (res && res.ok) {
          const resForCache = res.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, resForCache);
        }

        return res;
      } catch (err) {
        const cached = await caches.match(request);
        if (cached) return cached;

        if (request.mode === "navigate") {
          const fallback = await caches.match("./index.html");
          if (fallback) return fallback;
        }

        throw err;
      }
    })());
    return;
  }
});

// ── Message ──────────────────────────────────────────────────────────────────
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// ── Push ─────────────────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = { title: "Warehouse Update", body: "Tap to open", icon: "./icons/icon-192.png" };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
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
      body: data.body || "",
      icon: data.icon || "./icons/icon-192.png",
      badge: "./icons/icon-72.png",
      tag: data.tag || data.type || "wds",
      renotify: true,
      vibrate,
      data: data.data || { url: "/" },
      requireInteraction: data.type === "high_priority",
    })
  );
});

// ── Notification click ───────────────────────────────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(event.notification.data?.url || "/");
    })
  );
});
