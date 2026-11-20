import type { PullState } from '@kennko/core'
import type postgres from 'postgres'
import { readMenuVersion } from '../menu/read.js'
import { readPinRoster } from '../staff/pin-roster.js'
import { readOnlineQueue } from './online-orders.js'

/** What a till needs to catch up: the menu if newer than `tillVersion`, sold-out ids, PIN roster, shop details. */
export async function readPullState(sql: postgres.Sql, tillVersion: number | null, now: Date): Promise<PullState> {
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
    shop: { name: shop?.display_name ?? 'Kennko Coffee', address: shop?.address ?? '', phone: shop?.phone ?? null },
  }
}
