import {
  hasDrink,
  ONLINE_PULL_MAX,
  ONLINE_RECENT_MS,
  parseLook,
  type CatLook,
  type IceLevel,
  type IceServe,
  type OnlineQueueLine,
  type OnlineQueueOrder,
  type PendingPaymentOrder,
  type PrepStatus,
  type StampMode,
} from '@kennko/core'
import type postgres from 'postgres'

/**
 * The only columns the pull may read from `orders`, `order_lines` and `order_line_options`. Each query selects
 * exactly its list (as identifiers), so a column added to the table later never reaches a till by accident.
 * No email, GCash reference, proof path, order code, staff note, map pin, user id or money. The phone and
 * address are read for every order but only unfinished delivery orders carry them out of this file. `customer_id`
 * is read only to work out `card` and never leaves this file.
 */
export const ONLINE_ORDER_COLUMNS = [
  'id',
  'business_day',
  'ticket_number',
  'customer_name',
  'fulfilment',
  'fulfil_at',
  'customer_note',
  'prep_status',
  'created_at',
  'updated_at',
  'customer_phone',
  'delivery_address',
  'delivery_barangay',
  'customer_id',
] as const
export const ONLINE_LINE_COLUMNS = [
  'id',
  'order_id',
  'item_name',
  'variant_code',
  'variant_label',
  'quantity',
  'ice_level',
  'ice_serve',
  'note',
] as const
export const ONLINE_OPTION_COLUMNS = ['line_id', 'option_name'] as const

type OrderRow = {
  id: string
  business_day: string | Date
  ticket_number: number
  customer_name: string
  fulfilment: 'pickup' | 'delivery'
  fulfil_at: Date
  customer_note: string | null
  prep_status: PrepStatus
  created_at: Date
  updated_at: Date
  customer_phone: string | null
  delivery_address: string | null
  delivery_barangay: string | null
  customer_id: string | null
}
type LineRow = {
  id: string
  order_id: string
  item_name: string
  variant_code: string | null
  variant_label: string | null
  quantity: number
  ice_level: IceLevel | null
  ice_serve: IceServe | null
  note: string | null
}
type OptionRow = { line_id: string; option_name: string }

type Card = OnlineQueueOrder['card']

/**
 * "Stamp at pickup": `paper` when the linked customer is on paper, `stamped` when the order has a live stamp,
 * `stamp` when it is linked and has a drink, otherwise null.
 */
async function readCards(sql: postgres.Sql, orders: OrderRow[]): Promise<Map<string, Card>> {
  const linked = orders.filter((o) => o.customer_id !== null)
  const cards = new Map<string, Card>()
  if (linked.length === 0) return cards
  const orderIds = linked.map((o) => o.id)
  const modes = await sql<{ id: string; stamp_mode: StampMode }[]>`
    select id, stamp_mode from customers where id in ${sql(linked.map((o) => o.customer_id!))}`
  const stamped = await sql<{ order_id: string }[]>`
    select order_id from stamps where order_id in ${sql(orderIds)} and not ('forgiven' = any(flags))`
  const kinds = await sql<{ order_id: string; kind: 'drink' | 'food' | null }[]>`
    select l.order_id, c.kind from order_lines l
    left join menu_items i on i.id = l.item_id
    left join menu_categories c on c.id = i.category_id
    where l.order_id in ${sql(orderIds)}`
  const modeOf = new Map(modes.map((m) => [m.id, m.stamp_mode]))
  const stampedIds = new Set(stamped.map((s) => s.order_id))
  for (const o of linked) {
    const mode = modeOf.get(o.customer_id!)
    if (mode === undefined) continue
    const lines = kinds.filter((k) => k.order_id === o.id)
    cards.set(o.id, mode === 'paper' ? 'paper' : stampedIds.has(o.id) ? 'stamped' : hasDrink(lines) ? 'stamp' : null)
  }
  return cards
}

const day = (d: string | Date) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

async function loadLinesByOrder(sql: postgres.Sql, orderIds: string[]): Promise<Map<string, OnlineQueueLine[]>> {
  const lines = await sql<LineRow[]>`
    select ${sql(ONLINE_LINE_COLUMNS as unknown as string[])} from order_lines
    where order_id in ${sql(orderIds)}`
  const options =
    lines.length === 0
      ? []
      : await sql<OptionRow[]>`
          select ${sql(ONLINE_OPTION_COLUMNS as unknown as string[])} from order_line_options
          where line_id in ${sql(lines.map((l) => l.id))}`

  // The options table has no sequence column, so heap (insert) order is the order they were written.
  const optionsByLine = new Map<string, string[]>()
  for (const o of options) optionsByLine.set(o.line_id, [...(optionsByLine.get(o.line_id) ?? []), o.option_name])
  const linesByOrder = new Map<string, OnlineQueueLine[]>()
  for (const l of lines) {
    const list = linesByOrder.get(l.order_id) ?? []
    list.push({
      name: l.item_name,
      size: l.variant_code ?? l.variant_label ?? '',
      quantity: l.quantity,
      options: optionsByLine.get(l.id) ?? [],
      iceLevel: l.ice_level,
      iceServe: l.ice_serve,
      note: l.note ?? '',
    })
    linesByOrder.set(l.order_id, list)
  }
  return linesByOrder
}

