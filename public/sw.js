// Minimal offline support: network first, fall back to the cache.
// All data lives in IndexedDB, so this only needs to cache the app shell.
const CACHE = "habit-tracker-v1"

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("fetch", (event) => {
  const { request } = event
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match("/"))),
  )
})
