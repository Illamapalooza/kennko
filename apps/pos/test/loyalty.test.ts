import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, describe, expect, it } from 'vitest'
import { makePublicCode, type OnlineQueueOrder, type PullState, type SyncEvent, type TillCustomer } from '@kennko/core'
import { saveDevice } from '../server/device.ts'
import { chargeWithFreeDrink, deviceCall, lookupCustomer, FREE_DRINK_OFFLINE, RELEASE_WINDOW_MS } from '../server/kennko-api.ts'
import { builtInMenu } from '../server/menu.ts'
import { createPinDirectory } from '../server/pins.ts'
import { createSessions } from '../server/sessions.ts'
import { createStore, type NewOrder } from '../server/store.ts'
import { createSync } from '../server/sync.ts'

const T = Date.UTC(2026, 10, 21, 2, 0)
const API = 'https://api.kennko.test'
const TOKEN = 'kd_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
const ANA = '11111111-1111-4111-8111-111111111111'
const MGR = '33333333-3333-4333-8333-333333333333'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const TYPO = 'That code has a typo. Check it and try again.'
const menu = builtInMenu(0)
const latte = menu.categories[0]!.items.find((i) => i.name === 'Café Latte')!

let seed = 0
/** A valid bare code, different every call. */
const newCode = () => makePublicCode(() => (seed++ * 7 + 3) % 31)
const pretty = (bare: string) => `KC-${bare.slice(0, 3)}-${bare.slice(3, 6)}-${bare.slice(6, 9)}`
/** The same code with its first symbol changed: the check symbol catches it. */
const typo = (bare: string) => (bare[0] === '2' ? '3' : '2') + bare.slice(1)

const sale = (over: Partial<NewOrder> = {}): NewOrder => ({
  lines: [{ menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  type: 'takeout',
  payment: { method: 'cash', tenderedCentavos: 20000 },
  ...over,
})
const twoLines = (): NewOrder => sale({
  lines: [
    { menuItemId: latte.id, size: 'M', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' },
    { menuItemId: latte.id, size: 'L', modifierIds: [], quantity: 1, iceLevel: 'regular', iceServe: 'mixed', note: '' },
  ],
})

const made: string[] = []
const tempDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'kennko-loyalty-')); made.push(d); return d }
afterAll(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

const outbox = (store: ReturnType<typeof createStore>) =>
  store.db.prepare('select kind, entity_local_id, payload from outbox order by seq').all()
    .map((r: any) => ({ kind: r.kind, local: r.entity_local_id, payload: JSON.parse(r.payload) }))

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Call = { path: string; method: string; auth: string | null; body: any }
function fakeApi(answer: (path: string, body: any) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url))
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ path: u.pathname, method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('authorization'), body })
    return answer(u.pathname, body)
  }) as typeof fetch
  return { fn, calls }
}
const offlineFetch = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch

function till(opts: { paired?: boolean } = {}) {
  const dataDir = tempDir()
  if (opts.paired !== false) saveDevice(dataDir, { deviceId: 'd-1', name: 'Counter', token: TOKEN, pairedAt: T, revokedAt: null })
  const store = createStore(':memory:')
  store.startShift(0, T, ANA)
  return { dataDir, store }
}

const customer = (code: string, over: Partial<TillCustomer> = {}): TillCustomer =>
  ({ code: pretty(code), catName: null, stampMode: 'digital', stamps: 3, fullCards: 0, ...over })

