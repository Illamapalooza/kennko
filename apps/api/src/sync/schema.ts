import { MAX_LINES, MAX_PUSH_EVENTS, MAX_QUANTITY, normalisePublicCode, NOTE_MAX, type CounterOrderPayload, type SyncEvent, type SyncEventKind } from '@kennko/core'
import { z } from 'zod'

const KINDS = [
  'order.created',
  'order.prep_status',
  'order.cancelled',
  'shift.opened',
  'shift.closed',
  'cash.moved',
  'menu.availability',
  'customer.linked',
  'customer.unlinked',
  'stamp.added',
  'reward.used',
] as const satisfies readonly SyncEventKind[]

/**
 * The outer shape of every pushed event. A failure here refuses the whole push (400), so it checks
 * only what a receipt cannot be written without: id, seq and kind. A bad `occurredAt` or `staffId`
 * holds that one event as `invalid: …` instead (see `parseEvent`), so it can never block the till.
 */
export const envelopeSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().min(1),
  kind: z.enum(KINDS),
  occurredAt: z.string(),
  staffId: z.string().nullable(),
  payload: z.unknown(),
})
export type Envelope = z.infer<typeof envelopeSchema>

export const pushBodySchema = z.object({ events: z.array(envelopeSchema).min(1).max(MAX_PUSH_EVENTS) })

type PayloadOf<K extends SyncEventKind> = Extract<SyncEvent, { kind: K }>['payload']

const centavos = z.number().int().min(0)

/** `YYYY-MM-DD` naming a real calendar day, year 2000 or later. */
export function realDay(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number) as [number, number, number]
  return y >= 2000 && new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d
}

/** Postgres `int`: a bigger number would be refused by the table, so it is held invalid instead. */
export const PG_INT_MAX = 2_147_483_647
export const orderCentavos = centavos.max(PG_INT_MAX)
/** Text columns with no table limit still get one, well above anything the till produces. */
export const NAME_MAX = 120

export const pricedLineShape = z.object({
  menuItemId: z.string().min(1).max(NAME_MAX),
  name: z.string().min(1).max(NAME_MAX),
  // REG: food's one variant (Cookies, Empanada, Fries), sold at the till.
  size: z.enum(['M', 'L', 'XL', 'HOT', 'REG']),
  basePriceCentavos: orderCentavos,
  modifiers: z
    .array(z.object({ id: z.string().min(1).max(NAME_MAX), name: z.string().max(NAME_MAX), priceCentavos: orderCentavos }))
    .max(20),
  quantity: z.number().int().min(1).max(MAX_QUANTITY),
  iceLevel: z.enum(['regular', 'less', 'none']).nullable(),
  iceServe: z.enum(['mixed', 'side']).nullable(),
  note: z.string().max(NOTE_MAX),
  lineTotalCentavos: orderCentavos,
  // The free drink (Ruling 11): base 0, add-ons charged, at most one per order with quantity 1.
  reward: z.literal(true).optional(),
})

const pricedLine = pricedLineShape
  // order_lines_ice_shape: no preference, "none" with no serve, or a level with a serve.
  .refine(
    (l) => (l.iceLevel === null || l.iceLevel === 'none' ? l.iceServe === null : l.iceServe !== null),
    { path: ['iceServe'], message: 'does not match iceLevel' },
  )

export const orderCreatedPayload = z.object({
  orderId: z.uuid(),
  shiftId: z.uuid(),
  businessDay: z.iso
    .date()
    .refine(realDay, 'expected a real day, year 2000 or later'),
  ticketNumber: z.number().int().min(1).max(PG_INT_MAX),
  fulfilment: z.enum(['dine_in', 'takeout']),
  customerName: z.string().max(80),
  menuVersion: z.number().int().min(1).nullable(),
  lines: z.array(pricedLine).min(1).max(MAX_LINES),
  discount: z
    .object({ label: z.string().max(80), kind: z.enum(['percent', 'amount']), value: z.number().int().min(0).max(PG_INT_MAX) })
    .nullable(),
  subtotalCentavos: orderCentavos,
  discountCentavos: orderCentavos,
  totalCentavos: orderCentavos,
  payment: z.object({
    id: z.uuid(),
    method: z.enum(['cash', 'gcash']),
    tenderedCentavos: orderCentavos.nullable(),
    changeCentavos: orderCentavos.nullable(),
    reference: z.string().max(NAME_MAX).nullable(),
  }),
}).refine(
  (p) => {
    const rewards = p.lines.filter((l) => l.reward)
    return rewards.length <= 1 && rewards.every((l) => l.quantity === 1)
  },
  { path: ['lines'], message: 'reward' },
) satisfies z.ZodType<CounterOrderPayload>

export const prepStatusPayload = z.object({
  orderId: z.uuid(),
  to: z.enum(['placed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled']),
}) satisfies z.ZodType<PayloadOf<'order.prep_status'>>

export const cancelledPayload = z.object({
  orderId: z.uuid(),
  reason: z.string().max(200),
}) satisfies z.ZodType<PayloadOf<'order.cancelled'>>

export const shiftOpenedPayload = z.object({
  shiftId: z.uuid(),
  openingFloatCentavos: centavos,
}) satisfies z.ZodType<PayloadOf<'shift.opened'>>

