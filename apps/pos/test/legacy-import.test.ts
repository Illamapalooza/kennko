import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { IMPORT_CHUNK_MAX, type ImportChunk, type PullState, type SyncEvent } from '@kennko/core'
import { saveDevice } from '../server/device.ts'
import { builtInMenu } from '../server/menu.ts'
import { createPinDirectory } from '../server/pins.ts'
import { createSessions } from '../server/sessions.ts'
import { createStore, type NewOrder, type Store } from '../server/store.ts'
import { createSync } from '../server/sync.ts'
import { KENNKO_TILL_NS, ackImportChunk, assignLegacyIds, importRemaining, nextImportChunk } from '../server/legacy-import.ts'
import { uuid5 } from '../server/uuid5.ts'

const T = Date.UTC(2026, 10, 17, 2, 0)
const ANA = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'kd_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const API = 'https://api.kennko.test'
const menu = builtInMenu(0)
const latte = menu.categories[0]!.items.find((i) => i.name === 'Café Latte')!
const sale: NewOrder = {
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 20000 },
}

const made: string[] = []
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-import-')); made.push(d); return d }
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

/** The till's schema before Plan 4 (as in outbox.test.ts). */
const OLD_SCHEMA = `
  create table shifts (id integer primary key autoincrement, opened_at integer not null, opening_float integer not null,
    closed_at integer, counted integer, note text not null default '');
  create table orders (id integer primary key autoincrement, day text not null, number integer not null, type text not null,
    customer_name text not null default '', status text not null, lines text not null, subtotal integer not null,
    discount integer not null, discount_label text, total integer not null, payment_method text not null, tendered integer,
    change integer, payment_ref text, shift_id integer not null references shifts(id), created_at integer not null,
    updated_at integer not null, voided_at integer, void_reason text, prev_status text, unique (day, number));
  create table cash_moves (id integer primary key autoincrement, shift_id integer not null references shifts(id),
    kind text not null, amount integer not null, reason text not null, at integer not null);
  create table sold_out (item_id text primary key);
  create table sessions (token_hash text primary key, staff_id text, staff_name text,
    role text not null check (role in ('staff', 'manager')), created_at integer not null);
  create table staff_cache (id text primary key, full_name text not null,
    role text not null check (role in ('owner', 'manager', 'barista')), pin_hash text not null);
`

const LINE = {
  menuItemId: 'cafe-latte', name: 'Café Latte', size: 'M', basePriceCentavos: 10000, modifiers: [],
  quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '', lineTotalCentavos: 10000,
}

/** An old pos.db: one shift (closed unless `open`), `orders` orders (the second voided), one cash move. */
function oldFile(opts: { orders?: number; open?: boolean; status?: string } = {}) {
  const file = path.join(tempDir(), 'pos.db')
  const db = new DatabaseSync(file)
  db.exec(OLD_SCHEMA)
  db.prepare('insert into shifts (opened_at, opening_float, closed_at, counted, note) values (?, ?, ?, ?, ?)')
    .run(T, 50000, opts.open ? null : T + 100_000, opts.open ? null : 60000, 'closed fine')
  const add = db.prepare(`insert into orders (day, number, type, status, lines, subtotal, discount, total, payment_method, tendered,
    change, shift_id, created_at, updated_at, voided_at, void_reason) values ('2026-11-17', ?, 'takeout', ?, ?, 10000, 0, 10000,
    'cash', 10000, 0, 1, ?, ?, ?, ?)`)
  for (let n = 1; n <= (opts.orders ?? 2); n++) {
    const voided = n === 2
    add.run(n, voided ? 'voided' : (opts.status ?? 'done'), JSON.stringify([LINE]), T + n, T + n, voided ? T + 50 : null, voided ? 'wrong drink' : null)
  }
  db.prepare("insert into cash_moves (shift_id, kind, amount, reason, at) values (1, 'in', 500, 'coins', ?)").run(T + 10)
  db.close()
  return file
}

const uids = (store: Store) => ({
  shifts: store.db.prepare('select uid from shifts order by id').all().map((r: any) => r.uid),
  orders: store.db.prepare('select uid, payment_uid from orders order by id').all().map((r: any) => [r.uid, r.payment_uid]),
  moves: store.db.prepare('select uid from cash_moves order by id').all().map((r: any) => r.uid),
})

