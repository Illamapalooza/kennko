import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'

export type PublicOrder = {
  orderCode: string
  status: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  totalCentavos: number
  deliveryAddress: string | null
  items: { name: string; size: string; quantity: number }[]
}

/**
 * Narrow projection by design. Never returns payment_proof_path, staff notes,
 * the customer's phone, or the verifier -- the order code is guessable enough
 * that this response must be safe to hand to anyone holding one.
 */
export async function lookupOrder(code: string): Promise<PublicOrder | null> {
  const db = getAdminClient()

  const { data } = await db
    .from('orders')
    .select(
      'order_code, status, fulfilment, fulfil_at, total_centavos, delivery_address, order_items ( name_snapshot, size, quantity )',
    )
    .eq('order_code', code.toUpperCase())
    .maybeSingle()

  if (!data) return null

  return {
    orderCode: data.order_code,
    status: data.status,
    fulfilment: data.fulfilment,
    fulfilAt: data.fulfil_at,
    totalCentavos: data.total_centavos,
    deliveryAddress: data.delivery_address,
    items: (data.order_items ?? []).map(
      (i: { name_snapshot: string; size: string; quantity: number }) => ({
        name: i.name_snapshot,
        size: i.size,
        quantity: i.quantity,
      }),
    ),
  }
}
