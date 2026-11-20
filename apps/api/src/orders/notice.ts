import { ticketLabel, type PaymentNotice } from '@kennko/core'
import type postgres from 'postgres'
import { livePayment } from './read.js'

/**
 * Staff-only reads about one payment: its proof and what the customer emails need (Ruling 14). Never
 * used by a public route: the notice carries the email address, full name, street address and full
 * GCash reference.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d)

/** The payment's stored proof path, or null when there is no such payment or it has no proof. */
export async function readProofPath(sql: postgres.Sql, paymentId: string): Promise<string | null> {
  if (!UUID.test(paymentId)) return null
  const [row] = await sql<{ proof_path: string | null }[]>`select proof_path from payments where id = ${paymentId}`
  return row?.proof_path ?? null
}

export type NoticeResult = { ok: true; notice: PaymentNotice } | { ok: false; reason: 'not_found' | 'no_email' }

/** The payment's order, as the website's customer emails need it. A counter sale has no email. */
export async function readPaymentNotice(sql: postgres.Sql, paymentId: string): Promise<NoticeResult> {
  if (!UUID.test(paymentId)) return { ok: false, reason: 'not_found' }
  const [pay] = await sql<{ order_id: string }[]>`select order_id from payments where id = ${paymentId}`
  if (!pay) return { ok: false, reason: 'not_found' }

  type Row = {
    id: string; channel: string; order_code: string | null; ticket_series: 'C' | 'W'; ticket_number: number
    customer_name: string; customer_email: string | null; fulfilment: string; fulfil_at: Date | null
    total_centavos: number; delivery_address: string | null; payment_status: string
  }
  const [o] = await sql<Row[]>`
    select id, channel, order_code, ticket_series, ticket_number, customer_name, customer_email, fulfilment,
      fulfil_at, total_centavos, delivery_address, payment_status
    from orders where id = ${pay.order_id}`
  if (!o) return { ok: false, reason: 'not_found' }
  if (o.channel !== 'online' || !o.customer_email || !o.order_code) return { ok: false, reason: 'no_email' }

  type LineRow = { item_name: string; variant_label: string; quantity: number }
  const lines = await sql<LineRow[]>`
    select item_name, variant_label, quantity from order_lines where order_id = ${o.id} order by created_at, id`

  // The full reference, for the emailed receipt only, and only once the payment is confirmed.
  const confirmed = o.payment_status === 'paid' || o.payment_status === 'refunded'
  let reference: string | null = null
  if (confirmed) {
    const payments = await sql<{ reference: string | null; status: string; verified_at: Date | null; recorded_at: Date }[]>`
      select reference, status, verified_at, recorded_at from payments where order_id = ${o.id}`
    reference = livePayment(payments)?.reference ?? null
  }

  return {
    ok: true,
    notice: {
      to: o.customer_email,
      orderCode: o.order_code,
      ticket: ticketLabel(o.ticket_series, o.ticket_number),
      customerName: o.customer_name,
      fulfilment: o.fulfilment as 'pickup' | 'delivery',
      fulfilAt: o.fulfil_at == null ? null : iso(o.fulfil_at),
      totalCentavos: o.total_centavos,
      deliveryAddress: o.delivery_address,
      reference,
      items: lines.map((l) => ({ name: l.item_name, variantLabel: l.variant_label, quantity: l.quantity })),
    },
  }
}
