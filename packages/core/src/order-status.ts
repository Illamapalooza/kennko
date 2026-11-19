// Shared order vocabulary for the unified (counter + online) order model.
// Separate from the till's legacy `OrderStatus` in order.ts.

export type Channel = 'counter' | 'online'
export type Fulfilment = 'dine_in' | 'takeout' | 'pickup' | 'delivery'

export type PrepStatus =
  | 'placed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'cancelled'

export type PaymentStatus = 'unpaid' | 'pending_verification' | 'paid' | 'rejected' | 'refunded'

export type PaymentRowStatus =
  | 'recorded'
  | 'pending_verification'
  | 'verified'
  | 'rejected'
  | 'refunded'

export type OrderStage =
  | 'awaiting_verification'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'rejected'
  | 'cancelled'

export function orderStage(prep: PrepStatus, payment: PaymentStatus): OrderStage {
  if (prep === 'cancelled') return payment === 'rejected' ? 'rejected' : 'cancelled'
  if (prep === 'placed') return payment === 'pending_verification' ? 'awaiting_verification' : 'confirmed'
  return prep
}

export function nextPrepStatus(prep: PrepStatus, fulfilment: Fulfilment): PrepStatus | null {
  switch (prep) {
    case 'placed':
      return 'preparing'
    case 'preparing':
      return fulfilment === 'delivery' ? 'out_for_delivery' : 'ready'
    case 'ready':
      return 'completed'
    case 'out_for_delivery':
      return 'completed'
    default:
      return null
  }
}

export function canMovePrep(from: PrepStatus, to: PrepStatus, fulfilment: Fulfilment): boolean {
  return to === nextPrepStatus(from, fulfilment)
}

export function ticketLabel(series: 'C' | 'W', n: number): string {
  return `${series}${n}`
}