/** Reads and acks every chunk, returning them in order. */
function drain(store: Store): ImportChunk[] {
  const out: ImportChunk[] = []
  for (let next = nextImportChunk(store); next; next = nextImportChunk(store)) {
    out.push(next.chunk)
    ackImportChunk(store, next.rows, next.upTo)
  }
  return out
}

describe('uuid5', () => {
  it('matches the RFC 4122 v5 reference value', () => {
    expect(uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
  })
  it('uses the namespace from Ruling 9', () => {
    expect(KENNKO_TILL_NS).toBe('6f1c3a52-9a0e-4c7b-8d0f-2b7c5e4a9d13')
  })
})

describe('assignLegacyIds', () => {
  it('gives each legacy row its UUIDv5 once, and never changes it', () => {
    const file = oldFile()
    const store = createStore(file)
    expect(assignLegacyIds(store, 'D')).toBe(4)
    expect(assignLegacyIds(store, 'D')).toBe(0)
    expect(uids(store)).toEqual({
      shifts: [uuid5(KENNKO_TILL_NS, 'D:shifts:1')],
      orders: [
        [uuid5(KENNKO_TILL_NS, 'D:orders:1'), uuid5(KENNKO_TILL_NS, 'D:payments:1')],
        [uuid5(KENNKO_TILL_NS, 'D:orders:2'), uuid5(KENNKO_TILL_NS, 'D:payments:2')],
      ],
      moves: [uuid5(KENNKO_TILL_NS, 'D:cash_moves:1')],
    })
    const before = uids(store)
    store.close()

    const again = createStore(file)
    expect(assignLegacyIds(again, 'E')).toBe(0) // paired again with another device id
    expect(uids(again)).toEqual(before)
    again.close()
  })

  it('never touches a row created after the upgrade', () => {
    const store = createStore(oldFile())
    const shift = store.startShift(0, T + 200_000, null)
    const own = (store.db.prepare('select uid from shifts where id = ?').get(shift.id) as any).uid
    expect(assignLegacyIds(store, 'D')).toBe(4)
    expect((store.db.prepare('select uid from shifts where id = ?').get(shift.id) as any).uid).toBe(own)
    store.close()
  })
})

describe('nextImportChunk', () => {
  it('sends shifts first, then orders by id, at most 100 rows a chunk', () => {
    const store = createStore(oldFile({ orders: 250 }))
    assignLegacyIds(store, 'D')
    const chunks = drain(store)
    expect(chunks.map((c) => [c.shifts.length, c.orders.length, c.cashMoves.length])).toEqual([[1, 99, 0], [0, 100, 0], [0, 51, 1]])
    const orderIds = chunks.flatMap((c) => c.orders.map((o) => o.id))
    expect(orderIds).toEqual(Array.from({ length: 250 }, (_, i) => uuid5(KENNKO_TILL_NS, `D:orders:${i + 1}`)))
    expect(chunks.every((c) => c.shifts.length + c.orders.length + c.cashMoves.length <= IMPORT_CHUNK_MAX)).toBe(true)

    const [shift] = chunks[0]!.shifts
    expect(shift).toEqual({
      id: uuid5(KENNKO_TILL_NS, 'D:shifts:1'), openedAt: new Date(T).toISOString(), openingFloatCentavos: 50000,
      closedAt: new Date(T + 100_000).toISOString(), countedCentavos: 60000,
      // float 500 + 249 cash sales of 100 + 5 cash in (the voided one is out)
      expectedCentavos: 50000 + 249 * 10000 + 500, note: 'closed fine', openedByStaff: null, closedByStaff: null,
    })
    const voided = chunks[0]!.orders[1]!
    expect(voided).toMatchObject({ status: 'voided', voidedAt: new Date(T + 50).toISOString(), voidReason: 'wrong drink', cancelledByStaff: null })
    expect(chunks[0]!.orders[0]).toEqual({
      id: uuid5(KENNKO_TILL_NS, 'D:orders:1'), shiftId: shift!.id, businessDay: '2026-11-17', ticketNumber: 1, fulfilment: 'takeout',
      customerName: '', status: 'done', lines: [LINE], subtotalCentavos: 10000, discountCentavos: 0, discountLabel: null,
      totalCentavos: 10000,
      payment: { id: uuid5(KENNKO_TILL_NS, 'D:payments:1'), method: 'cash', tenderedCentavos: 10000, changeCentavos: 0, reference: null },
      createdAt: new Date(T + 1).toISOString(), voidedAt: null, voidReason: null, cancelledByStaff: null,
    })
    expect(chunks[2]!.cashMoves).toEqual([{
      id: uuid5(KENNKO_TILL_NS, 'D:cash_moves:1'), shiftId: shift!.id, kind: 'in', amountCentavos: 500, reason: 'coins',
      at: new Date(T + 10).toISOString(), staffId: null,
    }])
    expect(importRemaining(store)).toBe(0)
    store.close()
  })

  it('waits for rows with no uid yet', () => {
    const store = createStore(oldFile())
    expect(nextImportChunk(store)).toBeNull()
    expect(importRemaining(store)).toBe(4)
    store.close()
  })

  it('cleans text the API would refuse, never money', () => {
    const file = oldFile()
    const db = new DatabaseSync(file)
    const line = { ...LINE, name: '', note: 'x\u0000y', modifiers: [{ id: 'oat', name: 'O'.repeat(200), priceCentavos: 3000 }], iceServe: undefined }
    db.prepare('update orders set lines = ?, customer_name = ?, discount_label = ?, payment_ref = ?, void_reason = ? where id = 1')
      .run(JSON.stringify([line]), `Ana${'\u0007'}${'a'.repeat(100)}`, 'L'.repeat(90), 'R'.repeat(130), 'V'.repeat(250))
    db.prepare("update cash_moves set reason = '   '").run()
    db.prepare('update shifts set note = ?').run('N'.repeat(300))
    db.close()
    const store = createStore(file)
    assignLegacyIds(store, 'D')
    const { chunk } = nextImportChunk(store)!
    const o = chunk.orders[0]!
    expect(o.lines[0]).toEqual({ ...LINE, name: 'Drink', note: 'x y', modifiers: [{ id: 'oat', name: 'O'.repeat(120), priceCentavos: 3000 }], iceServe: 'mixed' })
    expect(o.customerName).toBe(`Ana ${'a'.repeat(76)}`)
    expect(o.discountLabel).toBe('L'.repeat(80))
    expect(o.payment.reference).toBe('R'.repeat(120))
    expect(o.voidReason).toBe('V'.repeat(200))
    expect([o.subtotalCentavos, o.totalCentavos, o.lines[0]!.lineTotalCentavos]).toEqual([10000, 10000, 10000])
    expect(chunk.cashMoves[0]!.reason).toBe('Cash in')
    expect(chunk.shifts[0]!.note).toBe('N'.repeat(200))
    store.close()
  })

  it('skips a cash move whose shift is gone rather than failing the chunk', () => {
    const file = oldFile()
    const db = new DatabaseSync(file)
    db.exec('pragma foreign_keys = off')
    db.prepare("insert into cash_moves (shift_id, kind, amount, reason, at) values (99, 'out', 100, 'lost', ?)").run(T)
    db.close()
    const store = createStore(file)
    assignLegacyIds(store, 'D')
    const next = nextImportChunk(store)!
    expect(next.chunk.cashMoves).toHaveLength(1)
    expect(next.rows).toContainEqual({ table: 'cash_moves', localId: 2 })
    ackImportChunk(store, next.rows, next.upTo)
    expect(importRemaining(store)).toBe(0)
    store.close()
  })
})

describe('ackImportChunk (Review Focus 5)', () => {
  it('drops the outbox events the chunk already carries, and keeps later ones', () => {
    const store = createStore(oldFile({ orders: 3, open: true, status: 'queued' }))
    for (let i = 0; i < 6; i++) store.createOrder(menu, sale, T + 1000 + i, null) // seq 1..6, in the legacy shift
    store.voidOrder(1, 'customer left', T + 2000, ANA) // legacy order 1, seq 7
    assignLegacyIds(store, 'D')
    const next = nextImportChunk(store)!
    expect(next.upTo).toBe(7)
    expect(next.chunk.orders[0]).toMatchObject({ id: uuid5(KENNKO_TILL_NS, 'D:orders:1'), status: 'voided', cancelledByStaff: ANA, voidReason: 'customer left' })
    store.advance(3, T + 3000, null) // legacy order 3, seq 8, written after the chunk was read

    ackImportChunk(store, next.rows, next.upTo)
    const left = store.db.prepare('select seq, kind, entity_local_id from outbox order by seq').all() as any[]
    expect(left.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5, 6, 8])
    const sent: SyncEvent[] = store.outboxEvents()
    expect(sent.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 8])
    expect(sent.find((e) => e.seq === 8)).toMatchObject({ kind: 'order.prep_status', payload: { orderId: uuid5(KENNKO_TILL_NS, 'D:orders:3'), to: 'preparing' } })
    store.close()
  })

  it('never offers an acked row again, and the same rows always get the same ids', () => {
    const store = createStore(oldFile({ orders: 150 }))
    assignLegacyIds(store, 'D')
    const first = drain(store)
    expect(nextImportChunk(store)).toBeNull()
    for (const t of ['shifts', 'orders', 'cash_moves']) store.db.exec(`update ${t} set needs_import = 1`)
    const second = drain(store)
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    store.close()
  })
})

