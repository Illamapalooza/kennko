import { ONLINE_PULL_MAX, ONLINE_RECENT_MS, type IceLevel, type IceServe, type OnlineQueueOrder, type PrepStatus } from '@kennko/core'
import type postgres from 'postgres'

/**
 * The only columns the pull may read from `orders`, `order_lines` and `order_line_options`. Each query selects
 * exactly its list (as identifiers), so a column added to the table later never reaches a till by accident.
 * No email, GCash reference, proof path, order code, staff note, map pin, user id or money. The phone and
 * address are read for every order but only delivery orders carry them out of this file.
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

const day = (d: string | Date) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))

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
  const linesByOrder = new Map<string, OnlineQueueOrder['lines']>()
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

  return orders.map((o) => ({
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
    delivery:
      o.fulfilment === 'delivery'
        ? { address: o.delivery_address ?? '', barangay: o.delivery_barangay ?? '', phone: o.customer_phone ?? '' }
        : null,
  }))
}
