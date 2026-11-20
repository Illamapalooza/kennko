import { MAX_PUSH_EVENTS, type CounterOrderPayload, type SyncEvent, type SyncEventKind } from '@kennko/core'
import { z } from 'zod'

const KINDS = [
  'order.created',
  'order.prep_status',
  'order.cancelled',
  'shift.opened',
  'shift.closed',
  'cash.moved',
  'menu.availability',
] as const satisfies readonly SyncEventKind[]

/** The outer shape of every pushed event. A failure here refuses the whole push (400). */
export const envelopeSchema = z.object({
  id: z.uuid(),
  seq: z.number().int().min(1),
  kind: z.enum(KINDS),
  occurredAt: z.iso.datetime({ offset: true }),
  staffId: z.uuid().nullable(),
  payload: z.unknown(),
})
export type Envelope = z.infer<typeof envelopeSchema>

export const pushBodySchema = z.object({ events: z.array(envelopeSchema).min(1).max(MAX_PUSH_EVENTS) })

type PayloadOf<K extends SyncEventKind> = Extract<SyncEvent, { kind: K }>['payload']

const centavos = z.number().int().min(0)

const pricedLine = z.object({
  menuItemId: z.string().min(1),
  name: z.string().min(1),
  size: z.enum(['M', 'L', 'XL', 'HOT']),
  basePriceCentavos: centavos,
  modifiers: z.array(z.object({ id: z.string().min(1), name: z.string(), priceCentavos: centavos })),
  quantity: z.number().int().min(1),
  iceLevel: z.enum(['regular', 'less', 'none']).nullable(),
  iceServe: z.enum(['mixed', 'side']).nullable(),
  note: z.string(),
  lineTotalCentavos: centavos,
})

export const orderCreatedPayload = z.object({
  orderId: z.uuid(),
  shiftId: z.uuid(),
  businessDay: z.iso.date(),
  ticketNumber: z.number().int().min(1),
  fulfilment: z.enum(['dine_in', 'takeout']),
  customerName: z.string(),
  menuVersion: z.number().int().min(1).nullable(),
  lines: z.array(pricedLine).min(1),
  discount: z.object({ label: z.string(), kind: z.enum(['percent', 'amount']), value: z.number().int() }).nullable(),
  subtotalCentavos: centavos,
  discountCentavos: centavos,
  totalCentavos: centavos,
  payment: z.object({
    id: z.uuid(),
    method: z.enum(['cash', 'gcash']),
    tenderedCentavos: centavos.nullable(),
    changeCentavos: centavos.nullable(),
    reference: z.string().nullable(),
  }),
}) satisfies z.ZodType<CounterOrderPayload>

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

export const payloadSchemas: { [K in SyncEventKind]: z.ZodType<PayloadOf<K>> } = {
  'order.created': orderCreatedPayload,
  'order.prep_status': prepStatusPayload,
  'order.cancelled': cancelledPayload,
  'shift.opened': shiftOpenedPayload,
  'shift.closed': shiftClosedPayload,
  'cash.moved': cashMovedPayload,
  'menu.availability': availabilityPayload,
}

/** A typed event, or the first problem with its payload as `invalid: <path>: <message>`. */
export function parseEvent(env: Envelope): { ok: true; event: SyncEvent } | { ok: false; reason: string } {
  const parsed = payloadSchemas[env.kind].safeParse(env.payload)
  if (parsed.success) return { ok: true, event: { ...env, payload: parsed.data } as SyncEvent }
  const issue = parsed.error.issues[0]!
  const path = issue.path.join('.')
  return { ok: false, reason: `invalid: ${path ? `${path}: ` : ''}${issue.message}` }
}
