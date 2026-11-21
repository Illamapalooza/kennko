import { STAMPS_PER_CARD } from '@kennko/core'
import type postgres from 'postgres'
import { lockCustomer } from './customers.js'

type Tx = postgres.TransactionSql

/** Locks the order row so the lock order (order, then customer) holds even when the caller has not. */
async function lockOrder(tx: Tx, orderId: string): Promise<void> {
  await tx`select id from orders where id = ${orderId} for update`
}

async function mustLock(tx: Tx, customerId: string) {
  const c = await lockCustomer(tx, customerId)
  if (!c) throw new Error(`customer ${customerId} not found`)
  return c
}

/**
 * Lays the customer's live stamps on unclaimed cards onto those cards in stamp order, 8 per card (Ruling 6).
 * Full cards keep or get `filled_at`, the last card may be partial, and empty extra cards are deleted. Claimed cards
 * are frozen. Full cards are written before the partial one, so the one-open-card index never sees two open cards.
 * The caller holds the customer lock.
 */
export async function repackCards(tx: Tx, customerId: string, now: Date): Promise<void> {
  const cards = await tx<{ id: string; filled_at: Date | null }[]>`
    select id, filled_at from stamp_cards
    where customer_id = ${customerId} and claimed_at is null
    order by (filled_at is null), filled_at, started_at, id`
  const stamps = await tx<{ id: string; card_id: string }[]>`
    select s.id, s.card_id from stamps s join stamp_cards c on c.id = s.card_id
    where c.customer_id = ${customerId} and c.claimed_at is null and not ('forgiven' = any(s.flags))
    order by s.stamped_at, s.received_at, s.id`

  const chunks: { id: string; card_id: string }[][] = []
  for (let i = 0; i < stamps.length; i += STAMPS_PER_CARD) chunks.push(stamps.slice(i, i + STAMPS_PER_CARD))
  const used: string[] = []
  let partialCard: string | null = null

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    const full = chunk.length === STAMPS_PER_CARD
    let cardId = cards[i]?.id
    if (!cardId) {
      // Only full cards or the last (partial) one are new here, and any existing open card sits before this index,
      // so a new open card never meets another one.
      const [c] = await tx<{ id: string }[]>`
        insert into stamp_cards (customer_id, started_at, filled_at)
        values (${customerId}, ${now}, ${full ? now : null}) returning id`
      cardId = c!.id
    } else if (full && cards[i]!.filled_at === null) {
      await tx`update stamp_cards set filled_at = ${now} where id = ${cardId}`
    }
    const moving = chunk.filter((s) => s.card_id !== cardId).map((s) => s.id)
    if (moving.length > 0) await tx`update stamps set card_id = ${cardId} where id in ${tx(moving)}`
    used.push(cardId)
    if (!full && cards[i]) partialCard = cardId
  }

  // Extra cards are empty now (their stamps moved above); deleting them also frees the open slot.
  const extra = cards.map((c) => c.id).filter((id) => !used.includes(id))
  if (extra.length > 0) await tx`delete from stamp_cards where id in ${tx(extra)}`
  if (partialCard) await tx`update stamp_cards set filled_at = null where id = ${partialCard} and filled_at is not null`
}

export type AddStampInput = {
  customerId: string
  stampId: string
  orderId: string
  staffId: string | null
  deviceId: string | null
  stampedAt: string
  now: Date
}

