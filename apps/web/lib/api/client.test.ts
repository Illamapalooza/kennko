import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
let token: string | null = 'jwt-1'
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) },
  }),
}))

const { publicFetch, userFetch, webKeyFetch } = await import('./client')

const fetchMock = vi.fn(async (..._a: unknown[]) => new Response('{}', { status: 200 }))
const env = { ...process.env }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockClear()
  token = 'jwt-1'
  process.env.KENNKO_API_URL = 'https://api.test/'
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  process.env = { ...env }
})

const sent = () => fetchMock.mock.calls[0] as unknown as [string, RequestInit]

describe('publicFetch', () => {
  it('sends no auth, no-store, with a timeout signal', async () => {
    await publicFetch('/v1/orders/by-code/KNK-1')
    const [url, init] = sent()
    expect(url).toBe('https://api.test/v1/orders/by-code/KNK-1')
    expect(init.cache).toBe('no-store')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it('throws when the API is not configured', async () => {
    delete process.env.KENNKO_API_URL
    await expect(publicFetch('/x')).rejects.toThrow(/KENNKO_API_URL/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('userFetch', () => {
  it("sends the signed-in user's access token", async () => {
    await userFetch('/v1/me/orders')
    const [url, init] = sent()
    expect(url).toBe('https://api.test/v1/me/orders')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer jwt-1')
    expect(init.cache).toBe('no-store')
  })

  it('throws when nobody is signed in, with no fetch', async () => {
    token = null
    await expect(userFetch('/v1/me/orders')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('webKeyFetch', () => {
  it('sends the trimmed web key and no user token', async () => {
    process.env.KENNKO_WEB_KEY = '  k'.padEnd(40, 'x') + '\n'
    await webKeyFetch('/v1/staff/alert-emails')
    const [url, init] = sent()
    expect(url).toBe('https://api.test/v1/staff/alert-emails')
    const headers = new Headers(init.headers)
    expect(headers.get('x-kennko-web-key')).toBe('k'.padEnd(38, 'x'))
    expect(headers.has('authorization')).toBe(false)
    expect(init.cache).toBe('no-store')
  })

  it.each([undefined, '', '   '])('returns null without a fetch when the key is %j', async (key) => {
    if (key === undefined) delete process.env.KENNKO_WEB_KEY
    else process.env.KENNKO_WEB_KEY = key
    expect(await webKeyFetch('/v1/staff/alert-emails')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null without a fetch when the API is not configured', async () => {
    process.env.KENNKO_WEB_KEY = 'k'.repeat(40)
    delete process.env.KENNKO_API_URL
    expect(await webKeyFetch('/v1/staff/alert-emails')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
