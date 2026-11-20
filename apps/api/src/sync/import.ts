import { createHash } from 'node:crypto'
import { IMPORT_CHUNK_MAX, MAX_LINES, SIZE_LABELS, TILL_TO_PREP, type ImportCashMove, type ImportOrder, type ImportResponse, type ImportShift } from '@kennko/core'
import type postgres from 'postgres'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { isRetryable, payloadJson } from './push.js'
import { clip, findNul, NAME_MAX, orderCentavos, PG_INT_MAX, pricedLineShape, realDay, storableTime } from './schema.js'

type Tx = postgres.TransactionSql

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const time = z.string().refine((v) => storableTime(v) !== null, 'expected an ISO date-time with an offset, year 2000 or later')
const staffRef = z.string().max(NAME_MAX).nullable()

const shiftSchema = z.object({
  id: z.uuid(),
  openedAt: time,
  openingFloatCentavos: orderCentavos,
  closedAt: time.nullable(),
  countedCentavos: orderCentavos.nullable(),
  expectedCentavos: z.number().int().min(-PG_INT_MAX).max(PG_INT_MAX).nullable(),
  note: z.string().max(200),
  openedByStaff: staffRef,
  closedByStaff: staffRef,
}) satisfies z.ZodType<ImportShift>

// The ice shape and arithmetic are left to the table checks: a row that fails one is skipped, never a failed chunk.
const orderSchema = z.object({
  id: z.uuid(),
  shiftId: z.string().max(NAME_MAX).nullable(),
  businessDay: z.iso.date().refine(realDay, 'expected a real day, year 2000 or later'),
  ticketNumber: z.number().int().min(1).max(PG_INT_MAX),
  fulfilment: z.enum(['dine_in', 'takeout']),
  customerName: z.string().max(80),
  status: z.enum(['queued', 'preparing', 'serving', 'done', 'voided']),
  lines: z.array(pricedLineShape).min(1).max(MAX_LINES),
  subtotalCentavos: orderCentavos,
  discountCentavos: orderCentavos,
  discountLabel: z.string().max(80).nullable(),
  totalCentavos: orderCentavos,
  payment: z.object({
    id: z.uuid(),
    method: z.enum(['cash', 'gcash']),
    tenderedCentavos: orderCentavos.nullable(),
    changeCentavos: orderCentavos.nullable(),
    reference: z.string().max(NAME_MAX).nullable(),
  }),
  createdAt: time,
  voidedAt: time.nullable(),
  voidReason: z.string().max(200).nullable(),
  cancelledByStaff: staffRef,
}) satisfies z.ZodType<ImportOrder>

const cashMoveSchema = z.object({
  id: z.uuid(),
  shiftId: z.string().max(NAME_MAX),
  kind: z.enum(['in', 'out']),
  amountCentavos: orderCentavos,
  reason: z.string().max(80),
  at: time,
  staffId: staffRef,
}) satisfies z.ZodType<ImportCashMove>

/**
 * Only the envelope is checked here (a 400): the three arrays and the row total. Each row is then
 * validated on its own, so one bad field can never stall the till's sync; a row the API cannot
 * store is kept as a held `invalid: legacy: …` receipt instead (Ruling P4-3).
 */
export const importChunkSchema = z
  .object({ shifts: z.array(z.unknown()), orders: z.array(z.unknown()), cashMoves: z.array(z.unknown()) })
  .refine((c) => c.shifts.length + c.orders.length + c.cashMoves.length <= IMPORT_CHUNK_MAX, {
    message: `at most ${IMPORT_CHUNK_MAX} rows in a chunk`,
  })
export type ImportEnvelope = z.infer<typeof importChunkSchema>

type KindOf = 'import.shift' | 'import.order' | 'import.cash_move'

/** Thrown inside a row's savepoint to undo it; the row is recorded as rejected for `why`. */
class Reject extends Error {}

type Outcome = 'inserted' | 'existing' | 'rejected'

const RECEIPT_TIME: Record<KindOf, string> = { 'import.shift': 'openedAt', 'import.order': 'createdAt', 'import.cash_move': 'at' }

