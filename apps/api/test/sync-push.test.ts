import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { startTestDb, type TestDb } from './pg.js'
import {
  availability,
  cashMoved,
  publishTwoVersions,
  seedDevice,
  seedStaff,
  shiftClosed,
  shiftOpened,
  syncApp,
  type TwoVersions,
} from './sync-helpers.js'

let db: TestDb
let api: ReturnType<typeof syncApp>
let menu: TwoVersions
let bea: string
let olive: string

beforeAll(async () => {
  db = await startTestDb()
  api = syncApp(db.sql)
  menu = await publishTwoVersions(db.sql)
  bea = await seedStaff(db.sql, { fullName: 'Bea' })
  olive = await seedStaff(db.sql, { fullName: 'Olive', role: 'manager' })
})
afterAll(async () => {
  await db.stop()
})

const count = async (table: 'shifts' | 'cash_moves' | 'sync_events', deviceId?: string) => {
  const rows =
    table === 'cash_moves'
      ? await db.sql`select count(*)::int as n from cash_moves m join shifts s on s.id = m.shift_id
          where ${deviceId ?? null}::uuid is null or s.device_id = ${deviceId ?? null}`
      : await db.sql`select count(*)::int as n from ${db.sql(table)}
          where ${deviceId ?? null}::uuid is null or device_id = ${deviceId ?? null}`
  return rows[0]!.n as number
}
const results = (r: { results: { result: string }[] }) => r.results.map((x) => x.result)

test('open, cash in, cash out and close in one push are all applied and stored as sent', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened({ openingFloatCentavos: 100000 }, { staffId: bea })
  const shiftId = open.payload.shiftId
  const cashIn = cashMoved({ shiftId, kind: 'in', amountCentavos: 5000, reason: 'Change' }, { staffId: bea })
  const cashOut = cashMoved({ shiftId, kind: 'out', amountCentavos: 2000, reason: 'Ice' }, { staffId: olive })
  const close = shiftClosed({ shiftId, countedCentavos: 103000, expectedCentavos: 103000, note: 'ok' }, { staffId: olive })

  const res = await api.push(token, [open, cashIn, cashOut, close])
  expect(res).toEqual({
    results: [open, cashIn, cashOut, close].map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })),
    held: 0,
  })

  const [shift] = await db.sql`select * from shifts where id = ${shiftId}`
  expect(shift).toMatchObject({
    device_id: deviceId,
    opening_float_centavos: 100000,
    opened_by_staff: bea,
    closed_by_staff: olive,
    counted_centavos: 103000,
    expected_centavos: 103000,
    note: 'ok',
    is_legacy: false,
  })
  expect(shift!.opened_at.toISOString()).toBe(open.occurredAt)
  expect(shift!.closed_at.toISOString()).toBe(close.occurredAt)
  expect(shift!.received_at.toISOString()).toBe(api.now().toISOString())
  expect(shift!.updated_at.toISOString()).toBe(api.now().toISOString())

  const moves = await db.sql`select id, kind, amount_centavos, reason, staff_id, at, received_at from cash_moves
    where shift_id = ${shiftId} order by at`
  expect(moves.map((m) => [m.id, m.kind, m.amount_centavos, m.reason, m.staff_id])).toEqual([
    [cashIn.payload.id, 'in', 5000, 'Change', bea],
    [cashOut.payload.id, 'out', 2000, 'Ice', olive],
  ])
  expect(moves[0]!.at.toISOString()).toBe(cashIn.occurredAt)
  expect(moves[0]!.received_at.toISOString()).toBe(api.now().toISOString())

  const receipts = await db.sql`select id, seq, kind, result, reason, entity_keys, staff_id, received_at, applied_at, payload
    from sync_events where device_id = ${deviceId} order by seq`
  expect(receipts.map((r) => [r.id, r.kind, r.result, r.reason])).toEqual([
    [open.id, 'shift.opened', 'applied', null],
    [cashIn.id, 'cash.moved', 'applied', null],
    [cashOut.id, 'cash.moved', 'applied', null],
    [close.id, 'shift.closed', 'applied', null],
  ])
  expect(receipts[0]!.entity_keys).toEqual([`shift:${shiftId}`])
  expect(receipts[1]!.entity_keys).toEqual([`shift:${shiftId}`])
  expect(receipts[0]!.payload).toEqual(open.payload)
  expect(receipts[0]!.staff_id).toBe(bea)
  expect(receipts[0]!.received_at.toISOString()).toBe(api.now().toISOString())
  expect(receipts[0]!.applied_at.toISOString()).toBe(api.now().toISOString())
})

