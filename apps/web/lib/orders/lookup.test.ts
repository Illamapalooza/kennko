import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicOrderView } from '@kennko/core'

vi.mock('server-only', () => ({}))

const publicFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ publicFetch: (...a: unknown[]) => publicFetch(...a) }))

import { lookupOrder } from './lookup'

const view: PublicOrderView = {
  orderCode: 'KNK-ABC123',
  ticket: 'W3',
  prepStatus: 'placed',
  paymentStatus: 'pending_verification',
  cancelled: false,
  fulfilment: 'pickup',
  fulfilAt: '2026-11-21T07:00:00.000Z',
  totalCentavos: 29000,
  deliveryAddress: null,
  lines: [{ name: 'Spanish Latte', variantLabel: 'L', quantity: 2, iceLevel: 'less', iceServe: null }],
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let current: Partial<PublicOrderView> = {}
beforeEach(() => {
  current = {}
  publicFetch.mockReset()
  publicFetch.mockImplementation(async () => json(200, { ...view, ...current }))
})

describe('lookupOrder', () => {
  it('reads the public order endpoint with the encoded code', async () => {
    await lookupOrder('knk abc/1')
    expect(publicFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch.mock.calls[0]![0]).toBe('/v1/orders/by-code/knk%20abc%2F1')
  })

  it('maps the view to the same PublicOrder as before', async () => {
    const o = await lookupOrder('knk-abc123')
    expect(o).toEqual({
      orderCode: 'KNK-ABC123',
      stage: 'awaiting_verification',
      hasConfirmedPayment: false,
      ticket: 'W3',
      fulfilment: 'pickup',
      fulfilAt: '2026-11-21T07:00:00.000Z',
      totalCentavos: 29000,
      deliveryAddress: null,
      items: [{ name: 'Spanish Latte', variantLabel: 'L', quantity: 2, ice: 'Less ice' }],
    })
    expect(Object.keys(o!).sort()).toEqual([
      'deliveryAddress', 'fulfilAt', 'fulfilment', 'hasConfirmedPayment', 'items', 'orderCode', 'stage',
      'ticket', 'totalCentavos',
    ])
  })

  it('a paid or refunded order has a confirmed payment', async () => {
    current = { paymentStatus: 'paid', prepStatus: 'preparing' }
    expect((await lookupOrder('KNK-ABC123'))?.hasConfirmedPayment).toBe(true)
    current = { paymentStatus: 'refunded', prepStatus: 'cancelled', cancelled: true }
    expect((await lookupOrder('KNK-ABC123'))?.hasConfirmedPayment).toBe(true)
  })

  it('an owner-cancelled unverified order shows as cancelled, not as a rejected payment', async () => {
    current = { prepStatus: 'cancelled', paymentStatus: 'rejected', cancelled: true }
    expect((await lookupOrder('KNK-ABC123'))?.stage).toBe('cancelled')
  })

  it('a rejected payment that was not cancelled still shows as rejected', async () => {
    current = { prepStatus: 'cancelled', paymentStatus: 'rejected', cancelled: false }
    expect((await lookupOrder('KNK-ABC123'))?.stage).toBe('rejected')
  })

  it('404 is null', async () => {
    publicFetch.mockResolvedValue(json(404, { code: 'NOT_FOUND' }))
    expect(await lookupOrder('KNK-NOPE')).toBeNull()
  })

  it('any other failure throws (the error boundary, not a 404)', async () => {
    publicFetch.mockResolvedValue(json(500, { code: 'INTERNAL' }))
    await expect(lookupOrder('KNK-ABC123')).rejects.toThrow()
    publicFetch.mockRejectedValue(new Error('network'))
    await expect(lookupOrder('KNK-ABC123')).rejects.toThrow()
  })
})
