import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import manifest from '../../app/manifest'
import { adminManifest } from './manifests'
import { serviceWorkerSource } from './sw-source'

const { safeNotificationUrl } = createRequire(import.meta.url)('../../public/sw-push.js') as {
  safeNotificationUrl: (url: unknown, origin: string) => string
}

const { cacheStrategyFor, mayStorePage } = createRequire(import.meta.url)('../../public/sw-routes.js') as {
  cacheStrategyFor: (url: URL, method: string) => 'cache-first' | 'network-first' | 'network-only'
  mayStorePage: (url: URL) => boolean
}
const at = (path: string, method = 'GET') => cacheStrategyFor(new URL(path, 'https://kennko.test'), method)

describe('website manifest', () => {
  it('installs the public site', () => {
    const m = manifest()
    expect(m).toMatchObject({
      name: 'Kennko Coffee',
      short_name: 'Kennko',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#fff5f0',
      theme_color: '#0055ff',
    })
    expect(m.icons?.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(['192x192:any', '512x512:any', '512x512:maskable'])
  })
})

describe('admin manifest', () => {
  it('is its own app, scoped to /admin', () => {
    expect(adminManifest).toMatchObject({
      name: 'Kennko Admin',
      short_name: 'Admin',
      id: '/admin',
      start_url: '/admin',
      scope: '/admin',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#0055ff',
    })
    expect(adminManifest.icons).toHaveLength(3)
  })
})

describe('cacheStrategyFor', () => {
  it.each(['/admin', '/admin/menu', '/order', '/order/thanks', '/orders', '/account', '/auth/callback', '/api/orders'])(
    'never caches %s',
    (path) => expect(at(path)).toBe('network-only'),
  )
  it('never caches a non-GET request', () => {
    expect(at('/', 'POST')).toBe('network-only')
    expect(at('/_next/static/x.js', 'PUT')).toBe('network-only')
  })
  it('does not mistake a lookalike path for a private one', () => {
    expect(at('/ordering-tips')).toBe('network-first')
  })
  it('serves built files cache-first', () => {
    expect(at('/_next/static/x.js')).toBe('cache-first')
    expect(at('/brand/wordmark-blue.png')).toBe('cache-first')
    expect(at('/icons/icon-192.png')).toBe('cache-first')
    expect(at('/fonts/a.woff2')).toBe('cache-first')
  })
  it('pages are network-first', () => {
    expect(at('/')).toBe('network-first')
    expect(at('/offline')).toBe('network-first')
  })
})

describe('mayStorePage', () => {
  const page = (path: string) => mayStorePage(new URL(path, 'https://kennko.test'))
  it('stores only the home page and the offline page', () => {
    expect(page('/')).toBe(true)
    expect(page('/offline')).toBe(true)
  })
  it.each(['/menu', '/visit', '/order', '/orders', '/admin', '/offline/x', '/ordering-tips'])('never stores %s', (path) =>
    expect(page(path)).toBe(false),
  )
})

describe('service worker source', () => {
  const source = serviceWorkerSource('abc123')
  it('is valid JavaScript', () => {
    expect(() => new Function(source)).not.toThrow()
  })
  it('versions its cache by build id and clears old ones', () => {
    expect(source).toContain('"abc123"')
    expect(source).toContain('caches.delete')
    expect(source).toContain("importScripts('/sw-routes.js')")
  })
  it('refuses to store no-store or private responses', () => {
    expect(source).toContain('no-store')
    expect(source).toContain('private')
  })
  it('stores a page only when the allow-list says so', () => {
    expect(source).toContain('self.mayStorePage(')
  })
  it('does not rely on Set-Cookie, which a worker cannot see', () => {
    expect(source.toLowerCase()).not.toContain('set-cookie')
  })
})

describe('push handlers', () => {
  const source = serviceWorkerSource('abc123')
  it('shows notifications and handles clicks', () => {
    expect(source).toContain("importScripts('/sw-push.js')")
    expect(source).toContain("addEventListener('push'")
    expect(source).toContain("addEventListener('notificationclick'")
    expect(source).toContain('/icons/icon-192.png')
    expect(source).toContain('self.safeNotificationUrl(')
  })
})

/** Runs the worker source against a fake `self` and returns its event handlers. */
function loadWorker(opts: { tabs?: FakeTab[]; openWindow?: ReturnType<typeof vi.fn> } = {}) {
  const handlers: Record<string, (event: unknown) => void> = {}
  const showNotification = vi.fn(async () => undefined)
  const openWindow = opts.openWindow ?? vi.fn(async () => null)
  const self = {
    location: { origin: 'https://kennko.test' },
    addEventListener: (name: string, fn: (event: unknown) => void) => { handlers[name] = fn },
    registration: { showNotification },
    clients: { matchAll: vi.fn(async () => opts.tabs ?? []), openWindow, claim: vi.fn() },
    safeNotificationUrl,
    cacheStrategyFor,
    mayStorePage,
  }
  new Function('self', 'importScripts', 'caches', serviceWorkerSource('t1'))(self, () => {}, {})
  return { handlers, showNotification, openWindow }
}

type FakeTab = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> }
const tab = (url: string, navigate: 'ok' | 'reject' | 'none' = 'ok'): FakeTab => {
  const t: FakeTab = { url, focus: vi.fn(async () => t) }
  if (navigate === 'ok') t.navigate = vi.fn(async () => t)
  if (navigate === 'reject') t.navigate = vi.fn(async () => { throw new TypeError('not controlled') })
  return t
}

