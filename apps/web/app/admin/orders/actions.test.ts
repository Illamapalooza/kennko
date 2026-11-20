import { beforeEach, describe, expect, it, vi } from 'vitest'

const staffFetch = vi.fn()
const sendEmail = vi.fn(async (..._a: unknown[]) => undefined)
const revalidatePath = vi.fn()
const update = vi.fn()
let noticeThrows = false

vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({ requireStaff: vi.fn(async () => ({ id: 's1', role: 'owner' })) }))
vi.mock('@/lib/api/client', () => ({ staffFetch: (...a: unknown[]) => staffFetch(...a) }))
vi.mock('@/lib/email/send', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }))
let receiptThrows = false
let receiptPaid = true
const loadReceipt = vi.fn(async (_code: string) => {
  if (receiptThrows) throw new Error('receipt api down')
  // The PUBLIC receipt: first name, barangay only, masked reference.
  return {
    order: {
      orderCode: notice.orderCode, ticket: 'W3', customerName: 'Ana', fulfilment: notice.fulfilment,
      deliveryAddress: null, deliveryBarangay: notice.fulfilment === 'delivery' ? 'Villa Kananga' : null,
      paidAt: '2026-11-20T04:30:00Z', paymentStatus: receiptPaid ? 'paid' : 'unpaid', prepStatus: 'preparing',
      cancelledAt: null, reference: '••••1234', subtotalCentavos: 29000, discountCentavos: 0,
      deliveryFeeCentavos: 0, totalCentavos: 29000,
      lines: [{ itemName: 'Spanish Latte', variantLabel: '16oz', quantity: 2,
        unitPriceCentavos: 14500, lineTotalCentavos: 29000, options: [] }],
    },
    settings: {
      displayName: 'Kennko Coffee', registeredName: null, tin: null, address: '7 Settings Rd, Butuan',
      phone: null, facebookUrl: null, receiptFooter: 'Ask for your official receipt.',
    },
  }
})
vi.mock('@/lib/receipts/load', () => ({ loadReceipt: (code: string) => loadReceipt(code) }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ from: () => ({ update }) }),
}))

const baseNotice = {
  to: 'ana@example.com', orderCode: 'KNK-7F3Q', ticket: 'W3', customerName: 'Ana Cruz',
  fulfilment: 'pickup' as 'pickup' | 'delivery', fulfilAt: '2026-11-20T08:00:00.000Z' as string | null,
  totalCentavos: 29000, deliveryAddress: null as string | null, reference: '1234567891234' as string | null,
  items: [{ name: 'Spanish Latte', variantLabel: '16oz', quantity: 2 }],
}
let notice = { ...baseNotice }
let noticeStatus = 200

const reply = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** The action's own call answers `status`/`body`; the notice and proof reads answer from the fixtures. */
function answer(status: number, body: unknown = {}) {
  staffFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/notice')) {
      if (noticeThrows) throw new Error('api down')
      return noticeStatus === 200 ? reply(200, notice) : reply(noticeStatus, { code: 'NO_EMAIL' })
    }
    return reply(status, body)
  })
}

import { confirmPayment, rejectPayment, advanceStatus, cancelOrder, proofUrl } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
  noticeThrows = false
  notice = { ...baseNotice }
  noticeStatus = 200
  receiptThrows = false
  receiptPaid = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('confirmPayment', () => {
  it('verifies through the API, emails the customer once, and revalidates', async () => {
    answer(200, { ok: true })
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(staffFetch).toHaveBeenCalledWith('/v1/payments/p1/verify', { method: 'POST' })
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: ['ana@example.com'] })
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
    expect(update).not.toHaveBeenCalled()
  })

  it('maps 409 to the changed-elsewhere message and sends no email', async () => {
    answer(409, { code: 'STATUS_CHANGED', message: 'x' })
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

describe('customer email is awaited', () => {
  it('confirm does not resolve until the email send finishes', async () => {
    answer(200, { ok: true })
    let finish: (v: undefined) => void = () => {}
    sendEmail.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    let settled = false
    const pending = confirmPayment('p1').then((r) => { settled = true; return r })
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 10))
    expect(settled).toBe(false)
    finish(undefined)
    expect(await pending).toEqual({ ok: true })
  })
})

describe('email trouble never reaches the UI', () => {
  it('confirm still returns ok and revalidates when the email lookup throws', async () => {
    answer(200, { ok: true })
    noticeThrows = true
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })

  it('reject still returns ok when the email lookup throws', async () => {
    answer(200, { ok: true })
    noticeThrows = true
    expect(await rejectPayment('p1', 'No match')).toEqual({ ok: true })
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })
})

