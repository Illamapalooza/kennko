import { LINKED_RECENT_MS, normalisePublicCode, type PullState, type TillCustomer } from '@kennko/core'
import type postgres from 'postgres'
import { sweepStrandedClaimsQuietly } from '../loyalty/cards.js'
import { tillCustomer } from '../loyalty/customers.js'
import { readMenuVersion } from '../menu/read.js'
import { readPinRoster } from '../staff/pin-roster.js'
import { readOnlineQueue } from './online-orders.js'

/** At most this many recent customers per pull. */
export const RECENT_CUSTOMERS_MAX = 50

/**
 * The customers linked through this till in the last 30 minutes (`LINKED_RECENT_MS`), newest link first, each once,
 * as `TillCustomer` and nothing more. Found by the code in this device's applied `customer.linked` receipts; codes are
 * compared after `normalisePublicCode`, never as raw text. A customer deleted since the link is simply left out.
 * Their stranded free-drink claims are swept first (Ruling P7-6), so a stuck claim shows as a full card again.
 */
export async function readRecentCustomers(sql: postgres.Sql, deviceId: string, now: Date): Promise<TillCustomer[]> {
  const since = new Date(now.getTime() - LINKED_RECENT_MS)
  const links = await sql<{ code: string | null }[]>`
    select payload->>'publicCode' as code from sync_events
    where device_id = ${deviceId} and kind = 'customer.linked' and result = 'applied' and received_at >= ${since}
    order by received_at desc, seq desc`
  const codes: string[] = []
  for (const l of links) {
    const bare = l.code === null ? null : normalisePublicCode(l.code)
    if (bare !== null && !codes.includes(bare)) codes.push(bare)
    if (codes.length === RECENT_CUSTOMERS_MAX) break
  }
  if (codes.length === 0) return []
  const ids = await sql<{ id: string }[]>`select id from customers where public_code in ${sql(codes)}`
  await sweepStrandedClaimsQuietly(
    sql,
    now,
    'pull',
    ids.map((r) => r.id),
  )
  // One snapshot, so a customer found here is still there for tillCustomer.
  return (await sql.begin('isolation level repeatable read read only', async (tx) => {
    const rows = await tx<{ id: string; public_code: string }[]>`
      select id, public_code from customers where public_code in ${tx(codes)}`
    const idOf = new Map(rows.map((r) => [r.public_code, r.id]))
    const out: TillCustomer[] = []
    for (const code of codes) {
      const id = idOf.get(code)
      if (id) out.push(await tillCustomer(tx, id))
    }
    return out
  })) as TillCustomer[]
}

/**
 * What a till needs to catch up: the menu if newer than `tillVersion`, sold-out ids, PIN roster, shop details, the
 * paid online queue and the customers linked on this till recently.
 */
export async function readPullState(sql: postgres.Sql, tillVersion: number | null, now: Date, deviceId: string): Promise<PullState> {
  const [latest] = await sql<{ version: string | number }[]>`select version from menu_snapshots order by version desc limit 1`
  let menu: PullState['menu'] = null
  if (latest) {
    const version = Number(latest.version)
    const snapshot = tillVersion === null || tillVersion < version ? await readMenuVersion(sql, version) : null
    menu = { version, snapshot }
  }

  const off = await sql<{ id: string }[]>`
    select id from menu_items where not is_available
    union all select id from menu_variants where not is_available
    union all select id from options where not is_available`
  const soldOut = off.map((r) => r.id).sort()

  const staff = await readPinRoster(sql)

  const [shop] = await sql<{ display_name: string; address: string; phone: string | null }[]>`
    select display_name, address, phone from shop_settings where id = 1`
  return {
    menu,
    soldOut,
    staff,
    onlineOrders: await readOnlineQueue(sql, now),
    customers: await readRecentCustomers(sql, deviceId, now),
    shop: { name: shop?.display_name ?? 'Kennko Coffee', address: shop?.address ?? '', phone: shop?.phone ?? null },
  }
}
