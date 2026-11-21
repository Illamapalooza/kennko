import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { BACKOFF_MS, KICK_DEBOUNCE_MS, SYNC_EVERY_MS, makePublicCode, type MenuSnapshot, type OnlineQueueOrder, type PullState, type PushResult, type SyncEvent } from '@kennko/core'
import { hashStaffPin } from '@kennko/core/staff-pin'
import { forgetConnection, loadDevice, saveDevice } from '../server/device.ts'
import { builtInMenu, loadSnapshot, saveSnapshot } from '../server/menu.ts'
import { createPinDirectory, type CachedStaff } from '../server/pins.ts'
import { createSessions } from '../server/sessions.ts'
import { createStore, type NewOrder } from '../server/store.ts'
import { clockSkew, createSync, nextDelay, syncReady, type SyncChange } from '../server/sync.ts'
import { bounded } from '../server/wait.ts'

const T = Date.UTC(2026, 10, 21, 2, 0) // on a whole second, like an HTTP Date header
const API = 'https://api.kennko.test'
const TOKEN = 'kd_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const menu = builtInMenu(0)
const latte = menu.categories[0]!.items.find((i) => i.name === 'Café Latte')!
const sale: NewOrder = {
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 20000 },
}

const made: string[] = []
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-sync-')); made.push(dir); return dir }
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }) })

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

const snapshot = (version: number): MenuSnapshot => ({
  version,
  publishedAt: '2026-11-20T00:00:00.000Z',
  categories: [{
    id: 'c-1', name: 'Coffee', kind: 'drink',
    items: [{
      id: 'i-1', name: 'Latte', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: [],
      variants: [{ id: 'v-1', code: 'M', label: 'Medium', priceCentavos: 14000, temperature: 'iced', isAvailable: true }],
    }],
  }],
  optionGroups: [],
  discountPresets: [],
})

const SHOP = { name: 'Kennko Coffee', address: 'Butuan City', phone: null }

type Call = { url: string; method: string; auth: string | null; body: any }

/** A fake Kennko API: records each request; push and pull answers can be swapped per test. */
function fakeApi() {
  const calls: Call[] = []
  let push: (events: SyncEvent[]) => Response | Promise<Response> = (events) =>
    json(200, { results: events.map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 })
  let pull: (version: string | null) => Response | Promise<Response> = () => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP } satisfies PullState)
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const auth = new Headers(init?.headers).get('authorization')
    calls.push({ url: String(url), method: init?.method ?? 'GET', auth, body })
    if (u.pathname === '/v1/sync/push') return push(body.events)
    if (u.pathname === '/v1/sync/pull') return pull(u.searchParams.get('version'))
    return json(404, { code: 'NOT_FOUND', message: 'no' })
  }) as typeof fetch
  return {
    fn, calls,
    pushes: () => calls.filter((c) => c.url.includes('/push')),
    pulls: () => calls.filter((c) => c.url.includes('/pull')),
    onPush(f: typeof push) { push = f },
    onPull(f: typeof pull) { pull = f },
  }
}

/** Timers the test fires by hand. */
function fakeTimers() {
  const pending = new Map<number, { fn: () => void; ms: number }>()
  let next = 0
  const set = ((fn: () => void, ms: number) => { const id = ++next; pending.set(id, { fn, ms }); return id }) as unknown as typeof setTimeout
  const clear = ((id: number) => { pending.delete(id) }) as unknown as typeof clearTimeout
  return {
    set, clear, pending,
    delays: () => [...pending.values()].map((p) => p.ms),
    fire() {
      const [[id, t]] = [...pending.entries()]
      pending.delete(id!)
      t!.fn()
    },
  }
}

function till(opts: { paired?: boolean; staff?: CachedStaff[] } = {}) {
  const dataDir = tempDir()
  if (opts.paired !== false) saveDevice(dataDir, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
  const store = createStore(':memory:')
  store.replaceStaffCache(opts.staff ?? [])
  const sessions = createSessions(store.db, () => T)
  const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => store.staffCache() })
  const api = fakeApi()
  const timers = fakeTimers()
  const changes: SyncChange[] = []
  let clock = T
  const sync = createSync({ store, sessions, pins, dataDir, apiUrl: `${API}/`, fetchFn: api.fn, now: () => clock, timers, onChange: (w) => changes.push(w) })
  return { dataDir, store, sessions, pins, api, timers, changes, sync, setClock: (t: number) => { clock = t } }
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)) }

describe('nextDelay and clockSkew', () => {
  it('waits SYNC_EVERY_MS after a success and backs off after failures', () => {
    expect(nextDelay(0)).toBe(SYNC_EVERY_MS)
    expect([1, 2, 3, 4, 5, 6, 50].map(nextDelay)).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000])
    expect(BACKOFF_MS[4]).toBe(300_000)
  })

  it('is the Date header minus the middle of the request, or null without one', () => {
    const ahead = new Response('', { headers: { date: new Date(T + 420_000).toUTCString() } })
    expect(clockSkew(ahead, T - 1000, T + 1000)).toBe(420_000)
    expect(clockSkew(new Response(''), T, T)).toBeNull()
    expect(clockSkew(new Response('', { headers: { date: 'not a date' } }), T, T)).toBeNull()
  })
})

