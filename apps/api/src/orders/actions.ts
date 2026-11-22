import { canMovePrep, type Fulfilment, type PrepStatus } from '@kennko/core'
import type postgres from 'postgres'
import type { AppDeps } from '../create-app.js'
import { creditOrderPoints } from '../loyalty/points.js'
import { afterCommit } from '../push/defer.js'
import { notifyOrder, PREP_PUSH_EVENTS } from '../push/notify.js'
import { onOrderCancelled } from '../sync/loyalty-events.js'

export type ActionResult =
  | { ok: true; prepStatus: PrepStatus; paymentStatus: string }
  | { ok: false; status: 404 | 409; code: string; errors: string[] }

type Tx = postgres.TransactionSql
type OrderState = { id: string; channel: string; fulfilment: Fulfilment; prep_status: PrepStatus; payment_status: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const fail = (status: 404 | 409, code: string, error: string): ActionResult => ({ ok: false, status, code, errors: [error] })
const notFound = () => fail(404, 'NOT_FOUND', 'Not found')
const badTransition = (error: string) => fail(409, 'BAD_TRANSITION', error)

/** Thrown inside a transaction to roll it back with a ready-made result. */
class Abort extends Error {
  constructor(readonly result: ActionResult) {
    super('aborted')
  }
}

async function transact(deps: AppDeps, fn: (tx: Tx) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return (await deps.sql.begin(fn)) as ActionResult
  } catch (e) {
    if (e instanceof Abort) return e.result
    // Deadlock or serialization failure: another action won the race. Tell the caller to refresh.
    const code = (e as { code?: unknown } | null)?.code
    if (code === '40P01' || code === '40001') {
      return fail(409, 'STATUS_CHANGED', 'This order was changed by someone else. Refresh and try again.')
    }
    throw e
  }
}

async function statusChanged(tx: Tx, orderId: string): Promise<ActionResult> {
  const [o] = await tx<{ prep_status: string; payment_status: string }[]>`
    select prep_status, payment_status from orders where id = ${orderId}`
  return fail(
    409,
    'STATUS_CHANGED',
    o
      ? `This order has changed: prep is ${o.prep_status}, payment is ${o.payment_status}. Refresh and try again.`
      : 'This order has changed. Refresh and try again.',
  )
}

const loadOrder = async (tx: Tx, id: string) =>
  (
    await tx<OrderState[]>`
      select id, channel, fulfilment, prep_status, payment_status from orders where id = ${id}`
  )[0]

function patchOrderTx(
  deps: AppDeps,
  input: { orderId: string; staffId: string; prepStatus?: PrepStatus; staffNote?: string },
): Promise<ActionResult> {
  const { orderId, staffId, prepStatus, staffNote } = input
  if (!UUID.test(orderId)) return Promise.resolve(notFound())

  return transact(deps, async (tx) => {
    const order = await loadOrder(tx, orderId)
    if (!order) return notFound()

    let current = { prep: order.prep_status, payment: order.payment_status }

    if (prepStatus !== undefined) {
      // The till owns counter prep for good (Plan 4 Ruling 7, Plan 5 Ruling 13); staff notes are still fine.
      if (order.channel === 'counter') return fail(409, 'COUNTER_ORDER', 'Counter orders are updated at the till.')
      if (order.payment_status !== 'paid') {
        return badTransition('Verify the payment before preparing this order.')
      }
      if (!canMovePrep(order.prep_status, prepStatus, order.fulfilment)) {
        return badTransition(`An order that is ${order.prep_status} cannot move to ${prepStatus}.`)
      }
      const [row] = await tx<{ prep_status: string }[]>`
        update orders set prep_status = ${prepStatus}, updated_at = now()
        where id = ${orderId} and prep_status = ${order.prep_status} and payment_status = 'paid'
        returning prep_status`
      if (!row) throw new Abort(await statusChanged(tx, orderId))
      await tx`
        insert into order_events (order_id, kind, from_value, to_value, staff_id)
        values (${orderId}, 'prep_status', ${order.prep_status}, ${prepStatus}, ${staffId})`
      current = { ...current, prep: prepStatus }
    }

    if (staffNote !== undefined) {
      await tx`update orders set staff_note = ${staffNote}, updated_at = now() where id = ${orderId}`
      await tx`
        insert into order_events (order_id, kind, to_value, staff_id)
        values (${orderId}, 'note', ${staffNote}, ${staffId})`
    }
    return { ok: true, prepStatus: current.prep, paymentStatus: current.payment }
  })
}

