import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const snapshot = { version: 1, publishedAt: 'x', categories: [], optionGroups: [], discountPresets: [] }
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function load() {
  vi.resetModules()
  return (await import('./api')).fetchMenuSnapshot
}

beforeEach(() => {
  vi.stubEnv('KENNKO_API_URL', 'https://api.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('fetchMenuSnapshot', () => {
  it('returns null and warns once when KENNKO_API_URL is unset', async () => {
    vi.stubEnv('KENNKO_API_URL', '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMenuSnapshot = await load()
    expect(await fetchMenuSnapshot()).toBeNull()
    expect(await fetchMenuSnapshot()).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns the snapshot on 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(snapshot)))
    expect(await (await load())()).toEqual(snapshot)
  })

  it('times out requests after 5 seconds', async () => {
    const fetchMock = vi.fn(async () => json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await (await load())()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('uses the 30s cache by default', async () => {
    const fetchMock = vi.fn(async () => json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await (await load())()
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }])[1]
    expect(init.next).toEqual({ revalidate: 30 })
    expect(init.cache).toBeUndefined()
  })

  it("bypasses the cache with cache: 'no-store' when fresh", async () => {
    const fetchMock = vi.fn(async () => json(snapshot))
    vi.stubGlobal('fetch', fetchMock)
    await (await load())({ fresh: true })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit & { next?: unknown }])[1]
    expect(init.cache).toBe('no-store')
    expect(init.next).toBeUndefined()
  })

  it('returns null on 404 NO_MENU', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'NO_MENU' }, 404)))
    expect(await (await load())()).toBeNull()
  })

  it('throws on any other 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'NOPE' }, 404)))
    await expect((await load())()).rejects.toThrow()
  })

  it('throws on 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({}, 500)))
    await expect((await load())()).rejects.toThrow()
  })

  it('throws on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect((await load())()).rejects.toThrow()
  })
})