describe('the import inside the sync loop', () => {
  function setup() {
    const dataDir = tempDir()
    saveDevice(dataDir, { deviceId: 'D', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
    const store = createStore(oldFile({ orders: 250 }))
    store.startShift(0, T + 200_000, null)
    store.createOrder(menu, sale, T + 200_001, null)
    const calls: { path: string; body: any }[] = []
    let failImport: number | null = null
    let imports = 0
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const p = new URL(String(url)).pathname
      const body = init?.body ? JSON.parse(String(init.body)) : null
      calls.push({ path: p, body })
      if (p === '/v1/sync/import') {
        imports++
        if (imports === failImport) return json(503, { code: 'UNAVAILABLE', message: 'down' })
        const n = body.shifts.length + body.orders.length + body.cashMoves.length
        return json(200, { inserted: n - 1, existing: 0, rejected: 1 })
      }
      if (p === '/v1/sync/push') return json(200, { results: body.events.map((e: SyncEvent) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 })
      if (p === '/v1/sync/pull') return json(200, { menu: null, soldOut: [], staff: [], shop: { name: 'K', address: 'B', phone: null } } satisfies PullState)
      return json(404, {})
    }) as typeof fetch
    const sessions = createSessions(store.db, () => T)
    const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => store.staffCache() })
    const timers = { set: (() => 0) as unknown as typeof setTimeout, clear: (() => {}) as unknown as typeof clearTimeout }
    const sync = createSync({ store, sessions, pins, dataDir, apiUrl: API, fetchFn, now: () => T + 300_000, timers, onChange: () => {} })
    return { store, sync, calls, failSecondImport: () => { failImport = 2 } }
  }

  it('imports everything before it pushes anything', async () => {
    const { store, sync, calls } = setup()
    expect(sync.status().importing).toBe(252)
    await sync.runOnce()
    expect(calls.map((c) => c.path)).toEqual(['/v1/sync/import', '/v1/sync/import', '/v1/sync/import', '/v1/sync/push', '/v1/sync/pull'])
    expect(calls[3]!.body.events.map((e: SyncEvent) => e.kind)).toEqual(['shift.opened', 'order.created'])
    expect(store.kvGet('import_done')).toBe('1')
    expect(sync.status()).toMatchObject({ importing: 0, offline: false, pendingEvents: 0 })
    store.close()
  })

  it('a failed chunk stops the run before any push; the next run resumes at row 101', async () => {
    const { store, sync, calls, failSecondImport } = setup()
    failSecondImport()
    await sync.runOnce()
    expect(calls.map((c) => c.path)).toEqual(['/v1/sync/import', '/v1/sync/import', '/v1/sync/pull'])
    expect(sync.status()).toMatchObject({ importing: 152, offline: true, pendingEvents: 2 })
    expect(store.kvGet('import_done')).toBeNull()

    calls.length = 0
    await sync.runOnce()
    expect(calls.map((c) => c.path)).toEqual(['/v1/sync/import', '/v1/sync/import', '/v1/sync/push', '/v1/sync/pull'])
    expect(calls[0]!.body.orders[0].id).toBe(uuid5(KENNKO_TILL_NS, 'D:orders:100')) // row 101: the shift was row 1
    expect(sync.status()).toMatchObject({ importing: 0, offline: false, pendingEvents: 0 })
    expect(store.kvGet('import_done')).toBe('1')
    store.close()
  })
})
