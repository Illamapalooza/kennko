import { isShopOpenNow, parseLook, type CatLook, type PrepStatus, type WallVisitor } from '@kennko/core'
import type postgres from 'postgres'
import { readVisitors } from '../loyalty/visits.js'
import { readShopStatus } from '../shop/status.js'

const WALL_LINGER_MS = 2 * 60 * 60 * 1000

export type PublicWallOrder = {
  id: number
  number: number
  series: 'C' | 'W'
  label?: string
  name: string
  items: { name: string; qty: number }[]
  status: 'queued' | 'preparing' | 'serving' | 'done'
  fulfilment: string
  prepStatus: PrepStatus
  createdAt: number
  updatedAt: number
  look?: CatLook
}

export type PublicWallSnapshot = {
  now: number
  baristas: number
  openNow: boolean
  isOpen: boolean
  closingTime: string | null
  orders: PublicWallOrder[]
  visitors: WallVisitor[]
}

const PREP_TO_WALL: Record<PrepStatus, PublicWallOrder['status']> = {
  placed: 'queued',
  preparing: 'preparing',
  ready: 'serving',
  out_for_delivery: 'done',
  completed: 'done',
  cancelled: 'done',
}

type OrderRow = {
  id: string
  channel: string
  ticket_number: number
  fulfilment: string
  prep_status: PrepStatus
  created_at: Date
  updated_at: Date
  cat_equipped: unknown
}

/**
 * Public read-only cafe snapshot for the website's `/cafe` page. Never exposes customer names, emails, phones,
 * addresses, prices, or check-in secrets.
 */
export async function readPublicWall(sql: postgres.Sql, now: Date): Promise<PublicWallSnapshot> {
  const since = new Date(now.getTime() - WALL_LINGER_MS)
  const [openShift] = await sql<{ id: string }[]>`select id from shifts where closed_at is null limit 1`
  const shopStatus = await readShopStatus(sql)
  const openNow = isShopOpenNow(shopStatus, now.getTime())
  const baristas = openNow && openShift ? 2 : 0

  const rows = await sql<OrderRow[]>`
    select o.id, o.channel, o.ticket_number, o.fulfilment, o.prep_status, o.created_at, o.updated_at,
      case when ca.hidden_by_admin then null else ca.equipped end as cat_equipped
    from orders o
    left join cats ca on ca.customer_id = o.customer_id
    where o.payment_status = 'paid'
      and (
        o.prep_status in ('placed', 'preparing', 'ready', 'out_for_delivery')
        or (o.prep_status = 'completed' and o.updated_at >= ${since})
      )
    order by o.created_at asc, o.ticket_number asc
    limit 50`

  const orderIds = rows.map((r) => r.id)
  const lineRows =
    orderIds.length === 0
      ? []
      : await sql<{ order_id: string; item_name: string; quantity: number }[]>`
          select order_id, item_name, quantity from order_lines where order_id in ${sql(orderIds)}`

  const itemsByOrder = new Map<string, Map<string, number>>()
  for (const l of lineRows) {
    let map = itemsByOrder.get(l.order_id)
    if (!map) {
      map = new Map()
      itemsByOrder.set(l.order_id, map)
    }
    map.set(l.item_name, (map.get(l.item_name) ?? 0) + l.quantity)
  }

  const taken = new Set<number>()
  const orders: PublicWallOrder[] = []
  for (const r of rows) {
    const online = r.channel === 'online'
    let id = online ? 5000 + r.ticket_number : r.ticket_number
    while (taken.has(id)) id += 1000
    taken.add(id)

    const itemMap = itemsByOrder.get(r.id)
    const items = itemMap ? [...itemMap.entries()].map(([name, qty]) => ({ name, qty })) : []
    const look = r.cat_equipped ? parseLook(r.cat_equipped) : null
    orders.push({
      id,
      number: r.ticket_number,
      series: online ? 'W' : 'C',
      ...(online ? { label: `W${r.ticket_number}` } : {}),
      name: '',
      items,
      status: PREP_TO_WALL[r.prep_status],
      fulfilment: r.fulfilment,
      prepStatus: r.prep_status,
      createdAt: new Date(r.created_at).getTime(),
      updatedAt: new Date(r.updated_at).getTime(),
      ...(look ? { look } : {}),
    })
  }

  const visitors = await readVisitors(sql, now)
  return {
    now: now.getTime(),
    baristas,
    openNow,
    isOpen: shopStatus.isOpen,
    closingTime: shopStatus.closingTime,
    orders,
    visitors,
  }
}
