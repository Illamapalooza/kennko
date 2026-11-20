import 'server-only'
import { orderStage, type OrderStage, type PublicOrderView } from '@kennko/core'
import { publicFetch } from '@/lib/api/client'
import { iceSummary } from '@/lib/cart/ice'

export type PublicOrder = {
  orderCode: string
  stage: OrderStage
  /** Payment was verified at some point (paid or refunded): the receipt page has something to show. */
  hasConfirmedPayment: boolean
  /** The customer's number, e.g. W3. */
  ticket: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  totalCentavos: number
  deliveryAddress: string | null
  items: { name: string; variantLabel: string; quantity: number; ice: string | null }[]
}

/**
 * The order page, from the API's public projection (`GET /v1/orders/by-code/:code`), which never
 * carries the proof path, staff notes, the customer's phone or email, or the verifier: the order
 * code is guessable enough that this must be safe to hand to anyone holding one.
 * 404 is null; any other failure throws, so the page shows its error boundary rather than a 404.
 */
export async function lookupOrder(code: string): Promise<PublicOrder | null> {
  const res = await publicFetch(`/v1/orders/by-code/${encodeURIComponent(code)}`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Could not load order ${code} (${res.status})`)
  const v = (await res.json()) as PublicOrderView

  return {
    orderCode: v.orderCode,
    stage: orderStage(v.prepStatus, v.paymentStatus, v.cancelled),
    hasConfirmedPayment: v.paymentStatus === 'paid' || v.paymentStatus === 'refunded',
    ticket: v.ticket,
    fulfilment: v.fulfilment,
    fulfilAt: v.fulfilAt,
    totalCentavos: v.totalCentavos,
    deliveryAddress: v.deliveryAddress,
    items: v.lines.map((l) => ({
      name: l.name,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      ice: iceSummary(l.iceLevel, l.iceServe),
    })),
  }
}
