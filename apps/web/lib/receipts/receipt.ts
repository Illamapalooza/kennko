import type { PaymentStatus, PrepStatus } from '@kennko/core'
import { formatManilaDateTime } from '@/lib/format/time'

export type ShopSettings = {
  displayName: string
  registeredName: string | null
  tin: string | null
  address: string
  phone: string | null
  facebookUrl: string | null
  receiptFooter: string
}

export type ReceiptLine = {
  itemName: string
  variantLabel: string
  quantity: number
  unitPriceCentavos: number
  lineTotalCentavos: number
  options: { name: string; priceCentavos: number }[]
}

export type ReceiptOrder = {
  orderCode: string
  ticket: string
  customerName: string
  fulfilment: 'pickup' | 'delivery'
  deliveryAddress: string | null
  deliveryBarangay: string | null
  paidAt: string | null
  paymentStatus: PaymentStatus
  prepStatus: PrepStatus
  cancelledAt: string | null
  reference: string | null
  subtotalCentavos: number
  discountCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  lines: ReceiptLine[]
}

export type Receipt = {
  seller: {
    name: string
    registeredName: string | null
    tin: string | null
    address: string
    phone: string | null
    facebookUrl: string | null
  }
  title: 'ORDER RECEIPT'
  notice: 'THIS IS NOT AN OFFICIAL RECEIPT'
  stamp: 'CANCELLED' | 'REFUNDED' | null
  orderCode: string
  ticket: string
  customer: string
  fulfilment: string
  paidAt: string
  reference: string
  lines: ReceiptLine[]
  subtotal: number
  discount: number
  deliveryFee: number
  total: number
  footer: string
}

function maskReference(reference: string): string {
  return reference.length < 5 ? '••••' : `••••${reference.slice(-4)}`
}

/**
 * The customer-facing e-receipt, or null if payment was never verified. `public` is what the
 * guessable-code web page may show; `email` goes only to the customer's own inbox.
 * Totals are copied from the order, never recomputed from lines.
 */
export function buildReceipt(
  order: ReceiptOrder,
  settings: ShopSettings,
  view: 'public' | 'email',
): Receipt | null {
  if (order.paymentStatus !== 'paid' && order.paymentStatus !== 'refunded') return null

  const isPublic = view === 'public'
  const fullName = order.customerName.trim()
  const customer = (isPublic ? fullName.split(/\s+/)[0] : fullName) || 'Customer'

  let fulfilment = 'Pickup'
  if (order.fulfilment === 'delivery') {
    const place = isPublic ? order.deliveryBarangay : order.deliveryAddress ?? order.deliveryBarangay
    fulfilment = place ? `Delivery to ${place}` : 'Delivery'
  }

  const reference = order.reference ?? ''
  const stamp =
    order.paymentStatus === 'refunded'
      ? 'REFUNDED'
      : order.prepStatus === 'cancelled' || order.cancelledAt != null
        ? 'CANCELLED'
        : null

  return {
    seller: {
      name: settings.displayName,
      registeredName: settings.registeredName,
      tin: settings.tin,
      address: settings.address,
      phone: settings.phone,
      facebookUrl: settings.facebookUrl,
    },
    title: 'ORDER RECEIPT',
    notice: 'THIS IS NOT AN OFFICIAL RECEIPT',
    stamp,
    orderCode: order.orderCode,
    ticket: order.ticket,
    customer,
    fulfilment,
    paidAt: order.paidAt ? formatManilaDateTime(order.paidAt) : '',
    reference: isPublic && reference ? maskReference(reference) : reference,
    lines: order.lines,
    subtotal: order.subtotalCentavos,
    discount: order.discountCentavos,
    deliveryFee: order.deliveryFeeCentavos,
    total: order.totalCentavos,
    footer: settings.receiptFooter,
  }
}