test('Review Focus 1: the same body again is all duplicate and writes nothing', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  const shiftId = open.payload.shiftId
  const body = [open, cashMoved({ shiftId }), cashMoved({ shiftId, kind: 'out' }), shiftClosed({ shiftId })]
  expect(results(await api.push(token, body))).toEqual(['applied', 'applied', 'applied', 'applied'])
  const before = [await count('shifts', deviceId), await count('cash_moves', deviceId), await count('sync_events', deviceId)]
  expect(before).toEqual([1, 2, 4])

  const again = await api.push(token, body)
  expect(again).toEqual({ results: body.map((e) => ({ id: e.id, result: 'duplicate', reason: null, flags: [] })), held: 0 })
  expect([await count('shifts', deviceId), await count('cash_moves', deviceId), await count('sync_events', deviceId)]).toEqual(before)
})

test('Review Focus 1: two identical pushes at once: one applied, one duplicate, one shift', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  const shiftId = open.payload.shiftId
  const body = [open, cashMoved({ shiftId }), shiftClosed({ shiftId })]
  // PGlite runs these one after another (one backend session); on Postgres the per-device advisory
  // lock serialises them and the sync_events primary key backs it up.
  const [a, b] = await Promise.all([api.push(token, body), api.push(token, body)])
  const sorted = [results(a), results(b)].sort()
  expect(sorted).toEqual([
    ['applied', 'applied', 'applied'],
    ['duplicate', 'duplicate', 'duplicate'],
  ])
  expect(await count('shifts', deviceId)).toBe(1)
  expect(await count('cash_moves', deviceId)).toBe(1)
})

test('the same event id from another till is not a duplicate', async () => {
  const one = await seedDevice(db.sql, 'One')
  const two = await seedDevice(db.sql, 'Two')
  const e = availability({ itemId: menu.latteId, available: true })
  expect(results(await api.push(one.token, [e]))).toEqual(['applied'])
  expect(results(await api.push(two.token, [e]))).toEqual(['applied'])
})

test('Review Focus 3: a cash move before its shift is held, then applied when the shift arrives', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  const shiftId = open.payload.shiftId
  const move = cashMoved({ shiftId, amountCentavos: 7000 })

  const first = await api.push(token, [move])
  expect(first).toEqual({ results: [{ id: move.id, result: 'held', reason: 'shift_unknown', flags: [] }], held: 1 })
  expect(await count('cash_moves', deviceId)).toBe(0)
  const [heldRow] = await db.sql`select result, reason, applied_at from sync_events where device_id = ${deviceId} and id = ${move.id}`
  expect(heldRow).toEqual({ result: 'held', reason: 'shift_unknown', applied_at: null })

  api.setNow(new Date('2026-11-21T02:05:00Z'))
  try {
    const second = await api.push(token, [open])
    expect(second).toEqual({ results: [{ id: open.id, result: 'applied', reason: null, flags: [] }], held: 0 })
    const moves = await db.sql`select amount_centavos from cash_moves where id = ${move.payload.id}`
    expect(moves).toEqual([{ amount_centavos: 7000 }])
    const [row] = await db.sql`select result, reason, applied_at from sync_events where device_id = ${deviceId} and id = ${move.id}`
    expect(row!.result).toBe('applied')
    expect(row!.reason).toBeNull()
    expect(row!.applied_at.toISOString()).toBe('2026-11-21T02:05:00.000Z')

    // Resending the held event now answers duplicate.
    expect(results(await api.push(token, [move]))).toEqual(['duplicate'])
  } finally {
    api.setNow(new Date('2026-11-21T02:00:00Z'))
  }
})

