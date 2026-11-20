import { orderStage, ticketLabel, type PaymentStatus, type PrepStatus } from '@kennko/core'
import type { AdminOrder } from '@/components/admin/OrderCard'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'
import type { Fulfilment } from './status'

type PaymentRow = {
  id: string; reference: string | null; proof_path: string | null
  status: string; recorded_at: string
}

export type OrderRow = {
  id: string; order_code: string; prep_status: PrepStatus; payment_status: PaymentStatus
  ticket_series: 'C' | 'W'; ticket_number: number; fulfilment: Fulfilment
  customer_name: string; customer_phone: string; customer_email: string
  delivery_address: string | null; delivery_barangay: string | null
  delivery_lat: string | null; delivery_lng: string | null
  delivery_distance_km: string | null
  fulfil_at: string; subtotal_centavos: number; delivery_fee_centavos: number
  total_centavos: number; customer_note: string | null
  created_at: string
  cancelled_at: string | null; cancel_reason: string | null
  payments: PaymentRow[]
  order_lines: {
    item_name: string; variant_label: string; quantity: number
    ice_level: string | null; ice_serve: string | null; note: string | null
    order_line_options: { option_name: string }[]
  }[]
}

export const ORDER_SELECT = `id, order_code, prep_status, payment_status, ticket_series, ticket_number,
       fulfilment, customer_name, customer_phone,
       customer_email, delivery_address, delivery_barangay,
       delivery_lat, delivery_lng, delivery_distance_km, fulfil_at,
       subtotal_centavos, delivery_fee_centavos, total_centavos,
       customer_note, created_at, cancelled_at, cancel_reason,
       payments ( id, reference, proof_path, status, recorded_at ),
       order_lines ( item_name, variant_label, quantity, ice_level, ice_serve, note,
                     order_line_options ( option_name ) )`

/** The payment staff act on: the live (non-rejected) one, else the newest. */
function livePayment(payments: PaymentRow[]): PaymentRow | null {
  const newestFirst = [...payments].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
  return newestFirst.find((p) => p.status !== 'rejected') ?? newestFirst[0] ?? null
}

export function toAdminOrder(r: OrderRow): AdminOrder {
  const payment = livePayment(r.payments ?? [])
  return {
    id: r.id,
    orderCode: r.order_code,
    ticket: ticketLabel(r.ticket_series, r.ticket_number),
    prepStatus: r.prep_status,
    paymentStatus: r.payment_status,
    stage: orderStage(r.prep_status, r.payment_status, r.cancelled_at != null),
    fulfilment: r.fulfilment,
    customerName: r.customer_name,
    customerPhone: r.customer_phone,
    customerEmail: r.customer_email,
    deliveryAddress: r.delivery_address,
    deliveryBarangay: r.delivery_barangay,
    deliveryLat: r.delivery_lat === null ? null : Number(r.delivery_lat),
    deliveryLng: r.delivery_lng === null ? null : Number(r.delivery_lng),
    deliveryDistanceKm:
      r.delivery_distance_km === null ? null : Number(r.delivery_distance_km),
    fulfilAt: r.fulfil_at,
    subtotalCentavos: r.subtotal_centavos,
    deliveryFeeCentavos: r.delivery_fee_centavos,
    totalCentavos: r.total_centavos,
    paymentId: payment?.id ?? null,
    gcashReference: payment?.reference ?? null,
    proofPath: payment?.proof_path ?? null,
    customerNote: r.customer_note,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
    items: (r.order_lines ?? []).map((i) => ({
      name: i.item_name,
      variantLabel: i.variant_label,
      quantity: i.quantity,
      modifiers: (i.order_line_options ?? []).map((m) => m.option_name),
      ice: iceSummary(
        i.ice_level as IceLevel | null,
        i.ice_serve as IceServe | null,
      ),
      note: i.note,
    })),
  }
}
