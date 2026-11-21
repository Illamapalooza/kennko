import { randomInt } from 'node:crypto'
import {
  checkCatName,
  COSMETIC_SLOTS,
  parseLook,
  STARTER_CAT_NAMES,
  STARTER_COATS,
  type CatLook,
  type CosmeticSlot,
  type CosmeticView,
  type MeView,
} from '@kennko/core'
import type postgres from 'postgres'
import { lockCustomer } from './customers.js'
import { balance } from './points.js'

type Tx = postgres.TransactionSql
type Sql = postgres.Sql | postgres.TransactionSql

export type Failure = { ok: false; status: 400 | 404 | 409; code: string; message: string }
const fail = (status: 400 | 404 | 409, code: string, message: string): Failure => ({ ok: false, status, code, message })
export const NOT_JOINED = fail(404, 'NOT_JOINED', 'You do not have a Kennko card yet.')

export type CatView = NonNullable<MeView['customer']>['cat']
export type Pick = { randomInt: (max: number) => number }

/**
 * Gives the customer a cat when they have none (Ruling 11): a random starter name and coat. Join calls it, and so does
 * every cat path, which covers customers who joined through an API from before Plan 8. An existing cat is never touched.
 */
export async function ensureCat(tx: Tx, customerId: string, now: Date, pick: Pick = { randomInt }): Promise<void> {
  const name = STARTER_CAT_NAMES[pick.randomInt(STARTER_CAT_NAMES.length)]!
  const coat = STARTER_COATS[pick.randomInt(STARTER_COATS.length)]!
  await tx`
    insert into cats (customer_id, name, equipped, updated_at)
    values (${customerId}, ${name}, ${tx.json({ coat })}, ${now})
    on conflict do nothing`
}

/** Every key the customer may wear: all starters (owned by everyone, no row) and what they bought, sorted. */
export async function ownedKeys(tx: Tx, customerId: string): Promise<string[]> {
  const rows = await tx<{ key: string }[]>`
    select key from cosmetics where is_starter
    union
    select c.key from customer_cosmetics cc join cosmetics c on c.id = cc.cosmetic_id where cc.customer_id = ${customerId}
    order by key`
  return rows.map((r) => r.key)
}

/** The customer's cat for `MeView`. `visitEndsAt` is set only while the visit is still on at `now`. */
export async function readCat(tx: Tx, customerId: string, now: Date): Promise<CatView> {
  type Row = { name: string; equipped: CatLook; show_on_wall: boolean; hidden_by_admin: boolean; ends_at: Date | null }
  const [r] = await tx<Row[]>`
    select c.name, c.equipped, c.show_on_wall, c.hidden_by_admin, v.ends_at
    from cats c left join visits v on v.customer_id = c.customer_id
    where c.customer_id = ${customerId}`
  if (!r) throw new Error(`customer ${customerId} has no cat`)
  return {
    name: r.name,
    look: r.equipped,
    showOnWall: r.show_on_wall,
    hiddenByAdmin: r.hidden_by_admin,
    visitEndsAt: r.ends_at !== null && r.ends_at.getTime() > now.getTime() ? r.ends_at.toISOString() : null,
  }
}

export type CatInput = { name: string; look: unknown; showOnWall: boolean }

/**
 * Renames and dresses the cat and sets "Show me on the wall" (Ruling 13). Checked in order: the name (core rules), the
 * look's shape, each key's slot, then ownership; an unknown key counts as not owned. A switched-off item stays
 * wearable. Runs under the customer lock; the stored name is the normalised one.
 */