describe('pushing the outbox', () => {
  it('sends 120 rows as 50, 50, 20 in seq order with the token, then pulls once; the outbox ends empty', async () => {
    const t = till()
    for (let i = 0; i < 120; i++) t.store.setAvailable(`item-${i}`, i % 2 === 0, T + i, null, { outbox: true })
    await t.sync.runOnce()
    const pushes = t.api.pushes()
    expect(pushes.map((p) => p.body.events.length)).toEqual([50, 50, 20])
    const seqs = pushes.flatMap((p) => p.body.events.map((e: SyncEvent) => e.seq))
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b))
    expect(new Set(seqs).size).toBe(120)
    for (const p of pushes) {
      expect(p.url).toBe(`${API}/v1/sync/push`)
      expect(p.method).toBe('POST')
      expect(p.auth).toBe(`Bearer ${TOKEN}`)
    }
    expect(t.api.pulls()).toHaveLength(1)
    expect(t.api.calls.at(-1)!.url).toContain('/v1/sync/pull')
    expect(t.api.pulls()[0]!.auth).toBe(`Bearer ${TOKEN}`)
    expect(t.store.pending()).toEqual({ sales: 0, events: 0 })
    expect(t.sync.status()).toMatchObject({ paired: true, revoked: false, offline: false, problem: null, lastSyncAt: T })
  })

  it('deletes rows answered held, flagged or duplicate too; held > 0 is not "still sending"', async () => {
    const t = till()
    for (let i = 0; i < 4; i++) t.store.setAvailable(`item-${i}`, false, T, null, { outbox: true })
    const kinds: PushResult[] = ['applied', 'held', 'flagged', 'duplicate']
    t.api.onPush((events) => json(200, { results: events.map((e, i) => ({ id: e.id, result: kinds[i], reason: null, flags: [] })), held: 7 }))
    await t.sync.runOnce()
    expect(t.api.pushes()).toHaveLength(1)
    expect(t.store.pending().events).toBe(0)
    expect(t.sync.status().offline).toBe(false)
  })

  it('stops pushing in a run when an answer acknowledges nothing', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    t.api.onPush(() => json(200, { results: [], held: 0 }))
    await t.sync.runOnce()
    expect(t.api.pushes()).toHaveLength(1)
    expect(t.store.pending().events).toBe(1)
  })

  it('Review Focus 4: a 503 deletes nothing, goes offline and backs off 15, 30, 60, 120, 300, 300 s; a success resets to 15 s', async () => {
    const t = till()
    t.store.startShift(0, T, null)
    t.store.createOrder(menu, sale, T, null)
    t.store.createOrder(menu, sale, T, null)
    t.api.onPush(() => new Response('down', { status: 503 }))
    t.sync.start()
    await settle()
    expect(t.store.pending()).toEqual({ sales: 2, events: 3 })
    expect(t.sync.status()).toMatchObject({ offline: true, pendingSales: 2, pendingEvents: 3 })
    expect(t.sync.status().problem).toEqual(expect.any(String))
    const waits: number[] = []
    for (let i = 0; i < 6; i++) {
      waits.push(...t.timers.delays())
      t.timers.fire()
      await settle()
    }
    expect(waits).toEqual([15_000, 30_000, 60_000, 120_000, 300_000, 300_000])
    t.api.onPush((events) => json(200, { results: events.map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 }))
    t.timers.fire()
    await settle()
    expect(t.timers.delays()).toEqual([15_000])
    expect(t.sync.status()).toMatchObject({ offline: false, problem: null, pendingSales: 0, pendingEvents: 0 })
    t.sync.stop()
    expect(t.timers.pending.size).toBe(0)
  })

  it('Review Focus 4: an answer lost after the server applied it is answered duplicate on the retry and still empties the outbox', async () => {
    const t = till()
    for (let i = 0; i < 3; i++) t.store.setAvailable(`item-${i}`, false, T, null, { outbox: true })
    const applied = new Set<string>()
    let lose = true
    t.api.onPush((events) => {
      const results = events.map((e) => ({ id: e.id, result: (applied.has(e.id) ? 'duplicate' : 'applied') as PushResult, reason: null, flags: [] }))
      for (const e of events) applied.add(e.id)
      if (lose) { lose = false; throw new TypeError('fetch failed') } // applied on the server, answer never arrives
      return json(200, { results, held: 0 })
    })
    await t.sync.runOnce()
    expect(t.store.pending().events).toBe(3)
    expect(t.sync.status().offline).toBe(true)
    await t.sync.runOnce()
    expect(t.store.pending().events).toBe(0)
    expect(t.sync.status().offline).toBe(false)
  })

  it('counts a timeout, a plain or HTML 5xx, a 408, a 429 and a non-API 401 as offline', async () => {
    for (const answer of [
      () => { throw new DOMException('timed out', 'TimeoutError') },
      () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
      () => new Response('An error occurred with your deployment\n\nFUNCTION_INVOCATION_FAILED', { status: 500 }),
      () => json(504, { error: 'timeout' }),
      () => json(408, { code: 'TIMEOUT', message: 'Request timed out' }),
      () => json(429, { code: 'TOO_MANY', message: 'Slow down' }),
      () => json(401, { code: 'SOMETHING_ELSE' }),
      () => new Response('<html>protected</html>', { status: 401 }),
    ]) {
      const t = till()
      t.store.setAvailable('x', false, T, null, { outbox: true })
      t.api.onPush(answer)
      await t.sync.runOnce()
      expect(t.store.pending().events).toBe(1)
      expect(t.sync.status()).toMatchObject({ offline: true, revoked: false })
      expect(loadDevice(t.dataDir)!.revokedAt).toBeNull()
    }
  })

  it("a 5xx with the API's { code, message } body is a sync problem, not offline; the batch is kept", async () => {
    for (const status of [500, 503]) {
      const t = till()
      t.store.setAvailable('x', false, T, null, { outbox: true })
      t.api.onPush(() => json(status, { code: 'INTERNAL', message: 'Something went wrong' }))
      await t.sync.runOnce()
      expect(t.store.pending().events).toBe(1)
      expect(t.sync.status()).toMatchObject({ offline: false, revoked: false, problem: 'Something went wrong' })
    }
  })

  it('acks only ids answered with a known result; an unknown result keeps its row', async () => {
    const t = till()
    for (let i = 0; i < 3; i++) t.store.setAvailable(`item-${i}`, false, T, null, { outbox: true })
    let firstPush = true
    t.api.onPush((events) => {
      const results = events.map((e, i) => ({ id: e.id, result: firstPush && i === 1 ? 'error' : 'applied', reason: null, flags: [] }))
      firstPush = false
      return json(200, { results, held: 0 })
    })
    const kept = t.store.outboxEvents()[1]!.id
    await t.sync.runOnce()
    // The first push acks two; the second push sends only the row answered 'error'.
    expect(t.api.pushes().map((p) => p.body.events.map((e: SyncEvent) => e.id))[1]).toEqual([kept])
    expect(t.store.pending().events).toBe(0)
    t.store.setAvailable('z', false, T, null, { outbox: true })
    t.api.onPush((events) => json(200, { results: events.map((e) => ({ id: e.id, result: 'error', reason: null, flags: [] })), held: 0 }))
    await t.sync.runOnce()
    expect(t.store.pending().events).toBe(1)
  })

  it('partial results: 30 of 50 acked leaves 20, which go in the next push; ids that were not sent are ignored', async () => {
    const t = till()
    for (let i = 0; i < 50; i++) t.store.setAvailable(`item-${i}`, false, T, null, { outbox: true })
    const all = t.store.outboxEvents().map((e) => e.id)
    let n = 0
    t.api.onPush((events) => {
      n++
      const answered = n === 1 ? events.slice(0, 30) : events
      const results = [...answered.map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })),
        { id: '99999999-9999-4999-8999-999999999999', result: 'applied', reason: null, flags: [] }]
      return json(200, { results, held: 0 })
    })
    await t.sync.runOnce()
    const pushes = t.api.pushes()
    expect(pushes.map((p) => p.body.events.length)).toEqual([50, 20])
    expect(pushes[1]!.body.events.map((e: SyncEvent) => e.id)).toEqual(all.slice(30))
    expect(t.store.pending().events).toBe(0)
  })

  it('an answer naming only ids that were not sent acks nothing and keeps the batch', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    t.api.onPush(() => json(200, { results: [{ id: '99999999-9999-4999-8999-999999999999', result: 'applied', reason: null, flags: [] }], held: 0 }))
    await t.sync.runOnce()
    expect(t.api.pushes()).toHaveLength(1)
    expect(t.store.pending().events).toBe(1)
  })

  it('P4-5: a 4xx on push keeps the batch and is a problem (the API message), not offline; backs off; logged once per message', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.api.onPush(() => json(400, { code: 'INVALID', message: 'Send 1 to 50 events (events.0.kind: Invalid)' }))
    t.sync.start()
    await settle()
    expect(t.store.pending().events).toBe(1)
    expect(t.sync.status()).toMatchObject({ offline: false, problem: 'Send 1 to 50 events (events.0.kind: Invalid)', lastSyncAt: null })
    expect(t.timers.delays()).toEqual([15_000])
    t.timers.fire()
    await settle()
    expect(t.timers.delays()).toEqual([30_000])
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Send 1 to 50 events'))).toHaveLength(1)
    t.api.onPush(() => json(413, { code: 'TOO_BIG', message: 'Too big' }))
    t.timers.fire()
    await settle()
    expect(t.sync.status().problem).toBe('Too big')
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('Too big'))).toHaveLength(1)
    expect(t.store.pending().events).toBe(1)
    t.sync.stop()
    warn.mockRestore()
  })

  it('P4-5: a 4xx on pull without a message falls back to the status, and is not offline', async () => {
    const t = till()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    t.api.onPull(() => new Response('forbidden', { status: 403 }))
    await t.sync.runOnce()
    expect(t.sync.status()).toMatchObject({ offline: false, problem: 'The website refused the request (403).' })
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.sync.status()).toMatchObject({ offline: false, problem: null, lastSyncAt: T })
    warn.mockRestore()
  })
})

