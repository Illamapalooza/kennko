import type { OnlineQueueOrder, Order, OrderStatus, PrepStatus } from '@kennko/core'

/**
 * What the projector wall may know about an order: no prices, no payment, nothing but what is being made. `series`
 * tells the wall a counter ticket (C) from an online one (W); for online orders `name` is the first name only.
 */
export type WallOrder = {
  id: number
  number: number
  series: 'C' | 'W'
  name: string
  items: { name: string; qty: number }[]
  status: OrderStatus
  createdAt: number
  updatedAt: number
}

/** How long a finished order stays in the feed, so its cat can finish the drink and walk out. */
export const WALL_LINGER_MS = 90_000

/**
 * An online order's step as a wall status (Plan 5 Ruling 11). Out for delivery is `done`: the customer is not in the
 * shop, so the number is not called.
 */
export const ONLINE_TO_WALL: Record<PrepStatus, OrderStatus> = {
  placed: 'queued',
  preparing: 'preparing',
  ready: 'serving',
  out_for_delivery: 'done',
  completed: 'done',
  cancelled: 'voided',
}

// The wall shows drinks, not sizes: two lattes in different sizes are still two lattes.
function byName(lines: { name: string; quantity: number }[]): { name: string; qty: number }[] {
  const items = new Map<string, number>()
  for (const line of lines) items.set(line.name, (items.get(line.name) ?? 0) + line.quantity)
  return [...items].map(([name, qty]) => ({ name, qty }))
}

export function wallOrders(orders: Order[]): WallOrder[] {
  return orders.map((order) => ({
    id: order.id,
    number: order.number,
    series: 'C',
    name: order.customerName,
    items: byName(order.lines),
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }))
}

/** Online orders for the wall: picked field by field, so no delivery details, phone or note can reach the projector. */
export function wallOnlineOrders(orders: OnlineQueueOrder[]): WallOrder[] {
  return orders.map((order) => ({
    id: order.ticketNumber,
    number: order.ticketNumber,
    series: 'W',
    name: order.customerName.trim().split(/\s+/)[0] ?? '',
    items: byName(order.lines),
    status: ONLINE_TO_WALL[order.prepStatus],
    createdAt: Date.parse(order.createdAt),
    updatedAt: Date.parse(order.updatedAt),
  }))
}
