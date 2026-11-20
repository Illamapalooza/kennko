import type { AppDeps } from '../create-app.js'
import { heldCount, retryHeld, withDeviceLock } from '../sync/push.js'

export type ActionResult = { ok: true } | { ok: false; status: 404 | 409; code: string; message: string }

const OK: ActionResult = { ok: true }
const fail = (status: 404 | 409, code: string, message: string): ActionResult => ({ ok: false, status, code, message })
const NOT_FOUND = fail(404, 'NOT_FOUND', 'Not found')

/**
 * Sets a held receipt aside (`discard`) or marks a flagged one as looked at (`seen`). Either is an
 * update, never a delete (Ruling 1). Then the device's held events are retried once, under the same
 * lock, so whatever the receipt was blocking applies now, even for a till that will never push again.
 */
export async function resolveEvent(
  deps: AppDeps,
  input: { deviceId: string; eventId: string; action: 'discard' | 'seen'; note: string; staffId: string },
): Promise<ActionResult> {
  const { deviceId, eventId, action, note, staffId } = input
  const now = deps.now()
  return withDeviceLock(deps, deviceId, async (tx, notes) => {
    const [row] = await tx<{ result: string; resolved_at: Date | null }[]>`
      select result, resolved_at from sync_events where device_id = ${deviceId} and id = ${eventId}`
    if (!row) return NOT_FOUND
    if (row.resolved_at !== null) return fail(409, 'NOT_OPEN', 'This receipt was already dealt with.')
    if (action === 'discard') {
      if (row.result !== 'held') return fail(409, 'NOT_HELD', 'Only a held receipt can be set aside.')
      await tx`
        update sync_events set result = 'discarded', resolved_at = ${now}, resolved_by = ${staffId}, resolve_note = ${note}
        where device_id = ${deviceId} and id = ${eventId}`
    } else {
      if (row.result !== 'flagged') return fail(409, 'NOT_FLAGGED', 'Only a flagged receipt can be marked seen.')
      await tx`
        update sync_events set resolved_at = ${now}, resolved_by = ${staffId}, resolve_note = ${note}
        where device_id = ${deviceId} and id = ${eventId}`
    }
    await retryHeld(tx, deviceId, now, notes)
    return OK
  })
}

/** Retries a device's held events now, under its lock. `held` is what is still held afterwards. */
export async function retryDevice(
  deps: AppDeps,
  deviceId: string,
): Promise<{ ok: true; held: number } | Extract<ActionResult, { ok: false }>> {
  const now = deps.now()
  return withDeviceLock(deps, deviceId, async (tx, notes) => {
    const [device] = await tx`select 1 from devices where id = ${deviceId}`
    if (!device) return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Not found' } as const
    await retryHeld(tx, deviceId, now, notes)
    return { ok: true, held: await heldCount(tx, deviceId) } as const
  })
}

/**
 * Closes a stuck open shift from admin (Ruling 3): a counted amount and a note, the owner as closer,
 * `expected_centavos` left null. Then that till's held events (a newer shift held `another_shift_open`
 * and the sales behind it) are retried under the same lock.
 */
export async function closeShift(
  deps: AppDeps,
  input: { shiftId: string; countedCentavos: number; note: string; staffId: string },
): Promise<ActionResult> {
  const { shiftId, countedCentavos, note, staffId } = input
  const now = deps.now()
  const [shift] = await deps.sql<{ device_id: string }[]>`select device_id from shifts where id = ${shiftId}`
  if (!shift) return NOT_FOUND
  return withDeviceLock(deps, shift.device_id, async (tx, notes) => {
    const [row] = await tx`
      update shifts set closed_at = ${now}, closed_by_staff = ${staffId}, counted_centavos = ${countedCentavos},
        note = ${note}, closed_in_admin = true, updated_at = ${now}
      where id = ${shiftId} and closed_at is null
      returning id`
    if (!row) return fail(409, 'ALREADY_CLOSED', 'This shift is already closed.')
    await retryHeld(tx, shift.device_id, now, notes)
    return OK
  })
}

/** Marks that the owner has looked at an order's flags. An order flagged only `legacy` never needs it (Ruling 6). */
export async function markOrderSeen(deps: AppDeps, input: { orderId: string; staffId: string }): Promise<ActionResult> {
  const now = deps.now()
  return deps.sql.begin(async (tx) => {
    const [order] = await tx<{ flags: string[]; flags_seen_at: Date | null }[]>`
      select flags, flags_seen_at from orders where id = ${input.orderId} for update`
    if (!order) return NOT_FOUND
    if (!order.flags.some((f) => f !== 'legacy')) return fail(409, 'NOT_FLAGGED', 'This order has nothing to look at.')
    if (order.flags_seen_at !== null) return fail(409, 'NOT_OPEN', 'This order was already marked seen.')
    await tx`update orders set flags_seen_at = ${now}, flags_seen_by = ${input.staffId} where id = ${input.orderId}`
    return OK
  }) as Promise<ActionResult>
}