describe('pulling', () => {
  it('saves a newer snapshot and says the menu changed; the next pull asks with its version', async () => {
    const t = till()
    t.api.onPull(() => json(200, { menu: { version: 3, snapshot: snapshot(3) }, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.api.pulls()[0]!.url).toBe(`${API}/v1/sync/pull`)
    expect(loadSnapshot(t.dataDir)).toEqual(snapshot(3))
    expect(t.changes.some((c) => c.menu)).toBe(true)
    expect(t.sync.status().menuVersion).toBe(3)
    await t.sync.runOnce()
    expect(t.api.pulls()[1]!.url).toBe(`${API}/v1/sync/pull?version=3`)
  })

  it('leaves the file alone when the snapshot is null', async () => {
    const t = till()
    saveSnapshot(t.dataDir, snapshot(5))
    const file = path.join(t.dataDir, 'menu-snapshot.json')
    const before = fs.statSync(file).mtimeMs
    const text = fs.readFileSync(file, 'utf8')
    t.api.onPull(() => json(200, { menu: { version: 5, snapshot: null }, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.api.pulls()[0]!.url).toBe(`${API}/v1/sync/pull?version=5`)
    expect(fs.readFileSync(file, 'utf8')).toBe(text)
    expect(fs.statSync(file).mtimeMs).toBe(before)
    expect(t.changes.some((c) => c.menu)).toBe(false)
  })

  it('treats an answer it cannot read as a failure and keeps everything', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: false })
    t.api.onPull(() => json(200, { menu: { version: 2, snapshot: { nope: true } }, soldOut: 'x', staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.sync.status().offline).toBe(true)
    expect(loadSnapshot(t.dataDir)).toBeNull()
    expect(t.store.soldOut()).toEqual(['x'])
  })

  it('Review Focus 6: an unsent sold-out mark survives a pull, stays after it is sent, and a server mark lands', async () => {
    const t = till()
    t.store.setAvailable('X', false, T, null, { outbox: true })
    t.api.onPush(() => new Response('down', { status: 503 }))
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.api.pulls()).toHaveLength(1)
    expect(t.store.soldOut()).toEqual(['X'])

    const server = new Set<string>()
    t.api.onPush((events) => {
      for (const e of events) if (e.kind === 'menu.availability') { if (e.payload.available) server.delete(e.payload.itemId); else server.add(e.payload.itemId) }
      return json(200, { results: events.map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 })
    })
    t.api.onPull(() => json(200, { menu: null, soldOut: [...server].sort(), staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.store.pending().events).toBe(0)
    expect(t.store.soldOut()).toEqual(['X'])

    server.add('Y')
    await t.sync.runOnce()
    expect(t.store.soldOut().sort()).toEqual(['X', 'Y'])
  })

  it('stores the shop details', async () => {
    const t = till()
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: { name: 'Kennko', address: 'J.C. Aquino Ave', phone: '0917' } }))
    await t.sync.runOnce()
    expect(JSON.parse(t.store.kvGet('shop')!)).toEqual({ name: 'Kennko', address: 'J.C. Aquino Ave', phone: '0917' })
  })

  it('updates the clock skew from every response', async () => {
    const t = till()
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP }, { date: new Date(T + 420_000).toUTCString() }))
    await t.sync.runOnce()
    expect(t.sync.status().clockSkewMs).toBe(420_000)
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.sync.status().clockSkewMs).toBeNull()
  })
})