export async function addStamp(
  tx: Tx,
  s: AddStampInput,
): Promise<'added' | 'already_recorded' | 'already_stamped' | 'paper'> {
  await lockOrder(tx, s.orderId)
  const customer = await mustLock(tx, s.customerId)

  const [same] = await tx`select id from stamps where id = ${s.stampId}`
  if (same) return 'already_recorded'
  const [live] = await tx`select id from stamps where order_id = ${s.orderId} and not ('forgiven' = any(flags))`
  if (live) return 'already_stamped'

  if (customer.stamp_mode === 'paper') {
    await tx`
      insert into stamps (id, customer_id, card_id, order_id, stamped_by_staff, device_id, stamped_at, received_at, flags)
      values (${s.stampId}, ${s.customerId}, null, ${s.orderId}, ${s.staffId}, ${s.deviceId}, ${s.stampedAt}, ${s.now},
        ${['mode_was_paper']})`
    return 'paper'
  }
  if (customer.stamp_mode === 'none') {
    await tx`update customers set stamp_mode = 'digital' where id = ${s.customerId}`
  }

  let [open] = await tx<{ id: string }[]>`
    select id from stamp_cards where customer_id = ${s.customerId} and filled_at is null`
  if (!open) {
    ;[open] = await tx<{ id: string }[]>`
      insert into stamp_cards (customer_id, started_at) values (${s.customerId}, ${s.now}) returning id`
  }
  await tx`
    insert into stamps (id, customer_id, card_id, order_id, stamped_by_staff, device_id, stamped_at, received_at)
    values (${s.stampId}, ${s.customerId}, ${open!.id}, ${s.orderId}, ${s.staffId}, ${s.deviceId}, ${s.stampedAt}, ${s.now})`
  await repackCards(tx, s.customerId, s.now)
  return 'added'
}

/**
 * The order was cancelled or unlinked (Ruling 7): a stamp on an unclaimed card (or a paper one with no card) is
 * deleted and the cards repacked; a stamp on a claimed card stays, flagged `forgiven`.
 */
export async function removeOrderStamp(tx: Tx, orderId: string, now: Date): Promise<'removed' | 'forgiven' | 'none'> {
  await lockOrder(tx, orderId)
  const liveStamp = () =>
    tx<{ id: string; customer_id: string; card_id: string | null; claimed_at: Date | null }[]>`
      select s.id, s.customer_id, s.card_id, c.claimed_at
      from stamps s left join stamp_cards c on c.id = s.card_id
      where s.order_id = ${orderId} and not ('forgiven' = any(s.flags))`
  const [found] = await liveStamp()
  if (!found) return 'none'
  await mustLock(tx, found.customer_id)
  // Read again under the customer lock: a claim may have landed in between.
  const [s] = await liveStamp()
  if (!s) return 'none'
  if (s.claimed_at !== null) {
    await tx`update stamps set flags = array_append(flags, 'forgiven') where id = ${s.id}`
    return 'forgiven'
  }
  await tx`delete from stamps where id = ${s.id}`
  await repackCards(tx, s.customer_id, now)
  return 'removed'
}

export type ClaimInput = { customerId: string; claimId: string; staffId: string | null; deviceId: string | null; now: Date }

/** Claims the oldest full, unclaimed card. The update is conditional, so of two claims at once only one succeeds. */
export async function claimFreeDrink(tx: Tx, c: ClaimInput): Promise<'claimed' | 'already_claimed' | 'none_full'> {
  await mustLock(tx, c.customerId)
  const [same] = await tx`select id from stamp_cards where claim_id = ${c.claimId}`
  if (same) return 'already_claimed'
  const [claimed] = await tx`
    update stamp_cards set claimed_at = ${c.now}, claim_id = ${c.claimId}, claimed_by_staff = ${c.staffId},
      claimed_device_id = ${c.deviceId}
    where id = (
      select id from stamp_cards
      where customer_id = ${c.customerId} and filled_at is not null and claimed_at is null
      order by filled_at, started_at, id
      limit 1
    ) and claimed_at is null
    returning id`
  return claimed ? 'claimed' : 'none_full'
}

export type UnclaimTarget = { cardId?: string; claimId?: string; orderId?: string }

/**
 * Clears a claim (a released claim, or a voided free-drink order) and repacks. Stamps forgiven while the card was
 * claimed belong to cancelled or unlinked orders, so they go.
 */
