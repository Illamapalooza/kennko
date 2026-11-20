import { describe, expect, it } from 'vitest'
import type { OnlineQueueOrder, PrepStatus } from '@kennko/core'
import { ONLINE_TO_WALL, wallOnlineOrders } from '../server/wall-feed.ts'

const order: OnlineQueueOrder = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  businessDay: '2026-11-21',
  ticketNumber: 3,
  customerName: 'Ana Dela Cruz',
  fulfilment: 'delivery',
  fulfilAt: '2026-11-21T02:30:00.000Z',
  customerNote: 'Gate is blue',
  prepStatus: 'placed',
  createdAt: '2026-11-21T01:50:00.000Z',
  updatedAt: '2026-11-21T01:52:00.000Z',
  lines: [
    { name: 'Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' },
    { name: 'Latte', size: 'L', quantity: 2, options: ['Oat milk'], iceLevel: 'less', iceServe: 'side', note: 'extra hot' },
    { name: 'Ensaymada', size: 'R', quantity: 1, options: [], iceLevel: null, iceServe: null, note: '' },
  ],
  delivery: { address: '12 Montilla Blvd', barangay: 'Libertad', phone: '09171234567' },
}

describe('online orders on the wall', () => {
  it('maps each prep status per Ruling 11', () => {
    expect(ONLINE_TO_WALL).toEqual({
      placed: 'queued',
      preparing: 'preparing',
      ready: 'serving',
      out_for_delivery: 'done',
      completed: 'done',
      cancelled: 'voided',
    })
    const statuses: PrepStatus[] = ['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']
    expect(wallOnlineOrders(statuses.map((prepStatus) => ({ ...order, prepStatus }))).map((w) => w.status))
      .toEqual(['queued', 'preparing', 'serving', 'done', 'done', 'voided'])
  })

  it('shows the W number, the first name only and drinks summed by name, with the times as numbers', () => {
    expect(wallOnlineOrders([order])).toEqual([{
      id: 3,
      number: 3,
      series: 'W',
      name: 'Ana',
      items: [{ name: 'Latte', qty: 3 }, { name: 'Ensaymada', qty: 1 }],
      status: 'queued',
      createdAt: Date.parse('2026-11-21T01:50:00.000Z'),
      updatedAt: Date.parse('2026-11-21T01:52:00.000Z'),
    }])
  })

  it('never carries the delivery details, phone, note or lines to the projector', () => {
    const [w] = wallOnlineOrders([order])
    for (const key of ['delivery', 'phone', 'customerNote', 'lines']) expect(w).not.toHaveProperty(key)
    expect(JSON.stringify(w)).not.toMatch(/Montilla|Libertad|0917|Gate|Dela Cruz|extra hot|Oat/)
  })

  it('copes with a name of spaces only', () => {
    expect(wallOnlineOrders([{ ...order, customerName: '   ' }])[0]!.name).toBe('')
  })
})