test('Review Focus 3: a later event on the same shift waits behind an earlier held one', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  const shiftId = open.payload.shiftId
  const move = cashMoved({ shiftId })
  const close = shiftClosed({ shiftId, countedCentavos: 105000, expectedCentavos: 105000 })

  const res = await api.push(token, [move, close])
  expect(res.results.map((r) => [r.result, r.reason])).toEqual([
    ['held', 'shift_unknown'],
    ['held', 'waits_for_earlier'],
  ])
  expect(res.held).toBe(2)

  // The shift arrives: both held events apply, in seq order, in the same push.
  const done = await api.push(token, [open])
  expect(done).toEqual({ results: [{ id: open.id, result: 'applied', reason: null, flags: [] }], held: 0 })
  const [shift] = await db.sql`select closed_at, counted_centavos from shifts where id = ${shiftId}`
  expect(shift!.closed_at.toISOString()).toBe(close.occurredAt)
  expect(shift!.counted_centavos).toBe(105000)
  expect(await count('cash_moves', deviceId)).toBe(1)
  const rows = await db.sql`select result from sync_events where device_id = ${deviceId} order by seq`
  expect(rows.map((r) => r.result)).toEqual(['applied', 'applied', 'applied'])
})

test('a held event is retried at the start of the next push even if that push is unrelated', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const shiftId = randomUUID()
  const move = cashMoved({ shiftId })
  const toggle = availability({ itemId: menu.latteId, available: true })
  expect(results(await api.push(token, [toggle, move]))).toEqual(['applied', 'held'])
  // The shift appears by another route (here: inserted directly, like a legacy import).
  await db.sql`insert into shifts (id, device_id, opened_at, opening_float_centavos)
    values (${shiftId}, ${deviceId}, '2026-11-21T00:00:00Z', 0)`
  // Only a resend: nothing new applies, so only the start-of-push pass can free the cash move.
  const res = await api.push(token, [toggle])
  expect(results(res)).toEqual(['duplicate'])
  expect(res.held).toBe(0)
  expect(await count('cash_moves', deviceId)).toBe(1)
})

test('a second shift.opened while one is open is held another_shift_open', async () => {
  const { token } = await seedDevice(db.sql)
  const first = shiftOpened()
  const second = shiftOpened()
  const res = await api.push(token, [first, second])
  expect(res.results.map((r) => [r.result, r.reason])).toEqual([
    ['applied', null],
    ['held', 'another_shift_open'],
  ])
  expect(res.held).toBe(1)

  // Closing the first releases the second on the next push.
  const close = shiftClosed({ shiftId: first.payload.shiftId })
  const next = await api.push(token, [close])
  expect(results(next)).toEqual(['applied'])
  expect(next.held).toBe(0)
  const [row] = await db.sql`select closed_at from shifts where id = ${second.payload.shiftId}`
  expect(row!.closed_at).toBeNull()
})

test('shift.closed: already closed is applied already_closed; a re-paired till can close its shift', async () => {
  const old = await seedDevice(db.sql, 'Old')
  const open = shiftOpened()
  const shiftId = open.payload.shiftId
  expect(results(await api.push(old.token, [open]))).toEqual(['applied'])

  // Paired again mid-shift: a new device id, the same shift (matched by id, not device).
  const fresh = await seedDevice(db.sql, 'New')
  const close = shiftClosed({ shiftId, countedCentavos: 90000, expectedCentavos: 100000 })
  expect(results(await api.push(fresh.token, [close]))).toEqual(['applied'])

  const again = shiftClosed({ shiftId, countedCentavos: 1 })
  const res = await api.push(fresh.token, [again])
  expect(res.results[0]).toEqual({ id: again.id, result: 'applied', reason: 'already_closed', flags: [] })
  const [row] = await db.sql`select counted_centavos, expected_centavos from shifts where id = ${shiftId}`
  expect(row).toEqual({ counted_centavos: 90000, expected_centavos: 100000 })
})

test('menu.availability off then on; a slug id is flagged unknown_item', async () => {
  const { token } = await seedDevice(db.sql)
  const off = availability({ itemId: menu.latteId, available: false }, { staffId: bea })
  expect(results(await api.push(token, [off]))).toEqual(['applied'])
  const [a] = await db.sql`select is_available, availability_changed_at from menu_items where id = ${menu.latteId}`
  expect(a!.is_available).toBe(false)
  expect(a!.availability_changed_at).not.toBeNull()

  expect(results(await api.push(token, [availability({ itemId: menu.latteId, available: true })]))).toEqual(['applied'])
  const [b] = await db.sql`select is_available from menu_items where id = ${menu.latteId}`
  expect(b!.is_available).toBe(true)

  const slug = availability({ itemId: 'iced-latte', available: false })
  const missing = availability({ itemId: randomUUID(), available: false })
  const res = await api.push(token, [slug, missing])
  expect(res.results).toEqual([
    { id: slug.id, result: 'flagged', reason: 'unknown_item', flags: [] },
    { id: missing.id, result: 'flagged', reason: 'unknown_item', flags: [] },
  ])
  expect(res.held).toBe(0)
})

