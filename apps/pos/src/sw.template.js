// The till's offline copy. Built into dist/sw.js by vite.config.ts, which fills in the two values below.
// It keeps the screens (pages, scripts, fonts, images) on the device. It never keeps sales data:
// everything under /api/ always goes to the till computer, so two tablets can never disagree.
const CACHE = '__CACHE__'
const FILES = '__FILES__'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith('kennko-pos-') && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname === '/setup' || url.pathname.endsWith('.crt')) return

  // Opening the app: take the newest page from the till computer, fall back to the saved one.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/', { cacheName: CACHE })))
    return
  }
  // Everything else is a built file: the saved copy is the right one for this version.
  event.respondWith(caches.match(request, { cacheName: CACHE }).then((saved) => saved ?? fetch(request)))
})