describe('linking a customer on the till', () => {
  it('the check character catching typos: one symbol changed is refused before anything is saved', () => {
    const { store } = till()
    const order = store.createOrder(menu, sale(), T, ANA)
    const before = outbox(store).length
    expect(() => store.linkCustomer(order.id, typo(newCode()), T, ANA)).toThrow(TYPO)
    expect(outbox(store)).toHaveLength(before)
    expect(store.getOrder(order.id).customerCode).toBeNull()
    expect((store.db.prepare('select customer_code from orders where id = ?').get(order.id) as any).customer_code).toBeNull()
    // Creating a sale with a typo'd code saves no sale either.
    expect(() => store.createOrder(menu, { ...sale(), customerCode: typo(newCode()) }, T, ANA)).toThrow(TYPO)
    expect(outbox(store)).toHaveLength(before)
  })

  it('a sale with a customer sends order.created, then customer.linked with the order uuid and the bare code', () => {
    const { store } = till()
    const code = newCode()
    const order = store.createOrder(menu, { ...sale(), customerCode: pretty(code).toLowerCase() }, T + 1, ANA)
    expect(order.customerCode).toBe(pretty(code))
    expect(order.stamped).toBe(false)
    expect(order.freeDrink).toBe(false)
    const events = store.outboxEvents()
    expect(events.map((e) => e.kind)).toEqual(['shift.opened', 'order.created', 'customer.linked'])
    const created = events[1] as Extract<SyncEvent, { kind: 'order.created' }>
    expect(events[2]!.payload).toEqual({ orderId: created.payload.orderId, publicCode: code })
    expect(events[2]!.staffId).toBe(ANA)
  })

  it('links afterwards from Orders or History; a second link asks to remove the first', () => {
    const { store } = till()
    const order = store.createOrder(menu, sale(), T, ANA)
    const code = newCode()
    expect(store.linkCustomer(order.id, `kc ${code.slice(0, 4)} ${code.slice(4)}`, T + 1, ANA).customerCode).toBe(pretty(code))
    expect(() => store.linkCustomer(order.id, newCode(), T + 2, ANA)).toThrow('Remove the customer first.')
    expect(outbox(store).filter((r) => r.kind === 'customer.linked')).toEqual([{ kind: 'customer.linked', local: order.id, payload: { publicCode: code } }])
  })

  it('refuses a voided order and an order of a closed till', () => {
    const { store } = till()
    const voided = store.createOrder(menu, sale(), T, ANA)
    store.voidOrder(voided.id, 'wrong drink', T, ANA)
    expect(() => store.linkCustomer(voided.id, newCode(), T, ANA)).toThrow(/voided/)
    const done = store.createOrder(menu, sale(), T, ANA)
    for (let i = 0; i < 3; i++) store.advance(done.id, T, ANA)
    store.endShift(0, '', T, ANA)
    const before = outbox(store).length
    expect(() => store.linkCustomer(done.id, newCode(), T, ANA)).toThrow('That order belongs to a till that is already closed.')
    expect(outbox(store)).toHaveLength(before)
  })
})

describe('stamping a counter sale', () => {
  it('stamp.added carries the order uuid and a new stamp id; a second stamp is refused', () => {
    const { store } = till()
    const order = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    const stamped = store.stampOrder(order.id, T + 1, ANA)
    expect(stamped.stamped).toBe(true)
    expect(() => store.stampOrder(order.id, T + 2, ANA)).toThrow(/already stamped/i)
    const events = store.outboxEvents()
    const created = events.find((e) => e.kind === 'order.created') as Extract<SyncEvent, { kind: 'order.created' }>
    const stamp = events.filter((e) => e.kind === 'stamp.added')
    expect(stamp).toHaveLength(1)
    expect(stamp[0]!.payload).toEqual({ orderId: created.payload.orderId, stampId: expect.stringMatching(UUID) })
    expect((store.db.prepare('select stamp_uid from orders where id = ?').get(order.id) as any).stamp_uid)
      .toBe((stamp[0]!.payload as any).stampId)
  })

  it('needs a customer, refuses a voided order and a customer known to be on paper', () => {
    const { store } = till()
    const plain = store.createOrder(menu, sale(), T, ANA)
    expect(() => store.stampOrder(plain.id, T, ANA)).toThrow(/customer/i)
    const voided = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    store.voidOrder(voided.id, 'oops', T, ANA)
    expect(() => store.stampOrder(voided.id, T, ANA)).toThrow(/voided/)
    const paper = newCode()
    store.replaceCustomerCache([customer(paper, { stampMode: 'paper' })])
    const onPaper = store.createOrder(menu, { ...sale(), customerCode: paper }, T, ANA)
    const before = outbox(store).length
    expect(() => store.stampOrder(onPaper.id, T, ANA)).toThrow('On a paper card: stamp their paper card.')
    expect(outbox(store)).toHaveLength(before)
  })
})

