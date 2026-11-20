import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import { ticketLabel, type PaymentStatus, type PrepStatus } from '@kennko/core'
import type { ReceiptOrder, ShopSettings } from './receipt'

const FALLBACK_SETTINGS: ShopSettings = {
  displayName: 'Kennko Coffee',
  registeredName: null,
  tin: null,
  address: 'CT. Montalban St., Villa Kananga, Butuan City, Philippines 8600',
  phone: null,
  facebookUrl: null,
  receiptFooter: 'Ask for your official receipt at the counter.',
}

type PaymentRow = {
  reference: string | null; status: string; verified_at: string | null; recorded_at: string
}

type Row = {
  order_code: string; ticket_series: 'C' | 'W'; ticket_number: number
  customer_name: string; fulfilment: 'pickup' | 'delivery'
  delivery_address: string | null; delivery_barangay: string | null
  prep_status: PrepStatus; payment_status: PaymentStatus; cancelled_at: string | null
  subtotal_centavos: number; discount_centavos: number
  delivery_fee_centavos: number; total_centavos: number
  payments: PaymentRow[] | null
  order_lines: {
    item_name: string; variant_label: string; quantity: number
    unit_price_centavos: number; line_total_centavos: number
    order_line_options: { option_name: string; price_centavos: number }[] | null
  }[] | null
}

/** The live (non-rejected) payment, else the newest -- same rule as the admin order list. */
function livePayment(payments: PaymentRow[]): PaymentRow | null {
  const newestFirst = [...payments].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
  return newestFirst.find((p) => p.status !== 'rejected') ?? newestFirst[0] ?? null
}

/** Service-role read of everything a receipt shows. Callers decide what is safe to display. */
export async function loadReceiptOrder(code: string): Promise<ReceiptOrder | null> {
  const db = getAdminClient()
  const { data } = await db
    .from('orders')
    .select(
      `order_code, ticket_series, ticket_number, customer_name, fulfilment, delivery_address,
       delivery_barangay, prep_status, payment_status, cancelled_at,
       subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos,
       payments ( reference, status, verified_at, recorded_at ),
       order_lines ( item_name, variant_label, quantity, unit_price_centavos, line_total_centavos,
                     order_line_options ( option_name, price_centavos ) )`,
    )
    .eq('order_code', code.toUpperCase())
    .maybeSingle()

  if (!data) return null
  const r = data as unknown as Row
  const payment = livePayment(r.payments ?? [])

  return {
    orderCode: r.order_code,
    ticket: ticketLabel(r.ticket_series, r.ticket_number),
    customerName: r.customer_name,
    fulfilment: r.fulfilment,
    deliveryAddress: r.delivery_address,
    deliveryBarangay: r.delivery_barangay,
    paidAt: payment?.verified_at ?? null,
    paymentStatus: r.payment_status,
    prepStatus: r.prep_status,
    cancelledAt: r.cancelled_at,
    reference: payment?.reference ?? null,
    subtotalCentavos: r.subtotal_centavos,
    discountCentavos: r.discount_centavos,
    deliveryFeeCentavos: r.delivery_fee_centavos,
    totalCentavos: r.total_centavos,
    lines: (r.order_lines ?? []).map((l) => ({
      itemName: l.item_name,
      variantLabel: l.variant_label,
      quantity: l.quantity,
      unitPriceCentavos: l.unit_price_centavos,
      lineTotalCentavos: l.line_total_centavos,
      options: (l.order_line_options ?? []).map((o) => ({
        name: o.option_name,
        priceCentavos: o.price_centavos,
      })),
    })),
  }
}

export async function loadShopSettings(): Promise<ShopSettings> {
  try {
    const { data, error } = await getAdminClient()
      .from('shop_settings')
      .select('display_name, registered_name, tin, address, phone, facebook_url, receipt_footer')
      .eq('id', 1)
      .maybeSingle()
    if (error || !data) throw error ?? new Error('shop_settings row missing')
    return {
      displayName: data.display_name,
      registeredName: data.registered_name,
      tin: data.tin,
      address: data.address,
      phone: data.phone,
      facebookUrl: data.facebook_url,
      receiptFooter: data.receipt_footer,
    }
  } catch (err) {
    console.error('[receipt] could not read shop_settings, using fallback', err)
    return FALLBACK_SETTINGS
  }
}