/** A stable uuid for a row whose own id is not one, so a resend finds its receipt again. */
function stableId(kind: string, raw: unknown): string {
  const h = createHash('sha1').update(`${kind}:${JSON.stringify(raw) ?? ''}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Why a savepoint failed: the table check that refused the row, or the error text. */
function whyOf(err: unknown): string {
  const e = err as { constraint_name?: string; message?: string }
  return e.constraint_name ?? e.message ?? String(err)
}

/**
 * Keeps a row the API cannot store as a held `invalid: legacy: …` receipt (permanent, so push never
 * retries it, and with no entity keys, so it blocks nothing). Safe to send again: the receipt is
 * keyed (device_id, id) and written `on conflict do nothing`.
 */
async function recordRejected(tx: Tx, deviceId: string, kind: KindOf, raw: unknown, why: string, now: Date): Promise<Outcome> {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const id = typeof obj.id === 'string' && UUID.test(obj.id) ? obj.id : stableId(kind, raw)
  const t = obj[RECEIPT_TIME[kind]]
  const occurredAt = typeof t === 'string' ? (storableTime(t) ?? now) : now
  await tx`
    insert into sync_events (device_id, id, seq, kind, payload, staff_id, entity_keys, occurred_at, received_at, result, reason)
    values (${deviceId}, ${id}, 0, ${kind}, ${payloadJson(raw)}::text::jsonb, null, '{}'::text[], ${occurredAt}, ${now}, 'held',
      ${`invalid: legacy: ${clip(why, 150)}`})
    on conflict do nothing`
  return 'rejected'
}

/**
 * One row: validated alone, then stored in its own savepoint. A row that fails validation, a table
 * check (SQLSTATE class 22 or 23) or a rule below is recorded as rejected, never dropped; retryable
 * database errors rethrow so the till sends the chunk again.
 */
async function row<S extends z.ZodType>(
  tx: Tx,
  deviceId: string,
  kind: KindOf,
  schema: S,
  raw: unknown,
  now: Date,
  body: (sp: Tx, parsed: z.infer<S>) => Promise<Outcome>,
): Promise<Outcome> {
  const nul = findNul(raw)
  if (nul) return recordRejected(tx, deviceId, kind, raw, `${nul.join('.')}: contains a NUL character`, now)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    return recordRejected(tx, deviceId, kind, raw, `${issue.path.join('.')}: ${issue.message}`, now)
  }
  try {
    return (await tx.savepoint((sp) => body(sp, parsed.data))) as Outcome
  } catch (err) {
    const code = (err as { code?: unknown } | null)?.code
    if (err instanceof Reject || (!isRetryable(err) && typeof code === 'string' && /^(22|23)/.test(code))) {
      return recordRejected(tx, deviceId, kind, raw, whyOf(err), now)
    }
    throw err
  }
}

/**
 * Imports the till's history from before it synced. One transaction under the same advisory lock as
 * push. Shifts first, then orders, then cash moves. Every insert is `on conflict do nothing`
 * (no target, so `shifts_one_open` is covered too), so running a chunk twice changes nothing.
 * Orders are stored as sent and never re-priced; no `order_events` rows are written.
 */
export async function importChunk(deps: AppDeps, deviceId: string, chunk: ImportEnvelope): Promise<ImportResponse> {
  const now = deps.now()
  const out: ImportResponse = { inserted: 0, existing: 0, rejected: 0 }
  const count = (o: Outcome) => void (out[o] += 1)

  await deps.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`sync:${deviceId}`}, 0))`

    /** The staff id when the API knows that person (older ids, or people since removed, become null). */
    const staff = async (sp: Tx, id: string | null): Promise<string | null> => {
      if (id === null || !UUID.test(id)) return null
      const [r] = await sp<{ id: string }[]>`select id from staff where id = ${id}`
      return r ? r.id : null
    }
    /** The shift id when that shift is stored. */
    const shiftOf = async (sp: Tx, id: string | null): Promise<string | null> => {
      if (id === null || !UUID.test(id)) return null
      const [r] = await sp<{ id: string }[]>`select id from shifts where id = ${id}`
      return r ? r.id : null
    }

    for (const raw of chunk.shifts) {
      count(
        await row(tx, deviceId, 'import.shift', shiftSchema, raw, now, async (sp, s) => {
          const ins = await sp`
            insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos, closed_at, closed_by_staff,
              counted_centavos, expected_centavos, note, is_legacy, received_at, updated_at)
            values (${s.id}, ${deviceId}, ${s.openedAt}, ${await staff(sp, s.openedByStaff)}, ${s.openingFloatCentavos}, ${s.closedAt},
              ${await staff(sp, s.closedByStaff)}, ${s.countedCentavos}, ${s.expectedCentavos}, ${s.note}, true, ${now}, ${now})
            on conflict do nothing returning id`
          if (ins.length > 0) return 'inserted'
          // Already stored (a resend) is fine; a conflict with the device's other open shift is not.
          if (await shiftOf(sp, s.id)) return 'existing'
          throw new Reject('another shift is open on this till')
        }),
      )
    }

    for (const raw of chunk.orders) {
      count(
        await row(tx, deviceId, 'import.order', orderSchema, raw, now, async (sp, o) => {
          const voided = o.status === 'voided'
          const ins = await sp`
            insert into orders (
              id, channel, fulfilment, prep_status, payment_status, business_day, ticket_series, ticket_number,
              menu_version, customer_name, subtotal_centavos, discount_centavos, total_centavos,
              discount_label, discount_kind, discount_value, flags, device_id, shift_id, opened_by_staff,
              cancelled_at, cancelled_by_staff, cancel_reason, created_at, received_at, updated_at
            ) values (
              ${o.id}, 'counter', ${o.fulfilment}, ${TILL_TO_PREP[o.status]}, ${voided ? 'refunded' : 'paid'}, ${o.businessDay}, 'C',
              ${o.ticketNumber}, null, ${o.customerName}, ${o.subtotalCentavos}, ${o.discountCentavos}, ${o.totalCentavos},
              ${o.discountLabel}, null, null, '{legacy}'::text[], ${deviceId}, ${await shiftOf(sp, o.shiftId)}, null,
              ${o.voidedAt}, ${await staff(sp, o.cancelledByStaff)}, ${o.voidReason}, ${o.createdAt}, ${now}, ${now}
            ) on conflict do nothing returning id`
          if (ins.length === 0) return 'existing'

          for (const line of o.lines) {
            const [l] = await sp<{ id: string }[]>`
              insert into order_lines (order_id, item_id, variant_id, item_name, variant_code, variant_label, unit_price_centavos,
                quantity, line_total_centavos, ice_level, ice_serve, note, created_at)
              values (${o.id}, null, null, ${line.name}, ${line.size}, ${SIZE_LABELS[line.size]}, ${line.basePriceCentavos},
                ${line.quantity}, ${line.lineTotalCentavos}, ${line.iceLevel}, ${line.iceServe}, ${line.note}, ${o.createdAt})
              returning id`
            for (const m of line.modifiers) {
              await sp`
                insert into order_line_options (line_id, option_id, group_name, option_name, price_centavos)
                values (${l!.id}, null, '', ${m.name}, ${m.priceCentavos})`
            }
          }

          const pay = o.payment
          const paid = await sp`
            insert into payments (id, order_id, method, amount_centavos, tendered_centavos, change_centavos, reference,
              status, device_id, recorded_at)
            values (${pay.id}, ${o.id}, ${pay.method}, ${o.totalCentavos}, ${pay.tenderedCentavos}, ${pay.changeCentavos},
              ${pay.reference}, ${voided ? 'refunded' : 'recorded'}, ${deviceId}, ${o.createdAt})
            on conflict do nothing returning id`
          // The till's payment id is already on another order: the order cannot be stored whole, so none of it is.
          if (paid.length === 0) throw new Reject('payment id already used by another order')
          return 'inserted'
        }),
      )
    }

    for (const raw of chunk.cashMoves) {
      count(
        await row(tx, deviceId, 'import.cash_move', cashMoveSchema, raw, now, async (sp, m) => {
          if (!(await shiftOf(sp, m.shiftId))) throw new Reject('shift not stored')
          const ins = await sp`
            insert into cash_moves (id, shift_id, kind, amount_centavos, reason, at, staff_id, received_at)
            values (${m.id}, ${m.shiftId}, ${m.kind}, ${m.amountCentavos}, ${m.reason}, ${m.at}, ${await staff(sp, m.staffId)}, ${now})
            on conflict do nothing returning id`
          return ins.length > 0 ? 'inserted' : 'existing'
        }),
      )
    }
  })
  return out
}
