import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const sendEmail = vi.fn(async (..._a: unknown[]) => undefined)
const revalidatePath = vi.fn()
const update = vi.fn()
let adminThrows = false

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireStaff: vi.fn(async () => ({ id: 's1', role: 'owner' })) }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ from: () => ({ update }) }),
}))

const orderRow = {
  order_code: 'KNK-7F3Q', ticket_series: 'W', ticket_number: 3, customer_name: 'Ana Cruz',
  customer_email: 'ana@example.com', fulfilment: 'pickup', fulfil_at: '2026-11-20T08:00:00Z',
  total_centavos: 29000, delivery_address: null,
  order_lines: [{
    item_name: 'Spanish Latte', variant_label: '16oz', quantity: 2,
    ice_level: null, ice_serve: null, note: null, order_line_options: [],
  }],
}
vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => {
    if (adminThrows) throw new Error('db down')
    return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === 'payments' ? { order_id: 'o1' } : orderRow,
            error: null,
          }),
        }),
      }),
    }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'u' } }) }) },
  }
  },
}))

import { confirmPayment, rejectPayment, advanceStatus, cancelOrder } from './actions'

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  vi.clearAllMocks()
  adminThrows = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('confirmPayment', () => {
  it('verifies through the API, emails the customer once, and revalidates', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(staffFetch).toHaveBeenCalledWith('/v1/payments/p1/verify', { method: 'POST' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: ['ana@example.com'] })
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
    expect(update).not.toHaveBeenCalled()
  })

  it('maps 409 to the changed-elsewhere message and sends no email', async () => {
    staffFetch.mockResolvedValue(reply(409, { code: 'STATUS_CHANGED', message: 'x' }))
    expect(await confirmPayment('p1')).toEqual({
      ok: false, message: 'This order changed on another screen. Refresh to see it.',
    })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('says so when the server cannot be reached', async () => {
    staffFetch.mockRejectedValue(new Error('network'))
    expect(await confirmPayment('p1')).toEqual({ ok: false, message: "Couldn't reach the server. Try again." })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('email trouble never reaches the UI', () => {
  it('confirm still returns ok and revalidates when the email lookup throws', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    adminThrows = true
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })

  it('reject still returns ok when the email lookup throws', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    adminThrows = true
    expect(await rejectPayment('p1', 'No match')).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })
})

describe('customer email data', () => {
  it('formats the pickup time in Manila time', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as { subject: string; text: string }
    // 08:00 UTC is 4:00 PM in Manila.
    expect(mail.text).toContain('4:00 PM')
    expect(mail.text).toContain('Nov 20, 2026')
  })
})

describe('rejectPayment', () => {
  it('rejects through the API with the reason and emails once', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    expect(await rejectPayment('p1', '  Wrong amount ')).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/payments/p1/reject')
    expect(JSON.parse(init.body)).toEqual({ reason: 'Wrong amount' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })

  it('needs a reason and does not call the API without one', async () => {
    const result = await rejectPayment('p1', '   ')
    expect(result.ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })

  it('maps 409', async () => {
    staffFetch.mockResolvedValue(reply(409, { code: 'STATUS_CHANGED', message: 'x' }))
    const result = await rejectPayment('p1', 'No match')
    expect(result).toEqual({ ok: false, message: 'This order changed on another screen. Refresh to see it.' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('advanceStatus', () => {
  it('patches the order through the API', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    expect(await advanceStatus('o1', 'preparing')).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/orders/o1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ prepStatus: 'preparing' })
    expect(update).not.toHaveBeenCalled()
  })

  it.each(['STATUS_CHANGED', 'BAD_TRANSITION'])('maps 409 %s', async (code) => {
    staffFetch.mockResolvedValue(reply(409, { code, message: 'x' }))
    expect(await advanceStatus('o1', 'ready')).toEqual({
      ok: false, message: 'This order changed on another screen. Refresh to see it.',
    })
  })
})

describe('cancelOrder', () => {
  it('cancels through the API with the reason', async () => {
    staffFetch.mockResolvedValue(reply(200, { ok: true }))
    expect(await cancelOrder('o1', 'Out of milk')).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/orders/o1/cancel')
    expect(JSON.parse(init.body)).toEqual({ reason: 'Out of milk' })
    expect(update).not.toHaveBeenCalled()
  })

  it('maps 403 to the owner-only message', async () => {
    staffFetch.mockResolvedValue(reply(403, { code: 'FORBIDDEN', message: 'x' }))
    expect(await cancelOrder('o1', 'Out of milk')).toEqual({
      ok: false, message: 'Only the owner can cancel orders.',
    })
  })

  it('needs a reason', async () => {
    expect((await cancelOrder('o1', ' ')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
})
