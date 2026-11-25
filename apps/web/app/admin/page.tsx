import Link from 'next/link'
import { requireStaff } from '@/lib/auth/session'
import { getMenuStatus } from '@/lib/menu/status'
import { countOrdersToCheck, countSoldOut, recentOrders } from '@/lib/admin/overview-data'
import { OrderAlertsButton } from '@/components/admin/OrderAlertsButton'
import { ShopHoursCard } from '@/components/admin/ShopHoursCard'
import { InstallAppButton } from '@/components/InstallAppButton'
import { apiBase } from '@/lib/api/client'
import type { ShopStatusState } from './shop-actions'
import { formatPesos } from '@/lib/money'
import { statusLabel } from './orders/status'
import { overviewTiles } from './overview'

export const dynamic = 'force-dynamic'

async function loadShopStatus(): Promise<ShopStatusState> {
  const base = apiBase()
  if (!base) return { isOpen: true, closingTime: '23:00', updatedAt: 0, openNow: true }
  try {
    const res = await fetch(`${base}/v1/shop`, { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!res.ok) throw new Error('bad status')
    return (await res.json()) as ShopStatusState
  } catch {
    return { isOpen: true, closingTime: '23:00', updatedAt: 0, openNow: true }
  }
}

export default async function AdminOverviewPage() {
  await requireStaff()
  const [ordersToCheck, soldOut, status, orders, shopStatus] = await Promise.all([
    countOrdersToCheck(),
    countSoldOut(),
    getMenuStatus().catch(() => ({ ok: false as const })),
    recentOrders(5),
    loadShopStatus(),
  ])
  const tiles = overviewTiles({ ordersToCheck, soldOut, status })

  return (
    <>
      <h1>Overview</h1>

      <ShopHoursCard initial={shopStatus} />

      <div className="overview-tiles">
        {tiles.map((tile) => (
          <Link key={tile.key} href={tile.href} className="overview-tile">
            <span className="overview-tile-title">{tile.title}</span>
            <strong className="overview-tile-value">{tile.value}</strong>
          </Link>
        ))}
      </div>

      <h2>Recent orders</h2>
      {orders.length === 0 ? (
        <p className="admin-notice">No orders yet.</p>
      ) : (
        <ul className="overview-orders">
          {orders.map((o) => (
            <li key={o.id}>
              <Link href="/admin/orders" className="overview-order">
                <strong>{o.ticket} · {o.orderCode}</strong>
                <span>{o.customerName}</span>
                <span className="overview-order-status">{statusLabel(o.stage)}</span>
                <span className="overview-order-total">{formatPesos(o.totalCentavos)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <OrderAlertsButton />
      <InstallAppButton label="Install Kennko Admin" className="btn btn-primary" />
    </>
  )
}
