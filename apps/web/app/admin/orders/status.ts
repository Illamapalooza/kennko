import { nextPrepStatus, type OrderStage, type PaymentStatus, type PrepStatus } from '@kennko/core'

export type Fulfilment = 'pickup' | 'delivery'

/**
 * The prep status a staff member can advance an order to, or null if there is nothing to do.
 * Nothing is offered until the payment is verified: no drinks before the money is checked.
 */
export function nextStatus(order: {
  prepStatus: PrepStatus
  paymentStatus: PaymentStatus
  fulfilment: Fulfilment
}): PrepStatus | null {
  if (order.paymentStatus !== 'paid') return null
  return nextPrepStatus(order.prepStatus, order.fulfilment)
}

const STAGE_LABELS: Record<OrderStage, string> = {
  awaiting_verification: 'Awaiting payment check',
  confirmed: 'Confirmed',
  preparing: 'Preparing',
  ready: 'Ready for pickup',
  out_for_delivery: 'Out for delivery',
  completed: 'Completed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export function statusLabel(stage: OrderStage): string {
  return STAGE_LABELS[stage]
}

/** The label for the button that moves an order to this prep status. */
export function prepLabel(prep: PrepStatus): string {
  return STAGE_LABELS[prep === 'placed' ? 'confirmed' : prep]
}

/**
 * Flags orders sharing a GCash reference with another order whose payment was not rejected.
 * Reusing one receipt screenshot across several orders is the obvious way to
 * game a static QR, so it is surfaced rather than left for staff to notice.
 */
export function duplicateReferences(
  orders: { gcashReference: string | null; paymentStatus: PaymentStatus }[],
): Set<string> {
  const counts = new Map<string, number>()
  for (const order of orders) {
    if (order.paymentStatus === 'rejected' || !order.gcashReference) continue
    const key = order.gcashReference.toUpperCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([ref]) => ref))
}
