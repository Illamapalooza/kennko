import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { orderStage, ticketLabel, type OrderStage } from '@kennko/core'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'

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
 * Narrow projection by design. Never returns payment_proof_path, staff notes,
 * the customer's phone, or the verifier -- the order code is guessable enough
 * that this response must be safe to hand to anyone holding one.
 */
export async function lookupOrder(code: string): Promise<PublicOrder | null> {
  const db = getAdminClient()

  const { data } = await db
    .from('orders')
    .select(
      'order_code, prep_status, payment_status, ticket_series, ticket_number, fulfilment, fulfil_at, total_centavos, delivery_address, cancelled_at, order_lines ( item_name, variant_label, quantity, ice_level, ice_serve, note, order_line_options ( option_name ) )',
    )
    .eq('order_code', code.toUpperCase())
    .maybeSingle()

  if (!data) return null

  return {
    orderCode: data.order_code,
    stage: orderStage(data.prep_status, data.payment_status, data.cancelled_at != null),
    hasConfirmedPayment: data.payment_status === 'paid' || data.payment_status === 'refunded',
    ticket: ticketLabel(data.ticket_series, data.ticket_number),
    fulfilment: data.fulfilment,
    fulfilAt: data.fulfil_at,
    totalCentavos: data.total_centavos,
    deliveryAddress: data.delivery_address,
    items: (data.order_lines ?? []).map(
      (i: {
        item_name: string; variant_label: string; quantity: number
        ice_level: IceLevel | null; ice_serve: IceServe | null
      }) => ({
        name: i.item_name,
        variantLabel: i.variant_label,
        quantity: i.quantity,
        ice: iceSummary(i.ice_level, i.ice_serve),
      }),
    ),
  }
}
