import { manilaDay, orderPoints } from '@kennko/core'
import type postgres from 'postgres'
import { lockCustomer } from './customers.js'

export type BonusReason = 'checkin' | 'card_scan' | 'social_share'

type Tx = postgres.TransactionSql

async function mustLock(tx: Tx, customerId: string): Promise<void> {
  if (!(await lockCustomer(tx, customerId))) throw new Error(`customer ${customerId} not found`)
}

/**
 * Credits an order once it is linked, paid and not cancelled, whichever came second (Ruling 9). The delivery fee and
 * the free-drink line earn nothing; 0 points writes no row. Returns the points written (0 when none).
 */
export async function creditOrderPoints(tx: Tx, orderId: string, now: Date): Promise<number> {
  const [o] = await tx<
    { customer_id: string | null; payment_status: string; prep_status: string; subtotal_centavos: number; discount_centavos: number }[]
  >`
    select customer_id, payment_status, prep_status, subtotal_centavos, discount_centavos
    from orders where id = ${orderId} for update`
  if (!o || o.customer_id === null || o.payment_status !== 'paid' || o.prep_status === 'cancelled') return 0
  const [r] = await tx<{ total: number }[]>`
    select coalesce(sum(line_total_centavos), 0)::int as total from order_lines where order_id = ${orderId} and is_reward`
  const points = orderPoints({
    subtotalCentavos: o.subtotal_centavos,
    discountCentavos: o.discount_centavos,
    rewardLineCentavos: r!.total,
  })
  if (points <= 0) return 0
  await mustLock(tx, o.customer_id)
  const written = await tx`
    insert into points_ledger (customer_id, delta, reason, order_id, created_at)
    values (${o.customer_id}, ${points}, 'order', ${orderId}, ${now})
    on conflict do nothing
    returning id`
  return written.length > 0 ? points : 0
}

/** Appends the order's reversal once, even when the points were already spent. Returns the delta written (or 0). */
export async function reverseOrderPoints(tx: Tx, orderId: string, now: Date): Promise<number> {
  await tx`select id from orders where id = ${orderId} for update`
  const [credit] = await tx<{ customer_id: string; delta: number }[]>`
    select customer_id, delta from points_ledger where order_id = ${orderId} and reason = 'order'`
  if (!credit) return 0
  await mustLock(tx, credit.customer_id)
  const written = await tx`
    insert into points_ledger (customer_id, delta, reason, order_id, created_at)
    values (${credit.customer_id}, ${-credit.delta}, 'order_reversed', ${orderId}, ${now})
    on conflict do nothing
    returning id`
  return written.length > 0 ? -credit.delta : 0
}

/**
 * Unlinking (Ruling 8): deletes the order's ledger rows for that customer, so `unique (order_id, reason)` lets the
 * right customer be credited after a relink. Returns how many rows went.
 */
export async function dropOrderPoints(tx: Tx, orderId: string, customerId: string): Promise<number> {
  await tx`select id from orders where id = ${orderId} for update`
  await mustLock(tx, customerId)
  const gone = await tx`delete from points_ledger where order_id = ${orderId} and customer_id = ${customerId} returning id`
  return gone.length
}

export type Adjustment = { customerId: string; delta: number; note: string; staffId: string; now: Date }

export async function adjustPoints(tx: Tx, a: Adjustment): Promise<void> {
  await mustLock(tx, a.customerId)
  await tx`
    insert into points_ledger (customer_id, delta, reason, note, created_by_staff, created_at)
    values (${a.customerId}, ${a.delta}, 'adjustment', ${a.note}, ${a.staffId}, ${a.now})`
}

/**
 * Credits a daily bonus (walk-in cat check-in, counter card scan, or F2F-verified social story/post) at most once
 * per Manila day per customer and bonus reason. Safe to call repeatedly.
 */
export async function creditDailyBonus(
  tx: Tx,
  o: { customerId: string; reason: BonusReason; delta: number; note: string; staffId?: string | null; now: Date },
): Promise<{ awarded: number; alreadyAwarded: boolean }> {
  if (o.delta <= 0) return { awarded: 0, alreadyAwarded: false }
  await mustLock(tx, o.customerId)
  const day = manilaDay(o.now.getTime())
  const written = await tx`
    insert into points_ledger (customer_id, delta, reason, note, created_by_staff, bonus_day, created_at)
    values (${o.customerId}, ${o.delta}, ${o.reason}, ${o.note}, ${o.staffId ?? null}, ${day}, ${o.now})
    on conflict (customer_id, reason, bonus_day) where bonus_day is not null do nothing
    returning id`
  return written.length > 0 ? { awarded: o.delta, alreadyAwarded: false } : { awarded: 0, alreadyAwarded: true }
}

export async function balance(tx: Tx, customerId: string): Promise<number> {
  const [r] = await tx<{ total: number }[]>`
    select coalesce(sum(delta), 0)::int as total from points_ledger where customer_id = ${customerId}`
  return r!.total
}
