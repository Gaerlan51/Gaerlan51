/* Service worker: shell caching only.
 *
 * Deliberately never caches or queues a scan. Offline scanning was ruled out at
 * design time — an offline punch has to trust the phone's clock, which is the
 * exact hole this system exists to close. So API requests always go to the
 * network, and when the network is gone the app says so.
 */

const SHELL = "dtr-shell-v1";
const ASSETS = [
  "/app/",
  "/static/shared/base.css",
  "/static/app/app.css",
  "/static/app/app.js",
  "/manifest.webmanifest",
  "/static/app/icons/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
