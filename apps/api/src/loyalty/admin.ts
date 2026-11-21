import {
  formatPublicCode,
  normalisePublicCode,
  ticketLabel,
  type CatLook,
  type CustomerDetail,
  type CustomerListItem,
  type PaperStamp,
  type StampMode,
} from '@kennko/core'
import type postgres from 'postgres'
import { repackCards } from './cards.js'
import { lockCustomer } from './customers.js'
import { adjustPoints, balance } from './points.js'

type Sql = postgres.Sql | postgres.TransactionSql

/** Admin lookups by code or display name (Ruling 17). Never an email: `kennko_api` cannot read `auth.users`. */
export const SEARCH_MIN = 2
export const SEARCH_LIMIT = 20
const CARDS_SHOWN = 10
const LEDGER_SHOWN = 50
const TO_CHECK_LIMIT = 200

export type Failure = { ok: false; status: 404 | 409; code: string; message: string }
const fail = (status: 404 | 409, code: string, message: string): Failure => ({ ok: false, status, code, message })
const NOT_FOUND = fail(404, 'NOT_FOUND', 'Not found')
const iso = (d: Date | null) => (d === null ? null : d.toISOString())

type ListRow = {
  id: string
  public_code: string
  display_name: string
  stamp_mode: StampMode
  stamps: number
  full_cards: number
  points: number
  created_at: Date
}

/** The list columns: live stamps on the open card, full cards waiting for a claim, and the points balance. */
const listColumns = (sql: Sql) => sql`
  c.id, c.public_code, c.display_name, c.stamp_mode, c.created_at,
  (select count(*)::int from stamps s join stamp_cards k on k.id = s.card_id
    where k.customer_id = c.id and k.filled_at is null and not ('forgiven' = any(s.flags))) as stamps,
  (select count(*)::int from stamp_cards k
    where k.customer_id = c.id and k.filled_at is not null and k.claimed_at is null) as full_cards,
  (select coalesce(sum(p.delta), 0)::int from points_ledger p where p.customer_id = c.id) as points`

const toListItem = (r: ListRow): CustomerListItem => ({
  id: r.id,
  publicCode: formatPublicCode(r.public_code),
  displayName: r.display_name,
  stampMode: r.stamp_mode,
  stamps: r.stamps,
  fullCards: r.full_cards,
  points: r.points,
  joinedAt: r.created_at.toISOString(),
})

/** `like` treats `%`, `_` and the escape character itself as special. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (ch) => `\\${ch}`)

/**
 * A query that reads as a card code matches that code exactly; anything else matches the start of the display name
 * or of a later word in it, case-insensitively. Fewer than 2 characters finds nothing.
 */
export async function searchCustomers(sql: Sql, raw: string): Promise<CustomerListItem[]> {
  const q = raw.trim()
  if (q.length < SEARCH_MIN) return []
  const bare = normalisePublicCode(q)
  const where =
    bare !== null
      ? sql`c.public_code = ${bare}`
      : sql`(lower(c.display_name) like ${escapeLike(q.toLowerCase()) + '%'} escape '\\'
          or lower(c.display_name) like ${'% ' + escapeLike(q.toLowerCase()) + '%'} escape '\\')`
  const rows = await sql<ListRow[]>`
    select ${listColumns(sql)} from customers c
    where ${where}
    order by lower(c.display_name), c.created_at, c.id
    limit ${SEARCH_LIMIT}`
  return rows.map(toListItem)
}

type PaperRow = {
  id: string
  order_id: string
  ticket_series: 'C' | 'W'
  ticket_number: number
  customer_id: string
  public_code: string
  display_name: string
  stamp_mode: StampMode
  stamped_at: Date
  device_name: string | null
  staff_name: string | null
}

/** A stamp rung up while the customer was on paper: no card, not resolved, flagged `mode_was_paper` (Ruling 13). */
const openPaper = (sql: Sql) => sql`(s.card_id is null and s.resolved_at is null and 'mode_was_paper' = any(s.flags))`

/** Stamps to check, oldest first; for one customer when `customerId` is given. */
export async function paperStamps(sql: Sql, customerId?: string): Promise<PaperStamp[]> {
  const rows = await sql<PaperRow[]>`
    select s.id, s.order_id, o.ticket_series, o.ticket_number, s.customer_id, c.public_code, c.display_name, c.stamp_mode,
      s.stamped_at, d.name as device_name, st.full_name as staff_name
    from stamps s
    join orders o on o.id = s.order_id
    join customers c on c.id = s.customer_id
    left join devices d on d.id = s.device_id
    left join staff st on st.id = s.stamped_by_staff
    where ${openPaper(sql)} ${customerId ? sql`and s.customer_id = ${customerId}` : sql``}
    order by s.stamped_at, s.received_at, s.id
    limit ${TO_CHECK_LIMIT}`
  return rows.map((r) => ({
    id: r.id,
    orderId: r.order_id,
    ticket: ticketLabel(r.ticket_series, r.ticket_number),
    customerId: r.customer_id,
    customerCode: formatPublicCode(r.public_code),
    displayName: r.display_name,
    customerMode: r.stamp_mode,
    stampedAt: r.stamped_at.toISOString(),
    deviceName: r.device_name,
    staffName: r.staff_name,
  }))
}