describe('unlinking', () => {
  it('works while the shift is open and clears the code and the stamp; after closing it is refused with no outbox row', () => {
    const { store } = till()
    const order = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    store.stampOrder(order.id, T, ANA)
    const off = store.unlinkCustomer(order.id, T + 1, ANA)
    expect(off.customerCode).toBeNull()
    expect(off.stamped).toBe(false)
    const events = store.outboxEvents()
    expect(events.at(-1)!.kind).toBe('customer.unlinked')
    expect(events.at(-1)!.payload).toEqual({ orderId: (events.find((e) => e.kind === 'order.created')!.payload as any).orderId })
    // The stamp event made before the unlink still goes, with its own id.
    expect(events.filter((e) => e.kind === 'stamp.added')).toHaveLength(1)
    // The right customer can be linked and stamped again.
    store.linkCustomer(order.id, newCode(), T + 2, ANA)
    expect(store.stampOrder(order.id, T + 3, ANA).stamped).toBe(true)

    const other = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    for (const o of [order, other]) for (let i = 0; i < 3; i++) store.advance(o.id, T, ANA)
    store.endShift(0, '', T, ANA)
    const before = outbox(store).length
    expect(() => store.unlinkCustomer(other.id, T, ANA)).toThrow('That order belongs to a till that is already closed.')
    expect(outbox(store)).toHaveLength(before)
    expect(store.getOrder(other.id).customerCode).not.toBeNull()
  })

  it('refuses an order with no customer', () => {
    const { store } = till()
    const order = store.createOrder(menu, sale(), T, ANA)
    expect(() => store.unlinkCustomer(order.id, T, ANA)).toThrow(/no customer/i)
  })
})

describe('the free drink at charge', () => {
  const claimOk = (code: string) => fakeApi((p) => p === '/v1/stamp-cards/claim'
    ? json(200, { customer: customer(code, { stamps: 0, fullCards: 0 }) })
    : json(200, { released: true }))

  it('a reward line is refused without a claim', () => {
    const { store } = till()
    const input = sale()
    input.lines[0]!.reward = true
    expect(() => store.createOrder(menu, { ...input, customerCode: newCode() }, T, ANA)).toThrow('The free drink was not claimed.')
    expect(outbox(store).map((r) => r.kind)).toEqual(['shift.opened'])
  })

  it('claim 200: the order has a ₱0 base reward line, linked, with reward.used carrying the claim id', async () => {
    const { store, dataDir } = till()
    const code = newCode()
    const api = claimOk(code)
    const order = await chargeWithFreeDrink({
      store, menu, dataDir, apiUrl: API, fetchFn: api.fn, input: twoLines(), reward: { lineIndex: 1, code: pretty(code) },
      now: T, by: ANA, managerStaffId: MGR,
    })
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0]).toMatchObject({ path: '/v1/stamp-cards/claim', method: 'POST', auth: `Bearer ${TOKEN}` })
    expect(api.calls[0]!.body).toEqual({ claimId: expect.stringMatching(UUID), code, staffId: MGR })
    expect(order.lines[1]).toMatchObject({ reward: true, basePriceCentavos: 0, quantity: 1 })
    expect(order.lines[0]!.reward).toBeUndefined()
    expect(order.freeDrink).toBe(true)
    expect(order.customerCode).toBe(pretty(code))
    const events = store.outboxEvents()
    expect(events.map((e) => e.kind)).toEqual(['shift.opened', 'order.created', 'customer.linked', 'reward.used'])
    const orderId = (events[1]!.payload as any).orderId
    expect(events[3]!.payload).toEqual({ claimId: api.calls[0]!.body.claimId, orderId })
    expect((store.db.prepare('select reward_claim_id from orders where id = ?').get(order.id) as any).reward_claim_id).toBe(api.calls[0]!.body.claimId)
  })

  it('claim 409: nothing is saved, with the message for each refusal', async () => {
    for (const [code, message] of [
      ['NO_FREE_DRINK', 'No free drink waiting on this card.'],
      ['PAPER_CARD', 'On a paper card: use their paper card.'],
    ] as const) {
      const { store, dataDir } = till()
      const api = fakeApi(() => json(409, { code, message: 'server words' }))
      await expect(chargeWithFreeDrink({
        store, menu, dataDir, apiUrl: API, fetchFn: api.fn, input: sale(), reward: { lineIndex: 0, code: newCode() }, now: T, by: ANA, managerStaffId: MGR,
      })).rejects.toThrow(message)
      expect(outbox(store).map((r) => r.kind)).toEqual(['shift.opened'])
      expect(store.ordersForDay('2026-11-21')).toEqual([])
    }
  })

  it('offline: nothing is saved and staff are told to charge it normally', async () => {
    for (const fetchFn of [offlineFetch, fakeApi(() => new Response('<html>bad gateway</html>', { status: 502 })).fn]) {
      const { store, dataDir } = till()
      await expect(chargeWithFreeDrink({
        store, menu, dataDir, apiUrl: API, fetchFn, input: sale(), reward: { lineIndex: 0, code: newCode() }, now: T, by: ANA, managerStaffId: null,
      })).rejects.toThrow(FREE_DRINK_OFFLINE)
      expect(FREE_DRINK_OFFLINE).toBe('The free drink needs the internet. Charge it normally, or try again when online.')
      expect(store.ordersForDay('2026-11-21')).toEqual([])
    }
    // An unpaired till never calls out.
    const { store, dataDir } = till({ paired: false })
    const api = claimOk(newCode())
    await expect(chargeWithFreeDrink({
      store, menu, dataDir, apiUrl: API, fetchFn: api.fn, input: sale(), reward: { lineIndex: 0, code: newCode() }, now: T, by: ANA, managerStaffId: null,
    })).rejects.toThrow(FREE_DRINK_OFFLINE)
    expect(api.calls).toEqual([])
  })

  it('checks the order and the code before claiming: a typo or a short payment never reaches Kennko', async () => {
    const { store, dataDir } = till()
    const api = claimOk(newCode())
    const args = { store, menu, dataDir, apiUrl: API, fetchFn: api.fn, now: T, by: ANA, managerStaffId: null }
    await expect(chargeWithFreeDrink({ ...args, input: sale(), reward: { lineIndex: 0, code: typo(newCode()) } })).rejects.toThrow(TYPO)
    await expect(chargeWithFreeDrink({ ...args, input: sale({ payment: { method: 'cash', tenderedCentavos: 0 } }), reward: { lineIndex: 0, code: newCode() } }))
      .resolves.toBeTruthy() // a free latte M with no add-ons costs ₱0: cash 0 is enough
    await expect(chargeWithFreeDrink({ ...args, input: twoLines(), reward: { lineIndex: 1, code: newCode() } }))
      .resolves.toBeTruthy()
    const short = twoLines()
    short.payment = { method: 'cash', tenderedCentavos: 100 }
    const calls = api.calls.length
    await expect(chargeWithFreeDrink({ ...args, input: short, reward: { lineIndex: 1, code: newCode() } })).rejects.toThrow(/less than the total/)
    await expect(chargeWithFreeDrink({ ...args, input: sale(), reward: { lineIndex: 3, code: newCode() } })).rejects.toThrow(/free drink/i)
    expect(api.calls).toHaveLength(calls)
  })

  it('a sale that fails after the claim (the till closed in between) releases the claim once, then says why', async () => {
    const { store, dataDir } = till()
    const code = newCode()
    const api = fakeApi((p) => {
      if (p === '/v1/stamp-cards/claim') {
        store.endShift(0, '', T, ANA) // the till closes while the claim is on its way
        return json(200, { customer: customer(code) })
      }
      return json(200, { released: true })
    })
    await expect(chargeWithFreeDrink({
      store, menu, dataDir, apiUrl: API, fetchFn: api.fn, input: sale(), reward: { lineIndex: 0, code }, now: T, by: ANA, managerStaffId: MGR,
    })).rejects.toThrow('Open the till before taking orders.')
    const releases = api.calls.filter((c) => c.path === '/v1/stamp-cards/release')
    expect(releases).toHaveLength(1)
    expect(releases[0]!.body).toEqual({ claimId: api.calls[0]!.body.claimId })
    expect(outbox(store).some((r) => r.kind === 'order.created')).toBe(false)
  })
})

