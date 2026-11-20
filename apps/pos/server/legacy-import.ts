import {
  IMPORT_CHUNK_MAX, NOTE_MAX,
  type ImportCashMove, type ImportChunk, type ImportOrder, type ImportShift, type PricedLine,
} from '@kennko/core'
import { clean, type Store } from './store.ts'
import { uuid5 } from './uuid5.ts'

/** The namespace of every UUIDv5 the till gives its legacy rows (Ruling 9). Never change it. */
export const KENNKO_TILL_NS = '6f1c3a52-9a0e-4c7b-8d0f-2b7c5e4a9d13'

export type ImportTable = 'shifts' | 'orders' | 'cash_moves'
export type ImportRow = { table: ImportTable; localId: number }

const TABLES: ImportTable[] = ['shifts', 'orders', 'cash_moves']
const ENTITY: Record<ImportTable, 'shift' | 'order' | 'cash_move'> = { shifts: 'shift', orders: 'order', cash_moves: 'cash_move' }

/** One SQLite transaction on the store's connection (node:sqlite is synchronous, so nothing interleaves). */
function inTx<T>(store: Store, work: () => T): T {
  store.db.exec('begin immediate')
  try {
    const out = work()
    store.db.exec('commit')
    return out
  } catch (err) {
    store.db.exec('rollback')
    throw err
  }
}

const iso = (ms: number | null): string | null => (ms === null || ms === undefined ? null : new Date(ms).toISOString())

/**
 * Gives every row still without a uid its permanent UUIDv5, "<deviceId>:<table>:<localId>" (orders also get their
 * payment's, "<deviceId>:payments:<localId>"). A row that has a uid is never touched, so pairing again with another
 * device id changes nothing. Returns how many rows got one.
 */
export function assignLegacyIds(store: Store, deviceId: string): number {
  return inTx(store, () => {
    let set = 0
    for (const table of TABLES) {
      const missing = store.db.prepare(`select id from ${table} where uid is null order by id`).all() as { id: number }[]
      const update = table === 'orders'
        ? store.db.prepare('update orders set uid = ?, payment_uid = coalesce(payment_uid, ?) where id = ? and uid is null')
        : store.db.prepare(`update ${table} set uid = ? where id = ? and uid is null`)
      for (const { id } of missing) {
        const uid = uuid5(KENNKO_TILL_NS, `${deviceId}:${table}:${id}`)
        if (table === 'orders') update.run(uid, uuid5(KENNKO_TILL_NS, `${deviceId}:payments:${id}`), id)
        else update.run(uid, id)
        set++
      }
    }
    return set
  })
}

/** Legacy rows not yet acknowledged by the API. */
export function importRemaining(store: Store): number {
  return TABLES.reduce((n, t) => n + Number((store.db.prepare(`select count(*) as n from ${t} where needs_import = 1`).get() as any).n), 0)
}

/** A line from an old pos.db as the API's row schema takes it: names and notes cleaned and cut, the ice shape kept valid. Money untouched. */
function legacyLine(raw: any): PricedLine {
  const l = raw && typeof raw === 'object' ? raw : {}
  const level = l.iceLevel === 'regular' || l.iceLevel === 'less' || l.iceLevel === 'none' ? l.iceLevel : null
  const serve = level === null || level === 'none' ? null : l.iceServe === 'side' ? 'side' : 'mixed'
  return {
    menuItemId: String(l.menuItemId ?? ''),
    name: clean(l.name, 120) || 'Drink',
    size: l.size,
    basePriceCentavos: l.basePriceCentavos,
    modifiers: Array.isArray(l.modifiers)
      ? l.modifiers.map((m: any) => ({ id: String(m?.id ?? ''), name: clean(m?.name, 120), priceCentavos: m?.priceCentavos }))
      : [],
    quantity: l.quantity,
    iceLevel: level,
    iceServe: serve,
    note: clean(l.note, NOTE_MAX),
    lineTotalCentavos: l.lineTotalCentavos,
  }
}

function legacyLines(json: string): PricedLine[] {
  try {
    const parsed = JSON.parse(json)
    // An unreadable list goes as no lines: the API keeps the row as a held receipt instead of losing it.
    return Array.isArray(parsed) ? parsed.map(legacyLine) : []
  } catch {
    return []
  }
}

const optional = (text: unknown, max: number): string | null => (text === null || text === undefined ? null : clean(text, max))

/**
 * The next import chunk: legacy rows (`needs_import = 1`) that have a uid, all shifts first, then orders by id, then
 * cash moves, at most IMPORT_CHUNK_MAX. `upTo` is the newest outbox seq when the rows were read: the chunk carries
 * every change up to there. Each row goes with whatever attribution it has (Ruling 10). A cash move whose shift is
 * gone is left out of the chunk but still listed in `rows`, so the ack clears it instead of retrying it for ever.
 */
