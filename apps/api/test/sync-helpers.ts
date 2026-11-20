import { randomUUID } from 'node:crypto'
import type { CounterOrderPayload, PushResponse, SyncEvent } from '@kennko/core'
import type postgres from 'postgres'
import { createApp } from '../src/create-app.js'
import { newDeviceToken, sha256Hex } from '../src/devices/tokens.js'
import { publishMenu } from '../src/menu/snapshot.js'
import { fakeProofs, inlineDefer } from './fakes.js'

/** A paired till: its id and the bearer token it sends. */
export async function seedDevice(sql: postgres.Sql, name = 'Front till'): Promise<{ deviceId: string; token: string }> {
  const token = newDeviceToken()
  const [row] = await sql<{ id: string }[]>`
    insert into devices (name, token_hash, paired_at) values (${name}, ${sha256Hex(token)}, now()) returning id`
  return { deviceId: row!.id, token }
}

/** A staff member with a website login (owners need one). Returns `staff.id`. */
export async function seedStaff(
  sql: postgres.Sql,
  over: { fullName?: string; role?: 'owner' | 'manager' | 'barista' } = {},
): Promise<string> {
  const userId = randomUUID()
  const email = `${userId.slice(0, 8)}@kennko.test`
  await sql`insert into auth.users (id, email, email_confirmed_at) values (${userId}, ${email}, now())`
  const [row] = await sql<{ id: string }[]>`
    insert into staff (user_id, email, full_name, role)
    values (${userId}, ${email}, ${over.fullName ?? 'Bea'}, ${over.role ?? 'barista'}) returning id`
  return row!.id
}

export type TwoVersions = {
  latteId: string
  latteMId: string
  oatId: string
  groupId: string
  v1: number
  v2: number
}

/** v1: latte M ₱120 + oat ₱20 ("Milk of Choice"); v2: latte M ₱130. */
export async function publishTwoVersions(sql: postgres.Sql): Promise<TwoVersions> {
  const [cat] = await sql`insert into menu_categories (name, sort_order) values ('Coffee', 0) returning id`
  const [latte] = await sql`insert into menu_items (category_id, name) values (${cat!.id}, 'Latte') returning id`
  const [m] = await sql`insert into menu_variants (item_id, code, label, price_centavos, temperature)
    values (${latte!.id}, 'M', 'Medium', 12000, 'iced') returning id`
  const [group] = await sql`insert into option_groups (name) values ('Milk of Choice') returning id`
  const [oat] = await sql`insert into options (group_id, name, price_centavos) values (${group!.id}, 'Oat milk', 2000) returning id`
  await sql`insert into item_option_groups (item_id, group_id) values (${latte!.id}, ${group!.id})`
  const v1 = (await publishMenu(sql, null)).version
  await sql`update menu_variants set price_centavos = 13000 where id = ${m!.id}`
  const v2 = (await publishMenu(sql, null)).version
  return { latteId: latte!.id, latteMId: m!.id, oatId: oat!.id, groupId: group!.id, v1, v2 }
}

/** The till's view of time for a test file; `setNow` moves it. */
export function syncApp(sql: postgres.Sql, start = new Date('2026-11-21T02:00:00Z')) {
  let now = start
  const app = createApp({
    sql,
    verifyUser: async () => {
      throw new Error('no staff tokens in sync tests')
    },
    proofs: fakeProofs(),
    push: null,
    defer: inlineDefer,
    now: () => now,
  })
  const post = (token: string | null, body: unknown) =>
    app.request('/v1/sync/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  return {
    app,
    post,
    /** Pushes and expects 200. */
    async push(token: string, events: unknown[]): Promise<PushResponse> {
      const res = await post(token, { events })
      if (res.status !== 200) throw new Error(`push answered ${res.status}: ${await res.text()}`)
      return (await res.json()) as PushResponse
    },
    setNow(d: Date) {
      now = d
    },
    now: () => now,
  }
}

let seq = 0
let clock = Date.parse('2026-11-21T01:00:00Z')

type Envelope<K extends SyncEvent['kind']> = Extract<SyncEvent, { kind: K }>
type EnvelopeOver = Partial<Pick<SyncEvent, 'id' | 'seq' | 'occurredAt' | 'staffId'>>

function envelope<K extends SyncEvent['kind']>(kind: K, payload: Envelope<K>['payload'], over: EnvelopeOver): Envelope<K> {
  seq += 1
  clock += 60_000
  return {
    id: randomUUID(),
    seq,
    occurredAt: new Date(clock).toISOString(),
    staffId: null,
    ...over,
    kind,
    payload,
  } as Envelope<K>
}

type P<K extends SyncEvent['kind']> = Envelope<K>['payload']

export const shiftOpened = (p: Partial<P<'shift.opened'>> = {}, over: EnvelopeOver = {}) =>
  envelope('shift.opened', { shiftId: randomUUID(), openingFloatCentavos: 100000, ...p }, over)

export const shiftClosed = (p: Partial<P<'shift.closed'>> & { shiftId: string }, over: EnvelopeOver = {}) =>
  envelope('shift.closed', { countedCentavos: 150000, expectedCentavos: 150000, note: '', ...p }, over)

export const cashMoved = (p: Partial<P<'cash.moved'>> & { shiftId: string }, over: EnvelopeOver = {}) =>
  envelope('cash.moved', { id: randomUUID(), kind: 'in', amountCentavos: 5000, reason: 'Change', ...p }, over)

export const availability = (p: P<'menu.availability'>, over: EnvelopeOver = {}) => envelope('menu.availability', p, over)

export const prepStatus = (p: P<'order.prep_status'>, over: EnvelopeOver = {}) => envelope('order.prep_status', p, over)

export const orderCancelled = (p: Partial<P<'order.cancelled'>> & { orderId: string }, over: EnvelopeOver = {}) =>
  envelope('order.cancelled', { reason: 'Wrong order', ...p }, over)

/** One latte M with oat at v1 prices (₱140 × 1), paid cash. Override anything. */
export const orderCreated = (p: Partial<CounterOrderPayload> & { shiftId: string }, over: EnvelopeOver = {}) =>
  envelope(
    'order.created',
    {
      orderId: randomUUID(),
      businessDay: '2026-11-21',
      ticketNumber: 1,
      fulfilment: 'dine_in',
      customerName: 'Walk-in',
      menuVersion: null,
      lines: [
        {
          menuItemId: 'latte',
          name: 'Latte',
          size: 'M',
          basePriceCentavos: 12000,
          modifiers: [{ id: 'oat', name: 'Oat milk', priceCentavos: 2000 }],
          quantity: 1,
          iceLevel: null,
          iceServe: null,
          note: '',
          lineTotalCentavos: 14000,
        },
      ],
      discount: null,
      subtotalCentavos: 14000,
      discountCentavos: 0,
      totalCentavos: 14000,
      payment: { id: randomUUID(), method: 'cash', tenderedCentavos: 20000, changeCentavos: 6000, reference: null },
      ...p,
    },
    over,
  )
