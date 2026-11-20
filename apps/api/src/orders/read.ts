import {
  ticketLabel,
  type HistoryOrderView,
  type IceLevel,
  type IceServe,
  type PaymentStatus,
  type PrepStatus,
  type PublicOrderView,
  type PublicReceiptView,
} from '@kennko/core'
import type postgres from 'postgres'

/**
 * The customer-facing reads, each today's website projection exactly (Rulings 10 and 11). Every query
 * names its columns, so a column added later never reaches a customer by accident. Never read here:
 * the email (except to match history), phone, proof path, staff note or verifier.
 */

const HISTORY_LIMIT = 50

type Fulfilment = 'pickup' | 'delivery'
type Ticket = { ticket_series: 'C' | 'W'; ticket_number: number }

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d)
const isoOrNull = (d: Date | string | null) => (d == null ? null : iso(d))

/** Codes are stored upper-case; anything else cannot be one, so it never reaches the database. */
const CODE = /^[A-Z0-9-]{1,32}$/
const normalise = (code: string) => {
  const upper = code.trim().toUpperCase()
  return CODE.test(upper) ? upper : null
}

/** `GET /v1/orders/by-code/:code`: the order page. */
export async function readPublicOrder(sql: postgres.Sql, code: string): Promise<PublicOrderView | null> {
  const orderCode = normalise(code)
  if (!orderCode) return null
  type Row = Ticket & {
    id: string; order_code: string; prep_status: PrepStatus; payment_status: PaymentStatus
    cancelled_at: Date | null; fulfilment: Fulfilment; fulfil_at: Date; total_centavos: number
    delivery_address: string | null
  }
  const [o] = await sql<Row[]>`
    select id, order_code, ticket_series, ticket_number, prep_status, payment_status, cancelled_at,
      fulfilment, fulfil_at, total_centavos, delivery_address
    from orders where order_code = ${orderCode} and channel = 'online'`
  if (!o) return null

  type LineRow = { item_name: string; variant_label: string; quantity: number; ice_level: IceLevel | null; ice_serve: IceServe | null }
  const lines = await sql<LineRow[]>`
    select item_name, variant_label, quantity, ice_level, ice_serve
    from order_lines where order_id = ${o.id} order by created_at, id`

  return {
    orderCode: o.order_code,
    ticket: ticketLabel(o.ticket_series, o.ticket_number),
    prepStatus: o.prep_status,
    paymentStatus: o.payment_status,
    cancelled: o.cancelled_at != null,
    fulfilment: o.fulfilment,
    fulfilAt: iso(o.fulfil_at),
    totalCentavos: o.total_centavos,
    deliveryAddress: o.delivery_address,
    lines: lines.map((l) => ({
      name: l.item_name,
      variantLabel: l.variant_label,
      quantity: l.quantity,
      iceLevel: l.ice_level,
      iceServe: l.ice_serve,
    })),
  }
}

type PaymentRow = { reference: string | null; status: string; verified_at: Date | null; recorded_at: Date }

/** The newest verified payment, else the newest non-rejected one, else the newest (the website's rule). */
function livePayment(payments: PaymentRow[]): PaymentRow | null {
  const newestFirst = [...payments].sort((a, b) => b.recorded_at.getTime() - a.recorded_at.getTime())
  return newestFirst.find((p) => p.verified_at != null) ?? newestFirst.find((p) => p.status !== 'rejected') ?? newestFirst[0] ?? null
}

