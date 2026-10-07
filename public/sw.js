// Minimal offline support: network first, fall back to the cache.
// All data lives in IndexedDB, so this only needs to cache the app shell.
const CACHE = "habit-tracker-v1"

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

self.addEventListener("fetch", (event) => {
  const { request } = event
  const url = new URL(request.url)
  // Only the app itself is cached; API calls always go to the network.
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/")) return
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match(self.registration.scope))),
  )
})

// ---------- notifications from the sync server ----------

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Habit Tracker", {
      body: data.body || "",
      tag: data.tag,
      icon: "icon-192.png",
      badge: "icon-192.png",
      data: { url: data.url, inboxId: data.inboxId },
    }),
  )
})

// Tapping a notification opens the app on that inbox item.
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const { inboxId } = event.notification.data || {}
  const url = new URL(self.registration.scope)
  if (inboxId) url.searchParams.set("inbox", inboxId)
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (open) {
        open.postMessage({ type: "open-inbox", id: inboxId })
        return open.focus()
      }
      return self.clients.openWindow(url.href)
    }),
  )
})
