import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import {
  MAX_PUSH_EVENTS, NOTE_MAX, OrderError, TILL_TO_PREP, cleanDiscount, manilaDay, nextStatus, prevStatus, priceLines, summarise, totals,
  type CashMove, type CounterOrderPayload, type Discount, type LineInput, type Menu, type Order, type OrderStatus, type OrderType,
  type PaymentMethod, type PricedLine, type Shift, type Summary, type SyncEvent, type SyncEventKind,
} from '@kennko/core'
import type { CachedStaff } from './pins.ts'

export type NewOrder = {
  lines: LineInput[]
  type: OrderType
  customerName?: string
  discount?: Discount | null
  payment: { method: PaymentMethod; tenderedCentavos?: number; ref?: string }
}

const SCHEMA = `
  create table if not exists shifts (
    id integer primary key autoincrement,
    opened_at integer not null,
    opening_float integer not null,
    closed_at integer,
    counted integer,
    note text not null default ''
  );
  create table if not exists orders (
    id integer primary key autoincrement,
    day text not null,
    number integer not null,
    type text not null,
    customer_name text not null default '',
    status text not null,
    lines text not null,
    subtotal integer not null,
    discount integer not null,
    discount_label text,
    total integer not null,
    payment_method text not null,
    tendered integer,
    change integer,
    payment_ref text,
    shift_id integer not null references shifts(id),
    created_at integer not null,
    updated_at integer not null,
    voided_at integer,
    void_reason text,
    prev_status text,
    unique (day, number)
  );
  create index if not exists orders_shift_idx on orders (shift_id);
  create table if not exists cash_moves (
    id integer primary key autoincrement,
    shift_id integer not null references shifts(id),
    kind text not null,
    amount integer not null,
    reason text not null,
    at integer not null
  );
  create table if not exists sold_out (item_id text primary key);
  create table if not exists sessions (
    token_hash text primary key,
    staff_id text,
    staff_name text,
    role text not null check (role in ('staff', 'manager')),
    created_at integer not null
  );
  create table if not exists staff_cache (
    id text primary key,
    full_name text not null,
    role text not null check (role in ('owner', 'manager', 'barista')),
    pin_hash text not null
  );
  create table if not exists outbox (
    seq integer primary key autoincrement,
    id text not null unique,
    kind text not null,
    entity text not null check (entity in ('order','shift','cash_move','menu')),
    entity_local_id integer,
    staff_id text,
    occurred_at integer not null,
    payload text not null
  );
  create table if not exists kv (key text primary key, value text not null);
`

/** Columns added to tables that already exist on tills from before Plan 4 (SQLite cannot add a unique column). */
const ADDED_COLUMNS: [table: string, column: string, decl: string][] = [
  ['shifts', 'uid', 'text'],
  ['shifts', 'opened_by_staff', 'text'],
  ['shifts', 'closed_by_staff', 'text'],
  ['shifts', 'needs_import', 'integer not null default 0'],
  ['orders', 'uid', 'text'],
  ['orders', 'payment_uid', 'text'],
  ['orders', 'menu_version', 'integer'],
  ['orders', 'cancelled_by_staff', 'text'],
  ['orders', 'needs_import', 'integer not null default 0'],
  ['cash_moves', 'uid', 'text'],
  ['cash_moves', 'staff_id', 'text'],
  ['cash_moves', 'needs_import', 'integer not null default 0'],
]
const UNIQUE_INDEXES = `
  create unique index if not exists shifts_uid_key on shifts (uid);
  create unique index if not exists orders_uid_key on orders (uid);
  create unique index if not exists orders_payment_uid_key on orders (payment_uid);
  create unique index if not exists cash_moves_uid_key on cash_moves (uid);
`

/** Who did it: a staff id from the staff cache, or null (shared PINs, or nobody signed in). */
export type By = string | null

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
/** Money the till accepts in one field; well inside what the API's int columns hold. */
const MONEY_MAX = 100_000_000
/** The API's limit for names and ids inside an order's lines. */
const LINE_TEXT_MAX = 120
const LINE_MODIFIERS_MAX = 20