describe('staff from the pull', () => {
  let bea: CachedStaff
  let ana: CachedStaff
  beforeAll(async () => {
    bea = { id: 'b-1', fullName: 'Bea', role: 'barista', pinHash: await hashStaffPin('111111') }
    ana = { id: 'm-1', fullName: 'Ana Cruz', role: 'manager', pinHash: await hashStaffPin('222222') }
  })

  it('replaces the cache and ends the sessions of people no longer listed', async () => {
    const t = till({ staff: [bea, ana] })
    const beaToken = t.sessions.start({ staffId: 'b-1', name: 'Bea', role: 'staff' })
    const anaToken = t.sessions.start({ staffId: 'm-1', name: 'Ana Cruz', role: 'manager' })
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [ana, { id: 'bad', fullName: 'X', role: 'owner', pinHash: 'plain' }], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.store.staffCache()).toEqual([ana])
    expect(t.sessions.get(beaToken)).toBeNull()
    expect(t.sessions.get(anaToken)).not.toBeNull()
    expect(t.changes.some((c) => c.staff)).toBe(true)
  })
})

describe('pairing state', () => {
  it('401 DEVICE_REVOKED marks device.json and later runs send nothing', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    t.setClock(T + 5000)
    t.api.onPush(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' }))
    await t.sync.runOnce()
    expect(loadDevice(t.dataDir)!.revokedAt).toBe(T + 5000)
    expect(t.sync.status()).toMatchObject({ paired: true, revoked: true })
    expect(t.changes.some((c) => c.status)).toBe(true)
    const sent = t.api.calls.length
    await t.sync.runOnce()
    expect(t.api.calls.length).toBe(sent)
    expect(t.store.pending().events).toBe(1) // the till keeps its record
  })

  it('401 UNAUTHENTICATED on the pull also counts as revoked', async () => {
    const t = till()
    t.api.onPull(() => json(401, { code: 'UNAUTHENTICATED', message: 'who?' }))
    await t.sync.runOnce()
    expect(loadDevice(t.dataDir)!.revokedAt).toBe(T)
  })

  it('an unpaired till fetches nothing', async () => {
    const t = till({ paired: false })
    t.store.setAvailable('x', false, T, null, { outbox: true })
    await t.sync.runOnce()
    expect(t.api.calls).toHaveLength(0)
    expect(t.sync.status()).toMatchObject({ paired: false, revoked: false, offline: false, pendingEvents: 1 })
  })
})

