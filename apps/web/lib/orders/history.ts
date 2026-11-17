import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'
import type { Customer } from '@/lib/auth/customer'

export type HistoryOrder = {
  id: string
  orderCode: string
  status: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  createdAt: string
  deliveryAddress: string | null
  subtotalCentavos: number
  deliveryFeeCentavos: number
  totalCentavos: number
  claimedByEmail: boolean
  items: {
    name: string; size: string; quantity: number
    ice: string | null; note: string | null; modifiers: string[]
  }[]
}

/**
 * A customer's orders: ones placed while signed in, plus guest orders under the
 * same address once that address is confirmed. The confirmation check is the
 * security boundary -- without it, signing up as someone else's address would
 * expose their history. Google accounts always arrive confirmed.
 *
 * Runs with the service role behind an explicit identity check rather than
 * relying on RLS alone, so the matching rule lives in one readable place.
 */
export async function getOrderHistory(customer: Customer): Promise<HistoryOrder[]> {
  const db = getAdminClient()

  const columns = `id, order_code, status, fulfilment, fulfil_at, created_at,
     delivery_address, subtotal_centavos, delivery_fee_centavos, total_centavos,
     customer_user_id, customer_email,
     order_items ( name_snapshot, size, quantity, ice_level, ice_serve, item_note,
                   order_item_modifiers ( name_snapshot ) )`

  const filter = customer.emailConfirmed
    ? `customer_user_id.eq.${customer.id},customer_email.eq.${customer.email.toLowerCase()}`
    : `customer_user_id.eq.${customer.id}`

  const { data, error } = await db
    .from('orders')
    .select(columns)
    .or(filter)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(`Could not load your orders: ${error.message}`)

  type Row = {
    id: string; order_code: string; status: string
    fulfilment: 'pickup' | 'delivery'; fulfil_at: string; created_at: string
    delivery_address: string | null
    subtotal_centavos: number; delivery_fee_centavos: number; total_centavos: number
    customer_user_id: string | null; customer_email: string
    order_items: {
      name_snapshot: string; size: string; quantity: number
      ice_level: IceLevel | null; ice_serve: IceServe | null; item_note: string | null
      order_item_modifiers: { name_snapshot: string }[]
    }[]
  }

  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    orderCode: r.order_code,
    status: r.status,
    fulfilment: r.fulfilment,
    fulfilAt: r.fulfil_at,
    createdAt: r.created_at,
    deliveryAddress: r.delivery_address,
    subtotalCentavos: r.subtotal_centavos,
    deliveryFeeCentavos: r.delivery_fee_centavos,
    totalCentavos: r.total_centavos,
    claimedByEmail: r.customer_user_id !== customer.id,
    items: (r.order_items ?? []).map((i) => ({
      name: i.name_snapshot,
      size: i.size,
      quantity: i.quantity,
      ice: iceSummary(i.ice_level, i.ice_serve),
      note: i.item_note,
      modifiers: (i.order_item_modifiers ?? []).map((m) => m.name_snapshot),
    })),
  }))
}