export async function unclaim(tx: Tx, target: UnclaimTarget, now: Date): Promise<'unclaimed' | 'none'> {
  if (target.orderId) await lockOrder(tx, target.orderId)
  const find = () =>
    target.cardId
      ? tx<{ id: string; customer_id: string }[]>`
          select id, customer_id from stamp_cards where id = ${target.cardId} and claimed_at is not null`
      : target.claimId
        ? tx<{ id: string; customer_id: string }[]>`
            select id, customer_id from stamp_cards where claim_id = ${target.claimId}`
        : target.orderId
          ? tx<{ id: string; customer_id: string }[]>`
              select id, customer_id from stamp_cards where claimed_order_id = ${target.orderId}`
          : Promise.resolve([] as { id: string; customer_id: string }[])
  const [found] = await find()
  if (!found) return 'none'
  await mustLock(tx, found.customer_id)
  const [card] = await find()
  if (!card) return 'none'
  await tx`
    update stamp_cards set claimed_at = null, claim_id = null, claimed_order_id = null, claimed_by_staff = null,
      claimed_device_id = null
    where id = ${card.id}`
  await tx`delete from stamps where card_id = ${card.id} and 'forgiven' = any(flags)`
  await repackCards(tx, card.customer_id, now)
  return 'unclaimed'
}

/** A free-drink claim whose sale has not reached the server after this long is stranded (Ruling P7-6). */
export const CLAIM_STRANDED_MS = 30 * 60_000

/**
 * Unclaims this customer's stranded claims (Ruling P7-6): cards claimed more than 30 minutes ago whose sale never
 * arrived (`claimed_order_id` still null), so the card is full again. Covers a till that crashed during the claim or
 * was re-paired before its release went through. A sale that arrives later re-claims (see `applyRewardUsed`).
 * Takes the customer lock only when there is something to sweep. The caller holds no order lock it took after a
 * customer lock (the global order is order, then customer); holding the customer lock already is fine.
 */
export async function sweepStrandedClaims(tx: Tx, customerId: string, now: Date): Promise<number> {
  const before = new Date(now.getTime() - CLAIM_STRANDED_MS)
  const stranded = () => tx<{ id: string }[]>`
    select id from stamp_cards
    where customer_id = ${customerId} and claimed_at is not null and claimed_at < ${before} and claimed_order_id is null`
  if ((await stranded()).length === 0) return 0
  if (!(await lockCustomer(tx, customerId))) return 0
  // Read again under the customer lock: a reward.used may have recorded the sale meanwhile.
  const cards = await stranded()
  for (const card of cards) await unclaim(tx, { cardId: card.id }, now)
  return cards.length
}

/**
 * Sweeps stranded claims (above) for these customers, or for every customer with one when `customerIds` is omitted.
 * One query when there is nothing to sweep; otherwise one transaction per customer, so no two customer locks are
 * ever held together.
 */
export async function sweepStrandedClaimsFor(sql: postgres.Sql, now: Date, customerIds?: string[]): Promise<number> {
  if (customerIds?.length === 0) return 0
  const before = new Date(now.getTime() - CLAIM_STRANDED_MS)
  const rows = await sql<{ customer_id: string }[]>`
    select distinct customer_id from stamp_cards
    where claimed_at is not null and claimed_at < ${before} and claimed_order_id is null
      ${customerIds ? sql`and customer_id in ${sql(customerIds)}` : sql``}`
  let swept = 0
  for (const r of rows) swept += (await sql.begin((tx) => sweepStrandedClaims(tx, r.customer_id, now))) as number
  return swept
}

/**
 * `sweepStrandedClaimsFor` for read paths (the pull, a lookup, `/v1/me`, Needs a look, admin customers): best effort.
 * A failure is logged and the read goes on with the cards as they are; the next read sweeps again.
 */
export async function sweepStrandedClaimsQuietly(sql: postgres.Sql, now: Date, where: string, customerIds?: string[]): Promise<void> {
  try {
    await sweepStrandedClaimsFor(sql, now, customerIds)
  } catch (err) {
    console.error(`[${where}] stranded-claim sweep failed:`, (err as Error).message)
  }
}
