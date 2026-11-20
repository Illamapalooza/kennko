import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryOrderView } from '@kennko/core'

vi.mock('server-only', () => ({}))

const userFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ userFetch: (...a: unknown[]) => userFetch(...a) }))

import { getOrderHistory } from './history'

const who = { id: 'u1', email: 'a@b.c', name: 'A', avatarUrl: null, emailConfirmed: true }

const view: HistoryOrderView = {
  id: 'o1',
  orderCode: 'KNK-ABC123',
  ticket: 'W3',
  prepStatus: 'placed',
  paymentStatus: 'pending_verification',
  cancelled: false,
  fulfilment: 'delivery',
  fulfilAt: '2026-11-21T07:00:00.000Z',
  createdAt: '2026-11-20T00:00:00.000Z',
  deliveryAddress: '1 Gate St',
  subtotalCentavos: 29000,
  deliveryFeeCentavos: 2000,
  totalCentavos: 31000,
  claimedByEmail: true,
  lines: [{
    name: 'Spanish Latte', variantCode: 'L', variantLabel: 'Large', quantity: 2,
    iceLevel: 'regular', iceServe: 'side', note: 'hot please', options: ['Oat milk'],
  }],
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  userFetch.mockReset()
  userFetch.mockResolvedValue(json(200, { orders: [view] }))
})

describe('getOrderHistory', () => {
  it("reads the signed-in customer's orders from the API", async () => {
    await getOrderHistory(who)
    expect(userFetch).toHaveBeenCalledTimes(1)
    expect(userFetch.mock.calls[0]![0]).toBe('/v1/me/orders')
  })

  it('maps to the same HistoryOrder as before, passing claimedByEmail through', async () => {
    const [o] = await getOrderHistory(who)
    expect(o).toEqual({
      id: 'o1',
      orderCode: 'KNK-ABC123',
      stage: 'awaiting_verification',
      ticket: 'W3',
      fulfilment: 'delivery',
      fulfilAt: '2026-11-21T07:00:00.000Z',
      createdAt: '2026-11-20T00:00:00.000Z',
      deliveryAddress: '1 Gate St',
      subtotalCentavos: 29000,
      deliveryFeeCentavos: 2000,
      totalCentavos: 31000,
      claimedByEmail: true,
      items: [{
        name: 'Spanish Latte', variantCode: 'L', variantLabel: 'Large', quantity: 2,
        ice: 'Regular ice, on the side', note: 'hot please', modifiers: ['Oat milk'],
      }],
    })
    expect(Object.keys(o!).sort()).toEqual([
      'claimedByEmail', 'createdAt', 'deliveryAddress', 'deliveryFeeCentavos', 'fulfilAt', 'fulfilment', 'id',
      'items', 'orderCode', 'stage', 'subtotalCentavos', 'ticket', 'totalCentavos',
    ])
    userFetch.mockResolvedValue(json(200, { orders: [{ ...view, claimedByEmail: false }] }))
    expect((await getOrderHistory(who))[0]!.claimedByEmail).toBe(false)
  })

  it('applies the cancelled rule', async () => {
    userFetch.mockResolvedValue(json(200, {
      orders: [
        { ...view, prepStatus: 'cancelled', paymentStatus: 'rejected', cancelled: true },
        { ...view, prepStatus: 'cancelled', paymentStatus: 'rejected', cancelled: false },
      ],
    }))
    expect((await getOrderHistory(who)).map((o) => o.stage)).toEqual(['cancelled', 'rejected'])
  })

  it('an empty history is an empty list', async () => {
    userFetch.mockResolvedValue(json(200, { orders: [] }))
    expect(await getOrderHistory(who)).toEqual([])
  })

  it.each([401, 503, 500])('a %s throws Could not load your orders', async (status) => {
    userFetch.mockResolvedValue(json(status, { code: 'X' }))
    await expect(getOrderHistory(who)).rejects.toThrow('Could not load your orders')
  })
})