test('Review Focus 6 (API half): an admin change then a later till event: the till wins (receive order)', async () => {
  const { token } = await seedDevice(db.sql)
  await db.sql`update menu_items set is_available = false where id = ${menu.latteId}`
  // The till toggled it off hours ago while offline; admin set it available since; the till's event arrives last.
  await db.sql`update menu_items set is_available = true where id = ${menu.latteId}`
  const oldToggle = availability({ itemId: menu.latteId, available: false }, { occurredAt: '2026-11-20T20:00:00.000Z' })
  expect(results(await api.push(token, [oldToggle]))).toEqual(['applied'])
  const [row] = await db.sql`select is_available from menu_items where id = ${menu.latteId}`
  expect(row!.is_available).toBe(false)
  await db.sql`update menu_items set is_available = true where id = ${menu.latteId}`
})

test('an invalid payload is held invalid: …; the rest of the push still applies', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const bad = shiftOpened({ openingFloatCentavos: -1 })
  const good = shiftOpened()
  const move = cashMoved({ shiftId: good.payload.shiftId })
  const res = await api.push(token, [bad, good, move])
  expect(res.results.map((r) => r.result)).toEqual(['held', 'applied', 'applied'])
  expect(res.results[0]!.reason).toMatch(/^invalid: openingFloatCentavos: /)
  expect(res.held).toBe(1)
  expect(await count('shifts', deviceId)).toBe(1)
  const [row] = await db.sql`select payload, result from sync_events where device_id = ${deviceId} and id = ${bad.id}`
  expect(row).toEqual({ payload: bad.payload, result: 'held' })
})

test('a null payload is held invalid and its receipt keeps a JSON null; a missing one is a 400', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const { payload: _drop, ...missing } = shiftOpened()
  expect((await api.post(token, { events: [missing] })).status).toBe(400)
  const bare = { ...shiftOpened(), payload: null }
  const res = await api.push(token, [bare])
  expect(res.results[0]).toMatchObject({ result: 'held', reason: expect.stringMatching(/^invalid: /) })
  const [row] = await db.sql`select payload, entity_keys from sync_events where device_id = ${deviceId} and id = ${bare.id}`
  expect(row).toEqual({ payload: null, entity_keys: [] })
  // Still held after the next push retries it.
  expect((await api.push(token, [availability({ itemId: menu.latteId, available: true })])).held).toBe(1)
})

test('a payload that breaks a table check is held invalid with the database message', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  // Passes zod (a positive integer) but not the int column: the savepoint rolls back, the push goes on.
  const huge = cashMoved({ shiftId: open.payload.shiftId, amountCentavos: 3_000_000_000 })
  const after = cashMoved({ shiftId: randomUUID() })
  const res = await api.push(token, [open, huge, after])
  expect(res.results.map((r) => r.result)).toEqual(['applied', 'held', 'held'])
  expect(res.results[1]!.reason).toMatch(/^invalid: .*out of range/)
  expect(res.results[2]!.reason).toBe('shift_unknown')
  expect(await count('cash_moves', deviceId)).toBe(0)
  expect(await count('sync_events', deviceId)).toBe(3)
})

test('an unknown staffId is applied, stored null, reason unknown_staff', async () => {
  const { token } = await seedDevice(db.sql)
  const ghost = randomUUID()
  const open = shiftOpened({}, { staffId: ghost })
  const move = cashMoved({ shiftId: open.payload.shiftId }, { staffId: ghost })
  const res = await api.push(token, [open, move])
  expect(res.results.map((r) => [r.result, r.reason])).toEqual([
    ['applied', 'unknown_staff'],
    ['applied', 'unknown_staff'],
  ])
  const [shift] = await db.sql`select opened_by_staff from shifts where id = ${open.payload.shiftId}`
  expect(shift!.opened_by_staff).toBeNull()
  const [m] = await db.sql`select staff_id from cash_moves where id = ${move.payload.id}`
  expect(m!.staff_id).toBeNull()
})

