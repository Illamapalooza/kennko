import { requireStaff } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { OrderCard, type AdminOrder } from '@/components/admin/OrderCard'
import { duplicateReferences, type OrderStatus, type Fulfilment } from './status'
import Link from 'next/link'
import { ordersForTab, tabCounts, orderQueries, parseTab, type OrderTab } from './tabs'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'

export const dynamic = 'force-dynamic'

type Row = {
  id: string; order_code: string; status: OrderStatus; fulfilment: Fulfilment
  customer_name: string; customer_phone: string; customer_email: string
  delivery_address: string | null; delivery_barangay: string | null
  delivery_lat: string | null; delivery_lng: string | null
  delivery_distance_km: string | null
  fulfil_at: string; subtotal_centavos: number; delivery_fee_centavos: number
  total_centavos: number; gcash_reference: string; payment_proof_path: string
  customer_note: string | null
  created_at: string
  order_items: {
    name_snapshot: string; size: string; quantity: number
    ice_level: string | null; ice_serve: string | null; item_note: string | null
    order_item_modifiers: { name_snapshot: string }[]
  }[]
}

// Unverified first, then oldest first -- a queue, not a feed.
const RANK: Record<string, number> = {
  awaiting_verification: 0, confirmed: 1, preparing: 2,
  ready: 3, out_for_delivery: 3, completed: 4, rejected: 5, cancelled: 5,
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: tabParam } = await searchParams
  await requireStaff()
  const db = await getServerClient()

  const now = new Date()
  const q = orderQueries(now)
  const select = `id, order_code, status, fulfilment, customer_name, customer_phone,
       customer_email, delivery_address, delivery_barangay,
       delivery_lat, delivery_lng, delivery_distance_km, fulfil_at,
       subtotal_centavos, delivery_fee_centavos, total_centavos,
       gcash_reference, payment_proof_path, customer_note, created_at,
       order_items ( name_snapshot, size, quantity, ice_level, ice_serve, item_note,
                     order_item_modifiers ( name_snapshot ) )`

  // Open orders are never limited: an old unverified payment must not vanish.
  const [openRes, doneRes] = await Promise.all([
    db.from('orders').select(select).in('status', q.openStatuses)
      .order('created_at', { ascending: false }),
    db.from('orders').select(select).in('status', q.doneStatuses)
      .gte('created_at', q.doneSince)
      .order('created_at', { ascending: false }).limit(100),
  ])
  const data = [...(openRes.data ?? []), ...(doneRes.data ?? [])]

  const rows = (data ?? []) as Row[]

  const orders: AdminOrder[] = rows
    .map((r) => ({
      id: r.id,
      orderCode: r.order_code,
      status: r.status,
      fulfilment: r.fulfilment,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      customerEmail: r.customer_email,
      deliveryAddress: r.delivery_address,
      deliveryBarangay: r.delivery_barangay,
      deliveryLat: r.delivery_lat === null ? null : Number(r.delivery_lat),
      deliveryLng: r.delivery_lng === null ? null : Number(r.delivery_lng),
      deliveryDistanceKm:
        r.delivery_distance_km === null ? null : Number(r.delivery_distance_km),
      fulfilAt: r.fulfil_at,
      subtotalCentavos: r.subtotal_centavos,
      deliveryFeeCentavos: r.delivery_fee_centavos,
      totalCentavos: r.total_centavos,
      gcashReference: r.gcash_reference,
      paymentProofPath: r.payment_proof_path,
      customerNote: r.customer_note,
      createdAt: r.created_at,
      items: (r.order_items ?? []).map((i) => ({
        name: i.name_snapshot,
        size: i.size,
        quantity: i.quantity,
        modifiers: (i.order_item_modifiers ?? []).map((m) => m.name_snapshot),
        ice: iceSummary(
          i.ice_level as IceLevel | null,
          i.ice_serve as IceServe | null,
        ),
        note: i.item_note,
      })),
    }))
    .sort((a, b) => RANK[a.status] - RANK[b.status])

  const counts = tabCounts(orders, now)
  const tab: OrderTab =
    parseTab(tabParam) ?? (counts.check > 0 ? 'check' : 'progress')
  const visible = ordersForTab(orders, tab, now)

  const dupes = duplicateReferences(
    orders.map((o) => ({ gcashReference: o.gcashReference, status: o.status })),
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
              isDuplicateReference={dupes.has(order.gcashReference.toUpperCase())}
            />
          ))}
        </div>
      )}
    </>
  )
}
