import { randomUuid } from '@kennko/core/portable-crypto'
import type { SqlDb, SqlOpen } from './sql.ts'
import {
  ADDON_LIMIT_MESSAGE, MAX_MODIFIERS, MAX_PUSH_EVENTS, NOTE_MAX, OrderError, TILL_TO_PREP, canMovePrep, cleanDiscount, isOnlineQueueOrder,
  formatPublicCode, hasDrink, manilaDay, nextPrepStatus, nextStatus, normalisePublicCode, prevStatus, priceLines, summarise, totals,
  DEFAULT_SHOP_STATUS, parseClosingTime, type ShopStatus,
  type CashMove, type CatLook, type CounterOrderPayload, type Discount, type LineInput, type Menu, type OnlineQueueOrder, type Order, type OrderStatus,
  type OrderType, type PaymentMethod, type PendingPaymentOrder, type PrepStatus, type PricedLine, type Shift, type Summary, type SyncEvent, type SyncEventKind,
  type TillCustomer, type WallVisitor, MAX_VISITORS, cleanVisitorKey, findVisitor, isWallVisitor, parseLook,
} from '@kennko/core'
import type { CachedStaff } from './pins.ts'

export type NewOrder = {
  lines: LineInput[]
  type: OrderType
  customerName?: string
  discount?: Discount | null
  payment: { method: PaymentMethod; tenderedCentavos?: number; ref?: string }
  /** A Kennko card to link in the same transaction, as typed or scanned (`KC-…` or bare). Empty or absent: none. */
  customerCode?: string | null
  /** Optional cat look from a walking cat or Kennko card. */
  catLook?: CatLook | null
  /** The visit key of the walking cat picked for this sale (a chip on the Sell screen). Empty or absent: none. */
  visitorKey?: string | null
  /** Optional table number (1-3 indoor, 4-7 al fresco) for dine-in orders. */
  tableNumber?: number | null
}

/** Refusals the till screens show as they are. */
export const TYPO_MESSAGE = 'That code has a typo. Check it and try again.'
export const PAPER_STAMP_MESSAGE = 'On a paper card: stamp their paper card.'
const CLOSED_TILL = 'That order belongs to a till that is already closed.'

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
    pin_hash text not null,
    cat_look text
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
  create table if not exists online_orders (id text primary key, prep_status text not null, updated_at integer not null, data text not null);
  create table if not exists customer_cache (code text primary key, data text not null, updated_at integer not null);
  create table if not exists online_stamps (order_id text primary key, stamp_uid text not null, at integer not null);
  create table if not exists pending_releases (claim_id text primary key, claimed_at integer not null);
  create table if not exists visitors (key text primary key, data text not null, ends_at integer not null);
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
  // Plan 7: the linked Kennko card (bare code), this sale's stamp and the free-drink claim it used.
  ['orders', 'customer_code', 'text'],
  ['orders', 'cat_look', 'text'],
  // The walking cat this order belongs to (its per-visit key), so the wall moves that cat instead of adding a twin.
  ['orders', 'visitor_key', 'text'],
  ['orders', 'wall_dismissed', 'integer not null default 0'],
  ['orders', 'table_number', 'integer'],
  ['orders', 'stamp_uid', 'text'],
  ['orders', 'reward_claim_id', 'text'],
  ['cash_moves', 'uid', 'text'],
  ['cash_moves', 'staff_id', 'text'],
  ['cash_moves', 'needs_import', 'integer not null default 0'],
  ['staff_cache', 'cat_look', 'text'],
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

/**
 * Text as the till stores and sends it: no control characters (so no NUL), no broken UTF-16 pairs, trimmed,
 * at most `max` UTF-16 units (the unit the API's limits count in) without cutting a character in half.
 */
export const clean = (text: unknown, max: number) => {
  const out = String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(LONE_SURROGATE, '\ufffd').trim().slice(0, max)
  return /[\ud800-\udbff]$/.test(out) ? out.slice(0, -1) : out
}

/**
 * The staff id to record. Attribution never stops a sale (Ruling P4-4): anything that is not a uuid is recorded as
 * nobody, with a warning, because the API would hold the whole event as invalid.
 */
const checkBy = (by: unknown): By => {
  if (by === null || (typeof by === 'string' && UUID.test(by))) return by
  console.warn(`Not a staff id, so this change is credited to nobody: ${JSON.stringify(String(by)).slice(0, 60)}`)
  return null
}

const sendableId = (id: unknown) => typeof id === 'string' && id.length >= 1 && id.length <= LINE_TEXT_MAX && !/[\u0000]/.test(id)

/**
 * A priced line as the till keeps and sends it (Ruling P4-4): display names cut to the API's limit, a clean note.
 * Only ids are checked, never cut (website ids are uuids, built-in ids short slugs), and the add-on cap the till
 * screen already enforces is kept as a guard.
 */
function sendableLine(line: PricedLine): PricedLine {
  if (line.modifiers.length > MAX_MODIFIERS) throw new OrderError(ADDON_LIMIT_MESSAGE)
  if (!sendableId(line.menuItemId) || !line.modifiers.every((m) => sendableId(m.id))) {
    throw new OrderError(`${clean(line.name, 40) || 'A drink'} has a menu entry the till cannot record. Update the menu.`)
  }
  return {
    ...line,
    name: clean(line.name, LINE_TEXT_MAX) || 'Drink',
    modifiers: line.modifiers.map((m) => ({ ...m, name: clean(m.name, LINE_TEXT_MAX) })),
    note: clean(line.note, NOTE_MAX),
  }
}

/** Whole-number discount values (the API stores ints); a fractional one from a hand-made request is rounded. */
const wholeDiscount = (d: Discount | null | undefined): Discount | null | undefined =>
  d && typeof d.value === 'number' && Number.isFinite(d.value) && !Number.isInteger(d.value) ? { ...d, value: Math.round(d.value) } : d