describe('deviceCall', () => {
  it('answers ok, refused, offline and revoked, and offline when unpaired', async () => {
    const { dataDir } = till()
    const call = (fetchFn: typeof fetch) => deviceCall(dataDir, API, '/v1/x', { method: 'GET' }, 1000, fetchFn)
    expect(await call(fakeApi(() => json(200, { a: 1 })).fn)).toEqual({ kind: 'ok', body: { a: 1 } })
    expect(await call(fakeApi(() => json(409, { code: 'NO_FREE_DRINK', message: 'none' })).fn))
      .toEqual({ kind: 'refused', status: 409, code: 'NO_FREE_DRINK', message: 'none' })
    expect(await call(offlineFetch)).toEqual({ kind: 'offline' })
    expect(await call(fakeApi(() => new Response('oops', { status: 503 })).fn)).toEqual({ kind: 'offline' })
    expect(await call(fakeApi(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' })).fn)).toEqual({ kind: 'revoked' })
    const slow = (async (_u: unknown, init?: RequestInit) => new Promise((_r, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as unknown as typeof fetch
    expect(await deviceCall(dataDir, API, '/v1/x', { method: 'GET' }, 20, slow)).toEqual({ kind: 'offline' })
    const unpaired = tempDir()
    const api = fakeApi(() => json(200, {}))
    expect(await deviceCall(unpaired, API, '/v1/x', { method: 'GET' }, 1000, api.fn)).toEqual({ kind: 'offline' })
    expect(await deviceCall(dataDir, '', '/v1/x', { method: 'GET' }, 1000, api.fn)).toEqual({ kind: 'offline' })
    expect(api.calls).toEqual([])
  })
})

describe('looking up a customer', () => {
  it('a typo is refused; online answers the customer and caches it; offline, an old API or 429 answers a note', async () => {
    const { store, dataDir } = till()
    const code = newCode()
    await expect(lookupCustomer(store, dataDir, API, typo(code), fakeApi(() => json(200, {})).fn)).rejects.toThrow(TYPO)

    const online = fakeApi(() => json(200, { ...customer(code), email: 'ana@x.test', points: 37 }))
    const found = await lookupCustomer(store, dataDir, API, pretty(code), online.fn)
    expect(online.calls[0]!.path).toBe(`/v1/customers/by-code/${code}`)
    expect(found).toEqual({ customer: customer(code) })
    expect(store.cachedCustomer(code)).toEqual(customer(code))
    expect(JSON.stringify(store.db.prepare('select * from customer_cache').all())).not.toMatch(/ana@x|37|email|points/)

    const other = newCode()
    expect(await lookupCustomer(store, dataDir, API, other, offlineFetch))
      .toEqual({ customer: null, code: pretty(other), note: 'Will confirm when back online' })
    expect(await lookupCustomer(store, dataDir, API, other, fakeApi(() => json(404, { code: 'NOT_FOUND', message: 'Not found.' })).fn))
      .toEqual({ customer: null, code: pretty(other), note: 'Will confirm when back online' })
    expect(await lookupCustomer(store, dataDir, API, other, fakeApi(() => json(429, { code: 'RATE_LIMITED', message: 'Too many lookups. Wait a minute.' })).fn))
      .toEqual({ customer: null, code: pretty(other), note: 'Too many lookups. Wait a minute.' })
    await expect(lookupCustomer(store, dataDir, API, other, fakeApi(() => json(404, { code: 'UNKNOWN_CUSTOMER', message: 'No Kennko card has that code.' })).fn))
      .rejects.toThrow('No Kennko card has that code.')
  })
})

const online = (over: Partial<OnlineQueueOrder> = {}): OnlineQueueOrder => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  businessDay: '2026-11-21',
  ticketNumber: 3,
  customerName: 'Ana Dela Cruz',
  fulfilment: 'pickup',
  fulfilAt: '2026-11-21T02:30:00.000Z',
  customerNote: null,
  prepStatus: 'ready',
  createdAt: '2026-11-21T01:50:00.000Z',
  updatedAt: '2026-11-21T01:52:00.000Z',
  lines: [{ name: 'Latte', size: 'M', quantity: 1, options: [], iceLevel: 'regular', iceServe: 'mixed', note: '' }],
  delivery: null,
  card: 'stamp',
  ...over,
})

describe('stamping an online order at pickup', () => {
  it('writes stamp.added with the server id and no local id; shows stamped; a second is refused', () => {
    const { store } = till()
    const o = online()
    store.replaceOnlineOrders([o])
    const out = store.stampOnline(o.id, T, ANA)
    expect(out.card).toBe('stamped')
    expect(store.onlineOrders()[0]!.card).toBe('stamped')
    const row = outbox(store).at(-1)!
    expect(row).toEqual({ kind: 'stamp.added', local: null, payload: { orderId: o.id, stampId: expect.stringMatching(UUID) } })
    expect(store.outboxEvents().at(-1)!.payload).toEqual(row.payload)
    expect(() => store.stampOnline(o.id, T, ANA)).toThrow(/already stamped/i)
    // A pull that has not heard of it yet keeps it stamped; one that has confirms it.
    store.replaceOnlineOrders([o])
    expect(store.onlineOrders()[0]!.card).toBe('stamped')
    store.replaceOnlineOrders([{ ...o, card: 'stamped' }])
    expect(store.onlineOrders()[0]!.card).toBe('stamped')
    expect(() => store.stampOnline(o.id, T, ANA)).toThrow(/already stamped/i)
  })

  it('refuses a paper card, an order with no card and an unknown order', () => {
    const { store } = till()
    store.replaceOnlineOrders([online({ card: 'paper' }), online({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', card: null })])
    const before = outbox(store).length
    expect(() => store.stampOnline('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', T, ANA)).toThrow('On a paper card: stamp their paper card.')
    expect(() => store.stampOnline('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', T, ANA)).toThrow(/no Kennko card/i)
    expect(() => store.stampOnline('cccccccc-cccc-4ccc-8ccc-cccccccccccc', T, ANA)).toThrow(/no longer on the till/)
    expect(outbox(store)).toHaveLength(before)
  })
})

describe('releasing a claim that did not make a sale (Ruling P7-3)', () => {
  const pending = (store: ReturnType<typeof createStore>) => store.pendingReleases().map((r) => r.claimId)
  function syncFor(t: ReturnType<typeof till>, release: (body: any) => Response, clock: { now: number }) {
    const sessions = createSessions(t.store.db, () => T)
    const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => t.store.staffCache() })
    const api = fakeApi((p, body) => {
      if (p === '/v1/stamp-cards/release') return release(body)
      if (p === '/v1/sync/push') return json(200, { results: body.events.map((e: any) => ({ id: e.id, result: 'applied', reason: null, flags: [] })), held: 0 })
      return json(200, { menu: null, soldOut: [], staff: [], shop: { name: 'K', address: 'B', phone: null } } satisfies PullState)
    })
    const sync = createSync({ store: t.store, sessions, pins, dataDir: t.dataDir, apiUrl: API, fetchFn: api.fn, now: () => clock.now, onChange: () => {} })
    return { sync, api }
  }

  it('a claim that times out queues a release with the same claimId; released:false is retried until released:true', async () => {
    const t = till()
    const slow = fakeApi((p) => p === '/v1/stamp-cards/claim' ? new Promise<Response>(() => {}) : json(200, { released: true }))
    const timedOut = (async (u: any, init?: RequestInit) => new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      void slow.fn(u, init).then(resolve)
    })) as unknown as typeof fetch
    let kicked = 0
    await expect(chargeWithFreeDrink({
      store: t.store, menu, dataDir: t.dataDir, apiUrl: API, fetchFn: timedOut, input: sale(), reward: { lineIndex: 0, code: newCode() },
      now: T, by: ANA, managerStaffId: null, claimWaitMs: 20, kick: () => { kicked++ },
    })).rejects.toThrow(FREE_DRINK_OFFLINE)
    const claimId = slow.calls[0]!.body.claimId
    expect(pending(t.store)).toEqual([claimId])
    expect(kicked).toBe(1)
    // No release raced the claim from the request itself.
    expect(slow.calls.filter((c) => c.path === '/v1/stamp-cards/release')).toEqual([])

    const clock = { now: T + 1000 }
    let answer = false
    const { sync, api } = syncFor(t, () => json(200, { released: answer }), clock)
    await sync.runOnce() // the claim has not committed yet: released:false, kept
    expect(pending(t.store)).toEqual([claimId])
    answer = true
    clock.now = T + 60_000
    await sync.runOnce()
    expect(pending(t.store)).toEqual([])
    expect(api.calls.filter((c) => c.path === '/v1/stamp-cards/release').map((c) => c.body)).toEqual([{ claimId }, { claimId }])
  })

  it('released:false is dropped once the claim attempt is older than the window; offline keeps it', async () => {
    const t = till()
    t.store.queueRelease('44444444-4444-4444-8444-444444444444', T)
    const clock = { now: T + 1000 }
    let release: () => Response = () => new Response('down', { status: 503 })
    const { sync } = syncFor(t, () => release(), clock)
    await sync.runOnce()
    expect(pending(t.store)).toHaveLength(1)
    release = () => json(200, { released: false })
    clock.now = T + RELEASE_WINDOW_MS - 1
    await sync.runOnce()
    expect(pending(t.store)).toHaveLength(1)
    clock.now = T + RELEASE_WINDOW_MS + 1
    await sync.runOnce()
    expect(pending(t.store)).toEqual([])
  })

  it('a sale that fails after a confirmed claim queues its release; a sale written under a claim never does', async () => {
    const t = till()
    const code = newCode()
    const api = fakeApi((p) => {
      if (p === '/v1/stamp-cards/claim') { t.store.endShift(0, '', T, ANA); return json(200, { customer: customer(code) }) }
      return json(200, { released: false }) // the immediate try is not definitive: it stays queued
    })
    await expect(chargeWithFreeDrink({
      store: t.store, menu, dataDir: t.dataDir, apiUrl: API, fetchFn: api.fn, input: sale(), reward: { lineIndex: 0, code }, now: T, by: ANA, managerStaffId: null,
    })).rejects.toThrow('Open the till before taking orders.')
    expect(pending(t.store)).toEqual([api.calls[0]!.body.claimId])

    const u = till()
    const ok = fakeApi(() => json(200, { customer: customer(code) }))
    const order = await chargeWithFreeDrink({
      store: u.store, menu, dataDir: u.dataDir, apiUrl: API, fetchFn: ok.fn, input: sale(), reward: { lineIndex: 0, code }, now: T, by: ANA, managerStaffId: null,
    })
    expect(order.freeDrink).toBe(true)
    expect(pending(u.store)).toEqual([])
    // Even asked to, the store never queues a claim a sale was written under.
    u.store.queueRelease(ok.calls[0]!.body.claimId, T)
    expect(pending(u.store)).toEqual([])
  })

  it('a refused release (not 400) is dropped and the queue moves on; a 429 or no answer keeps it', async () => {
    const t = till()
    const [gone, busy, next] = ['55555555-5555-4555-8555-555555555551', '55555555-5555-4555-8555-555555555552', '55555555-5555-4555-8555-555555555553']
    t.store.queueRelease(gone, T)
    t.store.queueRelease(busy, T + 1)
    t.store.queueRelease(next, T + 2)
    const clock = { now: T + 1000 }
    const answers: Record<string, () => Response> = {
      [gone]: () => json(404, { code: 'NOT_FOUND', message: 'Not found' }),
      [busy]: () => json(429, { code: 'RATE_LIMITED', message: 'Wait' }),
      [next]: () => json(200, { released: true }),
    }
    const { sync, api } = syncFor(t, (body) => answers[body.claimId]!(), clock)
    await sync.runOnce()
    // The 404 is dropped; the 429 stops the round with it and the rest kept.
    expect(pending(t.store)).toEqual([busy, next])
    answers[busy] = () => json(409, { code: 'CONFLICT', message: 'No' })
    await sync.runOnce()
    expect(pending(t.store)).toEqual([])
    expect(api.calls.filter((c) => c.path === '/v1/stamp-cards/release').map((c) => c.body.claimId)).toEqual([gone, busy, busy, next])
  })

  it('releases still go out when the website refuses the push, but not when it cannot be reached', async () => {
    const t = till()
    t.store.queueRelease('66666666-6666-4666-8666-666666666666', T)
    t.store.createOrder(menu, sale(), T, ANA) // something in the outbox
    let push: () => Response = () => json(400, { code: 'INVALID', message: 'Bad batch' })
    const sessions = createSessions(t.store.db, () => T)
    const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => t.store.staffCache() })
    const api = fakeApi((p) => {
      if (p === '/v1/stamp-cards/release') return json(200, { released: true })
      if (p === '/v1/sync/push') return push()
      return json(200, { menu: null, soldOut: [], staff: [], shop: { name: 'K', address: 'B', phone: null } } satisfies PullState)
    })
    const sync = createSync({ store: t.store, sessions, pins, dataDir: t.dataDir, apiUrl: API, fetchFn: api.fn, now: () => T + 1000, onChange: () => {} })
    push = () => new Response('down', { status: 503 })
    await sync.runOnce()
    expect(api.calls.filter((c) => c.path === '/v1/stamp-cards/release')).toEqual([])
    expect(pending(t.store)).toHaveLength(1)
    push = () => json(400, { code: 'INVALID', message: 'Bad batch' })
    await sync.runOnce()
    expect(api.calls.filter((c) => c.path === '/v1/stamp-cards/release')).toHaveLength(1)
    expect(pending(t.store)).toEqual([])
  })

  it('a refused claim queues nothing', async () => {
    const t = till()
    const api = fakeApi(() => json(409, { code: 'NO_FREE_DRINK', message: 'none' }))
    await expect(chargeWithFreeDrink({
      store: t.store, menu, dataDir: t.dataDir, apiUrl: API, fetchFn: api.fn, input: sale(), reward: { lineIndex: 0, code: newCode() }, now: T, by: ANA, managerStaffId: null,
    })).rejects.toThrow('No free drink waiting on this card.')
    expect(pending(t.store)).toEqual([])
  })
})

describe('stamp and unlink rules (Rulings P7-4, P7-5)', () => {
  it('stamping needs the order\'s till to be open', () => {
    const { store } = till()
    const order = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    for (let i = 0; i < 3; i++) store.advance(order.id, T, ANA)
    store.endShift(0, '', T, ANA)
    const before = outbox(store).length
    expect(() => store.stampOrder(order.id, T, ANA)).toThrow('That order belongs to a till that is already closed.')
    expect(outbox(store)).toHaveLength(before)
  })

  it('a voided order cannot be unlinked', () => {
    const { store } = till()
    const order = store.createOrder(menu, { ...sale(), customerCode: newCode() }, T, ANA)
    store.voidOrder(order.id, 'oops', T, ANA)
    const before = outbox(store).length
    expect(() => store.unlinkCustomer(order.id, T, ANA)).toThrow(/voided/)
    expect(outbox(store)).toHaveLength(before)
  })

  it('a sale whose only drink is the free one earns no stamp; with a paid drink too it does', async () => {
    const { store, dataDir } = till()
    const code = newCode()
    const ok = fakeApi(() => json(200, { customer: customer(code) }))
    const free = await chargeWithFreeDrink({ store, menu, dataDir, apiUrl: API, fetchFn: ok.fn, input: sale(), reward: { lineIndex: 0, code }, now: T, by: ANA, managerStaffId: null })
    expect(() => store.stampOrder(free.id, T, ANA)).toThrow('A free drink earns no stamp.')
    const mixed = await chargeWithFreeDrink({ store, menu, dataDir, apiUrl: API, fetchFn: ok.fn, input: twoLines(), reward: { lineIndex: 0, code }, now: T, by: ANA, managerStaffId: null })
    expect(store.stampOrder(mixed.id, T, ANA).stamped).toBe(true)
  })
})

describe('the customer cache', () => {
  function synced() {
    const t = till()
    const sessions = createSessions(t.store.db, () => T)
    const pins = createPinDirectory({ staffPin: '1234', managerPin: '0000', staff: () => t.store.staffCache() })
    let pull: () => Response = () => json(200, { menu: null, soldOut: [], staff: [], shop: { name: 'K', address: 'B', phone: null } } satisfies PullState)
    const api = fakeApi((p) => p === '/v1/sync/push' ? json(200, { results: [], held: 0 }) : pull())
    const sync = createSync({ store: t.store, sessions, pins, dataDir: t.dataDir, apiUrl: API, fetchFn: api.fn, now: () => T, onChange: () => {} })
    return { ...t, sync, setPull: (f: () => Response) => { pull = f } }
  }
  const state = (extra: Partial<PullState>): PullState =>
    ({ menu: null, soldOut: [], staff: [], shop: { name: 'K', address: 'B', phone: null }, ...extra })

  it('a pull with customers replaces it, keeping only the TillCustomer fields; a pull without the key keeps it', async () => {
    const { store, sync, setPull } = synced()
    const a = newCode()
    const b = newCode()
    store.replaceCustomerCache([customer(a)])
    setPull(() => json(200, state({ customers: [{ ...customer(b, { stamps: 5 }), points: 9, email: 'x@y.z' } as TillCustomer, { code: 'junk' } as any] })))
    await sync.runOnce()
    expect(store.cachedCustomer(a)).toBeNull()
    expect(store.cachedCustomer(b)).toEqual(customer(b, { stamps: 5 }))
    expect((store.db.prepare('select count(*) as n from customer_cache').get() as any).n).toBe(1)
    expect(JSON.stringify(store.db.prepare('select * from customer_cache').all())).not.toMatch(/points|email|x@y/)
    setPull(() => json(200, state({})))
    await sync.runOnce()
    expect(store.cachedCustomer(b)).toEqual(customer(b, { stamps: 5 }))
  })

  it('a revoke empties it', async () => {
    const { store, sync, setPull } = synced()
    const a = newCode()
    store.replaceCustomerCache([customer(a)])
    setPull(() => json(401, { code: 'DEVICE_REVOKED', message: 'gone' }))
    await sync.runOnce()
    expect(store.cachedCustomer(a)).toBeNull()
  })

  it('the backup snapshot has no customer_cache rows', () => {
    const { store } = till()
    store.replaceCustomerCache([customer(newCode())])
    const file = path.join(tempDir(), 'copy.db')
    store.snapshot(file)
    const copy = new DatabaseSync(file)
    try {
      expect((copy.prepare('select count(*) as n from customer_cache').get() as any).n).toBe(0)
    } finally {
      copy.close()
    }
  })
})
