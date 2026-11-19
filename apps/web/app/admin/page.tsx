import Link from 'next/link'
import { requireStaff } from '@/lib/auth/session'
import { getMenuStatus } from '@/lib/menu/status'
import { countOrdersToCheck, countSoldOut, recentOrders } from '@/lib/admin/overview-data'
import { InstallAppButton } from '@/components/InstallAppButton'
import { formatPesos } from '@/lib/money'
import { statusLabel, type OrderStatus } from './orders/status'
import { overviewTiles } from './overview'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  await requireStaff()
  const [ordersToCheck, soldOut, status, orders] = await Promise.all([
    countOrdersToCheck(),
    countSoldOut(),
    getMenuStatus(),
    recentOrders(5),
  ])
  const tiles = overviewTiles({ ordersToCheck, soldOut, status })

  return (
    <>
      <h1>Overview</h1>

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
                <strong>{o.orderCode}</strong>
                <span>{o.customerName}</span>
                <span className="overview-order-status">{statusLabel(o.status as OrderStatus)}</span>
                <span className="overview-order-total">{formatPesos(o.totalCentavos)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <InstallAppButton label="Install Kennko Admin" className="btn btn-primary" />
    </>
  )
}