/**
 * Text as the till stores and sends it: no control characters (so no NUL), no broken UTF-16 pairs, trimmed,
 * at most `max` UTF-16 units (the unit the API's limits count in) without cutting a character in half.
 */
const clean = (text: unknown, max: number) => {
  const out = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(LONE_SURROGATE, '\ufffd').trim().slice(0, max)
  return /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out
}

const checkBy = (by: By): By => {
  if (by !== null && (typeof by !== 'string' || !UUID.test(by))) throw new Error('A staff id must be a uuid or null.')
  return by
}

const sendableText = (text: unknown, min: number) =>
  typeof text === 'string' && text.length >= min && text.length <= LINE_TEXT_MAX && !/[\u0000]/.test(text)

/** A priced line the API will accept as sent: menu text within its limits, at most 20 add-ons, a clean note. */
function sendableLine(line: PricedLine): PricedLine {
  const ok = sendableText(line.menuItemId, 1) && sendableText(line.name, 1) && line.modifiers.length <= LINE_MODIFIERS_MAX
    && line.modifiers.every((m) => sendableText(m.id, 1) && sendableText(m.name, 0))
  if (!ok) throw new OrderError(`${clean(line.name, 40) || 'A drink'} has a menu entry the till cannot record. Update the menu.`)
  return { ...line, note: clean(line.note, NOTE_MAX) }
}

function toOrder(row: any): Order {
  return {
    id: row.id, day: row.day, number: row.number, type: row.type, customerName: row.customer_name, status: row.status,
    lines: JSON.parse(row.lines), subtotalCentavos: row.subtotal, discountCentavos: row.discount, discountLabel: row.discount_label,
    totalCentavos: row.total, paymentMethod: row.payment_method, tenderedCentavos: row.tendered, changeCentavos: row.change,
    paymentRef: row.payment_ref, shiftId: row.shift_id, createdAt: row.created_at, updatedAt: row.updated_at,
    voidedAt: row.voided_at, voidReason: row.void_reason, voidedByName: row.voided_by_name ?? null,
  }
}

const toShift = (row: any): Shift => ({
  id: row.id, openedAt: row.opened_at, openingFloatCentavos: row.opening_float, closedAt: row.closed_at, countedCentavos: row.counted, note: row.note,
})

const toMove = (row: any): CashMove => ({
  id: row.id, shiftId: row.shift_id, kind: row.kind, amountCentavos: row.amount, reason: row.reason, at: row.at, staffName: row.staff_name ?? null,
})

/** Orders and cash moves with the name of the person credited, when the till still knows them. */
const ORDERS = 'select o.*, sc.full_name as voided_by_name from orders o left join staff_cache sc on sc.id = o.cancelled_by_staff'
const MOVES = 'select m.*, sc.full_name as staff_name from cash_moves m left join staff_cache sc on sc.id = m.staff_id'

/** What an outbox row keeps: the event's payload minus the uuids, which are read from the rows at send time (Ruling 8). */
type StoredPayload<K extends SyncEventKind> = K extends 'order.created'
  ? Omit<CounterOrderPayload, 'orderId' | 'shiftId' | 'payment'> & { payment: Omit<CounterOrderPayload['payment'], 'id'> }
  : K extends 'order.prep_status' | 'order.cancelled' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'orderId'>
  : K extends 'shift.opened' | 'shift.closed' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'shiftId'>
  : K extends 'cash.moved' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'id' | 'shiftId'>
  : Extract<SyncEvent, { kind: K }>['payload']

const ENTITY: Record<SyncEventKind, 'order' | 'shift' | 'cash_move' | 'menu'> = {
  'order.created': 'order', 'order.prep_status': 'order', 'order.cancelled': 'order',
  'shift.opened': 'shift', 'shift.closed': 'shift', 'cash.moved': 'cash_move', 'menu.availability': 'menu',
}

const money = (value: unknown, what: string, min = 0): number => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > MONEY_MAX) throw new OrderError(`${what} is not a valid amount.`)
  return value as number
}

