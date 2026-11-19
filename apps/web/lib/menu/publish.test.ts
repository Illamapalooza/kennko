import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}))

import { publishMenu } from './publish'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.stubEnv('KENNKO_API_URL', 'https://api.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('publishMenu', () => {
  it('posts with the signed-in token and returns the version', async () => {
    const fetchMock = vi.fn(async () => json({ version: 7, created: true }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await publishMenu()).toEqual({ ok: true, version: 7 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/menu/publish')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('returns ok:false with the API message when the API answers 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'BOOM', message: 'Snapshot failed' }, 500)))
    expect(await publishMenu()).toEqual({ ok: false, message: 'Snapshot failed' })
  })

  it('returns ok:false when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await publishMenu()
    expect(result.ok).toBe(false)
  })

  it('returns ok:false when KENNKO_API_URL is unset', async () => {
    vi.stubEnv('KENNKO_API_URL', '')
    expect(await publishMenu()).toEqual({
      ok: false,
      message: 'The API is not configured (KENNKO_API_URL).',
    })
  })
})