test('order kinds are held not_supported for now', async () => {
  const { token } = await seedDevice(db.sql)
  const e = {
    id: randomUUID(),
    seq: 1,
    kind: 'order.prep_status',
    occurredAt: '2026-11-21T01:00:00.000Z',
    staffId: null,
    payload: { orderId: randomUUID(), to: 'preparing' },
  }
  const res = await api.push(token, [e])
  expect(res.results[0]).toMatchObject({ result: 'held', reason: 'not_supported' })
})

test('51 events, a bad envelope or an empty list → 400 INVALID; Cache-Control: no-store on success', async () => {
  const { token } = await seedDevice(db.sql)
  const many = Array.from({ length: 51 }, () => availability({ itemId: menu.latteId, available: true }))
  const tooMany = await api.post(token, { events: many })
  expect(tooMany.status).toBe(400)
  expect(await tooMany.json()).toMatchObject({ code: 'INVALID' })

  expect((await api.post(token, { events: [] })).status).toBe(400)
  expect((await api.post(token, { events: [{ ...shiftOpened(), kind: 'shift.reopened' }] })).status).toBe(400)
  expect((await api.post(token, { events: [{ ...shiftOpened(), id: 'nope' }] })).status).toBe(400)
  expect((await api.post(token, { events: [{ ...shiftOpened(), seq: 0 }] })).status).toBe(400)
  const notJson = await api.app.request('/v1/sync/push', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: 'not json',
  })
  expect(notJson.status).toBe(400)

  const ok = await api.post(token, { events: many.slice(0, 50) })
  expect(ok.status).toBe(200)
  expect(ok.headers.get('Cache-Control')).toBe('no-store')
})

test('no token → 401; a revoked till → 401 DEVICE_REVOKED', async () => {
  const body = { events: [availability({ itemId: menu.latteId, available: true })] }
  const anon = await api.post(null, body)
  expect(anon.status).toBe(401)

  const { deviceId, token } = await seedDevice(db.sql)
  await db.sql`update devices set revoked_at = now(), token_hash = null where id = ${deviceId}`
  const revoked = await api.post(token, body)
  expect(revoked.status).toBe(401)
  expect(await revoked.json()).toMatchObject({ code: 'DEVICE_REVOKED' })
})

test('a NUL character in a payload string is held invalid; the push answers 200 and the rest applies', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const open = shiftOpened()
  const nul = cashMoved({ shiftId: open.payload.shiftId, reason: 'Ice\u0000' })
  const nulKey = { ...availability({ itemId: menu.latteId, available: true }), payload: { itemId: menu.latteId, available: true, ['x\u0000']: 1 } }
  const other = availability({ itemId: menu.latteId, available: true })
  // Same shift as the held NUL event: waits behind it (per-entity order).
  const sameShift = cashMoved({ shiftId: open.payload.shiftId, reason: 'Change' })
  const res = await api.post(token, { events: [open, nul, nulKey, other, sameShift] })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { results: { result: string; reason: string | null }[] }
  expect(body.results.map((r) => r.result)).toEqual(['applied', 'held', 'held', 'applied', 'held'])
  expect(body.results[4]!.reason).toBe('waits_for_earlier')
  expect(body.results[1]!.reason).toBe('invalid: reason: contains a NUL character')
  expect(body.results[2]!.reason).toMatch(/^invalid: .*NUL/)
  expect(await count('cash_moves', deviceId)).toBe(0)
  // The receipt keeps the payload as JSON text, the NUL escaped.
  const [row] = await db.sql`select payload from sync_events where device_id = ${deviceId} and id = ${nul.id}`
  expect(typeof row!.payload).toBe('string')
  expect(JSON.parse(row!.payload)).toEqual(nul.payload)
  // Resent: duplicate. Retried on a later push: still held, never applied.
  const again = await api.push(token, [nul, availability({ itemId: menu.latteId, available: true })])
  expect(again.results[0]!.result).toBe('duplicate')
  expect(again.held).toBe(3)
})