/** Everything the till remembers. One SQLite file; every write is a single transaction, its outbox row included. */
export function createStore(file: string) {
  const db = new DatabaseSync(file)
  db.exec('pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on;')
  db.exec(SCHEMA)

  const tx = <T>(work: () => T): T => {
    db.exec('begin immediate')
    try {
      const out = work()
      db.exec('commit')
      return out
    } catch (err) {
      db.exec('rollback')
      throw err
    }
  }

  // Plan 4 upgrade. Safe to run on every start: each step checks before it changes anything.
  for (const [table, column, decl] of ADDED_COLUMNS) {
    const has = db.prepare(`pragma table_info(${table})`).all().some((c: any) => c.name === column)
    if (!has) db.exec(`alter table ${table} add column ${column} ${decl}`)
  }
  db.exec(UNIQUE_INDEXES)
  const kvGet = (key: string): string | null => (db.prepare('select value from kv where key = ?').get(key) as any)?.value ?? null
  const kvSet = (key: string, value: string): void => {
    db.prepare('insert into kv (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(key, value)
  }
  if (kvGet('schema') === null) {
    // Ruling 9: every row here before this version is legacy, imported once instead of replayed as events.
    tx(() => {
      for (const table of ['shifts', 'orders', 'cash_moves']) db.exec(`update ${table} set needs_import = 1`)
      kvSet('schema', '4')
    })
  }

  /** Adds the outbox row for a change. Called only inside the change's own `tx`. */
  const record = <K extends SyncEventKind>(kind: K, localId: number | null, by: By, now: number, payload: StoredPayload<K>) => {
    db.prepare('insert into outbox (id, kind, entity, entity_local_id, staff_id, occurred_at, payload) values (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), kind, ENTITY[kind], localId, by, now, JSON.stringify(payload))
  }

  const openShift = (): Shift | null => {
    const row = db.prepare('select * from shifts where closed_at is null order by id desc limit 1').get()
    return row ? toShift(row) : null
  }

  const getOrder = (id: number): Order => {
    const row = db.prepare(`${ORDERS} where o.id = ?`).get(id)
    if (!row) throw new OrderError('That order was not found.')
    return toOrder(row)
  }

  const setStatus = (id: number, status: OrderStatus, now: number, by: By) => {
    db.prepare('update orders set status = ?, updated_at = ? where id = ?').run(status, now, id)
    record('order.prep_status', id, by, now, { to: TILL_TO_PREP[status] })
    return getOrder(id)
  }

  const shiftSummary = (shift: Shift): Summary => {
    const orders = db.prepare(`${ORDERS} where o.shift_id = ? order by o.id`).all(shift.id).map(toOrder)
    const moves = db.prepare(`${MOVES} where m.shift_id = ? order by m.id`).all(shift.id).map(toMove)
    return summarise(orders, moves, shift.openingFloatCentavos)
  }

  const orderUids = db.prepare('select o.uid, o.payment_uid, s.uid as shift_uid from orders o left join shifts s on s.id = o.shift_id where o.id = ?')
  const shiftUid = db.prepare('select uid from shifts where id = ?')
  const moveUids = db.prepare('select m.uid, s.uid as shift_uid from cash_moves m left join shifts s on s.id = m.shift_id where m.id = ?')

  /** The event as the API takes it, or null while one of its uuids is not known yet (a legacy row before pairing). */
  const toEvent = (row: any): SyncEvent | null => {
    const head = { id: row.id as string, seq: row.seq as number, occurredAt: new Date(row.occurred_at).toISOString(), staffId: row.staff_id as string | null }
    const stored = JSON.parse(row.payload)
    const kind = row.kind as SyncEventKind
    switch (kind) {
      case 'order.created': {
        const u = orderUids.get(row.entity_local_id) as any
        if (!u?.uid || !u.payment_uid || !u.shift_uid) return null
        return { ...head, kind, payload: { orderId: u.uid, shiftId: u.shift_uid, ...stored, payment: { id: u.payment_uid, ...stored.payment } } }
      }
      case 'order.prep_status':
      case 'order.cancelled': {
        const u = orderUids.get(row.entity_local_id) as any
        if (!u?.uid) return null
        return { ...head, kind, payload: { orderId: u.uid, ...stored } }
      }
      case 'shift.opened':
      case 'shift.closed': {
        const u = shiftUid.get(row.entity_local_id) as any
        if (!u?.uid) return null
        return { ...head, kind, payload: { shiftId: u.uid, ...stored } }
      }
      case 'cash.moved': {
        const u = moveUids.get(row.entity_local_id) as any
        if (!u?.uid || !u.shift_uid) return null
        return { ...head, kind, payload: { id: u.uid, shiftId: u.shift_uid, ...stored } }
      }
      case 'menu.availability':
        return { ...head, kind, payload: stored }
      default:
        return null
    }
  }

  return {
    /** The open database, for the till's sessions (sessions.ts). */
    db,
    close: () => db.close(),
    /** Writes a complete, consistent copy of the database to a new file. Safe while the till is in use. */
    snapshot(to: string) { db.prepare('vacuum into ?').run(to) },
    openShift,
    getOrder,
    shiftSummary,
    kvGet,
    kvSet,

    /**
     * Changes waiting to be sent, oldest first, with uuids read from the rows now. Stops at the first event whose
     * uuids are not all known, so nothing after it overtakes it.
     */
    outboxEvents(limit = MAX_PUSH_EVENTS): SyncEvent[] {
      const out: SyncEvent[] = []
      for (const row of db.prepare('select * from outbox order by seq limit ?').all(limit)) {
        const event = toEvent(row)
        if (!event) break
        out.push(event)
      }
      return out
    },

    /** Forgets events the API has answered. */
    ackOutbox(ids: string[]): void {
      if (ids.length === 0) return
      tx(() => {
        const drop = db.prepare('delete from outbox where id = ?')
        for (const id of ids) drop.run(id)
      })
    },

    /** What is waiting to be sent: sales (`order.created`) and all events. */
    pending(): { sales: number; events: number } {
      const row = db.prepare("select count(*) as events, coalesce(sum(kind = 'order.created'), 0) as sales from outbox").get() as any
      return { sales: Number(row.sales), events: Number(row.events) }
    },

    /** The people the till lets in, as last fetched from the Kennko API (device.ts). Read on every PIN check. */
    staffCache(): CachedStaff[] {
      return db.prepare('select * from staff_cache order by full_name, id').all()
        .map((r: any) => ({ id: r.id, fullName: r.full_name, role: r.role, pinHash: r.pin_hash }))
    },

    /** Swaps the whole cache in one transaction, so a PIN check never sees half of it. */
    replaceStaffCache(rows: CachedStaff[]): void {
      tx(() => {
        db.prepare('delete from staff_cache').run()
        const add = db.prepare('insert into staff_cache (id, full_name, role, pin_hash) values (?, ?, ?, ?)')
        for (const r of rows) add.run(r.id, r.fullName, r.role, r.pinHash)
      })
    },

    soldOut(): string[] {
      return db.prepare('select item_id from sold_out').all().map((r: any) => r.item_id as string)
    },

    /** Marks a drink sold out or back. Sent to Kennko only when `opts.outbox` (while paired, Ruling 14). */
    setAvailable(itemId: string, available: boolean, now: number, by: By, opts: { outbox: boolean }) {
      checkBy(by)
      if (typeof itemId !== 'string' || itemId.length === 0 || /[\u0000]/.test(itemId)) throw new OrderError('That drink is not on the menu.')
      tx(() => {
        if (available) db.prepare('delete from sold_out where item_id = ?').run(itemId)
        else db.prepare('insert or ignore into sold_out (item_id) values (?)').run(itemId)
        if (opts.outbox) record('menu.availability', null, by, now, { itemId, available: Boolean(available) })
      })
    },

    /** Prices the order from the menu, checks the payment, and saves it. Nothing is saved unless all of it holds. */
    createOrder(menu: Menu, input: NewOrder, now: number, by: By): Order {
      checkBy(by)
      const lines = priceLines(menu, input.lines).map(sendableLine)
      const cleaned = cleanDiscount(input.discount)
      if (cleaned && !Number.isInteger(cleaned.value)) throw new OrderError('A discount must be a whole number.')
      if (cleaned && cleaned.value > MONEY_MAX) throw new OrderError('That discount is too large.')
      const discount: Discount | null = cleaned ? { ...cleaned, label: clean(cleaned.label, 40) || 'Discount' } : null
      const sums = totals(lines, discount)
      if (sums.subtotalCentavos > MONEY_MAX) throw new OrderError('That order is too large. Split it into two.')
      const type: OrderType = input.type === 'takeout' ? 'takeout' : 'dine_in'
      const method = input.payment?.method
      if (method !== 'cash' && method !== 'gcash') throw new OrderError('Choose cash or GCash.')
      let tendered: number | null = null
      let change: number | null = null
      if (method === 'cash') {
        tendered = money(input.payment.tenderedCentavos, 'Cash received')
        if (tendered < sums.totalCentavos) throw new OrderError('Cash received is less than the total.')
        change = tendered - sums.totalCentavos
      }
      const ref = method === 'gcash' ? clean(input.payment.ref, 40) || null : null
      const customerName = clean(input.customerName, 24)
      const menuVersion = Number.isInteger(menu.version) && (menu.version as number) >= 1 ? (menu.version as number) : null

      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till before taking orders.')
        const day = manilaDay(now)
        const last = db.prepare('select max(number) as n from orders where day = ?').get(day) as any
        const number = (last?.n ?? 0) + 1
        const result = db.prepare(`
          insert into orders (day, number, type, customer_name, status, lines, subtotal, discount, discount_label, total,
            payment_method, tendered, change, payment_ref, shift_id, created_at, updated_at, uid, payment_uid, menu_version)
          values (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(day, number, type, customerName, JSON.stringify(lines), sums.subtotalCentavos, sums.discountCentavos,
          sums.discountCentavos > 0 ? discount!.label : null, sums.totalCentavos, method, tendered, change, ref, shift.id, now, now,
          randomUUID(), randomUUID(), menuVersion)
        const id = Number(result.lastInsertRowid)
        record('order.created', id, by, now, {
          businessDay: day, ticketNumber: number, fulfilment: type, customerName, menuVersion, lines, discount,
          subtotalCentavos: sums.subtotalCentavos, discountCentavos: sums.discountCentavos, totalCentavos: sums.totalCentavos,
          payment: { method, tenderedCentavos: tendered, changeCentavos: change, reference: ref },
        })
        return getOrder(id)
      })
    },

    advance(id: number, now: number, by: By): Order {
      checkBy(by)
      return tx(() => {
        const next = nextStatus(getOrder(id).status)
        if (!next) throw new OrderError('That order is already finished.')
        return setStatus(id, next, now, by)
      })
    },

    undo(id: number, now: number, by: By): Order {
      checkBy(by)
      return tx(() => {
        const prev = prevStatus(getOrder(id).status)
        if (!prev) throw new OrderError('That order has nothing to undo.')
        return setStatus(id, prev, now, by)
      })
    },

    /** A void keeps the order on record but takes it out of sales and out of the expected cash. */
    voidOrder(id: number, reason: string, now: number, by: By): Order {
      checkBy(by)
      return tx(() => {
        const order = getOrder(id)
        if (order.status === 'voided') throw new OrderError('That order is already voided.')
        const shift = db.prepare('select closed_at from shifts where id = ?').get(order.shiftId) as any
        if (shift?.closed_at) throw new OrderError('That order belongs to a till that is already closed.')
        const why = clean(reason, 120)
        if (!why) throw new OrderError('Say why the order is being voided.')
        db.prepare('update orders set prev_status = status, status = ?, voided_at = ?, void_reason = ?, cancelled_by_staff = ?, updated_at = ? where id = ?')
          .run('voided', now, why, by, now, id)
        record('order.cancelled', id, by, now, { reason: why })
        return getOrder(id)
      })
    },

    /** Orders still being made or served, oldest first, across days so nothing is stranded at midnight. */
    activeOrders(): Order[] {
      return db.prepare(`${ORDERS} where o.status in ('queued','preparing','serving') order by o.id`).all().map(toOrder)
    },

    /** Orders finished or voided since the given time, for the wall to play out their ending. */
    recentlyFinished(since: number): Order[] {
      return db.prepare(`${ORDERS} where o.status in ('done','voided') and o.updated_at >= ? order by o.id`).all(since).map(toOrder)
    },

    ordersForDay(day: string): Order[] {
      return db.prepare(`${ORDERS} where o.day = ? order by o.id desc`).all(day).map(toOrder)
    },

    daySummary(day: string): Summary {
      const orders = db.prepare(`${ORDERS} where o.day = ? order by o.id`).all(day).map(toOrder)
      return summarise(orders, [], 0)
    },

    startShift(floatCentavos: number, now: number, by: By): Shift {
      checkBy(by)
      return tx(() => {
        if (openShift()) throw new OrderError('The till is already open.')
        const float = money(floatCentavos, 'Starting cash')
        const result = db.prepare('insert into shifts (opened_at, opening_float, uid, opened_by_staff) values (?, ?, ?, ?)')
          .run(now, float, randomUUID(), by)
        const id = Number(result.lastInsertRowid)
        record('shift.opened', id, by, now, { openingFloatCentavos: float })
        return toShift(db.prepare('select * from shifts where id = ?').get(id))
      })
    },

    cashMove(kind: 'in' | 'out', amountCentavos: number, reason: string, now: number, by: By): CashMove {
      checkBy(by)
      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till first.')
        if (kind !== 'in' && kind !== 'out') throw new OrderError('Choose cash in or cash out.')
        const why = clean(reason, 80)
        if (!why) throw new OrderError('Say what the cash is for.')
        const amount = money(amountCentavos, 'Amount', 1)
        const result = db.prepare('insert into cash_moves (shift_id, kind, amount, reason, at, uid, staff_id) values (?, ?, ?, ?, ?, ?, ?)')
          .run(shift.id, kind, amount, why, now, randomUUID(), by)
        const id = Number(result.lastInsertRowid)
        record('cash.moved', id, by, now, { kind, amountCentavos: amount, reason: why })
        return toMove(db.prepare(`${MOVES} where m.id = ?`).get(id))
      })
    },

    cashMoves(shiftId: number): CashMove[] {
      return db.prepare(`${MOVES} where m.shift_id = ? order by m.id desc`).all(shiftId).map(toMove)
    },

    endShift(countedCentavos: number, note: string, now: number, by: By): { shift: Shift; summary: Summary } {
      checkBy(by)
      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('The till is not open.')
        const pending = db.prepare("select count(*) as n from orders where status in ('queued','preparing','serving')").get() as any
        if (pending.n > 0) throw new OrderError(`Finish or void the ${pending.n} order(s) still in progress first.`)
        const counted = money(countedCentavos, 'Counted cash')
        const why = clean(note, 200)
        db.prepare('update shifts set closed_at = ?, counted = ?, note = ?, closed_by_staff = ? where id = ?')
          .run(now, counted, why, by, shift.id)
        const closed = toShift(db.prepare('select * from shifts where id = ?').get(shift.id))
        const summary = shiftSummary(closed)
        record('shift.closed', shift.id, by, now, { countedCentavos: counted, expectedCentavos: summary.expectedCashCentavos, note: why })
        return { shift: closed, summary }
      })
    },

    recentShifts(limit = 14): { shift: Shift; summary: Summary }[] {
      return db.prepare('select * from shifts where closed_at is not null order by id desc limit ?').all(limit)
        .map(toShift).map((shift) => ({ shift, summary: shiftSummary(shift) }))
    },
  }
}

export type Store = ReturnType<typeof createStore>