export function nextImportChunk(store: Store): { chunk: ImportChunk; upTo: number; rows: ImportRow[] } | null {
  const db = store.db
  return inTx(store, () => {
    const upTo = Number((db.prepare('select coalesce(max(seq), 0) as s from outbox').get() as any).s)
    const chunk: ImportChunk = { shifts: [], orders: [], cashMoves: [] }
    const rows: ImportRow[] = []
    let room = IMPORT_CHUNK_MAX

    for (const s of db.prepare('select * from shifts where needs_import = 1 and uid is not null order by id limit ?').all(room) as any[]) {
      const closed = s.closed_at !== null
      const summary = closed
        ? store.shiftSummary({ id: s.id, openedAt: s.opened_at, openingFloatCentavos: s.opening_float, closedAt: s.closed_at, countedCentavos: s.counted, note: s.note })
        : null
      const shift: ImportShift = {
        id: s.uid, openedAt: iso(s.opened_at)!, openingFloatCentavos: s.opening_float,
        closedAt: iso(s.closed_at), countedCentavos: s.counted ?? null, expectedCentavos: summary ? summary.expectedCashCentavos : null,
        note: clean(s.note, 200), openedByStaff: s.opened_by_staff ?? null, closedByStaff: s.closed_by_staff ?? null,
      }
      chunk.shifts.push(shift)
      rows.push({ table: 'shifts', localId: s.id })
    }
    room -= rows.length

    if (room > 0) {
      const orders = db.prepare(`select o.*, s.uid as shift_uid from orders o left join shifts s on s.id = o.shift_id
        where o.needs_import = 1 and o.uid is not null and o.payment_uid is not null order by o.id limit ?`).all(room) as any[]
      for (const o of orders) {
        const order: ImportOrder = {
          id: o.uid, shiftId: o.shift_uid ?? null, businessDay: o.day, ticketNumber: o.number, fulfilment: o.type,
          customerName: clean(o.customer_name, 80), status: o.status, lines: legacyLines(o.lines),
          subtotalCentavos: o.subtotal, discountCentavos: o.discount, discountLabel: optional(o.discount_label, 80), totalCentavos: o.total,
          payment: {
            id: o.payment_uid, method: o.payment_method, tenderedCentavos: o.tendered ?? null, changeCentavos: o.change ?? null,
            reference: optional(o.payment_ref, 120) || null,
          },
          createdAt: iso(o.created_at)!, voidedAt: iso(o.voided_at), voidReason: optional(o.void_reason, 200),
          cancelledByStaff: o.cancelled_by_staff ?? null,
        }
        chunk.orders.push(order)
        rows.push({ table: 'orders', localId: o.id })
      }
      room -= orders.length
    }

    if (room > 0) {
      const moves = db.prepare(`select m.*, s.uid as shift_uid from cash_moves m left join shifts s on s.id = m.shift_id
        where m.needs_import = 1 and m.uid is not null order by m.id limit ?`).all(room) as any[]
      for (const m of moves) {
        rows.push({ table: 'cash_moves', localId: m.id })
        if (!m.shift_uid) continue // its shift is missing: skipped, not a failed chunk (Ruling 10)
        const move: ImportCashMove = {
          id: m.uid, shiftId: m.shift_uid, kind: m.kind, amountCentavos: m.amount,
          // The API needs 1–80 characters; an old blank reason says which way the cash went.
          reason: clean(m.reason, 80) || (m.kind === 'out' ? 'Cash out' : 'Cash in'),
          at: iso(m.at)!, staffId: m.staff_id ?? null,
        }
        chunk.cashMoves.push(move)
      }
    }

    return rows.length === 0 ? null : { chunk, upTo, rows }
  })
}

/**
 * The API has the chunk: its rows are no longer legacy, and the outbox events of those rows written before the chunk
 * was read (`seq <= upTo`) go too, since the import already carried their latest state (Ruling 9). Later events stay
 * and are pushed as usual. One transaction.
 */
export function ackImportChunk(store: Store, rows: ImportRow[], upTo: number): void {
  if (rows.length === 0) return
  const db = store.db
  inTx(store, () => {
    const drop = db.prepare('delete from outbox where entity = ? and entity_local_id = ? and seq <= ?')
    const done = Object.fromEntries(TABLES.map((t) => [t, db.prepare(`update ${t} set needs_import = 0 where id = ?`)]))
    for (const { table, localId } of rows) {
      done[table]!.run(localId)
      drop.run(ENTITY[table], localId, upTo)
    }
  })
}