async function readCatLooks(sql: postgres.Sql, customerIds: string[]): Promise<Map<string, CatLook>> {
  const looks = new Map<string, CatLook>()
  if (customerIds.length === 0) return looks
  const rows = await sql<{ customer_id: string; equipped: unknown }[]>`
    select customer_id, equipped from cats
    where customer_id in ${sql(customerIds)} and not hidden_by_admin`
  for (const r of rows) {
    const look = parseLook(r.equipped)
    if (look) looks.set(r.customer_id, look)
  }
  return looks
}

/** Paid online orders for the till queue: unfinished first, then finished within the last 24 h (Ruling 1). */
export async function readOnlineQueue(sql: postgres.Sql, now: Date): Promise<OnlineQueueOrder[]> {
  const since = new Date(now.getTime() - ONLINE_RECENT_MS)
  const orders = await sql<OrderRow[]>`
    select ${sql(ONLINE_ORDER_COLUMNS as unknown as string[])} from orders
    where channel = 'online' and payment_status = 'paid'
      and (prep_status <> 'completed' or updated_at >= ${since})
    order by (prep_status = 'completed'), created_at desc
    limit ${ONLINE_PULL_MAX}`
  if (orders.length === 0) return []
  const orderIds = orders.map((o) => o.id)
  const customerIds = [...new Set(orders.map((o) => o.customer_id).filter((id): id is string => id !== null))]

  const [linesByOrder, cards, catLooks] = await Promise.all([
    loadLinesByOrder(sql, orderIds),
    readCards(sql, orders),
    readCatLooks(sql, customerIds),
  ])

  return orders.map((o) => {
    const catLook = o.customer_id ? catLooks.get(o.customer_id) ?? null : null
    return {
      id: o.id,
      businessDay: day(o.business_day),
      ticketNumber: o.ticket_number,
      customerName: o.customer_name,
      fulfilment: o.fulfilment,
      fulfilAt: new Date(o.fulfil_at).toISOString(),
      customerNote: o.customer_note ? o.customer_note : null,
      prepStatus: o.prep_status,
      createdAt: new Date(o.created_at).toISOString(),
      updatedAt: new Date(o.updated_at).toISOString(),
      lines: linesByOrder.get(o.id) ?? [],
      // The address and phone stay on the till only until hand-off: a completed delivery carries none.
      delivery:
        o.fulfilment === 'delivery' && o.prep_status !== 'completed'
          ? { address: o.delivery_address ?? '', barangay: o.delivery_barangay ?? '', phone: o.customer_phone ?? '' }
          : null,
      card: cards.get(o.id) ?? null,
      ...(catLook ? { catLook } : {}),
    }
  })
}

type PendingRow = {
  id: string
  payment_id: string
  order_code: string
  ticket_number: number
  customer_name: string
  fulfilment: 'pickup' | 'delivery'
  fulfil_at: Date
  total_centavos: number
  reference: string | null
  proof_path: string | null
  created_at: Date
}

/** Online orders awaiting GCash payment verification so staff at the till can confirm or reject when online. */
export async function readPendingPayments(
  sql: postgres.Sql,
  proofs?: { signedUrl(path: string, seconds: number): Promise<string> },
): Promise<PendingPaymentOrder[]> {
  const rows = await sql<PendingRow[]>`
    select o.id, p.id as payment_id, o.order_code, o.ticket_number, o.customer_name,
      o.fulfilment, o.fulfil_at, o.total_centavos, p.reference, p.proof_path, o.created_at
    from orders o
    join payments p on p.order_id = o.id
    where o.channel = 'online'
      and o.payment_status = 'pending_verification'
      and p.status = 'pending_verification'
    order by o.created_at asc
    limit 25`
  if (rows.length === 0) return []
  const linesByOrder = await loadLinesByOrder(sql, rows.map((r) => r.id))
  return Promise.all(
    rows.map(async (r) => {
      let proofUrl: string | null = null
      if (r.proof_path && proofs) {
        try {
          proofUrl = await proofs.signedUrl(r.proof_path, 300)
        } catch {
          proofUrl = null
        }
      }
      return {
        id: r.id,
        paymentId: r.payment_id,
        orderCode: r.order_code,
        ticketNumber: r.ticket_number,
        customerName: r.customer_name,
        fulfilment: r.fulfilment,
        fulfilAt: new Date(r.fulfil_at).toISOString(),
        totalCentavos: r.total_centavos,
        reference: r.reference ?? null,
        proofUrl,
        createdAt: new Date(r.created_at).toISOString(),
        lines: linesByOrder.get(r.id) ?? [],
      }
    }),
  )
}
