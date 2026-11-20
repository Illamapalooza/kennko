import { hasDrink, normalisePublicCode, type SyncEvent } from '@kennko/core'
import type postgres from 'postgres'
import { addStamp, removeOrderStamp, unclaim } from '../loyalty/cards.js'
import { customerByCode, lockCustomer } from '../loyalty/customers.js'
import { creditOrderPoints, dropOrderPoints, reverseOrderPoints } from '../loyalty/points.js'
import type { Applied } from './apply.js'

type Tx = postgres.TransactionSql
type EventOf<K extends SyncEvent['kind']> = Extract<SyncEvent, { kind: K }>

const applied = (reason: string | null = null): Applied => ({ result: 'applied', reason, flags: [] })
const held = (reason: string): Applied => ({ result: 'held', reason, flags: [] })
const flagged = (reason: string): Applied => ({ result: 'flagged', reason, flags: [] })

type OrderRow = { channel: string; customer_id: string | null; prep_status: string; payment_status: string }

/**
 * The order row, locked. Every loyalty event takes the order's lock first and the customer's second (the global lock
 * order, which account deletion follows too), so a link, a stamp and a deletion can never deadlock.
 */
async function lockOrder(tx: Tx, orderId: string): Promise<OrderRow | undefined> {
  const [row] = await tx<OrderRow[]>`
    select channel, customer_id, prep_status, payment_status from orders where id = ${orderId} for update`
  return row
}

/**
 * The till linked a Kennko card to a counter sale. Online orders link only at checkout. Points are credited here when
 * the sale is already paid (a counter sale always is), so whichever of the link and the payment comes second credits.
 */
export async function applyCustomerLinked(
  tx: Tx,
  _deviceId: string,
  event: EventOf<'customer.linked'>,
  _staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId, publicCode } = event.payload
  const order = await lockOrder(tx, orderId)
  if (!order) return held('order_unknown')
  if (order.channel !== 'counter') return flagged('online_order')
  // The payload schema already checked the code's check symbol.
  const bare = normalisePublicCode(publicCode)
  const found = bare === null ? null : await customerByCode(tx, bare)
  if (!found) return flagged('unknown_customer')
  if (order.customer_id === found.id) return applied('already_linked')
  if (order.customer_id !== null) return flagged('linked_other')
  // Read again under its lock: the account may have been deleted since the lookup.
  if (!(await lockCustomer(tx, found.id))) return flagged('unknown_customer')
  await tx`update orders set customer_id = ${found.id}, updated_at = ${now} where id = ${orderId}`
  await creditOrderPoints(tx, orderId, now)
  return applied()
}

/**
 * The till took the card off a sale (Ruling 8): its stamp goes (Ruling 7), its ledger rows for that customer go, and
 * the link is cleared, so the sale can be linked to the right person. Online orders were linked at checkout and are
 * not unlinked from the till.
 */
export async function applyCustomerUnlinked(
  tx: Tx,
  _deviceId: string,
  event: EventOf<'customer.unlinked'>,
  _staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId } = event.payload
  const order = await lockOrder(tx, orderId)
  if (!order) return held('order_unknown')
  if (order.channel !== 'counter') return flagged('online_order')
  if (order.customer_id === null) return applied('not_linked')
  const customerId = order.customer_id
  await lockCustomer(tx, customerId)
  await removeOrderStamp(tx, orderId, now)
  await dropOrderPoints(tx, orderId, customerId)
  await tx`update orders set customer_id = null, updated_at = ${now} where id = ${orderId}`
  return applied()
}

/** The menu kind of each line: food, drink, or null for an item the server does not know (counted as a drink). */
async function lineKinds(tx: Tx, orderId: string): Promise<{ kind: 'drink' | 'food' | null }[]> {
  return tx<{ kind: 'drink' | 'food' | null }[]>`
    select c.kind from order_lines l
    left join menu_items i on i.id = l.item_id
    left join menu_categories c on c.id = i.category_id
    where l.order_id = ${orderId}`
}

/**
 * One stamp per paid order with a drink, for the customer the order is linked to. Allowed on online orders ("Stamp at
 * pickup"). A customer on paper still gets the stamp stored, with no card, flagged `mode_was_paper` (Ruling 13).
 */
export async function applyStampAdded(
  tx: Tx,
  deviceId: string,
  event: EventOf<'stamp.added'>,
  staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId, stampId } = event.payload
  const order = await lockOrder(tx, orderId)
  if (!order) return held('order_unknown')
  if (order.customer_id === null) return flagged('not_linked')
  if (order.prep_status === 'cancelled') return applied('already_cancelled')
  if (order.payment_status !== 'paid') return flagged('not_paid')
  if (!hasDrink(await lineKinds(tx, orderId))) return flagged('no_drink')
  const out = await addStamp(tx, {
    customerId: order.customer_id,
    stampId,
    orderId,
    staffId,
    deviceId,
    stampedAt: event.occurredAt,
    now,
  })
  switch (out) {
    case 'added':
      return applied()
    case 'paper':
      return flagged('mode_was_paper')
    case 'already_stamped':
    case 'already_recorded':
      return applied(out)
  }
}

/**
 * The sale that used a free-drink claim made online at charge time (Ruling 10): the claimed card records the order.
 * A claim for an order that was voided first is released (Ruling 12).
 */
export async function applyRewardUsed(
  tx: Tx,
  _deviceId: string,
  event: EventOf<'reward.used'>,
  _staffId: string | null,
  now: Date,
): Promise<Applied> {
  const { orderId, claimId } = event.payload
  const order = await lockOrder(tx, orderId)
  if (!order) return held('order_unknown')
  const cardOf = () =>
    tx<{ id: string; customer_id: string; claimed_order_id: string | null }[]>`
      select id, customer_id, claimed_order_id from stamp_cards where claim_id = ${claimId}`
  const [found] = await cardOf()
  if (!found) return flagged('unknown_claim')
  await lockCustomer(tx, found.customer_id)
  // Read again under the customer lock: the claim may have been released in between.
  const [card] = await cardOf()
  if (!card) return flagged('unknown_claim')
  if (card.claimed_order_id !== null && card.claimed_order_id !== orderId) return flagged('claim_reused')
  if (order.prep_status === 'cancelled') {
    await unclaim(tx, { claimId }, now)
    return applied('already_cancelled')
  }
  if (card.claimed_order_id === orderId) return applied('already_recorded')
  await tx`update stamp_cards set claimed_order_id = ${orderId} where id = ${card.id}`
  return applied()
}

/**
 * Everything loyalty an order loses when it is cancelled: its points are reversed, its stamp removed (Ruling 7) and a
 * free-drink claim it used released (Ruling 12). Used by the till's void, admin's cancel or refund, and a rejected
 * payment. The caller holds the order's row lock.
 */
export async function onOrderCancelled(tx: Tx, orderId: string, now: Date): Promise<void> {
  await reverseOrderPoints(tx, orderId, now)
  await removeOrderStamp(tx, orderId, now)
  await unclaim(tx, { orderId }, now)
}
