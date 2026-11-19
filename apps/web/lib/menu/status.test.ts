import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}))

import { getMenuStatus } from './status'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.stubEnv('KENNKO_API_URL', 'https://api.test')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getMenuStatus', () => {
  it('maps the 200 body and sends the session token', async () => {
    const fetchMock = vi.fn(async () =>
      json({ publishedVersion: 4, publishedAt: '2026-11-20T01:00:00Z', hasUnpublishedChanges: true }),
    )
    vi.stubGlobal('fetch', fetchMock)
    expect(await getMenuStatus()).toEqual({
      ok: true,
      publishedVersion: 4,
      publishedAt: '2026-11-20T01:00:00Z',
      hasUnpublishedChanges: true,
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/menu/status')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('accepts a never-published menu', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ publishedVersion: null, publishedAt: null, hasUnpublishedChanges: true })),
    )
    expect(await getMenuStatus()).toMatchObject({ ok: true, publishedVersion: null })
  })

  it('returns ok:false on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ code: 'BOOM', message: 'x' }, 500)))
    expect(await getMenuStatus()).toEqual({ ok: false })
  })

  it('returns ok:false on a malformed body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ nope: 1 })))
    expect(await getMenuStatus()).toEqual({ ok: false })
  })

  it('returns ok:false when the network fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    expect(await getMenuStatus()).toEqual({ ok: false })
  })

  it('returns ok:false when KENNKO_API_URL is unset', async () => {
    vi.stubEnv('KENNKO_API_URL', '')
    expect(await getMenuStatus()).toEqual({ ok: false })
  })
})
