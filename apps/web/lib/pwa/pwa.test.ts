import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import manifest from '../../app/manifest'
import { adminManifest } from './manifests'
import { serviceWorkerSource } from './sw-source'

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