const W5: OnlineQueueOrder = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  businessDay: '2026-11-21',
  ticketNumber: 5,
  customerName: 'Jose Reyes',
  fulfilment: 'delivery',
  fulfilAt: '2026-11-21T02:30:00.000Z',
  customerNote: null,
  prepStatus: 'placed',
  createdAt: '2026-11-21T01:50:00.000Z',
  updatedAt: '2026-11-21T01:50:00.000Z',
  lines: [{ name: 'Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  delivery: { address: '12 Montilla Blvd', barangay: 'Libertad', phone: '09171234567' },
}
const BY = null
const withOnline = (onlineOrders: unknown) => () => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP, onlineOrders })

describe('online orders from the pull', () => {
  it('stores the pulled orders and says online changed; the same pull again says it did not', async () => {
    const t = till()
    t.api.onPull(withOnline([W5]))
    await t.sync.runOnce()
    expect(t.store.onlineOrders()).toEqual([W5])
    expect(t.changes.at(-1)).toMatchObject({ online: true })
    const seen = t.changes.length
    await t.sync.runOnce()
    expect(t.changes.slice(seen).every((c) => !c.online)).toBe(true)
  })

  it('Review Focus 4: a step taken while push is down survives a pull still saying placed, and is pushed first next run', async () => {
    const t = till()
    t.api.onPull(withOnline([W5]))
    await t.sync.runOnce()

    t.api.onPush(() => new Response('down', { status: 503 }))
    t.store.advanceOnline(W5.id, T + 1000, BY)
    await t.sync.runOnce()
    expect(t.sync.status().offline).toBe(true)
    expect(t.store.onlineOrders()[0]!.prepStatus).toBe('preparing')

    t.store.setAvailable('later', false, T + 2000, null, { outbox: true })
    t.api.onPush((events) => json(200, { results: events.map((e) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 }))
    const before = t.api.pushes().length
    await t.sync.runOnce()
    const events: SyncEvent[] = t.api.pushes().slice(before)[0]!.body.events
    expect(events[0]).toMatchObject({ kind: 'order.prep_status', payload: { orderId: W5.id, to: 'preparing' } })
    expect(events.slice(1).map((e) => e.kind)).toEqual(['menu.availability'])
  })

  it('a pull without onlineOrders leaves the table as it is (an API from before Plan 5)', async () => {
    const t = till()
    t.store.replaceOnlineOrders([W5])
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP }))
    await t.sync.runOnce()
    expect(t.store.onlineOrders()).toEqual([W5])
    expect(t.sync.status()).toMatchObject({ offline: false, problem: null })
  })

  it('a malformed list is a garbled pull: problem set, offline, nothing applied', async () => {
    const t = till()
    t.store.replaceOnlineOrders([W5])
    t.api.onPull(() => json(200, { menu: null, soldOut: ['x'], staff: [], shop: { name: 'Other', address: 'A', phone: null }, onlineOrders: [{ id: 'x' }] }))
    await t.sync.runOnce()
    expect(t.sync.status().problem).toEqual(expect.any(String))
    expect(t.sync.status().offline).toBe(true)
    expect(t.store.onlineOrders()).toEqual([W5])
    expect(t.store.soldOut()).toEqual([])
    expect(t.store.kvGet('shop')).toBeNull()
  })

  it('a list that is not an array, or repeats an id, is garbled too', async () => {
    for (const bad of ['W5', { 0: W5 }, [W5, W5]]) {
      const t = till()
      t.store.replaceOnlineOrders([W5])
      t.api.onPull(withOnline(bad))
      await t.sync.runOnce()
      expect(t.sync.status().offline).toBe(true)
      expect(t.store.onlineOrders()).toEqual([W5])
    }
  })

  it('an order no longer in the pull leaves the till', async () => {
    const t = till()
    t.api.onPull(withOnline([W5]))
    await t.sync.runOnce()
    t.api.onPull(withOnline([]))
    await t.sync.runOnce()
    expect(t.store.onlineOrders()).toEqual([])
    expect(t.changes.at(-1)).toMatchObject({ online: true })
  })

  it('Ruling 10: 401 DEVICE_REVOKED empties the online orders', async () => {
    const t = till()
    t.store.replaceOnlineOrders([W5])
    t.api.onPull(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' }))
    await t.sync.runOnce()
    expect(loadDevice(t.dataDir)!.revokedAt).toBe(T)
    expect(t.store.onlineOrders()).toEqual([])
  })
})