test('an occurredAt Postgres cannot store, or a non-uuid staffId, is held invalid; the push answers 200', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  const year0 = shiftOpened({}, { occurredAt: '0000-01-01T00:00:00Z' })
  const feb31 = shiftOpened({}, { occurredAt: '2026-02-31T00:00:00Z' })
  const nulTime = shiftOpened({}, { occurredAt: '2026-11-21T00:00:00Z\u0000' })
  const words = shiftOpened({}, { occurredAt: 'yesterday' })
  const badStaff = { ...shiftOpened(), staffId: 'bea\u0000' }
  const good = shiftOpened()
  const res = await api.post(token, { events: [year0, feb31, nulTime, words, badStaff, good] })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { results: { result: string; reason: string | null }[] }
  expect(body.results.map((r) => r.result)).toEqual(['held', 'held', 'held', 'held', 'held', 'applied'])
  for (const r of body.results.slice(0, 4)) expect(r.reason).toMatch(/^invalid: occurredAt: /)
  expect(body.results[4]!.reason).toMatch(/^invalid: staffId: /)
  const rows = await db.sql`select id, occurred_at, staff_id, result from sync_events where device_id = ${deviceId} order by seq`
  expect(rows).toHaveLength(6)
  // A time that cannot be stored is recorded as the receive time.
  expect(rows[0]!.occurred_at.toISOString()).toBe(api.now().toISOString())
  expect(rows[4]!.staff_id).toBeNull()
  expect(await count('shifts', deviceId)).toBe(1)
})

test('a retryable database error (serialization, timeout, connection) fails the push instead of holding', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  await db.sql.unsafe(`
    create function test_boom() returns trigger language plpgsql as $$
    begin
      if new.reason = 'boom' then raise exception 'could not serialize' using errcode = '40001'; end if;
      return new;
    end $$;
    create trigger test_boom before insert on cash_moves for each row execute function test_boom();`)
  try {
    const open = shiftOpened()
    const boom = cashMoved({ shiftId: open.payload.shiftId, reason: 'boom' })
    const res = await api.post(token, { events: [open, boom] })
    expect(res.status).toBe(500)
    // Nothing from that push was kept: the till sends it again.
    expect(await count('sync_events', deviceId)).toBe(0)
    expect(await count('shifts', deviceId)).toBe(0)
  } finally {
    await db.sql.unsafe('drop trigger test_boom on cash_moves; drop function test_boom();')
  }
})

test('isRetryable: SQLSTATE classes 40, 57 and 08 and postgres.js connection errors', async () => {
  const { isRetryable } = await import('../src/sync/push.js')
  for (const code of ['40001', '40P01', '57014', '57P01', '08006', 'CONNECTION_CLOSED', 'CONNECT_TIMEOUT']) {
    expect(isRetryable({ code })).toBe(true)
  }
  for (const code of ['23505', '22003', '22P02', undefined]) expect(isRetryable({ code })).toBe(false)
  expect(isRetryable(new Error('plain'))).toBe(false)
})

test('if Postgres refuses a receipt, the event rolls back and a fallback receipt is held invalid: receipt', async () => {
  const { deviceId, token } = await seedDevice(db.sql)
  await db.sql.unsafe(`
    create function test_refuse() returns trigger language plpgsql as $$
    begin
      if new.seq = 424242 and new.result <> 'held' then raise exception 'refused'; end if;
      return new;
    end $$;
    create trigger test_refuse before insert on sync_events for each row execute function test_refuse();`)
  try {
    const off = availability({ itemId: menu.latteId, available: false }, { seq: 424242 })
    const open = shiftOpened()
    const res = await api.post(token, { events: [off, open] })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { results: { result: string; reason: string | null }[] }
    expect(body.results.map((r) => [r.result, r.reason])).toEqual([
      ['held', 'invalid: receipt'],
      ['applied', null],
    ])
    const [item] = await db.sql`select is_available from menu_items where id = ${menu.latteId}`
    expect(item!.is_available).toBe(true)
    const [row] = await db.sql`select result, payload from sync_events where device_id = ${deviceId} and id = ${off.id}`
    expect(row!.result).toBe('held')
    expect(JSON.parse(row!.payload)).toEqual(off.payload)
  } finally {
    await db.sql.unsafe('drop trigger test_refuse on sync_events; drop function test_refuse();')
  }
})