function toOrder(row: any): Order {
  return {
    id: row.id, day: row.day, number: row.number, type: row.type, customerName: row.customer_name, status: row.status,
    lines: JSON.parse(row.lines), subtotalCentavos: row.subtotal, discountCentavos: row.discount, discountLabel: row.discount_label,
    totalCentavos: row.total, paymentMethod: row.payment_method, tenderedCentavos: row.tendered, changeCentavos: row.change,
    paymentRef: row.payment_ref, shiftId: row.shift_id, createdAt: row.created_at, updatedAt: row.updated_at,
    voidedAt: row.voided_at, voidReason: row.void_reason, voidedByName: row.voided_by_name ?? null,
    customerCode: row.customer_code ? formatPublicCode(row.customer_code) : null,
    stamped: row.stamp_uid != null,
    freeDrink: row.reward_claim_id != null,
    ...(row.visitor_key ? { visitorKey: row.visitor_key as string } : {}),
    ...(row.cat_look ? (() => { try { const l = parseLook(JSON.parse(row.cat_look)); return l ? { catLook: l } : {} } catch { return {} } })() : {}),
    ...(Number.isInteger(row.table_number) ? { tableNumber: row.table_number } : {}),
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

/**
 * What an outbox row keeps: the event's payload minus the uuids, which are read from the rows at send time (Ruling 8).
 * A prep step on an online order keeps the server's `orderId`: that id is the server's from the start (Plan 5 Ruling 8).
 */
type StoredPayload<K extends SyncEventKind> = K extends 'order.created'
  ? Omit<CounterOrderPayload, 'orderId' | 'shiftId' | 'payment'> & { payment: Omit<CounterOrderPayload['payment'], 'id'> }
  : K extends 'order.prep_status' ? { to: PrepStatus } | { orderId: string; to: PrepStatus }
  : K extends 'order.cancelled' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'orderId'>
  : K extends 'shift.opened' | 'shift.closed' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'shiftId'>
  : K extends 'cash.moved' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'id' | 'shiftId'>
  // An online order's stamp keeps the server's `orderId`, like its prep steps.
  : K extends 'stamp.added' ? { stampId: string } | { orderId: string; stampId: string }
  : K extends 'customer.linked' | 'customer.unlinked' | 'reward.used' ? Omit<Extract<SyncEvent, { kind: K }>['payload'], 'orderId'>
  : Extract<SyncEvent, { kind: K }>['payload']

const ENTITY: Record<SyncEventKind, 'order' | 'shift' | 'cash_move' | 'menu'> = {
  'order.created': 'order', 'order.prep_status': 'order', 'order.cancelled': 'order',
  'shift.opened': 'shift', 'shift.closed': 'shift', 'cash.moved': 'cash_move', 'menu.availability': 'menu',
  'customer.linked': 'order', 'customer.unlinked': 'order', 'stamp.added': 'order', 'reward.used': 'order',
}

/**
 * An online order as the till shows it: the pulled copy, with the prep status the till holds now, and `stamped` while
 * a stamp this till made is waiting for the pull to confirm it (`stamped_here`, from `online_stamps`).
 */
const toOnline = (row: any): OnlineQueueOrder => {
  const data = JSON.parse(row.data)
  return { ...data, prepStatus: row.prep_status, ...(row.stamped_here && data.card === 'stamp' ? { card: 'stamped' } : {}) }
}
const ONLINE = 'select o.*, s.order_id as stamped_here from online_orders o left join online_stamps s on s.order_id = o.id'

const STAMP_MODES = new Set(['none', 'digital', 'paper'])
const count = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 10_000
/** A pulled or looked-up customer, cut down to the `TillCustomer` fields field by field, or null when it is not one. */
export function tillCustomer(x: any): { bare: string; customer: TillCustomer } | null {
  if (!x || typeof x !== 'object' || typeof x.code !== 'string') return null
  const bare = normalisePublicCode(x.code)
  if (!bare || !STAMP_MODES.has(x.stampMode) || !count(x.stamps) || !count(x.fullCards)) return null
  const catLook = x.catLook !== undefined ? parseLook(x.catLook) : null
  return {
    bare,
    customer: {
      code: formatPublicCode(bare),
      catName: typeof x.catName === 'string' ? x.catName.slice(0, 40) : null,
      ...(catLook ? { catLook } : {}),
      stampMode: x.stampMode,
      stamps: x.stamps,
      fullCards: x.fullCards,
    },
  }
}

/**
 * The till sells drinks only (its menu is the snapshot's drink categories), so each counter line counts as a drink,
 * except the free drink: it earns no stamp (Ruling P7-5).
 */
const counterKinds = (lines: PricedLine[]) => lines.filter((l) => !l.reward).map(() => ({ kind: null }))
const byCreated = (a: OnlineQueueOrder, b: OnlineQueueOrder) =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0

const money = (value: unknown, what: string, min = 0): number => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > MONEY_MAX) throw new OrderError(`${what} is not a valid amount.`)
  return value as number
}

