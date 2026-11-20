import { requireStaff } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { OrderCard, type AdminOrder } from '@/components/admin/OrderCard'
import type { OrderStage } from '@kennko/core'
import { duplicateReferences } from './status'
import { ORDER_SELECT, toAdminOrder, type OrderRow } from './rows'
import Link from 'next/link'
import { ordersForTab, tabCounts, orderQueries, parseTab, type OrderTab } from './tabs'

export const dynamic = 'force-dynamic'

// Unverified first, then oldest first -- a queue, not a feed.
const RANK: Record<OrderStage, number> = {
  awaiting_verification: 0, confirmed: 1, preparing: 2,
  ready: 3, out_for_delivery: 3, completed: 4, rejected: 5, cancelled: 5,
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: tabParam } = await searchParams
  const staff = await requireStaff()
  const db = await getServerClient()

  const now = new Date()
  const q = orderQueries(now)
  const select = ORDER_SELECT

  // Open orders are never limited: an old unverified payment must not vanish. The website
  // only deals with online orders; counter tickets belong to the till.
  const [checkRes, progressRes, doneRes] = await Promise.all([
    db.from('orders').select(select).eq('channel', 'online')
      .eq('payment_status', q.check.paymentStatus)
      .not('prep_status', 'in', `(${q.check.excludePrep.join(',')})`)
      .order('created_at', { ascending: false }),
    db.from('orders').select(select).eq('channel', 'online')
      .eq('payment_status', q.progress.paymentStatus)
      .in('prep_status', q.progress.prepStatuses)
      .order('created_at', { ascending: false }),
    db.from('orders').select(select).eq('channel', 'online')
      .in('prep_status', q.done.prepStatuses)
      .gte('created_at', q.done.since)
      .order('created_at', { ascending: false }).limit(100),
  ])
  const results = [
    ['check', checkRes], ['progress', progressRes], ['done', doneRes],
  ] as const
  const loadFailed = results.some(([, r]) => r.error)
  for (const [name, r] of results) {
    if (r.error) console.error(`Admin orders: ${name} query failed`, r.error)
  }
  const rows = [
    ...(checkRes.data ?? []), ...(progressRes.data ?? []), ...(doneRes.data ?? []),
  ] as unknown as OrderRow[]

  const orders: AdminOrder[] = rows
    .map(toAdminOrder)
    .sort((a, b) => RANK[a.stage] - RANK[b.stage])

  const counts = tabCounts(orders, now)
  const tab: OrderTab =
    parseTab(tabParam) ?? (counts.check > 0 ? 'check' : 'progress')
  const visible = ordersForTab(orders, tab, now)

  const dupes = duplicateReferences(
    orders.map((o) => ({ gcashReference: o.gcashReference, paymentStatus: o.paymentStatus })),
  )
  const tabs: { id: OrderTab; label: string }[] = [
    { id: 'check', label: `Needs checking (${counts.check})` },
    { id: 'progress', label: `In progress (${counts.progress})` },
    { id: 'done', label: 'Done' },
  ]

  return (
    <>
      <title>{counts.check > 0 ? `(${counts.check}) Kennko Admin` : 'Kennko Admin'}</title>
      <h1>Orders</h1>

      {loadFailed ? (
        <p className="admin-error" role="alert">
          Couldn&apos;t load all orders. Refresh the page; if it keeps happening, check the internet connection.
        </p>
      ) : null}

      <nav className="order-tabs" aria-label="Order views">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/admin/orders?tab=${t.id}`}
            className="order-tab"
            aria-current={t.id === tab ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {counts.check > 0 && tab === 'check' ? (
        <p className="admin-notice">
          {counts.check} order(s) awaiting a payment check. Verify the GCash
          reference before anyone starts making drinks.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <p className="admin-notice">No orders here.</p>
      ) : (
        <div className="admin-order-list">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              isDuplicateReference={
                order.gcashReference !== null && dupes.has(order.gcashReference.toUpperCase())
              }
              isOwner={staff.role === 'owner'}
            />
          ))}
        </div>
      )}
    </>
  )
}