export async function saveCat(tx: Tx, customerId: string, input: CatInput, now: Date): Promise<Failure | null> {
  const name = checkCatName(input.name)
  if (!name.ok) return fail(400, 'BAD_NAME', name.message)
  const look = parseLook(input.look)
  if (!look) return fail(400, 'BAD_LOOK', 'A look is a coat and up to one item for each of hat, face, neck and held.')

  if (!(await lockCustomer(tx, customerId))) return NOT_JOINED
  await ensureCat(tx, customerId, now)

  const worn = Object.entries(look) as [CosmeticSlot, string][]
  const known = await tx<{ key: string; slot: CosmeticSlot }[]>`
    select key, slot from cosmetics where key in ${tx(worn.map(([, key]) => key))}`
  const slotOf = new Map(known.map((k) => [k.key, k.slot]))
  for (const [slot, key] of worn) {
    const actual = slotOf.get(key)
    if (actual !== undefined && actual !== slot) return fail(400, 'WRONG_SLOT', `That one is worn as ${actual}, not ${slot}.`)
  }
  const owned = new Set(await ownedKeys(tx, customerId))
  if (worn.some(([, key]) => !owned.has(key))) return fail(409, 'NOT_OWNED', 'Buy it first.')

  // Stored in slot order, whatever order the request used.
  const equipped = Object.fromEntries(COSMETIC_SLOTS.filter((s) => look[s] !== undefined).map((s) => [s, look[s]!]))
  await tx`
    update cats set name = ${name.name}, equipped = ${tx.json(equipped)}, show_on_wall = ${input.showOnWall},
      updated_at = ${now}
    where customer_id = ${customerId}`
  return null
}

/**
 * Buys a cosmetic with points (Ruling 12), under the customer lock: the balance is read after locking. Already owned is
 * no charge and no error. The ledger row and the owned row are written together; a free item writes no ledger row.
 * Buying does not equip.
 */
export async function buyCosmetic(
  tx: Tx,
  customerId: string,
  cosmeticId: string,
  now: Date,
): Promise<{ ok: true; kind: 'bought' | 'owned' } | Failure> {
  if (!(await lockCustomer(tx, customerId))) return NOT_JOINED
  await ensureCat(tx, customerId, now)

  const [item] = await tx<{ id: string; price_points: number; is_starter: boolean; is_active: boolean }[]>`
    select id, price_points, is_starter, is_active from cosmetics where id = ${cosmeticId}`
  if (!item || !item.is_active) return fail(404, 'UNKNOWN_COSMETIC', 'That item is not in the shop.')
  if (item.is_starter) return fail(409, 'STARTER_ITEM', 'Starter items are already yours.')

  const [have] = await tx`
    select 1 from customer_cosmetics where customer_id = ${customerId} and cosmetic_id = ${cosmeticId}`
  if (have) return { ok: true, kind: 'owned' }

  const points = await balance(tx, customerId)
  if (points < item.price_points) {
    return fail(409, 'NOT_ENOUGH_POINTS', `You need ${item.price_points - points} more points.`)
  }
  await tx`
    insert into customer_cosmetics (customer_id, cosmetic_id, acquired_at)
    values (${customerId}, ${cosmeticId}, ${now})`
  if (item.price_points > 0) {
    await tx`
      insert into points_ledger (customer_id, delta, reason, cosmetic_id, created_at)
      values (${customerId}, ${-item.price_points}, 'cosmetic', ${cosmeticId}, ${now})`
  }
  return { ok: true, kind: 'bought' }
}

type CosmeticRow = {
  id: string
  key: string
  slot: CosmeticSlot
  name: string
  price_points: number
  is_starter: boolean
  is_active: boolean
  sort_order: number
}

const toView = (r: CosmeticRow): CosmeticView => ({
  id: r.id,
  key: r.key,
  slot: r.slot,
  name: r.name,
  pricePoints: r.price_points,
  isStarter: r.is_starter,
  isActive: r.is_active,
  sortOrder: r.sort_order,
})

/** The shop: active items by slot (in `COSMETIC_SLOTS` order), then sort order. */
export async function activeCosmetics(sql: Sql): Promise<CosmeticView[]> {
  const rows = await sql<CosmeticRow[]>`
    select id, key, slot, name, price_points, is_starter, is_active, sort_order
    from cosmetics where is_active
    order by sort_order, key`
  const rank = (s: CosmeticSlot) => COSMETIC_SLOTS.indexOf(s)
  return [...rows].sort((a, b) => rank(a.slot) - rank(b.slot)).map(toView)
}
