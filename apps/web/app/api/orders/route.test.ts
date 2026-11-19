// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getCurrentCustomer = vi.fn()
vi.mock('@/lib/auth/customer', () => ({ getCurrentCustomer: () => getCurrentCustomer() }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'cust-token' } } }) },
  }),
}))
const sendEmail = vi.fn(async (_args: unknown) => true)
vi.mock('@/lib/email/send', () => ({
  sendEmail: (args: unknown) => sendEmail(args),
  activeStaffEmails: async () => ['staff@kennko.test'],
}))

import { POST } from './route'
import { resetRateLimit } from '@/lib/orders/rate-limit'

const created = {
  orderId: 'o1',
  orderCode: 'KNK-ABC123',
  ticket: 'W3',
  items: [{ name: 'Spanish Latte', variantLabel: 'L', quantity: 2, ice: null, note: null }],
  subtotalCentavos: 29000,
  deliveryFeeCentavos: 0,
  totalCentavos: 29000,
}

function makeRequest() {
  const form = new FormData()
  form.set(
    'order',
    JSON.stringify({ name: 'Ana Cruz', fulfilment: 'pickup', fulfilAt: '2026-11-21T07:00:00Z', lines: [] }),
  )
  form.set('proof', new File(['x'], 'proof.png', { type: 'image/png' }))
  return new Request('http://localhost/api/orders', {
    method: 'POST',
    body: form,
    headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
  }) as never
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  resetRateLimit()
  sendEmail.mockClear()
  getCurrentCustomer.mockResolvedValue({ id: 'u1', email: 'a@b.c', emailConfirmed: true })
  vi.stubEnv('NEXT_PUBLIC_ORDERING_ENABLED', 'true')
  vi.stubEnv('KENNKO_API_URL', 'https://api.test/')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('POST /api/orders', () => {
  it('forwards the form data and the customer token to the API', async () => {
    const fetchMock = vi.fn(async () => json(created, 201))
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(makeRequest())
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ orderCode: 'KNK-ABC123', ticket: 'W3' })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/orders')
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('order')).toContain('Ana Cruz')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer cust-token')
    expect(headers['x-forwarded-for']).toBe('1.2.3.4')
  })

  it('sends no Authorization header for a guest', async () => {
    getCurrentCustomer.mockResolvedValue(null)
    const fetchMock = vi.fn(async () => json(created, 201))
    vi.stubGlobal('fetch', fetchMock)
    await POST(makeRequest())
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('passes a 409 PRICE_CHANGED body through', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({ code: 'PRICE_CHANGED', message: 'm', errors: ['Prices changed.'] }, 409),
      ),
    )
    const res = await POST(makeRequest())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ code: 'PRICE_CHANGED', errors: ['Prices changed.'] })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('maps a network error to 503 ORDERING_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      code: 'ORDERING_UNAVAILABLE',
      errors: ['Ordering is unavailable right now. Please try again in a few minutes.'],
    })
  })

  it('maps a missing API base URL to 503 without calling fetch', async () => {
    vi.stubEnv('KENNKO_API_URL', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORDERING_UNAVAILABLE')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends one staff alert whose subject leads with the ticket', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(created, 201)))
    await POST(makeRequest())
    expect(sendEmail).toHaveBeenCalledTimes(1)
    const args = sendEmail.mock.calls[0] as unknown as [{ to: string[]; subject: string }]
    expect(args[0].subject.startsWith('New order W3 · KNK-ABC123')).toBe(true)
    expect(args[0].subject).toContain('(pickup)')
  })

  it('answers 503 without calling fetch when ordering is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_ORDERING_ENABLED', 'false')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await POST(makeRequest())
    expect(res.status).toBe(503)
    expect((await res.json()).code).toBe('ORDERING_DISABLED')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
