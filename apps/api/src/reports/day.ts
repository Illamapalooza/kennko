import type { DayLineRow, DayOrderRow, DayRows, DayShiftRow, HeldSaleRow, ShiftSaleRow } from '@kennko/core'
import type postgres from 'postgres'

type Sql = postgres.Sql | postgres.TransactionSql

type OrderRow = {
  id: string
  channel: DayOrderRow['channel']
  fulfilment: DayOrderRow['fulfilment']
  ticket_series: DayOrderRow['ticketSeries']
  ticket_number: number
  device_name: string | null
  shift_id: string | null
  prep_status: DayOrderRow['prepStatus']
  payment_status: DayOrderRow['paymentStatus']
  subtotal_centavos: number
  discount_centavos: number
  delivery_fee_centavos: number
  total_centavos: number
  flags: string[]
  payments: DayOrderRow['payments']
}

type LineRow = { order_id: string; item_name: string; variant_label: string; quantity: number; line_total_centavos: number }

type ShiftRow = {
  id: string
  device_name: string
  opened_at: Date
  closed_at: Date | null
  close_received_at: Date | null
  opened_by_name: string | null
  closed_by_name: string | null
  opening_float_centavos: number
  counted_centavos: number | null
  expected_centavos: number | null
  closed_in_admin: boolean
  cash_in: number
  cash_out: number
}

type ShiftSale = { shift_id: string; order_id: string; cash: number; received_at: Date }

type HeldRow = {
  device_name: string
  id: string
  result: HeldSaleRow['result']
  reason: string | null
  ticket: unknown
  total: unknown
  resolve_note: string | null
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString())
/** The payload is whatever the till sent: a number is used only when it is an integer. */
const int = (x: unknown): number | null => (Number.isInteger(x) ? (x as number) : null)

/** A counted order (Ruling 7), as SQL over alias `o`. */
const counted = (sql: Sql) => sql`(o.prep_status <> 'cancelled' and o.payment_status = 'paid')`

/**
 * Everything the day report needs for `date` (a valid `YYYY-MM-DD`), read as rows; `summariseDay` does the sums.
 * Orders count on their business day; shifts on the Manila day they opened, with every counted sale of theirs
 * whatever its day; held and set-aside sales on the business day their payload names.
 */
export async function readDayRows(sql: Sql, date: string): Promise<DayRows> {
  const orders = await sql<OrderRow[]>`
    select o.id, o.channel, o.fulfilment, o.ticket_series, o.ticket_number, d.name as device_name, o.shift_id,
      o.prep_status, o.payment_status, o.subtotal_centavos, o.discount_centavos, o.delivery_fee_centavos,
      o.total_centavos, o.flags,
      coalesce((
        select json_agg(json_build_object('method', p.method, 'amountCentavos', p.amount_centavos, 'status', p.status)
          order by p.recorded_at, p.id)
        from payments p where p.order_id = o.id
      ), '[]'::json) as payments
    from orders o
    left join devices d on d.id = o.device_id
    where o.business_day = ${date}::date
    order by o.channel, d.name nulls first, o.ticket_number, o.id`

  const lines = await sql<LineRow[]>`
    select l.order_id, l.item_name, l.variant_label, l.quantity, l.line_total_centavos
    from order_lines l
    join orders o on o.id = l.order_id
    where o.business_day = ${date}::date
    order by l.order_id, l.created_at, l.id`

  // A legacy shift's orders arrived by import, whenever that ran: none of them is "after close".
  const shifts = await sql<ShiftRow[]>`
    select sh.id, d.name as device_name, sh.opened_at, sh.closed_at,
      case when sh.closed_at is not null and not sh.is_legacy then sh.updated_at end as close_received_at,
      so.full_name as opened_by_name, sc.full_name as closed_by_name, sh.opening_float_centavos,
      sh.counted_centavos, sh.expected_centavos, sh.closed_in_admin,
      coalesce((select sum(m.amount_centavos) from cash_moves m where m.shift_id = sh.id and m.kind = 'in'), 0)::int as cash_in,
      coalesce((select sum(m.amount_centavos) from cash_moves m where m.shift_id = sh.id and m.kind = 'out'), 0)::int as cash_out
    from shifts sh
    join devices d on d.id = sh.device_id
    left join staff so on so.id = sh.opened_by_staff
    left join staff sc on sc.id = sh.closed_by_staff
    where (sh.opened_at at time zone 'Asia/Manila')::date = ${date}::date
    order by sh.opened_at, sh.id`

  const shiftIds = shifts.map((s) => s.id)
  const shiftSales =
    shiftIds.length === 0
      ? []
      : await sql<ShiftSale[]>`
          select o.shift_id, o.id as order_id, o.received_at,
            coalesce((select sum(p.amount_centavos) from payments p
              where p.order_id = o.id and p.method = 'cash' and p.status in ('recorded', 'verified')), 0)::int as cash
          from orders o
          where o.shift_id = any(${shiftIds}::uuid[]) and ${counted(sql)}
          order by o.received_at, o.id`

  const held = await sql<HeldRow[]>`
    select d.name as device_name, e.id, e.result, e.reason, e.payload->'ticketNumber' as ticket,
      e.payload->'totalCentavos' as total, e.resolve_note
    from sync_events e
    join devices d on d.id = e.device_id
    where e.kind = 'order.created' and e.result in ('held', 'discarded') and e.payload->>'businessDay' = ${date}
    order by e.received_at, e.seq`

  return {
    date,
    orders: orders.map(
      (o): DayOrderRow => ({
        id: o.id,
        channel: o.channel,
        fulfilment: o.fulfilment,
        ticketSeries: o.ticket_series,
        ticketNumber: o.ticket_number,
        deviceName: o.device_name,
        shiftId: o.shift_id,
        prepStatus: o.prep_status,
        paymentStatus: o.payment_status,
        subtotalCentavos: o.subtotal_centavos,
        discountCentavos: o.discount_centavos,
        deliveryFeeCentavos: o.delivery_fee_centavos,
        totalCentavos: o.total_centavos,
        flags: o.flags,
        payments: o.payments,
      }),
    ),
    lines: lines.map(
      (l): DayLineRow => ({
        orderId: l.order_id,
        itemName: l.item_name,
        variantLabel: l.variant_label,
        quantity: l.quantity,
        lineTotalCentavos: l.line_total_centavos,
      }),
    ),
    shifts: shifts.map(
      (s): DayShiftRow => ({
        id: s.id,
        deviceName: s.device_name,
        openedAt: s.opened_at.toISOString(),
        closedAt: iso(s.closed_at),
        closeReceivedAt: iso(s.close_received_at),
        openedByName: s.opened_by_name,
        closedByName: s.closed_by_name,
        openingFloatCentavos: s.opening_float_centavos,
        countedCentavos: s.counted_centavos,
        expectedCentavos: s.expected_centavos,
        closedInAdmin: s.closed_in_admin,
        cashInCentavos: s.cash_in,
        cashOutCentavos: s.cash_out,
      }),
    ),
    shiftSales: shiftSales.map(
      (x): ShiftSaleRow => ({ shiftId: x.shift_id, orderId: x.order_id, cashCentavos: x.cash, receivedAt: x.received_at.toISOString() }),
    ),
    heldSales: held.map(
      (h): HeldSaleRow => ({
        deviceName: h.device_name,
        eventId: h.id,
        result: h.result,
        reason: h.reason,
        ticketNumber: int(h.ticket),
        totalCentavos: int(h.total),
        note: h.resolve_note,
      }),
    ),
  }
}
