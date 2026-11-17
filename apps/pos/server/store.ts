import { DatabaseSync } from 'node:sqlite'
import {
  OrderError, cleanDiscount, manilaDay, nextStatus, prevStatus, priceLines, summarise, totals,
  type CashMove, type Discount, type LineInput, type Menu, type Order, type OrderType, type PaymentMethod, type Shift, type Summary,
} from '@kennko/core'

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
`

const clean = (text: unknown, max: number) => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)

function toOrder(row: any): Order {
  return {
    id: row.id, day: row.day, number: row.number, type: row.type, customerName: row.customer_name, status: row.status,
    lines: JSON.parse(row.lines), subtotalCentavos: row.subtotal, discountCentavos: row.discount, discountLabel: row.discount_label,
    totalCentavos: row.total, paymentMethod: row.payment_method, tenderedCentavos: row.tendered, changeCentavos: row.change,
    paymentRef: row.payment_ref, shiftId: row.shift_id, createdAt: row.created_at, updatedAt: row.updated_at,
    voidedAt: row.voided_at, voidReason: row.void_reason,
  }
}

const toShift = (row: any): Shift => ({
  id: row.id, openedAt: row.opened_at, openingFloatCentavos: row.opening_float, closedAt: row.closed_at, countedCentavos: row.counted, note: row.note,
})

const toMove = (row: any): CashMove => ({ id: row.id, shiftId: row.shift_id, kind: row.kind, amountCentavos: row.amount, reason: row.reason, at: row.at })

const money = (value: unknown, what: string, min = 0): number => {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > 100_000_000) throw new OrderError(`${what} is not a valid amount.`)
  return value as number
}

/** Everything the till remembers. One SQLite file; every write is a single transaction. */
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

  const openShift = (): Shift | null => {
    const row = db.prepare('select * from shifts where closed_at is null order by id desc limit 1').get()
    return row ? toShift(row) : null
  }

  const getOrder = (id: number): Order => {
    const row = db.prepare('select * from orders where id = ?').get(id)
    if (!row) throw new OrderError('That order was not found.')
    return toOrder(row)
  }

  const setStatus = (id: number, status: string, now: number) => {
    db.prepare('update orders set status = ?, updated_at = ? where id = ?').run(status, now, id)
    return getOrder(id)
  }

  const shiftSummary = (shift: Shift): Summary => {
    const orders = db.prepare('select * from orders where shift_id = ? order by id').all(shift.id).map(toOrder)
    const moves = db.prepare('select * from cash_moves where shift_id = ? order by id').all(shift.id).map(toMove)
    return summarise(orders, moves, shift.openingFloatCentavos)
  }

  return {
    close: () => db.close(),
    /** Writes a complete, consistent copy of the database to a new file. Safe while the till is in use. */
    snapshot(to: string) { db.prepare('vacuum into ?').run(to) },
    openShift,
    getOrder,
    shiftSummary,

    soldOut(): string[] {
      return db.prepare('select item_id from sold_out').all().map((r: any) => r.item_id as string)
    },

    setAvailable(itemId: string, available: boolean) {
      if (available) db.prepare('delete from sold_out where item_id = ?').run(itemId)
      else db.prepare('insert or ignore into sold_out (item_id) values (?)').run(itemId)
    },

    /** Prices the order from the menu, checks the payment, and saves it. Nothing is saved unless all of it holds. */
    createOrder(menu: Menu, input: NewOrder, now: number): Order {
      const lines = priceLines(menu, input.lines)
      const discount = cleanDiscount(input.discount)
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

      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till before taking orders.')
        const day = manilaDay(now)
        const last = db.prepare('select max(number) as n from orders where day = ?').get(day) as any
        const number = (last?.n ?? 0) + 1
        const result = db.prepare(`
          insert into orders (day, number, type, customer_name, status, lines, subtotal, discount, discount_label, total,
            payment_method, tendered, change, payment_ref, shift_id, created_at, updated_at)
          values (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(day, number, type, clean(input.customerName, 24), JSON.stringify(lines), sums.subtotalCentavos, sums.discountCentavos,
          sums.discountCentavos > 0 ? discount!.label : null, sums.totalCentavos, method, tendered, change, ref, shift.id, now, now)
        return getOrder(Number(result.lastInsertRowid))
      })
    },

    advance(id: number, now: number): Order {
      return tx(() => {
        const next = nextStatus(getOrder(id).status)
        if (!next) throw new OrderError('That order is already finished.')
        return setStatus(id, next, now)
      })
    },

    undo(id: number, now: number): Order {
      return tx(() => {
        const prev = prevStatus(getOrder(id).status)
        if (!prev) throw new OrderError('That order has nothing to undo.')
        return setStatus(id, prev, now)
      })
    },

    /** A void keeps the order on record but takes it out of sales and out of the expected cash. */
    voidOrder(id: number, reason: string, now: number): Order {
      return tx(() => {
        const order = getOrder(id)
        if (order.status === 'voided') throw new OrderError('That order is already voided.')
        const shift = db.prepare('select closed_at from shifts where id = ?').get(order.shiftId) as any
        if (shift?.closed_at) throw new OrderError('That order belongs to a till that is already closed.')
        const why = clean(reason, 120)
        if (!why) throw new OrderError('Say why the order is being voided.')
        db.prepare('update orders set prev_status = status, status = ?, voided_at = ?, void_reason = ?, updated_at = ? where id = ?')
          .run('voided', now, why, now, id)
        return getOrder(id)
      })
    },

    /** Orders still being made or served, oldest first, across days so nothing is stranded at midnight. */
    activeOrders(): Order[] {
      return db.prepare("select * from orders where status in ('queued','preparing','serving') order by id").all().map(toOrder)
    },

    /** Orders finished or voided since the given time, for the wall to play out their ending. */
    recentlyFinished(since: number): Order[] {
      return db.prepare("select * from orders where status in ('done','voided') and updated_at >= ? order by id").all(since).map(toOrder)
    },

    ordersForDay(day: string): Order[] {
      return db.prepare('select * from orders where day = ? order by id desc').all(day).map(toOrder)
    },

    daySummary(day: string): Summary {
      const orders = db.prepare('select * from orders where day = ? order by id').all(day).map(toOrder)
      return summarise(orders, [], 0)
    },

    startShift(floatCentavos: number, now: number): Shift {
      return tx(() => {
        if (openShift()) throw new OrderError('The till is already open.')
        const result = db.prepare('insert into shifts (opened_at, opening_float) values (?, ?)').run(now, money(floatCentavos, 'Starting cash'))
        return toShift(db.prepare('select * from shifts where id = ?').get(Number(result.lastInsertRowid)))
      })
    },

    cashMove(kind: 'in' | 'out', amountCentavos: number, reason: string, now: number): CashMove {
      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('Open the till first.')
        if (kind !== 'in' && kind !== 'out') throw new OrderError('Choose cash in or cash out.')
        const why = clean(reason, 80)
        if (!why) throw new OrderError('Say what the cash is for.')
        const result = db.prepare('insert into cash_moves (shift_id, kind, amount, reason, at) values (?, ?, ?, ?, ?)')
          .run(shift.id, kind, money(amountCentavos, 'Amount', 1), why, now)
        return toMove(db.prepare('select * from cash_moves where id = ?').get(Number(result.lastInsertRowid)))
      })
    },

    cashMoves(shiftId: number): CashMove[] {
      return db.prepare('select * from cash_moves where shift_id = ? order by id desc').all(shiftId).map(toMove)
    },

    endShift(countedCentavos: number, note: string, now: number): { shift: Shift; summary: Summary } {
      return tx(() => {
        const shift = openShift()
        if (!shift) throw new OrderError('The till is not open.')
        const pending = db.prepare("select count(*) as n from orders where status in ('queued','preparing','serving')").get() as any
        if (pending.n > 0) throw new OrderError(`Finish or void the ${pending.n} order(s) still in progress first.`)
        db.prepare('update shifts set closed_at = ?, counted = ?, note = ? where id = ?')
          .run(now, money(countedCentavos, 'Counted cash'), clean(note, 200), shift.id)
        const closed = toShift(db.prepare('select * from shifts where id = ?').get(shift.id))
        return { shift: closed, summary: shiftSummary(closed) }
      })
    },

    recentShifts(limit = 14): { shift: Shift; summary: Summary }[] {
      return db.prepare('select * from shifts where closed_at is not null order by id desc limit ?').all(limit)
        .map(toShift).map((shift) => ({ shift, summary: shiftSummary(shift) }))
    },
  }
}

export type Store = ReturnType<typeof createStore>
