import { IMPORT_CHUNK_MAX, MAX_LINES, SIZE_LABELS, TILL_TO_PREP, type ImportChunk, type ImportResponse } from '@kennko/core'
import type postgres from 'postgres'
import { z } from 'zod'
import type { AppDeps } from '../create-app.js'
import { isRetryable } from './push.js'
import { findNul, NAME_MAX, orderCentavos, PG_INT_MAX, pricedLineShape, realDay, storableTime } from './schema.js'

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
})

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
})

const cashMoveSchema = z.object({
  id: z.uuid(),
  shiftId: z.string().max(NAME_MAX),
  kind: z.enum(['in', 'out']),
  amountCentavos: orderCentavos,
  reason: z.string().max(80),
  at: time,
  staffId: staffRef,
})

export const importChunkSchema = z
  .object({
    shifts: z.array(shiftSchema),
    orders: z.array(orderSchema),
    cashMoves: z.array(cashMoveSchema),
  })
  .refine((c) => c.shifts.length + c.orders.length + c.cashMoves.length <= IMPORT_CHUNK_MAX, {
    message: `at most ${IMPORT_CHUNK_MAX} rows in a chunk`,
  })
  .refine((c) => findNul(c) === null, { message: 'text contains a NUL character' }) satisfies z.ZodType<ImportChunk>

/** Thrown inside a row's savepoint to undo it and count the row as skipped. */
class Skip extends Error {}

type Outcome = 'inserted' | 'existing' | 'skipped'

/**
 * One row in its own savepoint. A row the tables refuse (SQLSTATE class 22 data exception or 23
 * integrity violation, e.g. totals that break `orders_total_math`) is skipped and counted: the till
 * retries a failed chunk unchanged, so one bad old row must never fail the whole chunk.
 */
async function row(tx: Tx, body: (sp: Tx) => Promise<Outcome>): Promise<Outcome> {
  try {
    return (await tx.savepoint(body)) as Outcome
  } catch (err) {
    if (err instanceof Skip) return 'skipped'
    const code = (err as { code?: unknown } | null)?.code
    if (!isRetryable(err) && typeof code === 'string' && /^(22|23)/.test(code)) return 'skipped'
    throw err
  }
}

/**
 * Imports the till's history from before it synced. One transaction under the same advisory lock as
 * push. Shifts first, then orders, then cash moves. Every insert is `on conflict do nothing`
 * (no target, so `shifts_one_open` is covered too), so running a chunk twice changes nothing.
 * Orders are stored as sent and never re-priced; no `order_events` rows are written.
 */
export async function importChunk(deps: AppDeps, deviceId: string, chunk: ImportChunk): Promise<ImportResponse> {
  const now = deps.now()
  const out: ImportResponse = { inserted: 0, existing: 0, skipped: 0 }
  const count = (o: Outcome) => void (out[o] += 1)

  await deps.sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${`sync:${deviceId}`}, 0))`

    // Staff the API does not know (older than the upgrade, or since removed) become null.
    const wanted = [
      ...new Set(
        [
          ...chunk.shifts.flatMap((s) => [s.openedByStaff, s.closedByStaff]),
          ...chunk.orders.map((o) => o.cancelledByStaff),
          ...chunk.cashMoves.map((m) => m.staffId),
        ].filter((id): id is string => id !== null && UUID.test(id)),
      ),
    ]
    const known = new Set(
      wanted.length === 0 ? [] : (await tx<{ id: string }[]>`select id from staff where id = any(${wanted}::uuid[])`).map((r) => r.id),
    )
    const staff = (id: string | null) => (id !== null && known.has(id) ? id : null)

    for (const s of chunk.shifts) {
      count(
        await row(tx, async (sp) => {
          const ins = await sp`
            insert into shifts (id, device_id, opened_at, opened_by_staff, opening_float_centavos, closed_at, closed_by_staff,
              counted_centavos, expected_centavos, note, is_legacy, received_at, updated_at)
            values (${s.id}, ${deviceId}, ${s.openedAt}, ${staff(s.openedByStaff)}, ${s.openingFloatCentavos}, ${s.closedAt},
              ${staff(s.closedByStaff)}, ${s.countedCentavos}, ${s.expectedCentavos}, ${s.note}, true, ${now}, ${now})
            on conflict do nothing returning id`
          return ins.length > 0 ? 'inserted' : 'existing'
        }),
      )
    }

    const shiftIds = new Set(
      (await tx<{ id: string }[]>`select id from shifts where id = any(${[...new Set(chunk.orders.map((o) => o.shiftId).filter((id): id is string => id !== null && UUID.test(id)))]}::uuid[])`).map((r) => r.id),
    )

    for (const o of chunk.orders) {
      count(
        await row(tx, async (sp) => {
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
              ${o.discountLabel}, null, null, '{legacy}'::text[], ${deviceId}, ${o.shiftId !== null && shiftIds.has(o.shiftId) ? o.shiftId : null}, null,
              ${o.voidedAt}, ${staff(o.cancelledByStaff)}, ${o.voidReason}, ${o.createdAt}, ${now}, ${now}
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
          if (paid.length === 0) throw new Skip()
          return 'inserted'
        }),
      )
    }

    for (const m of chunk.cashMoves) {
      count(
        await row(tx, async (sp) => {
          if (!UUID.test(m.shiftId)) throw new Skip()
          const [shift] = await sp`select 1 from shifts where id = ${m.shiftId}`
          if (!shift) throw new Skip()
          const ins = await sp`
            insert into cash_moves (id, shift_id, kind, amount_centavos, reason, at, staff_id, received_at)
            values (${m.id}, ${m.shiftId}, ${m.kind}, ${m.amountCentavos}, ${m.reason}, ${m.at}, ${staff(m.staffId)}, ${now})
            on conflict do nothing returning id`
          return ins.length > 0 ? 'inserted' : 'existing'
        }),
      )
    }
  })
  return out
}