/** Everything the till remembers. One SQLite file; every write is a single transaction, its outbox row included. */
export function createStore(file: string | SqlDb, open: SqlOpen) {
  const db = typeof file === 'string' ? open(file) : file
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
      .run(randomUuid(), kind, ENTITY[kind], localId, by, now, JSON.stringify(payload))
  }

  let pendingPayments: PendingPaymentOrder[] = []

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
      case 'order.prep_status': {
        // An online order's step carries the server's id, so it never waits for a local uid.
        if (typeof stored.orderId === 'string') return { ...head, kind, payload: { orderId: stored.orderId, to: stored.to } }
        const u = orderUids.get(row.entity_local_id) as any
        if (!u?.uid) return null
        return { ...head, kind, payload: { orderId: u.uid, ...stored } }
      }
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
      case 'customer.linked':
      case 'customer.unlinked':
      case 'reward.used': {
        const u = orderUids.get(row.entity_local_id) as any
        if (!u?.uid) return null
        return { ...head, kind, payload: { orderId: u.uid, ...stored } } as SyncEvent
      }
      case 'stamp.added': {
        // An online order's stamp carries the server's id, so it never waits for a local uid.
        if (typeof stored.orderId === 'string') return { ...head, kind, payload: { orderId: stored.orderId, stampId: stored.stampId } }
        const u = orderUids.get(row.entity_local_id) as any
        if (!u?.uid) return null
        return { ...head, kind, payload: { orderId: u.uid, stampId: stored.stampId } }
      }
      default:
        return null
    }
  }

  const onlineRows = (where: string, ...args: any[]): OnlineQueueOrder[] =>
    (db.prepare(`${ONLINE} ${where}`).all(...args) as any[]).map(toOnline).sort(byCreated)

  /** The bare code for what staff typed, or the typo refusal. Empty or absent: no customer. */
  const codeOrNull = (input: unknown): string | null => {
    if (input === undefined || input === null || input === '') return null
    const bare = normalisePublicCode(input as string)
    if (!bare) throw new OrderError(TYPO_MESSAGE)
    return bare
  }

  /** An order that still belongs to the open till: not voided, its shift not closed. */
  const changeableOrder = (id: number): Order => {
    const order = getOrder(id)
    if (order.status === 'voided') throw new OrderError('That order is voided.')
    const shift = db.prepare('select closed_at from shifts where id = ?').get(order.shiftId) as any
    if (shift?.closed_at) throw new OrderError(CLOSED_TILL)
    return order
  }

  /** The cats visiting at `now` on the till's clock (visit ends are the server's time, so the measured skew is added). */
  const visitorsAt = (now: number): WallVisitor[] => {
    const skew = Number(kvGet('checkin_skew'))
    const at = now + (Number.isSafeInteger(skew) ? skew : 0)
    return (db.prepare('select data from visitors where ends_at > ? order by rowid').all(at) as any[]).map((r) => JSON.parse(r.data))
  }

  /**
   * Which walking cat an order belongs to. A key the screen sent wins when that cat is still here; otherwise the
   * customer's own cat is looked for among the visitors by name and look. null: no visiting cat fits.
   */
  const visitorForOrder = (now: number, picked: string | null, cat: { name?: string | null; look?: CatLook | null } | null): WallVisitor | null => {
    const here = visitorsAt(now)
    if (picked !== null) return here.find((v) => v.key === picked) ?? null
    if (!cat) return null
    const key = findVisitor(here, cat)
    return key === null ? null : here.find((v) => v.key === key) ?? null
  }

  /** The customer as last pulled or looked up, or null. Only `TillCustomer` fields are ever stored. */
  const cachedCustomer = (code: string): TillCustomer | null => {
    const bare = normalisePublicCode(code)
    if (!bare) return null
    const row = db.prepare('select data from customer_cache where code = ?').get(bare) as any
    if (!row) return null
    try { return tillCustomer(JSON.parse(row.data))?.customer ?? null } catch { return null }
  }

  /**
   * The pricing and payment checks of a sale, without writing (`createOrder` and `prepareOrder`). Nothing here reads
   * or writes the database.
   */
  const priceOrder = (menu: Menu, input: NewOrder) => {
    const lines = priceLines(menu, input.lines).map(sendableLine)
    const cleaned = cleanDiscount(wholeDiscount(input.discount))
    const subtotal = totals(lines, null).subtotalCentavos
    if (subtotal > MONEY_MAX) throw new OrderError('That order is too large. Split it into two.')
    // An amount bigger than the order takes off the subtotal anyway (discountAmount), so that is what is kept and sent.
    const discount: Discount | null = cleaned
      ? { ...cleaned, label: clean(cleaned.label, 40) || 'Discount', value: cleaned.kind === 'amount' ? Math.min(cleaned.value, subtotal) : cleaned.value }
      : null
    const sums = totals(lines, discount)
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
    const customerCode = codeOrNull(input.customerCode)
    return { lines, discount, sums, type, method, tendered, change, ref, customerName, menuVersion, customerCode }
  }

  return {
    /** The open database, for the till's sessions (sessions.ts). */
    db,
    close: () => db.close(),
    /**
     * Writes a complete, consistent copy of the database to a new file. Safe while the till is in use. The copy keeps
     * no online orders: they carry customer phones and addresses (Ruling P5-3), and the next pull fetches them again.
     * Nor the customer cache: the next pull or lookup fills it again. Nor the visiting cats or the wall's check-in
     * secret (Plan 8): the secret stays in this database alone.
     */
    snapshot(to: string) {
      db.prepare('vacuum into ?').run(to)
      const copy = open(to)
      try {
        copy.exec('delete from online_orders')
        copy.exec('delete from customer_cache')
        // Plan 8: the wall's check-in secret never leaves this computer, and visiting cats are refetched by the pull.
        copy.exec('delete from visitors')
        copy.exec("delete from kv where key = 'checkin_secret'")
        copy.exec("delete from kv where key like 'file:%'")
        copy.exec('vacuum')
      } finally {
        copy.close()
      }
    },
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
        .map((r: any) => {
          let catLook: CatLook | null = null
          if (typeof r.cat_look === 'string') {
            try { catLook = JSON.parse(r.cat_look) } catch { catLook = null }
          }
          return {
            id: r.id,
            fullName: r.full_name,
            role: r.role,
            pinHash: r.pin_hash,
            ...(catLook ? { catLook } : {}),
          }
        })
    },

    /** Swaps the whole cache in one transaction, so a PIN check never sees half of it. */
    replaceStaffCache(rows: CachedStaff[]): void {
      tx(() => {
        db.prepare('delete from staff_cache').run()
        const add = db.prepare('insert into staff_cache (id, full_name, role, pin_hash, cat_look) values (?, ?, ?, ?, ?)')
        for (const r of rows) add.run(r.id, r.fullName, r.role, r.pinHash, r.catLook ? JSON.stringify(r.catLook) : null)
      })
    },

    /** Baristas currently clocked in on the bar (up to 3), enriched with their latest custom cat look from staff_cache. */
    onDutyBaristas(): { staffId: string; name: string; role: 'owner' | 'manager' | 'barista'; catLook: CatLook | null }[] {
      const raw = (db.prepare('select value from kv where key = ?').get('on_duty_baristas') as any)?.value
      if (typeof raw !== 'string') return []
      let list: { staffId: string; name: string; role: 'owner' | 'manager' | 'barista'; catLook?: CatLook | null }[] = []
      try { list = JSON.parse(raw) } catch { return [] }
      if (!Array.isArray(list)) return []
      const byId = new Map(
        (db.prepare('select id, full_name, role, cat_look from staff_cache').all() as any[]).map((r) => {
          let look: CatLook | null = null
          if (typeof r.cat_look === 'string') { try { look = JSON.parse(r.cat_look) } catch { look = null } }
          return [r.id as string, { fullName: r.full_name as string, role: r.role as 'owner' | 'manager' | 'barista', catLook: look }]
        }),
      )
      return list
        .filter((b) => b && typeof b.staffId === 'string' && typeof b.name === 'string')
        .slice(0, 3)
        .map((b) => {
          const fresh = byId.get(b.staffId)
          return {
            staffId: b.staffId,
            name: fresh?.fullName ?? b.name,
            role: fresh?.role ?? b.role ?? 'barista',
            catLook: fresh?.catLook ?? b.catLook ?? null,
          }
        })
    },

    setOnDutyBaristas(list: { staffId: string; name: string; role: 'owner' | 'manager' | 'barista'; catLook?: CatLook | null }[]): void {
      const clean = list.slice(0, 3).map((b) => ({
        staffId: b.staffId,
        name: b.name,
        role: b.role,
        catLook: b.catLook ?? null,
      }))
      db.prepare('insert into kv (key, value) values (?, ?) on conflict(key) do update set value = excluded.value')
        .run('on_duty_baristas', JSON.stringify(clean))
    },

    soldOut(): string[] {
      return db.prepare('select item_id from sold_out').all().map((r: any) => r.item_id as string)
    },

    /** Marks a drink sold out or back. Sent to Kennko only when `opts.outbox` (while paired, Ruling 14). */
    setAvailable(itemId: string, available: boolean, now: number, by: By, opts: { outbox: boolean }) {
      by = checkBy(by)
      if (typeof itemId !== 'string' || itemId.length === 0 || /[\u0000]/.test(itemId)) throw new OrderError('That drink is not on the menu.')
      tx(() => {
        if (available) db.prepare('delete from sold_out where item_id = ?').run(itemId)
        else db.prepare('insert or ignore into sold_out (item_id) values (?)').run(itemId)
        if (opts.outbox) record('menu.availability', null, by, now, { itemId, available: Boolean(available) })
      })
    },

    /**
     * Takes the website's sold-out list, then replays this till's unsent toggles on top in the order they were made,
     * so a mark the website has not heard about yet is not undone by the pull (Ruling 14). One transaction.
     */
    replaceSoldOut(ids: string[]): void {
      tx(() => {
        db.prepare('delete from sold_out').run()
        const off = db.prepare('insert or ignore into sold_out (item_id) values (?)')
        const on = db.prepare('delete from sold_out where item_id = ?')
        for (const id of ids) off.run(id)
        for (const row of db.prepare("select payload from outbox where kind = 'menu.availability' order by seq").all() as any[]) {
          let p: any
          try { p = JSON.parse(row.payload) } catch { continue } // a broken row never stops the pull
          if (typeof p?.itemId !== 'string') continue
          if (p.available) on.run(p.itemId)
          else off.run(p.itemId)
        }
      })
    },

    /**
     * Checks a sale as `createOrder` would (prices, payment, the customer code, an open till) without writing.
     * Used before a free-drink claim, so a claim is never made for a sale that cannot be saved.
     */
    prepareOrder(menu: Menu, input: NewOrder): { lines: PricedLine[]; totalCentavos: number } {
      const p = priceOrder(menu, input)
      if (!openShift()) throw new OrderError('Open the till before taking orders.')
      return { lines: p.lines, totalCentavos: p.sums.totalCentavos }
    },

    /**
     * Prices the order from the menu, checks the payment, and saves it. Nothing is saved unless all of it holds.
     * With `customerCode`, the card is linked in the same transaction (`customer.linked`). A free-drink line needs
     * `opts.rewardClaimId`, the claim the till made online just before (Ruling 10), and is recorded as `reward.used`.
     */
    createOrder(menu: Menu, input: NewOrder, now: number, by: By, opts: { rewardClaimId?: string } = {}): Order {
      by = checkBy(by)
      const p = priceOrder(menu, input)
      const claimId = opts.rewardClaimId ?? null
      const hasReward = p.lines.some((l) => l.reward)
      if (hasReward && claimId === null) throw new OrderError('The free drink was not claimed.')
      if (claimId !== null && (!hasReward || p.customerCode === null || !UUID.test(claimId))) {
        throw new OrderError('The free drink needs its line and the customer\'s code.')
      }
      const { lines, discount, sums, type, method, tendered, change, ref, menuVersion, customerCode } = p
      const cached = customerCode !== null ? cachedCustomer(customerCode) : null
      // The customer's cat already walking the wall is the order's cat: the picked chip, else the card's own cat.
      const visitor = visitorForOrder(now, cleanVisitorKey(input.visitorKey),
        cached ? { name: cached.catName, look: cached.catLook ?? null } : null)
      const customerName = p.customerName || (cached?.catName ? clean(cached.catName, 24) : visitor ? clean(visitor.name, 24) : '')
      const catLook = visitor?.look ?? (input.catLook ? parseLook(input.catLook) : (cached?.catLook ?? null))
      const visitorKey = visitor?.key ?? null
      const tableNumber = type === 'dine_in' && Number.isInteger(input.tableNumber) && input.tableNumber! >= 1 && input.tableNumber! <= 7
        ? input.tableNumber!
        : null

      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till before taking orders.')
        const day = manilaDay(now)
        const last = db.prepare('select max(number) as n from orders where day = ?').get(day) as any
        const number = (last?.n ?? 0) + 1
        const result = db.prepare(`
          insert into orders (day, number, type, customer_name, status, lines, subtotal, discount, discount_label, total,
            payment_method, tendered, change, payment_ref, shift_id, created_at, updated_at, uid, payment_uid, menu_version,
            customer_code, cat_look, visitor_key, table_number, reward_claim_id)
          values (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(day, number, type, customerName, JSON.stringify(lines), sums.subtotalCentavos, sums.discountCentavos,
          sums.discountCentavos > 0 ? discount!.label : null, sums.totalCentavos, method, tendered, change, ref, shift.id, now, now,
          randomUuid(), randomUuid(), menuVersion, customerCode, catLook ? JSON.stringify(catLook) : null, visitorKey, tableNumber, claimId)
        const id = Number(result.lastInsertRowid)
        record('order.created', id, by, now, {
          businessDay: day, ticketNumber: number, fulfilment: type, customerName, menuVersion, lines, discount,
          subtotalCentavos: sums.subtotalCentavos, discountCentavos: sums.discountCentavos, totalCentavos: sums.totalCentavos,
          payment: { method, tenderedCentavos: tendered, changeCentavos: change, reference: ref },
        })
        if (customerCode !== null) record('customer.linked', id, by, now, { publicCode: customerCode })
        if (claimId !== null) record('reward.used', id, by, now, { claimId })
        return getOrder(id)
      })
    },

    /**
     * Gives an order its cat, or takes it away. With `visitorKey` the order is tied to that walking cat (its look and
     * name are taken from the visit, so the wall and the ticket cannot disagree); a key that is no longer visiting is
     * refused rather than silently turned into a look-alike. Without a key, `catLook` alone dresses a new cat.
     * Fills `customer_name` when it is blank.
     */
    setOrderCat(id: number, catLook: CatLook | null, customerName?: string, visitorKey?: string | null, now: number = Date.now()): Order {
      const key = cleanVisitorKey(visitorKey)
      const visitor = key !== null ? visitorForOrder(now, key, null) : null
      if (key !== null && !visitor) throw new OrderError('That cat is no longer visiting. Pick again.')
      const look = visitor ? visitor.look : catLook ? parseLook(catLook) : null
      if (!visitor && catLook && !look) throw new OrderError('That cat look is not valid.')
      const name = visitor ? visitor.name : customerName
      return tx(() => {
        const order = getOrder(id)
        if (order.status === 'voided') throw new OrderError('That order is voided.')
        const nextName = !order.customerName && name ? clean(name, 24) : order.customerName
        db.prepare('update orders set cat_look = ?, visitor_key = ?, customer_name = ? where id = ?')
          .run(look ? JSON.stringify(look) : null, visitor?.key ?? null, nextName, id)
        return getOrder(id)
      })
    },

    /** Links a Kennko card to a sale of the open till (Ruling 19). A typo'd code is refused before anything is written. */
    linkCustomer(id: number, code: string, now: number, by: By): Order {
      by = checkBy(by)
      const bare = normalisePublicCode(code)
      if (!bare) throw new OrderError(TYPO_MESSAGE)
      return tx(() => {
        const order = changeableOrder(id)
        if (order.customerCode !== null) throw new OrderError('Remove the customer first.')
        const cached = cachedCustomer(bare)
        const nextName = !order.customerName && cached?.catName ? clean(cached.catName, 24) : order.customerName
        // A cat already assigned by hand stays; otherwise the card's own cat, and the walking one when it is here.
        const visitor = order.visitorKey ? null : visitorForOrder(now, null, cached ? { name: cached.catName, look: cached.catLook ?? null } : null)
        const nextLook = order.catLook ?? visitor?.look ?? cached?.catLook ?? null
        const nextKey = order.visitorKey ?? (order.catLook ? null : visitor?.key ?? null)
        db.prepare('update orders set customer_code = ?, customer_name = ?, cat_look = ?, visitor_key = ?, updated_at = ? where id = ?')
          .run(bare, nextName, nextLook ? JSON.stringify(nextLook) : null, nextKey, now, id)
        record('customer.linked', id, by, now, { publicCode: bare })
        return getOrder(id)
      })
    },

    /**
     * Takes the card off a sale while its till is open (Ruling 19); its stamp goes with it (the API removes it, Ruling 8).
     * A free-drink sale keeps its card: the claim was made on that card, so voiding is the way back.
     */
    unlinkCustomer(id: number, now: number, by: By): Order {
      by = checkBy(by)
      return tx(() => {
        const order = changeableOrder(id)
        if (order.customerCode === null) throw new OrderError('That order has no customer.')
        if (order.freeDrink) throw new OrderError('This sale used their free drink. Void it instead.')
        db.prepare('update orders set customer_code = null, stamp_uid = null, updated_at = ? where id = ?').run(now, id)
        record('customer.unlinked', id, by, now, {})
        return getOrder(id)
      })
    },

    /** One stamp for the linked card, sent through the outbox. A card known to be on paper is stamped on paper instead. */
    stampOrder(id: number, now: number, by: By): Order {
      by = checkBy(by)
      return tx(() => {
        const order = getOrder(id)
        if (order.customerCode === null) throw new OrderError('Add the customer first.')
        changeableOrder(id)
        if (order.stamped) throw new OrderError('That order is already stamped.')
        if (!hasDrink(counterKinds(order.lines))) throw new OrderError(order.freeDrink ? 'A free drink earns no stamp.' : 'A stamp needs a drink.')
        if (cachedCustomer(order.customerCode)?.stampMode === 'paper') throw new OrderError(PAPER_STAMP_MESSAGE)
        const stampId = randomUuid()
        db.prepare('update orders set stamp_uid = ?, updated_at = ? where id = ?').run(stampId, now, id)
        record('stamp.added', id, by, now, { stampId })
        return getOrder(id)
      })
    },

    advance(id: number, now: number, by: By): Order {
      by = checkBy(by)
      return tx(() => {
        const next = nextStatus(getOrder(id).status)
        if (!next) throw new OrderError('That order is already finished.')
        return setStatus(id, next, now, by)
      })
    },

    undo(id: number, now: number, by: By): Order {
      by = checkBy(by)
      return tx(() => {
        const prev = prevStatus(getOrder(id).status)
        if (!prev) throw new OrderError('That order has nothing to undo.')
        return setStatus(id, prev, now, by)
      })
    },

    /** A void keeps the order on record but takes it out of sales and out of the expected cash. */
    voidOrder(id: number, reason: string, now: number, by: By): Order {
      by = checkBy(by)
      return tx(() => {
        const order = getOrder(id)
        if (order.status === 'voided') throw new OrderError('That order is already voided.')
        const shift = db.prepare('select closed_at from shifts where id = ?').get(order.shiftId) as any
        if (shift?.closed_at) throw new OrderError(CLOSED_TILL)
        const why = clean(reason, 120)
        if (!why) throw new OrderError('Say why the order is being voided.')
        db.prepare('update orders set prev_status = status, status = ?, voided_at = ?, void_reason = ?, cancelled_by_staff = ?, updated_at = ? where id = ?')
          .run('voided', now, why, by, now, id)
        record('order.cancelled', id, by, now, { reason: why })
        return getOrder(id)
      })
    },

    /**
     * Paid online orders as last pulled, oldest first. They live in their own table, never in `orders`, so the day
     * summary, shift cash, History, CSV and C numbers cannot include them (Plan 5 Ruling 7).
     */
    onlineOrders(): OnlineQueueOrder[] {
      return onlineRows('')
    },

    pendingPayments(): PendingPaymentOrder[] {
      return pendingPayments
    },

    replacePendingPayments(list: PendingPaymentOrder[]) {
      pendingPayments = list
    },

    activeOnlineOrders(): OnlineQueueOrder[] {
      return onlineRows("where prep_status in ('placed','preparing','ready','out_for_delivery')")
    },

    /** Online orders completed since the given time, for the wall to play out their ending. */
    recentlyFinishedOnline(since: number): OnlineQueueOrder[] {
      return onlineRows("where prep_status = 'completed' and updated_at >= ?", since)
    },

    /**
     * Takes the pulled list, then re-applies this till's unsent online steps in the order they were made, each only
     * while it is still the next step, so a step Kennko has not heard about yet is not undone by the pull (Plan 5
     * Ruling 9). One transaction: a malformed list leaves the table as it was.
     */
    replaceOnlineOrders(orders: OnlineQueueOrder[]): void {
      if (!Array.isArray(orders) || !orders.every(isOnlineQueueOrder)) throw new OrderError('The online orders from Kennko are not readable.')
      tx(() => {
        db.prepare('delete from online_orders').run()
        const add = db.prepare('insert into online_orders (id, prep_status, updated_at, data) values (?, ?, ?, ?)')
        // A completed delivery has been handed over: its address and phone are never kept (Ruling P5-3).
        for (const o of orders) {
          const kept = o.prepStatus === 'completed' ? { ...o, delivery: null } : o
          add.run(o.id, o.prepStatus, Date.parse(o.updatedAt) || 0, JSON.stringify(kept))
        }
        const get = db.prepare('select prep_status, data from online_orders where id = ?')
        const set = db.prepare('update online_orders set prep_status = ?, updated_at = ? where id = ?')
        for (const row of db.prepare("select payload, occurred_at from outbox where kind = 'order.prep_status' order by seq").all() as any[]) {
          let p: any
          try { p = JSON.parse(row.payload) } catch { continue } // a broken row never stops the pull
          if (typeof p?.orderId !== 'string') continue // a counter step
          const current = get.get(p.orderId) as any
          if (!current) continue
          if (canMovePrep(current.prep_status, p.to, JSON.parse(current.data).fulfilment)) set.run(p.to, row.occurred_at, p.orderId)
        }
        // A local stamp stays shown until the pull confirms it: kept only while the pull still says `stamp` and its
        // event has not been sent. Anything else (stamped, paper, gone, or sent and not taken) is the server's word.
        db.prepare(`
          delete from online_stamps where not exists (
            select 1 from online_orders o where o.id = online_stamps.order_id and json_extract(o.data, '$.card') = 'stamp'
          ) or not exists (
            select 1 from outbox b where b.kind = 'stamp.added' and b.entity_local_id is null and json_extract(b.payload, '$.orderId') = online_stamps.order_id
          )`).run()
      })
    },

    /**
     * Moves an online order to its next prep step; the step goes to Kennko through the outbox (Plan 5 Ruling 8).
     * `from` is the step the barista saw: when the order has moved since (a double tap, a second tablet), nothing is
     * written, so one tap is never two steps. The till's route always passes it.
     */
    advanceOnline(id: string, now: number, by: By, from?: PrepStatus): OnlineQueueOrder {
      by = checkBy(by)
      return tx(() => {
        const row = db.prepare(`${ONLINE} where o.id = ?`).get(id) as any
        if (!row) throw new OrderError('That online order is no longer on the till.')
        const order = toOnline(row)
        if (from !== undefined && from !== order.prepStatus) throw new OrderError('Someone already moved this order.')
        const next = nextPrepStatus(order.prepStatus, order.fulfilment)
        if (!next) throw new OrderError('That order is already finished.')
        db.prepare('update online_orders set prep_status = ?, updated_at = ? where id = ?').run(next, now, id)
        record('order.prep_status', null, by, now, { orderId: id, to: next })
        return { ...order, prepStatus: next }
      })
    },

    /**
     * "Stamp at pickup" for an online order the pull marked `card: 'stamp'`. The stamp goes through the outbox with the
     * server's order id (Plan 5 Ruling 8), and the order shows `stamped` here until the pull confirms it.
     */
    stampOnline(orderId: string, now: number, by: By): OnlineQueueOrder {
      by = checkBy(by)
      return tx(() => {
        const row = db.prepare(`${ONLINE} where o.id = ?`).get(orderId) as any
        if (!row) throw new OrderError('That online order is no longer on the till.')
        const order = toOnline(row)
        if (order.card === 'stamped') throw new OrderError('That order is already stamped.')
        if (order.card === 'paper') throw new OrderError(PAPER_STAMP_MESSAGE)
        if (order.card !== 'stamp') throw new OrderError('That order has no Kennko card to stamp.')
        const stampId = randomUuid()
        db.prepare('insert into online_stamps (order_id, stamp_uid, at) values (?, ?, ?)').run(orderId, stampId, now)
        record('stamp.added', null, by, now, { orderId, stampId })
        return { ...order, card: 'stamped' }
      })
    },

    /** Drops every online order (the till was revoked or forgotten, Plan 5 Ruling 10). The outbox is left alone. */
    clearOnlineOrders(): void {
      tx(() => {
        db.prepare('delete from online_orders').run()
        db.prepare('delete from online_stamps').run()
      })
    },

    cachedCustomer,
    visitorsAt,

    /**
     * The wall check-in pulled from Kennko (Plan 8). The secret is read only by checkin.ts, inside this server process;
     * it is never sent to a tablet, the wall, a log or the backup. null drops the secret and the URL.
     */
    setCheckin(c: { secret: string; url: string } | null): void {
      tx(() => {
        if (c === null) {
          db.prepare("delete from kv where key in ('checkin_secret', 'checkin_url')").run()
          return
        }
        kvSet('checkin_secret', c.secret)
        kvSet('checkin_url', c.url)
      })
    },

    checkinConfig(): { secret: string; url: string } | null {
      const secret = kvGet('checkin_secret')
      const url = kvGet('checkin_url')
      return secret !== null && url !== null ? { secret, url } : null
    },

    shopStatus(): ShopStatus {
      const raw = kvGet('shop_status')
      if (!raw) return DEFAULT_SHOP_STATUS
      try {
        const parsed = JSON.parse(raw) as Partial<ShopStatus>
        return {
          isOpen: typeof parsed.isOpen === 'boolean' ? parsed.isOpen : true,
          closingTime: parsed.closingTime === null ? null : parseClosingTime(parsed.closingTime) ?? DEFAULT_SHOP_STATUS.closingTime,
          updatedAt: typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt) ? parsed.updatedAt : 0,
        }
      } catch {
        return DEFAULT_SHOP_STATUS
      }
    },

    setShopStatus(status: ShopStatus): ShopStatus {
      const next: ShopStatus = {
        isOpen: Boolean(status.isOpen),
        closingTime: status.closingTime === null ? null : parseClosingTime(status.closingTime) ?? DEFAULT_SHOP_STATUS.closingTime,
        updatedAt: status.updatedAt,
      }
      kvSet('shop_status', JSON.stringify(next))
      return next
    },

    /** Forgets the secret, the URL and the visiting cats (the till was revoked or forgotten). */
    clearCheckin(): void {
      tx(() => {
        db.prepare("delete from kv where key in ('checkin_secret', 'checkin_url')").run()
        db.prepare('delete from visitors').run()
      })
    },

    /**
     * The visiting cats from the pull, in its order (rowid keeps it). Each is rebuilt field by field; one that is not a
     * visitor, or has no readable end time, is skipped, a repeated key keeps the first, and at most MAX_VISITORS stay.
     */
    replaceVisitors(list: WallVisitor[]): void {
      tx(() => {
        db.prepare('delete from visitors').run()
        const add = db.prepare('insert or ignore into visitors (key, data, ends_at) values (?, ?, ?)')
        let kept = 0
        for (const x of Array.isArray(list) ? list : []) {
          if (kept >= MAX_VISITORS) break
          if (!isWallVisitor(x)) continue
          const endsAt = Date.parse(x.endsAt)
          const look = parseLook(x.look)
          if (!Number.isFinite(endsAt) || !look) continue
          const v: WallVisitor = { key: x.key, name: x.name, look, endsAt: x.endsAt }
          if (Number(add.run(v.key, JSON.stringify(v), endsAt).changes) > 0) kept++
        }
      })
    },

    /** Cats whose visit ends after `now` (the server's clock: the times are the server's), in pull order. */
    activeVisitors(now: number): WallVisitor[] {
      return (db.prepare('select data from visitors where ends_at > ? order by rowid').all(now) as any[]).map((r) => JSON.parse(r.data))
    },

    /**
     * Takes the pulled list of customers linked through this till lately (Ruling 15). Only `TillCustomer` fields are
     * kept, picked one by one; an entry that is not a customer is skipped, never stopping the pull (P4-4).
     */
    replaceCustomerCache(list: TillCustomer[], now = Date.now()): void {
      tx(() => {
        db.prepare('delete from customer_cache').run()
        const add = db.prepare('insert or replace into customer_cache (code, data, updated_at) values (?, ?, ?)')
        for (const x of Array.isArray(list) ? list : []) {
          const c = tillCustomer(x)
          if (c) add.run(c.bare, JSON.stringify(c.customer), now)
        }
      })
    },

    /** Keeps one looked-up customer until the next pull replaces the cache. */
    cacheCustomer(x: TillCustomer, now = Date.now()): void {
      const c = tillCustomer(x)
      if (c) db.prepare('insert or replace into customer_cache (code, data, updated_at) values (?, ?, ?)').run(c.bare, JSON.stringify(c.customer), now)
    },

    /**
     * Remembers a free-drink claim to let go (Ruling P7-3): one not confirmed in time, or confirmed but its sale not
     * saved. The sync loop retries the release until it is definitive. A claim a sale was written under is never queued.
     */
    queueRelease(claimId: string, claimedAt: number): void {
      tx(() => {
        if (db.prepare('select 1 from orders where reward_claim_id = ?').get(claimId)) return
        db.prepare('insert or ignore into pending_releases (claim_id, claimed_at) values (?, ?)').run(claimId, claimedAt)
      })
    },

    /** Claims waiting to be released, oldest first. */
    pendingReleases(): { claimId: string; claimedAt: number }[] {
      return (db.prepare('select claim_id, claimed_at from pending_releases order by claimed_at, claim_id').all() as any[])
        .map((r) => ({ claimId: r.claim_id, claimedAt: r.claimed_at }))
    },

    dropRelease(claimId: string): void {
      db.prepare('delete from pending_releases where claim_id = ?').run(claimId)
    },

    /** Forgets every cached customer (the till was revoked or forgotten). */
    clearCustomerCache(): void {
      db.prepare('delete from customer_cache').run()
    },

    /** Orders still being made or served, oldest first, across days so nothing is stranded at midnight. */
    activeOrders(): Order[] {
      return db.prepare(`${ORDERS} where o.status in ('queued','preparing','serving') order by o.id`).all().map(toOrder)
    },

    /** Orders finished or voided since the given time, for the wall to play out their ending or keep dine-in cats seated. */
    recentlyFinished(since: number): Order[] {
      return db.prepare(`${ORDERS} where o.status in ('done','voided') and coalesce(o.wall_dismissed, 0) = 0 and o.updated_at >= ? order by o.id`).all(since).map(toOrder)
    },

    /** Explicitly removes a finished order's cat from the cafe wall without voiding the sale. */
    dismissFromWall(id: number): Order {
      getOrder(id)
      db.prepare('update orders set wall_dismissed = 1 where id = ?').run(id)
      return getOrder(id)
    },

    /** Assigns or clears a table (1-3 indoor, 4-7 al fresco) on a dine-in order. */
    setOrderTable(id: number, tableNumber: number | null): Order {
      const next = tableNumber !== null && Number.isInteger(tableNumber) && tableNumber >= 1 && tableNumber <= 7 ? tableNumber : null
      if (tableNumber !== null && next === null) throw new OrderError('Pick a table from 1 to 7.')
      return tx(() => {
        const order = getOrder(id)
        if (order.status === 'voided') throw new OrderError('That order is voided.')
        if (order.type !== 'dine_in') throw new OrderError('Only dine-in orders have a table.')
        db.prepare('update orders set table_number = ? where id = ?').run(next, id)
        return getOrder(id)
      })
    },

    ordersForDay(day: string): Order[] {
      return db.prepare(`${ORDERS} where o.day = ? order by o.id desc`).all(day).map(toOrder)
    },

    daySummary(day: string): Summary {
      const orders = db.prepare(`${ORDERS} where o.day = ? order by o.id`).all(day).map(toOrder)
      return summarise(orders, [], 0)
    },

    startShift(floatCentavos: number, now: number, by: By): Shift {
      by = checkBy(by)
      return tx(() => {
        if (openShift()) throw new OrderError('The till is already open.')
        const float = money(floatCentavos, 'Starting cash')
        const result = db.prepare('insert into shifts (opened_at, opening_float, uid, opened_by_staff) values (?, ?, ?, ?)')
          .run(now, float, randomUuid(), by)
        const id = Number(result.lastInsertRowid)
        record('shift.opened', id, by, now, { openingFloatCentavos: float })
        return toShift(db.prepare('select * from shifts where id = ?').get(id))
      })
    },

    cashMove(kind: 'in' | 'out', amountCentavos: number, reason: string, now: number, by: By): CashMove {
      by = checkBy(by)
      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till first.')
        if (kind !== 'in' && kind !== 'out') throw new OrderError('Choose cash in or cash out.')
        const why = clean(reason, 80)
        if (!why) throw new OrderError('Say what the cash is for.')
        const amount = money(amountCentavos, 'Amount', 1)
        const result = db.prepare('insert into cash_moves (shift_id, kind, amount, reason, at, uid, staff_id) values (?, ?, ?, ?, ?, ?, ?)')
          .run(shift.id, kind, amount, why, now, randomUuid(), by)
        const id = Number(result.lastInsertRowid)
        record('cash.moved', id, by, now, { kind, amountCentavos: amount, reason: why })
        return toMove(db.prepare(`${MOVES} where m.id = ?`).get(id))
      })
    },

    cashMoves(shiftId: number): CashMove[] {
      return db.prepare(`${MOVES} where m.shift_id = ? order by m.id desc`).all(shiftId).map(toMove)
    },

    endShift(countedCentavos: number, note: string, now: number, by: By): { shift: Shift; summary: Summary } {
      by = checkBy(by)
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
