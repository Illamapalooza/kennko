import type { OrderStatus } from './status'

export type OrderTab = 'check' | 'progress' | 'done'

type TabOrder = { status: OrderStatus; createdAt: string }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const TAB_STATUSES: Record<OrderTab, OrderStatus[]> = {
  check: ['awaiting_verification'],
  progress: ['confirmed', 'preparing', 'ready', 'out_for_delivery'],
  done: ['completed', 'rejected', 'cancelled'],
}

export function parseTab(value: string | undefined): OrderTab | null {
  return value === 'check' || value === 'progress' || value === 'done' ? value : null
}

export function ordersForTab<T extends TabOrder>(orders: T[], tab: OrderTab, now: Date): T[] {
  return orders.filter((o) => {
    if (!TAB_STATUSES[tab].includes(o.status)) return false
    if (tab !== 'done') return true
    return now.getTime() - new Date(o.createdAt).getTime() <= WEEK_MS
  })
}

export function tabCounts(orders: TabOrder[], now: Date): Record<OrderTab, number> {
  return {
    check: ordersForTab(orders, 'check', now).length,
    progress: ordersForTab(orders, 'progress', now).length,
    done: ordersForTab(orders, 'done', now).length,
  }
}