describe('customers from the pull (Plan 7)', () => {
  const ana = { code: 'KC-AAA-AAA-AAA', catName: null, stampMode: 'digital', stamps: 2, fullCards: 0 }
  it('a customers key that is not a list is a garbled pull and the cache is kept', async () => {
    const t = till()
    const code = makePublicCode(() => 4)
    t.store.replaceCustomerCache([{ ...ana, code } as any])
    t.api.onPull(() => json(200, { menu: null, soldOut: [], staff: [], shop: SHOP, customers: { 0: ana } }))
    await t.sync.runOnce()
    expect(t.sync.status().offline).toBe(true)
    expect(t.store.cachedCustomer(code)).toMatchObject({ stamps: 2 })
  })

  it('pushes stamp and link events with the uuids filled in', async () => {
    const t = till()
    t.store.startShift(0, T, null)
    const code = makePublicCode(() => 9)
    const order = t.store.createOrder(menu, { ...sale, customerCode: code }, T, null)
    t.store.stampOrder(order.id, T, null)
    await t.sync.runOnce()
    const events: SyncEvent[] = t.api.pushes()[0]!.body.events
    const orderId = (events[1]!.payload as any).orderId
    expect(events.slice(2)).toMatchObject([
      { kind: 'customer.linked', payload: { orderId, publicCode: code } },
      { kind: 'stamp.added', payload: { orderId, stampId: expect.any(String) } },
    ])
    expect(t.store.pending().events).toBe(0)
  })
})

describe('scheduling', () => {
  it('start runs at once and then every SYNC_EVERY_MS', async () => {
    const t = till()
    t.sync.start()
    await settle()
    expect(t.api.pulls()).toHaveLength(1)
    expect(t.timers.delays()).toEqual([SYNC_EVERY_MS])
    t.timers.fire()
    await settle()
    expect(t.api.pulls()).toHaveLength(2)
    t.sync.stop()
  })

  it('three kicks within 300 ms make one run', async () => {
    const t = till()
    t.sync.start()
    await settle()
    const before = t.api.pulls().length
    t.sync.kick(); t.sync.kick(); t.sync.kick()
    expect(t.timers.delays()).toEqual([KICK_DEBOUNCE_MS])
    t.timers.fire()
    await settle()
    expect(t.api.pulls().length).toBe(before + 1)
    expect(t.timers.delays()).toEqual([SYNC_EVERY_MS])
    t.sync.stop()
  })

  it('a kick during a run queues exactly one more run; runs never overlap', async () => {
    const t = till()
    let release!: () => void
    let inFlight = 0
    let most = 0
    let first = true
    t.api.onPull(async () => {
      inFlight++; most = Math.max(most, inFlight)
      if (first) { first = false; await new Promise<void>((r) => { release = r }) }
      inFlight--
      return json(200, { menu: null, soldOut: [], staff: [], shop: SHOP })
    })
    const run = t.sync.runOnce()
    await settle()
    t.sync.kick(); t.sync.kick()
    expect(t.timers.pending.size).toBe(0) // queued behind the run, not on a timer
    release()
    await run
    await settle()
    expect(t.api.pulls()).toHaveLength(2)
    expect(most).toBe(1)
    // runOnce during a run joins it: the caller's promise covers the one queued run too.
    first = true
    const a = t.sync.runOnce()
    await settle()
    const b = t.sync.runOnce()
    release()
    await Promise.all([a, b])
    expect(t.api.pulls()).toHaveLength(4)
    expect(most).toBe(1)
  })

  it('while failing, a kick never shortens the backoff wait', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    t.api.onPush(() => new Response('down', { status: 503 }))
    t.sync.start()
    await settle()
    expect(t.timers.delays()).toEqual([15_000])
    t.setClock(T + 1000)
    t.sync.kick()
    expect(t.timers.delays()).toEqual([14_000])
    t.setClock(T + 14_900)
    t.sync.kick()
    expect(t.timers.delays()).toEqual([KICK_DEBOUNCE_MS])
    t.sync.stop()
  })

  it('a kick during a failing run does not queue an immediate rerun', async () => {
    const t = till()
    t.store.setAvailable('x', false, T, null, { outbox: true })
    let release!: () => void
    t.api.onPush(async () => {
      await new Promise<void>((r) => { release = r })
      return new Response('down', { status: 503 })
    })
    t.sync.start()
    await settle()
    t.sync.kick()
    release()
    await settle()
    expect(t.api.pushes()).toHaveLength(1)
    expect(t.timers.delays()).toEqual([15_000])
    t.sync.stop()
  })

  it('never throws out of a run, whatever the store does', async () => {
    const t = till()
    vi.spyOn(t.store, 'outboxEvents').mockImplementation(() => { throw new Error('disk on fire') })
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(t.sync.runOnce()).resolves.toBeUndefined()
    expect(t.sync.status().offline).toBe(true)
    err.mockRestore()
  })
})

