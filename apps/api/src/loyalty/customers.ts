import { formatPublicCode, type StampMode, type TillCustomer } from '@kennko/core'
import type postgres from 'postgres'

type Tx = postgres.TransactionSql

export type LockedCustomer = { id: string; stamp_mode: StampMode }

/**
 * Locks the customer row for the rest of the transaction. Every card, stamp and ledger write holds this lock.
 * Lock order: the order row first (when there is one), then the customer.
 */
export async function lockCustomer(tx: Tx, id: string): Promise<LockedCustomer | null> {
  const [c] = await tx<LockedCustomer[]>`select id, stamp_mode from customers where id = ${id} for update`
  return c ?? null
}

/** The customer for a bare 9-symbol code (already normalised and checked), without a lock. */
export async function customerByCode(tx: Tx, bare: string): Promise<LockedCustomer | null> {
  const [c] = await tx<LockedCustomer[]>`select id, stamp_mode from customers where public_code = ${bare}`
  return c ?? null
}

/** The stamps on the open card, oldest first, and how many full cards wait for a claim. */
export async function cardSummary(tx: Tx, id: string): Promise<{ stamps: { stampedAt: string }[]; fullCards: number }> {
  const stamps = await tx<{ stamped_at: Date }[]>`
    select s.stamped_at from stamps s join stamp_cards c on c.id = s.card_id
    where c.customer_id = ${id} and c.filled_at is null and not ('forgiven' = any(s.flags))
    order by s.stamped_at, s.received_at, s.id`
  const [full] = await tx<{ n: number }[]>`
    select count(*)::int as n from stamp_cards
    where customer_id = ${id} and filled_at is not null and claimed_at is null`
  return { stamps: stamps.map((s) => ({ stampedAt: s.stamped_at.toISOString() })), fullCards: full!.n }
}

/** The till's view of a customer. The only function that builds it: no name, email, phone or point balance. */
export async function tillCustomer(tx: Tx, id: string): Promise<TillCustomer> {
  const [c] = await tx<{ public_code: string; stamp_mode: StampMode }[]>`
    select public_code, stamp_mode from customers where id = ${id}`
  if (!c) throw new Error(`customer ${id} not found`)
  const summary = await cardSummary(tx, id)
  return {
    code: formatPublicCode(c.public_code),
    catName: null,
    stampMode: c.stamp_mode,
    stamps: summary.stamps.length,
    fullCards: summary.fullCards,
  }
}
