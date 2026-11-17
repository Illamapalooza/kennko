export type OrderStatus =
  | 'awaiting_verification' | 'confirmed' | 'preparing'
  | 'ready' | 'out_for_delivery' | 'completed' | 'rejected' | 'cancelled'

export type Fulfilment = 'pickup' | 'delivery'

const PICKUP_FLOW: OrderStatus[] = ['confirmed', 'preparing', 'ready', 'completed']
const DELIVERY_FLOW: OrderStatus[] = ['confirmed', 'preparing', 'out_for_delivery', 'completed']

/**
 * The next status a staff member can advance an order to, or null if it is
 * finished. Pickup ends at the counter; delivery goes out with a rider.
 */
export function nextStatus(
  status: OrderStatus,
  fulfilment: Fulfilment,
): OrderStatus | null {
  const flow = fulfilment === 'delivery' ? DELIVERY_FLOW : PICKUP_FLOW
  const index = flow.indexOf(status)
  if (index === -1 || index === flow.length - 1) return null
  return flow[index + 1]
}

export function statusLabel(status: OrderStatus): string {
  return {
    awaiting_verification: 'Awaiting payment check',
    confirmed: 'Confirmed',
    preparing: 'Preparing',
    ready: 'Ready for pickup',
    out_for_delivery: 'Out for delivery',
    completed: 'Completed',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }[status]
}

/**
 * Flags orders sharing a GCash reference with another non-rejected order.
 * Reusing one receipt screenshot across several orders is the obvious way to
 * game a static QR, so it is surfaced rather than left for staff to notice.
 */
export function duplicateReferences(
  orders: { gcashReference: string; status: OrderStatus }[],
): Set<string> {
  const counts = new Map<string, number>()
  for (const order of orders) {
    if (order.status === 'rejected') continue
    const key = order.gcashReference.toUpperCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([ref]) => ref))
}