describe('menu snapshot file', () => {
  it('round-trips and refuses a file of the wrong shape', () => {
    const dir = tempDir()
    expect(loadSnapshot(dir)).toBeNull()
    saveSnapshot(dir, snapshot(4))
    expect(loadSnapshot(dir)).toEqual(snapshot(4))
    expect(fs.existsSync(path.join(dir, 'menu-snapshot.json.tmp'))).toBe(false)
    fs.writeFileSync(path.join(dir, 'menu-snapshot.json'), JSON.stringify({ version: 'x', categories: [] }))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadSnapshot(dir)).toBeNull()
    warn.mockRestore()
  })
})

describe('replaceSoldOut', () => {
  it('replaces the marks then replays unsent toggles in seq order', () => {
    const store = createStore(':memory:')
    store.setAvailable('A', false, T, null, { outbox: false })
    store.setAvailable('B', false, T, null, { outbox: true })
    store.setAvailable('C', false, T, null, { outbox: true })
    store.setAvailable('C', true, T, null, { outbox: true })
    store.setAvailable('D', true, T, null, { outbox: true })
    store.replaceSoldOut(['A', 'C', 'D', 'E'])
    expect(store.soldOut().sort()).toEqual(['A', 'B', 'E'])
  })

  it('skips an availability row whose payload does not parse', () => {
    const store = createStore(':memory:')
    store.setAvailable('B', false, T, null, { outbox: true })
    store.db.prepare("insert into outbox (id, kind, entity, entity_local_id, staff_id, occurred_at, payload) values ('bad-1', 'menu.availability', 'menu', null, null, ?, 'not json')").run(T)
    store.setAvailable('C', false, T, null, { outbox: true })
    store.replaceSoldOut(['A'])
    expect(store.soldOut().sort()).toEqual(['A', 'B', 'C'])
  })
})

describe('bounded (Ruling P4-7)', () => {
  it('is true when the work finishes in time, false when the wait runs out first', async () => {
    vi.useFakeTimers()
    try {
      let finish!: () => void
      const slow = new Promise<void>((r) => { finish = r })
      const late = bounded(slow, 5000)
      await vi.advanceTimersByTimeAsync(4999)
      let settled: boolean | null = null
      void late.then((v) => { settled = v })
      await vi.advanceTimersByTimeAsync(0)
      expect(settled).toBeNull()
      await vi.advanceTimersByTimeAsync(1)
      expect(await late).toBe(false)
      finish()
      expect(await bounded(Promise.resolve(), 5000)).toBe(true)
      expect(vi.getTimerCount()).toBe(0) // the timer is cleared once the work is done
    } finally { vi.useRealTimers() }
  })

  it('treats a rejection as done, never throws', async () => {
    expect(await bounded(Promise.reject(new Error('boom')), 1000)).toBe(true)
  })
})

describe('syncReady', () => {
  const device = { deviceId: 'd', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null }
  it('needs the website address, a pairing and no revocation', () => {
    expect(syncReady(device, API)).toBe(true)
    expect(syncReady(device, '  ')).toBe(false)
    expect(syncReady(null, API)).toBe(false)
    expect(syncReady({ ...device, revokedAt: T }, API)).toBe(false)
  })
})

