import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'

export type PublicOrder = {
  orderCode: string
  status: string
  fulfilment: 'pickup' | 'delivery'
  fulfilAt: string
  totalCentavos: number
  deliveryAddress: string | null
  items: { name: string; size: string; quantity: number; ice: string | null }[]
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
      'order_code, status, fulfilment, fulfil_at, total_centavos, delivery_address, order_items ( name_snapshot, size, quantity, ice_level, ice_serve )',
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
      (i: {
        name_snapshot: string; size: string; quantity: number
        ice_level: IceLevel | null; ice_serve: IceServe | null
      }) => ({
        name: i.name_snapshot,
        size: i.size,
        quantity: i.quantity,
        ice: iceSummary(i.ice_level, i.ice_serve),
      }),
    ),
  }
}