describe('customer email data', () => {
  it('formats the pickup time in Manila time', async () => {
    answer(200, { ok: true })
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as { subject: string; text: string }
    // 08:00 UTC is 4:00 PM in Manila.
    expect(mail.text).toContain('4:00 PM')
    expect(mail.text).toContain('Nov 20, 2026')
  })
})

describe('confirmation email receipt', () => {
  type Mail = { subject: string; text: string; html?: string }
  it('adds the e-receipt and a receipt link', async () => {
    answer(200, { ok: true })
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.subject).toBe('Your Kennko order KNK-7F3Q is confirmed')
    expect(mail.html).toContain('View or print your receipt: ')
    expect(mail.html).toContain('/order/KNK-7F3Q/receipt')
    expect(mail.html).toContain('THIS IS NOT AN OFFICIAL RECEIPT')
    expect(mail.text).toContain('THIS IS NOT AN OFFICIAL RECEIPT')
  })
  it('still sends the plain confirmation when the receipt fails to load', async () => {
    answer(200, { ok: true })
    receiptThrows = true
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.html).toBeUndefined()
    expect(mail.text).toContain('is confirmed')
  })
  it('still sends the plain confirmation when no receipt can be built', async () => {
    answer(200, { ok: true })
    receiptPaid = false
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.html).toBeUndefined()
    expect(mail.text).toContain('is confirmed')
  })
  it('html has an escaped pickup line, as the text body does', async () => {
    answer(200, { ok: true })
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.html).toContain('Pickup on Nov 20, 2026')
    expect(mail.html).toContain('4:00 PM at 7 Settings Rd, Butuan')
  })
  it('html has an escaped delivery line', async () => {
    answer(200, { ok: true })
    notice = { ...baseNotice, fulfilment: 'delivery', deliveryAddress: '<i>Rizal</i> St' }
    await confirmPayment('p1')
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.html).toContain('Delivery on Nov 20, 2026')
    expect(mail.html).toContain('&lt;i&gt;Rizal&lt;/i&gt; St')
    expect(mail.html).not.toContain('<i>Rizal')
  })
  it('escapes the receipt href and url-encodes the code', async () => {
    answer(200, { ok: true })
    const prev = process.env.NEXT_PUBLIC_SITE_URL
    process.env.NEXT_PUBLIC_SITE_URL = 'https://x.test/a&b'
    notice = { ...baseNotice, orderCode: 'KNK A&B' }
    try { await confirmPayment('p1') } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
      else process.env.NEXT_PUBLIC_SITE_URL = prev
    }
    const mail = sendEmail.mock.calls[0][0] as Mail
    expect(mail.html).toContain('href="https://x.test/a&amp;b/order/KNK%20A%26B/receipt"')
  })
  it('reject emails carry no html', async () => {
    answer(200, { ok: true })
    await rejectPayment('p1', 'No match')
    expect((sendEmail.mock.calls[0][0] as Mail).html).toBeUndefined()
  })
})

describe('rejectPayment', () => {
  it('rejects through the API with the reason and emails once', async () => {
    answer(200, { ok: true })
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
    answer(409, { code: 'STATUS_CHANGED', message: 'x' })
    const result = await rejectPayment('p1', 'No match')
    expect(result).toEqual({ ok: false, message: 'This order changed on another screen. Refresh to see it.' })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})

describe('advanceStatus', () => {
  it('patches the order through the API', async () => {
    answer(200, { ok: true })
    expect(await advanceStatus('o1', 'preparing')).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/orders/o1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ prepStatus: 'preparing' })
    expect(update).not.toHaveBeenCalled()
  })

  it('maps STATUS_CHANGED to the changed-elsewhere message', async () => {
    answer(409, { code: 'STATUS_CHANGED', message: 'x' })
    expect(await advanceStatus('o1', 'ready')).toEqual({
      ok: false, message: 'This order changed on another screen. Refresh to see it.',
    })
  })

  it('maps BAD_TRANSITION to the step-not-allowed message', async () => {
    answer(409, { code: 'BAD_TRANSITION', message: 'x' })
    expect(await advanceStatus('o1', 'ready')).toEqual({
      ok: false, message: "That step isn't allowed for this order. Refresh to see where it is.",
    })
  })

  it('maps FORBIDDEN outside cancel to the ask-the-owner message', async () => {
    answer(403, { code: 'FORBIDDEN', message: 'x' })
    expect(await advanceStatus('o1', 'ready')).toEqual({
      ok: false, message: "Your account can't do that. Ask the owner.",
    })
  })

  it('maps 401 to the session-ended message', async () => {
    answer(401, { code: 'UNAUTHENTICATED', message: 'x' })
    expect(await advanceStatus('o1', 'ready')).toEqual({
      ok: false, message: 'Your session ended. Sign in again.',
    })
  })

  it('maps 404 to the no-longer-exists message', async () => {
    answer(404, { code: 'NOT_FOUND', message: 'x' })
    expect(await advanceStatus('o1', 'ready')).toEqual({ ok: false, message: 'This order no longer exists.' })
  })

  it.each([
    [400, { code: 'INVALID', message: 'prepStatus must be one of ...' }],
    [409, { code: 'COUNTER_ORDER', message: 'Counter orders are managed at the till' }],
    [500, { code: 'INTERNAL', message: 'relation "orders" does not exist' }],
    [502, 'not json'],
  ])('never shows the raw API message (%s)', async (status, body) => {
    answer(status, body)
    expect(await advanceStatus('o1', 'ready')).toEqual({ ok: false, message: 'Something went wrong. Try again.' })
  })
})

