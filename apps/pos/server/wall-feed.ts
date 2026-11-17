import type { Order, OrderStatus } from '@kennko/core'

/** What the projector wall may know about an order: no prices, no payment, nothing but what is being made. */
export type WallOrder = {
  id: number
  number: number
  name: string
  items: { name: string; qty: number }[]
  status: OrderStatus
  createdAt: number
  updatedAt: number
}

/** How long a finished order stays in the feed, so its cat can finish the drink and walk out. */
export const WALL_LINGER_MS = 90_000

export function wallOrders(orders: Order[]): WallOrder[] {
  return orders.map((order) => {
    // The wall shows drinks, not sizes: two lattes in different sizes are still two lattes.
    const items = new Map<string, number>()
    for (const line of order.lines) items.set(line.name, (items.get(line.name) ?? 0) + line.quantity)
    return {
      id: order.id,
      number: order.number,
      name: order.customerName,
      items: [...items].map(([name, qty]) => ({ name, qty })),
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    }
  })
}