/** The public receipt's masking, as the website's `buildReceipt('public')` does it. */
export function maskReference(reference: string): string {
  return reference.length < 5 ? '••••' : `••••${reference.slice(-4)}`
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

/**
 * `GET /v1/orders/by-code/:code/receipt`: the public receipt (Ruling P6-4). Masked here, not in the
 * website, so the unmasked values never leave the API on this unauthenticated route.
 */
export async function readReceipt(sql: postgres.Sql, code: string): Promise<PublicReceiptView | null> {
  const orderCode = normalise(code)
  if (!orderCode) return null
  type Row = Ticket & {
    id: string; order_code: string; customer_name: string; fulfilment: Fulfilment
    delivery_barangay: string | null
    prep_status: PrepStatus; payment_status: PaymentStatus; cancelled_at: Date | null
    subtotal_centavos: number; discount_centavos: number; delivery_fee_centavos: number; total_centavos: number
  }
  const [o] = await sql<Row[]>`
    select id, order_code, ticket_series, ticket_number, customer_name, fulfilment,
      delivery_barangay, prep_status, payment_status, cancelled_at,
      subtotal_centavos, discount_centavos, delivery_fee_centavos, total_centavos
    from orders where order_code = ${orderCode} and channel = 'online'`
  if (!o) return null

  const payments = await sql<PaymentRow[]>`
    select reference, status, verified_at, recorded_at from payments where order_id = ${o.id}`
  type LineRow = { id: string; item_name: string; variant_label: string; quantity: number; unit_price_centavos: number; line_total_centavos: number }
  const lines = await sql<LineRow[]>`
    select id, item_name, variant_label, quantity, unit_price_centavos, line_total_centavos
    from order_lines where order_id = ${o.id} order by created_at, id`
  type OptionRow = { line_id: string; option_name: string; price_centavos: number }
  const options =
    lines.length === 0
      ? []
      : await sql<OptionRow[]>`
          select line_id, option_name, price_centavos from order_line_options
          where line_id in ${sql(lines.map((l) => l.id))} order by id`
  type ShopRow = {
    display_name: string; registered_name: string | null; tin: string | null; address: string
    phone: string | null; facebook_url: string | null; receipt_footer: string
  }
  const [shop] = await sql<ShopRow[]>`
    select display_name, registered_name, tin, address, phone, facebook_url, receipt_footer
    from shop_settings where id = 1`

  // Like buildReceipt: nothing about the payment until it is confirmed.
  const confirmed = o.payment_status === 'paid' || o.payment_status === 'refunded'
  const payment = confirmed ? livePayment(payments) : null
  return {
    order: {
      orderCode: o.order_code,
      ticket: ticketLabel(o.ticket_series, o.ticket_number),
      customerFirstName: firstName(o.customer_name),
      fulfilment: o.fulfilment,
      deliveryBarangay: o.delivery_barangay,
      prepStatus: o.prep_status,
      paymentStatus: o.payment_status,
      cancelledAt: isoOrNull(o.cancelled_at),
      subtotalCentavos: o.subtotal_centavos,
      discountCentavos: o.discount_centavos,
      deliveryFeeCentavos: o.delivery_fee_centavos,
      totalCentavos: o.total_centavos,
      payment: payment
        ? {
            referenceMasked: payment.reference ? maskReference(payment.reference) : null,
            verifiedAt: isoOrNull(payment.verified_at),
          }
        : null,
      lines: lines.map((l) => ({
        itemName: l.item_name,
        variantLabel: l.variant_label,
        quantity: l.quantity,
        unitPriceCentavos: l.unit_price_centavos,
        lineTotalCentavos: l.line_total_centavos,
        options: options
          .filter((op) => op.line_id === l.id)
          .map((op) => ({ name: op.option_name, priceCentavos: op.price_centavos })),
      })),
    },
    shop: shop
      ? {
          displayName: shop.display_name,
          registeredName: shop.registered_name,
          tin: shop.tin,
          address: shop.address,
          phone: shop.phone,
          facebookUrl: shop.facebook_url,
          receiptFooter: shop.receipt_footer,
        }
      : null,
  }
}

/**
 * A customer's orders: the ones placed while signed in, plus guest orders under the same address only
 * once that address is confirmed. The confirmation check is the security boundary: without it, signing
 * up as someone else's address would expose their history.
 */
export async function readHistory(
  sql: postgres.Sql,
  user: { id: string; email: string | null; emailConfirmed: boolean },
): Promise<HistoryOrderView[]> {
  const email = user.emailConfirmed && user.email ? user.email : null
  type Row = Ticket & {
    id: string; order_code: string; prep_status: PrepStatus; payment_status: PaymentStatus
    cancelled_at: Date | null; fulfilment: Fulfilment; fulfil_at: Date; created_at: Date
    delivery_address: string | null; subtotal_centavos: number; delivery_fee_centavos: number
    total_centavos: number; customer_user_id: string | null
  }
  const orders = await sql<Row[]>`
    select id, order_code, ticket_series, ticket_number, prep_status, payment_status, cancelled_at,
      fulfilment, fulfil_at, created_at, delivery_address, subtotal_centavos, delivery_fee_centavos,
      total_centavos, customer_user_id
    from orders
    where customer_user_id = ${user.id}
      ${email ? sql`or lower(customer_email) = lower(${email})` : sql``}
    order by created_at desc, id desc
    limit ${HISTORY_LIMIT}`
  if (orders.length === 0) return []

  type LineRow = {
    id: string; order_id: string; item_name: string; variant_code: string; variant_label: string
    quantity: number; ice_level: IceLevel | null; ice_serve: IceServe | null; note: string | null
  }
  const lines = await sql<LineRow[]>`
    select id, order_id, item_name, variant_code, variant_label, quantity, ice_level, ice_serve, note
    from order_lines where order_id in ${sql(orders.map((o) => o.id))} order by created_at, id`
  type OptionRow = { line_id: string; option_name: string }
  const options =
    lines.length === 0
      ? []
      : await sql<OptionRow[]>`
          select line_id, option_name from order_line_options
          where line_id in ${sql(lines.map((l) => l.id))} order by id`

  return orders.map((o) => ({
    id: o.id,
    orderCode: o.order_code,
    ticket: ticketLabel(o.ticket_series, o.ticket_number),
    prepStatus: o.prep_status,
    paymentStatus: o.payment_status,
    cancelled: o.cancelled_at != null,
    fulfilment: o.fulfilment,
    fulfilAt: iso(o.fulfil_at),
    createdAt: iso(o.created_at),
    deliveryAddress: o.delivery_address,
    subtotalCentavos: o.subtotal_centavos,
    deliveryFeeCentavos: o.delivery_fee_centavos,
    totalCentavos: o.total_centavos,
    claimedByEmail: o.customer_user_id !== user.id,
    lines: lines
      .filter((l) => l.order_id === o.id)
      .map((l) => ({
        name: l.item_name,
        variantCode: l.variant_code,
        variantLabel: l.variant_label,
        quantity: l.quantity,
        iceLevel: l.ice_level,
        iceServe: l.ice_serve,
        note: l.note,
        options: options.filter((op) => op.line_id === l.id).map((op) => op.option_name),
      })),
  }))
}
