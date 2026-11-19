import type { PaymentStatus, PrepStatus } from '@kennko/core'

export type OrderTab = 'check' | 'progress' | 'done'

type TabOrder = { prepStatus: PrepStatus; paymentStatus: PaymentStatus; createdAt: string }

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

const PROGRESS_PREP: PrepStatus[] = ['placed', 'preparing', 'ready', 'out_for_delivery']
const DONE_PREP: PrepStatus[] = ['completed', 'cancelled']

export function parseTab(value: string | undefined): OrderTab | null {
  return value === 'check' || value === 'progress' || value === 'done' ? value : null
}

function inTab(o: TabOrder, tab: OrderTab): boolean {
  switch (tab) {
    case 'check':
      return o.paymentStatus === 'pending_verification' && o.prepStatus !== 'cancelled'
    case 'progress':
      return o.paymentStatus === 'paid' && PROGRESS_PREP.includes(o.prepStatus)
    case 'done':
      return DONE_PREP.includes(o.prepStatus)
  }
}

export function ordersForTab<T extends TabOrder>(orders: T[], tab: OrderTab, now: Date): T[] {
  return orders.filter((o) => {
    if (!inTab(o, tab)) return false
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

/** Column filters for the three order queries. Open tabs are never limited; done is the last 7 days. */
export function orderQueries(now: Date): {
  check: { paymentStatus: PaymentStatus; excludePrep: PrepStatus[] }
  progress: { paymentStatus: PaymentStatus; prepStatuses: PrepStatus[] }
  done: { prepStatuses: PrepStatus[]; since: string }
} {
  return {
    check: { paymentStatus: 'pending_verification', excludePrep: ['cancelled'] },
    progress: { paymentStatus: 'paid', prepStatuses: [...PROGRESS_PREP] },
    done: { prepStatuses: [...DONE_PREP], since: new Date(now.getTime() - WEEK_MS).toISOString() },
  }
}
