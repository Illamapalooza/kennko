import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
let token: string | undefined = 'jwt-1'
let customer: { name: string } | null = { name: 'Ana' }
let base: string | null = 'https://api.test'

vi.mock('@/lib/api/client', () => ({
  staffFetch: (...a: unknown[]) => staffFetch(...a),
  apiBase: () => base,
}))
vi.mock('@/lib/auth/customer', () => ({ getCurrentCustomer: async () => customer }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } }),
}))

import { subscribeToOrder, subscribeStaffAlerts, unsubscribePush, unwatchOrder } from './push-actions'

const sub = { endpoint: 'https://push.test/e1', keys: { p256dh: 'p', auth: 'a' }, expirationTime: null }
const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset(); staffFetch.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  token = 'jwt-1'; customer = { name: 'Ana' }; base = 'https://api.test'
})

describe('subscribeToOrder', () => {
  it('forwards the subscription and code with the customer token', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    expect(await subscribeToOrder('KNK-7F3Q', sub)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/v1/push/subscriptions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer jwt-1')
    expect(JSON.parse(init.body)).toEqual({
      subscription: { endpoint: sub.endpoint, keys: sub.keys },
      orderCode: 'KNK-7F3Q',
    })
  })
  it('sends no token for a guest', async () => {
    customer = null
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }))
    await subscribeToOrder('KNK-7F3Q', sub)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined()
  })
  it('reports an unknown order', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 }))
    const r = await subscribeToOrder('KNK-NOPE', sub)
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  })
  it('rejects a subscription without keys', async () => {
    const r = await subscribeToOrder('KNK-7F3Q', { endpoint: 'x' })
    expect(r.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('fails softly when the API is down', async () => {
    fetchMock.mockRejectedValue(new Error('down'))
    expect((await subscribeToOrder('KNK-7F3Q', sub)).ok).toBe(false)
  })
})

describe('subscribeStaffAlerts', () => {
  it('posts without an order code via staffFetch', async () => {
    staffFetch.mockResolvedValue(new Response(null, { status: 201 }))
    expect(await subscribeStaffAlerts(sub)).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/push/subscriptions')
    expect(JSON.parse(init.body)).toEqual({ subscription: { endpoint: sub.endpoint, keys: sub.keys } })
    expect(init.headers['Content-Type']).toBe('application/json')
  })
  it('reports a refusal', async () => {
    staffFetch.mockResolvedValue(new Response('{}', { status: 403 }))
    expect((await subscribeStaffAlerts(sub)).ok).toBe(false)
  })
})

describe('unsubscribePush', () => {
  it('deletes by endpoint', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await unsubscribePush(sub.endpoint)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/v1/push/subscriptions')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ endpoint: sub.endpoint })
  })
})

describe('unwatchOrder', () => {
  it('deletes only that order watch', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    expect(await unwatchOrder('KNK-7F3Q', sub.endpoint)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/v1/push/subscriptions/watch')
    expect(init.method).toBe('DELETE')
    expect(JSON.parse(init.body)).toEqual({ endpoint: sub.endpoint, orderCode: 'KNK-7F3Q' })
  })
  it('reports failure', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }))
    expect((await unwatchOrder('KNK-7F3Q', sub.endpoint)).ok).toBe(false)
    fetchMock.mockRejectedValue(new Error('down'))
    expect((await unwatchOrder('KNK-7F3Q', sub.endpoint)).ok).toBe(false)
  })
})