export const shiftClosedPayload = z.object({
  shiftId: z.uuid(),
  countedCentavos: centavos,
  // Float minus cash out can go below zero.
  expectedCentavos: z.number().int(),
  note: z.string().max(200),
}) satisfies z.ZodType<PayloadOf<'shift.closed'>>

export const cashMovedPayload = z.object({
  id: z.uuid(),
  shiftId: z.uuid(),
  kind: z.enum(['in', 'out']),
  amountCentavos: z.number().int().min(1),
  reason: z.string().min(1).max(80),
}) satisfies z.ZodType<PayloadOf<'cash.moved'>>

export const availabilityPayload = z.object({
  // The built-in menu uses slugs, so any non-empty string is accepted; unknown ids are flagged.
  itemId: z.string().min(1),
  available: z.boolean(),
}) satisfies z.ZodType<PayloadOf<'menu.availability'>>

export const customerLinkedPayload = z.object({
  orderId: z.uuid(),
  // The till refuses a bad check symbol before writing (Ruling 19), so one arriving here is held invalid.
  publicCode: z
    .string()
    .max(20)
    .refine((code) => normalisePublicCode(code) !== null, 'expected a Kennko card code with a valid check symbol'),
}) satisfies z.ZodType<PayloadOf<'customer.linked'>>
export const customerUnlinkedPayload = z.object({ orderId: z.uuid() }) satisfies z.ZodType<PayloadOf<'customer.unlinked'>>
export const stampAddedPayload = z.object({ orderId: z.uuid(), stampId: z.uuid() }) satisfies z.ZodType<PayloadOf<'stamp.added'>>
export const rewardUsedPayload = z.object({ claimId: z.uuid(), orderId: z.uuid() }) satisfies z.ZodType<PayloadOf<'reward.used'>>

export const payloadSchemas: { [K in SyncEventKind]: z.ZodType<PayloadOf<K>> } = {
  'order.created': orderCreatedPayload,
  'order.prep_status': prepStatusPayload,
  'order.cancelled': cancelledPayload,
  'shift.opened': shiftOpenedPayload,
  'shift.closed': shiftClosedPayload,
  'cash.moved': cashMovedPayload,
  'menu.availability': availabilityPayload,
  'customer.linked': customerLinkedPayload,
  'customer.unlinked': customerUnlinkedPayload,
  'stamp.added': stampAddedPayload,
  'reward.used': rewardUsedPayload,
}

const isoDateTime = z.iso.datetime({ offset: true })
const uuid = z.uuid()

/**
 * `occurredAt` when Postgres can store it as given: an ISO date-time with an offset, a real calendar
 * day, year 2000 or later. Otherwise null.
 */
export function storableTime(value: string): string | null {
  if (!isoDateTime.safeParse(value).success) return null
  const [y, m, d] = value.slice(0, 10).split('-').map(Number) as [number, number, number]
  if (y < 2000 || new Date(Date.UTC(y, m - 1, d)).getUTCDate() !== d) return null
  return Number.isNaN(Date.parse(value)) ? null : value
}

/** The path of the first string or key holding U+0000 (jsonb and text columns reject it), or null. */
export function findNul(value: unknown, path: string[] = []): string[] | null {
  if (typeof value === 'string') return value.includes('\u0000') ? path : null
  if (value === null || typeof value !== 'object') return null
  for (const [k, v] of Object.entries(value)) {
    if (k.includes('\u0000')) return [...path, k.replaceAll('\u0000', '\\u0000')]
    const found = findNul(v, [...path, k])
    if (found) return found
  }
  return null
}

/** Text safe to keep in a reason: U+0000 written as `\\u0000`, at most `max` characters. */
export function clip(text: string, max = 200): string {
  const safe = text.replaceAll('\u0000', '\\u0000')
  return safe.length > max ? `${safe.slice(0, max - 1)}…` : safe
}

const invalid = (path: (string | number | symbol)[], message: string) =>
  ({ ok: false, reason: `invalid: ${path.length > 0 ? `${path.map(String).join('.')}: ` : ''}${message}` }) as const

/** A typed event, or the first problem with it as `invalid: <path>: <message>`. */
export function parseEvent(env: Envelope): { ok: true; event: SyncEvent } | { ok: false; reason: string } {
  if (storableTime(env.occurredAt) === null) {
    return invalid(['occurredAt'], `expected an ISO date-time with an offset, year 2000 or later, got "${clip(env.occurredAt, 60)}"`)
  }
  if (env.staffId !== null && !uuid.safeParse(env.staffId).success) return invalid(['staffId'], 'expected a uuid or null')
  const nul = findNul(env.payload)
  if (nul) return invalid(nul, 'contains a NUL character')
  const parsed = payloadSchemas[env.kind].safeParse(env.payload)
  if (parsed.success) return { ok: true, event: { ...env, payload: parsed.data } as SyncEvent }
  const issue = parsed.error.issues[0]!
  return invalid(issue.path, issue.message)
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g

/** The value with every unpaired surrogate in a string or key replaced by U+FFFD (jsonb rejects them). */
export function scrubSurrogates(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(LONE_SURROGATE, '\ufffd')
  if (Array.isArray(value)) return value.map(scrubSurrogates)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k.replace(LONE_SURROGATE, '\ufffd'), scrubSurrogates(v)]))
  }
  return value
}
