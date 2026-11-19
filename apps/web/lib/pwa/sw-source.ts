/**
 * The website's service worker, as text. Served by app/sw.js/route.ts so the cache name carries the
 * build id: every deploy gets a new cache and `activate` deletes the old ones.
 * The routing rules live in public/sw-routes.js (shared with the tests), loaded with importScripts.
 */
export function serviceWorkerSource(buildId: string): string {
  return `// Kennko website offline copy. Never keeps signed-in pages, orders, the API or any non-GET request.
importScripts('/sw-routes.js')
const PREFIX = 'kennko-web-'
const CACHE = PREFIX + ${JSON.stringify(buildId)}
const SHELL = ['/offline', '/brand/wordmark-blue.png', '/brand/wordmark-white.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n.startsWith(PREFIX) && n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

// Responses that belong to one person or must be fresh are never stored.
function storable(response) {
  if (!response || !response.ok || response.type === 'opaque') return false
  const control = (response.headers.get('cache-control') || '').toLowerCase()
  return !control.includes('no-store') && !control.includes('private')
}

async function cacheFirst(request) {
  const saved = await caches.match(request, { cacheName: CACHE })
  if (saved) return saved
  const response = await fetch(request)
  if (storable(response)) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)) }
  return response
}

// Pages are stored only when the allow-list in sw-routes.js names them (the home page and /offline).
async function networkFirst(request, url) {
  try {
    const response = await fetch(request)
    if (self.mayStorePage(url) && storable(response)) { const copy = response.clone(); caches.open(CACHE).then((c) => c.put(request, copy)) }
    return response
  } catch (err) {
    const saved = await caches.match(request, { cacheName: CACHE })
    return saved || (await caches.match('/offline', { cacheName: CACHE })) || Response.error()
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const strategy = self.cacheStrategyFor(url, request.method)
  if (strategy === 'cache-first') event.respondWith(cacheFirst(request))
  // Only whole-page visits fall back to a saved page; data fetches (RSC payloads and the like) go straight through.
  else if (strategy === 'network-first' && request.mode === 'navigate') event.respondWith(networkFirst(request, url))
})
`
}
