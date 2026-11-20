import { describe, expect, it } from 'vitest'
import type { OnlineQueueOrder, PrepStatus } from '@kennko/core'
import { deliveryText, onlineAction, onlineColumn, onlineStage, onlineWhen } from '../src/onlineText.ts'

const order = (over: Partial<OnlineQueueOrder> = {}): OnlineQueueOrder => ({
  id: '11111111-1111-4111-8111-111111111111', businessDay: '2026-11-21', ticketNumber: 3, customerName: 'Ana Dela Cruz',
  fulfilment: 'pickup', fulfilAt: '2026-11-21T07:30:00Z', customerNote: null, prepStatus: 'placed',
  createdAt: '2026-11-21T06:00:00Z', updatedAt: '2026-11-21T06:00:00Z', lines: [], delivery: null, ...over,
})
// 2026-11-21 03:00 in Manila
const NOW = Date.UTC(2026, 10, 20, 19, 0)

describe('onlineColumn', () => {
  it.each([
    ['placed', 'queued'], ['preparing', 'preparing'], ['ready', 'serving'], ['out_for_delivery', 'serving'],
    ['completed', null], ['cancelled', null],
  ] as [PrepStatus, string | null][])('%s -> %s', (p, col) => expect(onlineColumn(p)).toBe(col))
})

// Every prep status × online fulfilment: [status, fulfilment, button, stage]. The two impossible pairs (a delivery order
// "ready", a pickup order "out for delivery") get neutral words that promise the customer nothing (final fix 8).
const MATRIX: [PrepStatus, 'pickup' | 'delivery', string | null, string][] = [
  ['placed', 'pickup', 'Start', ''],
  ['placed', 'delivery', 'Start', ''],
  ['preparing', 'pickup', 'Ready', ''],
  ['preparing', 'delivery', 'Out for delivery', ''],
  ['ready', 'pickup', 'Picked up', 'Ready for pickup'],
  ['ready', 'delivery', 'Done', 'Ready'],
  ['out_for_delivery', 'pickup', 'Done', 'Sent out'],
  ['out_for_delivery', 'delivery', 'Delivered', 'Out for delivery'],
  ['completed', 'pickup', null, ''],
  ['completed', 'delivery', null, ''],
  ['cancelled', 'pickup', null, ''],
  ['cancelled', 'delivery', null, ''],
]

describe('onlineAction and onlineStage, every status × fulfilment', () => {
  it('covers all twelve pairs', () => {
    const statuses: PrepStatus[] = ['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']
    expect(new Set(MATRIX.map(([p, f]) => `${p}/${f}`))).toEqual(new Set(statuses.flatMap((p) => [`${p}/pickup`, `${p}/delivery`])))
  })
  it.each(MATRIX)('%s %s: button %s, stage "%s"', (p, f, action, stage) => {
    expect(onlineAction(p, f)).toBe(action)
    expect(onlineStage(p, f)).toBe(stage)
  })
})

describe('onlineWhen', () => {
  it('today', () => {
    expect(onlineWhen(order(), NOW)).toBe('Pickup 3:30 PM')
    expect(onlineWhen(order({ fulfilment: 'delivery' }), NOW)).toBe('Delivery 3:30 PM')
  })
  it('another day carries the date', () => {
    expect(onlineWhen(order({ fulfilAt: '2026-11-22T02:00:00Z' }), NOW)).toBe('Pickup Sun 22 Nov, 10:00 AM')
  })
  it('across Manila midnight', () => {
    expect(onlineWhen(order({ fulfilAt: '2026-11-21T16:30:00Z' }), NOW)).toBe('Pickup Sun 22 Nov, 12:30 AM')
  })
  it('noon', () => {
    expect(onlineWhen(order({ fulfilAt: '2026-11-21T04:05:00Z' }), NOW)).toBe('Pickup 12:05 PM')
  })
})

describe('deliveryText', () => {
  it('address, barangay and phone for delivery', () => {
    const d = order({ fulfilment: 'delivery', delivery: { address: '1 Gate St', barangay: 'Libertad', phone: '0917 111 2222' } })
    expect(deliveryText(d)).toBe('1 Gate St, Libertad · 0917 111 2222')
  })
  it('nothing for pickup', () => expect(deliveryText(order())).toBeNull())
})
