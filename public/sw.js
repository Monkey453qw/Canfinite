/**
 * Service Worker for Infinite Canvas
 * 
 * Caches all static assets for offline use.
 * The math solver API (/api/math-solve) requires internet and is NOT cached —
 * it will simply fail gracefully when offline (the app shows an error toast).
 *
 * All other features (drawing, text, selection, eraser, lasso, undo/redo,
 * constants, unit converter, auto-save to IndexedDB) work fully offline.
 */

const CACHE_NAME = "infinite-canvas-v1";
const OFFLINE_URL = "/";

// Assets to cache on install (core app shell)
const CORE_ASSETS = [
  "/",
  "/manifest.json",
  "/logo.svg",
];

// Install: cache core assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch(() => {
        // If any asset fails, just skip it — we'll cache on demand
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: cache-first for static assets, network-first for API
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // API routes: always try network (math solver needs server)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({
            recognized: "",
            result: "Offline — connect to internet to use the math solver.",
            steps: [],
          }),
          {
            headers: { "Content-Type": "application/json" },
            status: 503,
          }
        );
      })
    );
    return;
  }

  // Everything else: cache-first, fall back to network, then cache
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        // Return cached + update in background
        fetch(event.request)
          .then((response) => {
            if (response.ok) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, response.clone());
              });
            }
          })
          .catch(() => {});
        return cached;
      }

      // Not in cache — fetch from network
      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline and not cached — return the offline page for navigation
          if (event.request.mode === "navigate") {
            return caches.match(OFFLINE_URL);
          }
          return new Response("", { status: 504 });
        });
    })
  );
});