/** For Needs a look's badge. */
export async function countPaperStamps(sql: Sql): Promise<number> {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from stamps s where ${openPaper(sql)}`
  return r!.n
}

/** One customer for admin, read in one snapshot. Null when there is no such customer. */
export async function customerDetail(sql: postgres.Sql, id: string): Promise<CustomerDetail | null> {
  return (await sql.begin('isolation level repeatable read read only', async (tx) => {
    const [row] = await tx<(ListRow & { set_by_name: string | null; stamp_mode_set_at: Date | null })[]>`
      select ${listColumns(tx)}, sb.full_name as set_by_name, c.stamp_mode_set_at
      from customers c left join staff sb on sb.id = c.stamp_mode_set_by
      where c.id = ${id}`
    if (!row) return null

    const cards = await tx<
      {
        id: string
        started_at: Date
        filled_at: Date | null
        claimed_at: Date | null
        claimed_series: 'C' | 'W' | null
        claimed_number: number | null
      }[]
    >`
      select k.id, k.started_at, k.filled_at, k.claimed_at, o.ticket_series as claimed_series, o.ticket_number as claimed_number
      from stamp_cards k left join orders o on o.id = k.claimed_order_id
      where k.customer_id = ${id}
      order by k.filled_at desc nulls first, k.started_at desc, k.id
      limit ${CARDS_SHOWN}`
    const cardIds = cards.map((k) => k.id)
    const stamps =
      cardIds.length === 0
        ? []
        : await tx<{ id: string; card_id: string; ticket_series: 'C' | 'W'; ticket_number: number; stamped_at: Date; flags: string[] }[]>`
            select s.id, s.card_id, o.ticket_series, o.ticket_number, s.stamped_at, s.flags
            from stamps s join orders o on o.id = s.order_id
            where s.card_id in ${tx(cardIds)}
            order by s.stamped_at, s.received_at, s.id`

    const ledger = await tx<
      {
        id: string
        delta: number
        reason: CustomerDetail['ledger'][number]['reason']
        ticket_series: 'C' | 'W' | null
        ticket_number: number | null
        note: string | null
        by_name: string | null
        created_at: Date
      }[]
    >`
      select p.id, p.delta, p.reason, o.ticket_series, o.ticket_number, p.note, st.full_name as by_name, p.created_at
      from points_ledger p
      left join orders o on o.id = p.order_id
      left join staff st on st.id = p.created_by_staff
      where p.customer_id = ${id}
      order by p.created_at desc, p.id desc
      limit ${LEDGER_SHOWN}`

    const [cat] = await tx<{ name: string; equipped: CatLook; show_on_wall: boolean; hidden_by_admin: boolean }[]>`
      select name, equipped, show_on_wall, hidden_by_admin from cats where customer_id = ${id}`

    return {
      ...toListItem(row),
      cat: cat ? { name: cat.name, look: cat.equipped, showOnWall: cat.show_on_wall, hiddenByAdmin: cat.hidden_by_admin } : null,
      stampModeSetBy: row.set_by_name,
      stampModeSetAt: iso(row.stamp_mode_set_at),
      cards: cards.map((k) => ({
        id: k.id,
        startedAt: k.started_at.toISOString(),
        filledAt: iso(k.filled_at),
        claimedAt: iso(k.claimed_at),
        claimedTicket: k.claimed_series && k.claimed_number !== null ? ticketLabel(k.claimed_series, k.claimed_number) : null,
        stamps: stamps
          .filter((s) => s.card_id === k.id)
          .map((s) => ({
            id: s.id,
            ticket: ticketLabel(s.ticket_series, s.ticket_number),
            stampedAt: s.stamped_at.toISOString(),
            flags: s.flags,
          })),
      })),
      ledger: ledger.map((p) => ({
        id: p.id,
        delta: p.delta,
        reason: p.reason,
        ticket: p.ticket_series && p.ticket_number !== null ? ticketLabel(p.ticket_series, p.ticket_number) : null,
        note: p.note,
        byName: p.by_name,
        createdAt: p.created_at.toISOString(),
      })),
      paperStamps: await paperStamps(tx, id),
    }
  })) as CustomerDetail | null
}

/**
 * A manager switches the card mode (Ruling 14). Paper is refused while a full card waits for its claim. Back to
 * digital resumes the earlier digital stamps; paper stamps stay under "Stamps to check". The same mode changes nothing.
 */
export async function setStampMode(
  sql: postgres.Sql,
  input: { customerId: string; mode: 'digital' | 'paper'; staffId: string; now: Date },
): Promise<{ ok: true; stampMode: StampMode; changed: boolean } | Failure> {
  return (await sql.begin(async (tx) => {
    const customer = await lockCustomer(tx, input.customerId)
    if (!customer) return NOT_FOUND
    if (customer.stamp_mode === input.mode) return { ok: true, stampMode: customer.stamp_mode, changed: false }
    if (input.mode === 'paper') {
      const [waiting] = await tx`
        select 1 from stamp_cards where customer_id = ${input.customerId} and filled_at is not null and claimed_at is null`
      if (waiting) {
        return fail(409, 'FREE_DRINK_WAITING', 'They have a free drink waiting. Claim it at the till first.')
      }
    }
    await tx`
      update customers set stamp_mode = ${input.mode}, stamp_mode_set_by = ${input.staffId}, stamp_mode_set_at = ${input.now}
      where id = ${input.customerId}`
    return { ok: true, stampMode: input.mode, changed: true }
  })) as { ok: true; stampMode: StampMode; changed: boolean } | Failure
}

/** An owner's adjustment: always a new ledger row, never an edit. Answers the new balance. */
export async function addAdjustment(
  sql: postgres.Sql,
  input: { customerId: string; delta: number; note: string; staffId: string; now: Date },
): Promise<{ ok: true; points: number } | Failure> {
  return (await sql.begin(async (tx) => {
    if (!(await lockCustomer(tx, input.customerId))) return NOT_FOUND
    await adjustPoints(tx, input)
    return { ok: true, points: await balance(tx, input.customerId) }
  })) as { ok: true; points: number } | Failure
}

/**
 * Applies a paper stamp once the customer is digital (or none) again, or discards it (Ruling 13). Either way the
 * stamp and its `stamp.added` receipt are marked resolved. Locks the order row, then the customer.
 */
export async function resolvePaperStamp(
  sql: postgres.Sql,
  input: { stampId: string; action: 'apply' | 'discard'; staffId: string; now: Date },
): Promise<{ ok: true } | Failure> {
  const { stampId, action, staffId, now } = input
  return (await sql.begin(async (tx) => {
    type Row = { id: string; order_id: string; customer_id: string; device_id: string | null; open: boolean }
    const find = () => tx<Row[]>`
      select s.id, s.order_id, s.customer_id, s.device_id, ${openPaper(tx)} as open from stamps s where s.id = ${stampId}`
    const [before] = await find()
    if (!before) return NOT_FOUND
    await tx`select id from orders where id = ${before.order_id} for update`
    const customer = await lockCustomer(tx, before.customer_id)
    // Read again under the locks: another manager may have resolved it, or a cancel removed it.
    const [stamp] = await find()
    if (!stamp || !customer) return NOT_FOUND
    if (!stamp.open) return fail(409, 'NOT_OPEN', 'This stamp was already dealt with.')

    if (action === 'apply') {
      if (customer.stamp_mode === 'paper') {
        return fail(409, 'STILL_PAPER', 'Switch them to the digital card first.')
      }
      if (customer.stamp_mode === 'none') {
        await tx`update customers set stamp_mode = 'digital' where id = ${customer.id}`
      }
      let [open] = await tx<{ id: string }[]>`
        select id from stamp_cards where customer_id = ${customer.id} and filled_at is null`
      if (!open) {
        ;[open] = await tx<{ id: string }[]>`
          insert into stamp_cards (customer_id, started_at) values (${customer.id}, ${now}) returning id`
      }
      await tx`
        update stamps set card_id = ${open!.id}, resolved_at = ${now}, resolved_by = ${staffId} where id = ${stampId}`
      // Laid in stamp order, so an older paper stamp goes before newer digital ones.
      await repackCards(tx, customer.id, now)
    } else {
      await tx`
        update stamps set flags = array_append(flags, 'discarded'), resolved_at = ${now}, resolved_by = ${staffId}
        where id = ${stampId}`
    }

    await tx`
      update sync_events set resolved_at = ${now}, resolved_by = ${staffId},
        resolve_note = ${action === 'apply' ? 'Stamp applied' : 'Stamp discarded'}
      where kind = 'stamp.added' and result = 'flagged' and payload->>'stampId' = ${stampId} and resolved_at is null
        ${stamp.device_id ? tx`and device_id = ${stamp.device_id}` : tx``}`
    return { ok: true }
  })) as { ok: true } | Failure
}

/**
 * A manager or owner hides a cat from the wall, or lets it back (Ruling 15). Records who and when; unhiding clears both.
 * A customer with no cat is not found. Runs under the customer lock.
 */
export async function setCatHidden(
  sql: postgres.Sql,
  input: { customerId: string; hidden: boolean; staffId: string; now: Date },
): Promise<{ ok: true } | Failure> {
  return (await sql.begin(async (tx) => {
    if (!(await lockCustomer(tx, input.customerId))) return NOT_FOUND
    const done = await tx`
      update cats set hidden_by_admin = ${input.hidden},
        hidden_by = ${input.hidden ? input.staffId : null}, hidden_at = ${input.hidden ? input.now : null}
      where customer_id = ${input.customerId}
      returning customer_id`
    return done.length === 0 ? NOT_FOUND : { ok: true }
  })) as { ok: true } | Failure
}
