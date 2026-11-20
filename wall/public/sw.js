// The wall's offline copy: keeps the scene's files so the page still opens if the LAN server restarts.
// Saved copies are shown at once and refreshed in the background, so an update arrives on the next open.
// Nothing under /api/ is ever kept (orders, the event streams, the PIN), and neither is any non-GET request.
const CACHE = "kennko-wall-v3";
const SHELL = ["/", "/wall.css", "/wall.mjs", "/scene/scene.mjs", "/scene/sprites.mjs", "/scene/logic.mjs", "/brand/icon.png", "/brand/wordmark-white.png", "/brand/wordmark-blue.png"];
const STATIC = /\.(html|css|mjs|js|png|svg|webmanifest)$/;

self.addEventListener("install", (event) => {
  // One missing file (the pad's, when it is off) must not stop the worker installing.
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((f) => cache.add(f)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith("kennko-wall-") && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  const isPage = request.mode === "navigate";
  if (!isPage && !STATIC.test(url.pathname) && !url.pathname.startsWith("/brand/")) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = isPage ? url.pathname : request;
      const saved = await cache.match(key);
      const fresh = fetch(request).then((response) => {
        if (response.ok && response.status === 200) cache.put(key, response.clone());
        return response;
      });
      if (saved) { fresh.catch(() => {}); return saved; }
      return fresh;
    }),
  );
});
