import { eventSummary, ticketLabel, type AttentionEvent, type AttentionView, type FlaggedOrder, type OpenShift } from '@kennko/core'
import type postgres from 'postgres'

type Sql = postgres.Sql | postgres.TransactionSql

/**
 * Flagged receipts that are about the receipt itself (Ruling 6). A sale flagged for its order
 * (`reprice_mismatch`, `unknown_version`, `ticket_duplicate`, `clock_skew`) is looked at as a flagged
 * order instead, so it is not listed twice.
 */
export const RECEIPT_FLAGS = ['already_recorded_differs', 'not_for_counter', 'online_order', 'not_paid', 'not_from_till', 'unknown_item']

const OPEN_LIMIT = 200
const RESOLVED_LIMIT = 100

type EventRow = {
  device_id: string
  device_name: string
  device_revoked: boolean
  id: string
  seq: string
  kind: string
  payload: unknown
  result: AttentionEvent['result']
  reason: string | null
  staff_name: string | null
  occurred_at: Date
  received_at: Date
  resolved_at: Date | null
  resolved_by_name: string | null
  resolve_note: string | null
}

type OrderRow = {
  id: string
  ticket_series: 'C' | 'W'
  ticket_number: number
  channel: FlaggedOrder['channel']
  business_day: string
  flags: string[]
  total_centavos: number
  device_name: string | null
  flags_seen_at: Date | null
}

type ShiftRow = {
  id: string
  device_id: string
  device_name: string
  device_revoked: boolean
  opened_at: Date
  opened_by_name: string | null
  opening_float_centavos: number
  blocking: number
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString())

/** Receipts still waiting on the owner: held, or flagged for the receipt itself and not yet seen. */
const openReceipt = (sql: Sql) => sql`
  (e.result = 'held'
    or (e.result = 'flagged' and e.resolved_at is null and string_to_array(e.reason, ',') && ${RECEIPT_FLAGS}::text[]))`

/** Orders with a flag other than `legacy` that the owner has not looked at. */
const unseenOrder = (sql: Sql) => sql`(o.flags_seen_at is null and cardinality(array_remove(o.flags, 'legacy')) > 0)`

function toEvent(r: EventRow): AttentionEvent {
  const open = r.resolved_at === null
  return {
    deviceId: r.device_id,
    deviceName: r.device_name,
    deviceRevoked: r.device_revoked,
    id: r.id,
    seq: Number(r.seq),
    kind: r.kind,
    result: r.result,
    reason: r.reason,
    summary: eventSummary(r.kind, r.payload),
    staffName: r.staff_name,
    occurredAt: r.occurred_at.toISOString(),
    receivedAt: r.received_at.toISOString(),
    resolvedAt: iso(r.resolved_at),
    resolvedByName: r.resolved_by_name,
    resolveNote: r.resolve_note,
    action: !open ? null : r.result === 'held' ? 'discard' : r.result === 'flagged' ? 'seen' : null,
  }
}

const toOrder = (r: OrderRow): FlaggedOrder => ({
  id: r.id,
  ticket: ticketLabel(r.ticket_series, r.ticket_number),
  channel: r.channel,
  businessDay: r.business_day,
  flags: r.flags,
  totalCentavos: r.total_centavos,
  deviceName: r.device_name,
  seenAt: iso(r.flags_seen_at),
})

const toShift = (r: ShiftRow): OpenShift => ({
  id: r.id,
  deviceId: r.device_id,
  deviceName: r.device_name,
  deviceRevoked: r.device_revoked,
  openedAt: r.opened_at.toISOString(),
  openedByName: r.opened_by_name,
  openingFloatCentavos: r.opening_float_centavos,
  blocking: r.blocking,
})

async function events(sql: Sql, show: 'open' | 'resolved'): Promise<AttentionEvent[]> {
  const where =
    show === 'open' ? openReceipt(sql) : sql`(e.result = 'discarded' or (e.result = 'flagged' and e.resolved_at is not null))`
  const order = show === 'open' ? sql`e.received_at desc, e.seq desc` : sql`e.resolved_at desc, e.seq desc`
  const rows = await sql<EventRow[]>`
    select e.device_id, d.name as device_name, d.revoked_at is not null as device_revoked, e.id, e.seq, e.kind, e.payload,
      e.result, e.reason, s.full_name as staff_name, e.occurred_at, e.received_at, e.resolved_at,
      r.full_name as resolved_by_name, e.resolve_note
    from sync_events e
    join devices d on d.id = e.device_id
    left join staff s on s.id = e.staff_id
    left join staff r on r.id = e.resolved_by
    where ${where}
    order by ${order}
    limit ${show === 'open' ? OPEN_LIMIT : RESOLVED_LIMIT}`
  return rows.map(toEvent)
}

async function orders(sql: Sql, show: 'open' | 'resolved'): Promise<FlaggedOrder[]> {
  const where = show === 'open' ? unseenOrder(sql) : sql`o.flags_seen_at is not null`
  const order = show === 'open' ? sql`o.created_at desc, o.id` : sql`o.flags_seen_at desc, o.id`
  const rows = await sql<OrderRow[]>`
    select o.id, o.ticket_series, o.ticket_number, o.channel, o.business_day::text as business_day, o.flags,
      o.total_centavos, d.name as device_name, o.flags_seen_at
    from orders o
    left join devices d on d.id = o.device_id
    where ${where}
    order by ${order}
    limit ${show === 'open' ? OPEN_LIMIT : RESOLVED_LIMIT}`
  return rows.map(toOrder)
}

/** Every open shift; those holding a till's `another_shift_open` events first ("Blocking sync"). */
async function openShifts(sql: Sql): Promise<OpenShift[]> {
  const rows = await sql<ShiftRow[]>`
    select * from (
      select sh.id, sh.device_id, d.name as device_name, d.revoked_at is not null as device_revoked, sh.opened_at,
        st.full_name as opened_by_name, sh.opening_float_centavos,
        (select count(*)::int from sync_events e
          where e.device_id = sh.device_id and e.result = 'held' and e.reason = 'another_shift_open') as blocking
      from shifts sh
      join devices d on d.id = sh.device_id
      left join staff st on st.id = sh.opened_by_staff
      where sh.closed_at is null
    ) open
    order by blocking > 0 desc, opened_at, id`
  return rows.map(toShift)
}

/**
 * Needs a look. `open`: what still waits on the owner, across every till (revoked ones included), and
 * every open shift. `resolved`: the receipts and orders the owner has dealt with most recently.
 */
export async function readAttention(sql: Sql, show: 'open' | 'resolved'): Promise<AttentionView> {
  return {
    events: await events(sql, show),
    orders: await orders(sql, show),
    shifts: show === 'open' ? await openShifts(sql) : [],
    stamps: [], // Plan 7 Task 7 fills this
  }
}

/** The admin badge: open receipts, unseen flagged orders, and open shifts that block a till. */
export async function countAttention(sql: Sql): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    select
      (select count(*)::int from sync_events e where ${openReceipt(sql)})
      + (select count(*)::int from orders o where ${unseenOrder(sql)})
      + (select count(*)::int from shifts sh where sh.closed_at is null and exists (
          select 1 from sync_events e
          where e.device_id = sh.device_id and e.result = 'held' and e.reason = 'another_shift_open')) as n`
  return row!.n
}
