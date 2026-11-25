import { manilaDay } from '@kennko/core'
import type { Store } from './store.ts'
import type { SyncStatus } from './sync.ts'
import { WALL_LINGER_MS } from './wall-feed.ts'

/**
 * What `/api/events` sends the tablets: the active tickets, seated dine-in cats still on the wall, the open shift,
 * the paid online orders, the menu key and the sync status. It never carries the wall's check-in or visiting cats
 * (Plan 8): those go to the wall's feed only, and the check-in secret to neither.
 */
export function tabletSnapshot(store: Store, o: { version: number; now: number; menuKey: string; sync: SyncStatus }) {
  const seated = store
    .recentlyFinished(o.now - WALL_LINGER_MS)
    .filter((order) => order.status === 'done' && order.type === 'dine_in')
  return {
    version: o.version, now: o.now, day: manilaDay(o.now), active: store.activeOrders(), seated, shift: store.openShift(),
    // Paid online orders being made or out for delivery (Plan 5), kept apart from the till's own tickets.
    online: store.activeOnlineOrders(),
    pendingPayments: store.pendingPayments(),
    menuKey: o.menuKey,
    sync: o.sync,
  }
}
