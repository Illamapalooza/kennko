import 'server-only'
import { orderStage, type HistoryOrderView, type OrderStage } from '@kennko/core'
import { userFetch } from '@/lib/api/client'
import { iceSummary } from '@/lib/cart/ice'
import type { Customer } from '@/lib/auth/customer'

export type HistoryOrder = {
  id: string
  orderCode: string
  stage: OrderStage
  ticket: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  createdAt: string
  deliveryAddress: string | null
  subtotalCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  claimedByEmail: boolean
  items: {
    name: string; variantCode: string; variantLabel: string; quantity: number
    ice: string | null; note: string | null; modifiers: string[]
  }[]
}

/**
 * A customer's orders, from `GET /v1/me/orders` as the signed-in user: ones placed while signed in,
 * plus guest orders under the same address once that address is confirmed. The API applies the rule
 * and asks Supabase Auth itself whether the address is confirmed (Ruling 11), so `customer` only
 * documents who is asking; the session's access token is what the API trusts.
 */
export async function getOrderHistory(_customer: Customer): Promise<HistoryOrder[]> {
  const res = await userFetch('/v1/me/orders')
  if (!res.ok) throw new Error(`Could not load your orders (${res.status})`)
  const { orders } = (await res.json()) as { orders: HistoryOrderView[] }

  return orders.map((o) => ({
    id: o.id,
    orderCode: o.orderCode,
    stage: orderStage(o.prepStatus, o.paymentStatus, o.cancelled),
    ticket: o.ticket,
    fulfilment: o.fulfilment,
    fulfilAt: o.fulfilAt,
    createdAt: o.createdAt,
    deliveryAddress: o.deliveryAddress,
    subtotalCentavos: o.subtotalCentavos,
    deliveryFeeCentavos: o.deliveryFeeCentavos,
    totalCentavos: o.totalCentavos,
    claimedByEmail: o.claimedByEmail,
    items: o.lines.map((l) => ({
      name: l.name,
      variantCode: l.variantCode,
      variantLabel: l.variantLabel,
      quantity: l.quantity,
      ice: iceSummary(l.iceLevel, l.iceServe),
      note: l.note,
      modifiers: l.options,
    })),
  }))
}