async function click(w: ReturnType<typeof loadWorker>, url: string) {
  let done: Promise<unknown> = Promise.resolve()
  w.handlers.notificationclick({ notification: { close: vi.fn(), data: { url } }, waitUntil: (p: Promise<unknown>) => { done = p } })
  await done
}

async function push(w: ReturnType<typeof loadWorker>, data: unknown) {
  let done: Promise<unknown> = Promise.resolve()
  w.handlers.push({ data: { json: () => data }, waitUntil: (p: Promise<unknown>) => { done = p } })
  await done
  return w.showNotification.mock.calls[0] as unknown as [string, { tag?: string; renotify?: boolean }]
}

describe('push event', () => {
  it('re-alerts for a tagged notification', async () => {
    const [title, options] = await push(loadWorker(), { title: 'W3 is ready', body: 'b', tag: 'order-KNK-1', url: '/order/KNK-1' })
    expect(title).toBe('W3 is ready')
    expect(options).toMatchObject({ tag: 'order-KNK-1', renotify: true })
  })
  it('an untagged notification sets no renotify (browsers reject renotify without a tag)', async () => {
    const [, options] = await push(loadWorker(), { title: 't', body: 'b' })
    expect(options.tag).toBeUndefined()
    expect(options.renotify).toBeUndefined()
  })
})

describe('notification click', () => {
  const target = 'https://kennko.test/order/KNK-1'
  it('navigates the matching tab to a fresh copy, then focuses it', async () => {
    const same = tab(target)
    const w = loadWorker({ tabs: [same] })
    await click(w, '/order/KNK-1')
    expect(same.navigate).toHaveBeenCalledWith(target)
    expect(same.focus).toHaveBeenCalled()
    expect(w.openWindow).not.toHaveBeenCalled()
  })
  it('opens a window when the matching tab cannot be navigated', async () => {
    const same = tab(target, 'reject')
    const w = loadWorker({ tabs: [same] })
    await click(w, '/order/KNK-1')
    expect(w.openWindow).toHaveBeenCalledWith(target)
  })
  it('navigates another same-origin tab, or opens a window when that rejects', async () => {
    const other = tab('https://kennko.test/menu')
    const w = loadWorker({ tabs: [other] })
    await click(w, '/order/KNK-1')
    expect(other.navigate).toHaveBeenCalledWith(target)
    expect(other.focus).toHaveBeenCalled()

    const stuck = tab('https://kennko.test/menu', 'reject')
    const w2 = loadWorker({ tabs: [stuck] })
    await click(w2, '/order/KNK-1')
    expect(w2.openWindow).toHaveBeenCalledWith(target)
  })
  it('opens a window when no tab is open', async () => {
    const w = loadWorker()
    await click(w, '/order/KNK-1')
    expect(w.openWindow).toHaveBeenCalledWith(target)
  })
})

describe('safeNotificationUrl', () => {
  const o = 'https://kennko.test'
  it('keeps same-origin relative paths', () => {
    expect(safeNotificationUrl('/order/KNK-7F3Q', o)).toBe('/order/KNK-7F3Q')
    expect(safeNotificationUrl('/admin/orders?x=1', o)).toBe('/admin/orders?x=1')
  })
  it('accepts an absolute url on this origin as a path', () => {
    expect(safeNotificationUrl('https://kennko.test/orders', o)).toBe('/orders')
  })
  it.each(['https://evil.test/x', '//evil.test/x', 'javascript:alert(1)', '/\\evil.test', '', null, 42])(
    'falls back to / for %s',
    (u) => expect(safeNotificationUrl(u, o)).toBe('/'),
  )
})