describe('cancelOrder', () => {
  it('cancels through the API with the reason', async () => {
    answer(200, { ok: true })
    expect(await cancelOrder('o1', 'Out of milk')).toEqual({ ok: true })
    const [path, init] = staffFetch.mock.calls[0]
    expect(path).toBe('/v1/orders/o1/cancel')
    expect(JSON.parse(init.body)).toEqual({ reason: 'Out of milk' })
    expect(update).not.toHaveBeenCalled()
  })

  it('maps 403 to the owner-only message', async () => {
    answer(403, { code: 'FORBIDDEN', message: 'x' })
    expect(await cancelOrder('o1', 'Out of milk')).toEqual({
      ok: false, message: 'Only the owner can cancel orders.',
    })
  })

  it('needs a reason', async () => {
    expect((await cancelOrder('o1', ' ')).ok).toBe(false)
    expect(staffFetch).not.toHaveBeenCalled()
  })
})

describe('customer email data comes from the payment notice', () => {
  type Mail = { to: string[]; subject: string; text: string; html?: string }

  it('confirm reads the notice and sends to notice.to with the full-name, full-reference receipt', async () => {
    answer(200, { ok: true })
    notice = { ...baseNotice, to: 'ana.cruz@example.com', fulfilment: 'delivery', deliveryAddress: '1 Gate St, Ampayon' }
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(staffFetch.mock.calls.map((c) => c[0])).toEqual(['/v1/payments/p1/verify', '/v1/payments/p1/notice'])
    expect(loadReceipt).toHaveBeenCalledWith('KNK-7F3Q')
    const mail = sendEmail.mock.calls[0]![0] as Mail
    expect(mail.to).toEqual(['ana.cruz@example.com'])
    // The email receipt is the full one: name, street address and GCash reference from the notice.
    expect(mail.text).toContain('Customer: Ana Cruz')
    expect(mail.text).toContain('1234567891234')
    expect(mail.text).not.toContain('••••1234')
    expect(mail.text).toContain('Delivery to 1 Gate St, Ampayon')
  })

  it('a notice without a reference leaves the receipt reference empty, never the masked one', async () => {
    answer(200, { ok: true })
    notice = { ...baseNotice, reference: null }
    await confirmPayment('p1')
    expect((sendEmail.mock.calls[0]![0] as Mail).text).not.toContain('••••')
  })

  it('a notice 404 sends no email and the action is still ok', async () => {
    answer(200, { ok: true })
    noticeStatus = 404
    expect(await confirmPayment('p1')).toEqual({ ok: true })
    expect(await rejectPayment('p1', 'No match')).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })

  it('reject reads the notice and sends to notice.to', async () => {
    answer(200, { ok: true })
    await rejectPayment('p1', 'No match')
    expect(staffFetch.mock.calls[1]![0]).toBe('/v1/payments/p1/notice')
    expect((sendEmail.mock.calls[0]![0] as Mail).to).toEqual(['ana@example.com'])
    expect(loadReceipt).not.toHaveBeenCalled()
  })
})

describe('proofUrl', () => {
  it('asks the API for a signed link for the payment', async () => {
    answer(200, { url: 'https://signed.test/x' })
    expect(await proofUrl('p1')).toBe('https://signed.test/x')
    expect(staffFetch.mock.calls[0]![0]).toBe('/v1/payments/p1/proof')
  })

  it('is null on a 404 or a failure', async () => {
    answer(404, { code: 'NOT_FOUND' })
    expect(await proofUrl('p1')).toBeNull()
    staffFetch.mockRejectedValue(new Error('network'))
    expect(await proofUrl('p1')).toBeNull()
  })
})