describe('the wall check-in from the pull (Plan 8)', () => {
  const SECRET = 's'.repeat(43)
  const URL_ = 'https://kennko.vercel.app/here'
  const look = { coat: 'ginger', hat: 'beanie' }
  const mochi = { key: 'v-1', name: 'Mochi', look, endsAt: new Date(T + 3_600_000).toISOString() }
  const kape = { key: 'v-2', name: 'Kape', look: { coat: 'tabby' }, endsAt: new Date(T + 1_800_000).toISOString() }
  const base = { menu: null, soldOut: [], staff: [], shop: SHOP }

  it('a pull with checkin and visitors stores them, in pull order', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi, kape] }))
    await t.sync.runOnce()
    expect(t.sync.status().offline).toBe(false)
    expect(t.store.checkinConfig()).toEqual({ secret: SECRET, url: URL_ })
    expect(t.store.activeVisitors(T)).toEqual([mochi, kape])
  })

  it('a pull without the keys keeps both (an API from before Plan 8)', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi] }))
    await t.sync.runOnce()
    t.api.onPull(() => json(200, base))
    await t.sync.runOnce()
    expect(t.store.checkinConfig()).toEqual({ secret: SECRET, url: URL_ })
    expect(t.store.activeVisitors(T)).toEqual([mochi])
  })

  it('checkin null clears the secret; an empty visitors list clears the cats', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi] }))
    await t.sync.runOnce()
    t.api.onPull(() => json(200, { ...base, checkin: null, visitors: [] }))
    await t.sync.runOnce()
    expect(t.store.checkinConfig()).toBeNull()
    expect(t.store.activeVisitors(T)).toEqual([])
  })

  it('a malformed checkin or visitors garbles the pull and keeps what the till has', async () => {
    for (const bad of [
      { checkin: { secret: 'short', url: URL_ } },
      { checkin: { secret: SECRET, url: 'http://kennko.vercel.app/here' } },
      { checkin: { secret: SECRET } },
      { checkin: 'yes' },
      { visitors: { 0: mochi } },
    ]) {
      const t = till()
      t.store.setCheckin({ secret: SECRET, url: URL_ })
      t.api.onPull(() => json(200, { ...base, ...bad }))
      await t.sync.runOnce()
      expect(t.sync.status()).toMatchObject({ offline: true })
      expect(t.store.checkinConfig()).toEqual({ secret: SECRET, url: URL_ })
    }
  })

  it('a visitor that is not one is skipped, and at most 12 are kept', async () => {
    const t = till()
    const many = Array.from({ length: 14 }, (_, i) => ({ ...mochi, key: `v-${i}` }))
    t.api.onPull(() => json(200, { ...base, visitors: [{ ...mochi, key: 'bad', email: 'ana@x.ph' }, { ...mochi, key: 'bad2', endsAt: 'soon' }, ...many] }))
    await t.sync.runOnce()
    const kept = t.store.activeVisitors(T)
    expect(kept.map((v) => v.key)).toEqual(many.slice(0, 12).map((v) => v.key))
    expect(JSON.stringify(kept)).not.toContain('ana@x.ph')
  })

  it('visitors drop out by endsAt on the till alone, offline', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, visitors: [mochi, kape] }))
    await t.sync.runOnce()
    t.api.onPull(() => json(503, {}))
    await t.sync.runOnce()
    expect(t.sync.status().offline).toBe(true)
    expect(t.store.activeVisitors(T + 1_800_000).map((v) => v.key)).toEqual(['v-1'])
    expect(t.store.activeVisitors(T + 3_600_000)).toEqual([])
  })

  it('revoke clears the secret, the URL and the visitors', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi] }))
    await t.sync.runOnce()
    t.api.onPull(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' }))
    await t.sync.runOnce()
    expect(t.store.checkinConfig()).toBeNull()
    expect(t.store.kvGet('checkin_url')).toBeNull()
    expect(t.store.activeVisitors(T)).toEqual([])
  })

  it('forgetting the connection clears them too, with the device file', async () => {
    const t = till()
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi] }))
    await t.sync.runOnce()
    forgetConnection(t.store, t.dataDir)
    expect(loadDevice(t.dataDir)).toBeNull()
    expect(t.store.checkinConfig()).toBeNull()
    expect(t.store.activeVisitors(T)).toEqual([])
  })

  it('persists the skew from each answer that carried a Date, so a restart offline can still make the code', async () => {
    const t = till()
    t.api.onPull(() => json(200, base, { date: new Date(T + 90_000).toUTCString() }))
    await t.sync.runOnce()
    expect(t.store.kvGet('checkin_skew')).toBe('90000')
    t.api.onPull(() => json(200, base)) // no Date header: the last measured skew stays
    await t.sync.runOnce()
    expect(t.store.kvGet('checkin_skew')).toBe('90000')
  })

  it('never logs the secret, nor puts it in the sync status the tablets get', async () => {
    const t = till()
    const lines: string[] = []
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const)
      .map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { lines.push(a.map(String).join(' ')) }))
    t.api.onPull(() => json(200, { ...base, checkin: { secret: SECRET, url: URL_ }, visitors: [mochi] }))
    await t.sync.runOnce()
    t.api.onPull(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' }))
    await t.sync.runOnce()
    for (const s of spies) s.mockRestore()
    expect(lines.join('\n')).not.toContain(SECRET)
    expect(JSON.stringify(t.sync.status())).not.toContain(SECRET)
    expect(JSON.stringify(t.changes)).not.toContain(SECRET)
  })
})
