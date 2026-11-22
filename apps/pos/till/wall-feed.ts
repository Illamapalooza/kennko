import { manilaDay, type CatLook, type Menu, type OnlineQueueOrder, type Order, type OrderStatus, type PrepStatus } from '@kennko/core'
import { storedSkew, type WallCheckin } from './checkin.ts'
import type { Store } from './store.ts'

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
  fulfilment?: 'dine_in' | 'takeout' | 'pickup' | 'delivery'
  prepStatus?: PrepStatus
  look?: CatLook
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

export function wallOrders(orders: Order[], lookFor?: (code: string) => CatLook | null): WallOrder[] {
  return orders.map((order) => {
    const look = order.customerCode && lookFor ? lookFor(order.customerCode) : null
    return {
      id: order.id,
      number: order.number,
      series: 'C',
      name: order.customerName,
      items: byName(order.lines),
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      ...(look ? { look } : {}),
    }
  })
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
    fulfilment: order.fulfilment,
    prepStatus: order.prepStatus,
    ...(order.catLook ? { look: order.catLook } : {}),
  }))
}

/** A visiting cat as the wall gets it (Plan 8): the per-visit key, the name, the look, and when the visit ends. */
export type WallFeedVisitor = { key: string; name: string; look: CatLook; endsAt: number }

/**
 * What `/api/wall/events` sends: the menu's drink names and the orders being made or just finished, built field by
 * field above, so no price, payment, Kennko card code or stamp can reach the projector. Plan 8 adds the check-in QR
 * (`checkin`, precomputed by `currentCheckin`: the link and its modules, never the secret) and the visiting cats, built
 * field by field. A visit's end is the server's time; `endsAt` is turned to the till's clock (minus the skew) so the
 * wall walks a cat out on time, and an ended visit is dropped here even while the till is offline.
 */
export function wallSnapshot(store: Store, menu: Menu, now: number, checkin: WallCheckin | null) {
  const since = now - WALL_LINGER_MS
  const skew = storedSkew(store) ?? 0
  const visitors: WallFeedVisitor[] = store.activeVisitors(now + skew).map((v) => ({
    key: v.key,
    name: v.name,
    look: wallLook(v.look),
    endsAt: Date.parse(v.endsAt) - skew,
  }))
  return {
    now, day: manilaDay(now),
    menu: wallMenu(menu),
    orders: [
      ...wallOrders([...store.activeOrders(), ...store.recentlyFinished(since)], (code) => store.cachedCustomer?.(code)?.catLook ?? null),
      ...wallOnlineOrders([...store.activeOnlineOrders(), ...store.recentlyFinishedOnline(since)]),
    ],
    checkin: checkin ? { url: checkin.url, modules: checkin.modules } : null,
    visitors,
  }
}

/** Only the slots, slot by slot. */
function wallLook(look: CatLook): CatLook {
  const out: CatLook = { coat: look.coat }
  for (const slot of ['hat', 'face', 'neck', 'held'] as const) if (typeof look[slot] === 'string') out[slot] = look[slot]
  return out
}

/** The drink names the barista cats show: category, name and bestseller star. Never a price, id or stock. */
export type WallMenu = { category: string; items: { name: string; star: boolean }[] }[]

/** Every item stays, sold out or not (the cats show names, not stock). Empty categories are skipped. */
export function wallMenu(menu: Menu): WallMenu {
  return menu.categories
    .map((c) => ({ category: c.name, items: c.items.map((i) => ({ name: i.name, star: i.isBestseller })) }))
    .filter((c) => c.items.length > 0)
}