function cancelOrderTx(
  deps: AppDeps,
  input: { orderId: string; staffId: string; reason: string },
): Promise<ActionResult> {
  const { orderId, staffId, reason } = input
  if (!UUID.test(orderId)) return Promise.resolve(notFound())

  return transact(deps, async (tx) => {
    const order = await loadOrder(tx, orderId)
    if (!order) return notFound()
    if (order.channel !== 'online') {
      return fail(409, 'COUNTER_ORDER', 'Counter orders are cancelled at the till, not here.')
    }
    if (order.prep_status === 'cancelled') {
      return badTransition(`An order that is ${order.prep_status} cannot be cancelled.`)
    }

    // A paid order is refunded; one still awaiting verification has its payment rejected.
    const outcome =
      order.payment_status === 'paid'
        ? { from: 'verified', to: 'refunded', order: 'refunded' }
        : order.payment_status === 'pending_verification'
          ? { from: 'pending_verification', to: 'rejected', order: 'rejected' }
          : null
    if (!outcome) return badTransition(`An order with payment ${order.payment_status} cannot be cancelled.`)

    const [row] = await tx<{ id: string }[]>`
      update orders set prep_status = 'cancelled', payment_status = ${outcome.order},
        cancelled_at = now(), cancelled_by_staff = ${staffId}, cancel_reason = ${reason}, updated_at = now()
      where id = ${orderId} and prep_status = ${order.prep_status} and payment_status = ${order.payment_status}
      returning id`
    if (!row) throw new Abort(await statusChanged(tx, orderId))

    const paid = await tx<{ id: string }[]>`
      update payments set status = ${outcome.to}
      where order_id = ${orderId} and status = ${outcome.from}
      returning id`
    if (paid.length === 0) throw new Abort(await statusChanged(tx, orderId))

    await tx`
      insert into order_events (order_id, kind, from_value, to_value, staff_id, reason)
      values (${orderId}, 'cancelled', ${order.prep_status}, 'cancelled', ${staffId},
              ${`${reason} (payment ${outcome.order})`})`
    await onOrderCancelled(tx, orderId, deps.now())
    return { ok: true, prepStatus: 'cancelled', paymentStatus: outcome.order }
  })
}

/** Verify or reject a payment that is pending verification. */
function decidePaymentTx(
  deps: AppDeps,
  input: { paymentId: string; staffId: string; decision: 'verify' } | { paymentId: string; staffId: string; decision: 'reject'; reason: string },
  decided: { orderId?: string },
): Promise<ActionResult> {
  const { paymentId, staffId } = input
  if (!UUID.test(paymentId)) return Promise.resolve(notFound())

  return transact(deps, async (tx) => {
    // Lock the order first, the same order as cancelOrder (orders, then payments), so a verify
    // racing a cancel waits instead of deadlocking.
    const [existing] = await tx<{ id: string }[]>`
      select o.id from orders o join payments p on p.order_id = o.id
      where p.id = ${paymentId} for update of o`
    if (!existing) return notFound()
    const orderId = existing.id
    decided.orderId = orderId
    const verifying = input.decision === 'verify'
    const rejectReason = input.decision === 'reject' ? input.reason : null

    const [pay] = verifying
      ? await tx<{ id: string }[]>`
          update payments set status = 'verified', verified_by = ${staffId}, verified_at = now()
          where id = ${paymentId} and status = 'pending_verification' returning id`
      : await tx<{ id: string }[]>`
          update payments set status = 'rejected'
          where id = ${paymentId} and status = 'pending_verification' returning id`
    if (!pay) throw new Abort(await statusChanged(tx, orderId))

    const [order] = verifying
      ? await tx<{ prep_status: PrepStatus }[]>`
          update orders set payment_status = 'paid', updated_at = now()
          where id = ${orderId} and payment_status = 'pending_verification' returning prep_status`
      : await tx<{ prep_status: PrepStatus }[]>`
          update orders set payment_status = 'rejected', prep_status = 'cancelled',
            staff_note = case when staff_note is null or staff_note = '' then ${rejectReason}::text
                              else staff_note || E'\n' || ${rejectReason}::text end,
            updated_at = now()
          where id = ${orderId} and payment_status = 'pending_verification' returning prep_status`
    if (!order) throw new Abort(await statusChanged(tx, orderId))

    await tx`
      insert into order_events (order_id, kind, from_value, to_value, staff_id, reason)
      values (${orderId}, 'payment', 'pending_verification', ${verifying ? 'paid' : 'rejected'}, ${staffId},
              ${input.decision === 'reject' ? input.reason : null})`
    // Linked at checkout: a verified payment earns the points; a rejected one cancels the order.
    if (verifying) await creditOrderPoints(tx, orderId, deps.now())
    else await onOrderCancelled(tx, orderId, deps.now())
    return verifying
      ? { ok: true, prepStatus: order.prep_status, paymentStatus: 'paid' }
      : { ok: true, prepStatus: 'cancelled', paymentStatus: 'rejected' }
  })
}

// ---- Push after a successful commit. notifyOrder never throws, so a push problem cannot fail an action. ----

export async function patchOrder(
  deps: AppDeps,
  input: Parameters<typeof patchOrderTx>[1],
): Promise<ActionResult> {
  const result = await patchOrderTx(deps, input)
  const event = input.prepStatus && PREP_PUSH_EVENTS[input.prepStatus]
  if (result.ok && event) await afterCommit(deps, () => notifyOrder(deps, input.orderId, event))
  return result
}

export async function cancelOrder(deps: AppDeps, input: Parameters<typeof cancelOrderTx>[1]): Promise<ActionResult> {
  const result = await cancelOrderTx(deps, input)
  if (result.ok) await afterCommit(deps, () => notifyOrder(deps, input.orderId, 'problem'))
  return result
}

export async function decidePayment(deps: AppDeps, input: Parameters<typeof decidePaymentTx>[1]): Promise<ActionResult> {
  const decided: { orderId?: string } = {}
  const result = await decidePaymentTx(deps, input, decided)
  if (result.ok && decided.orderId) {
    const orderId = decided.orderId
    await afterCommit(deps, () => notifyOrder(deps, orderId, input.decision === 'verify' ? 'paid' : 'problem'))
  }
  return result
}
