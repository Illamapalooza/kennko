import { requireStaff } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { OrderCard, type AdminOrder } from '@/components/admin/OrderCard'
import { orderStage, ticketLabel, type OrderStage, type PaymentStatus, type PrepStatus } from '@kennko/core'
import { duplicateReferences, type Fulfilment } from './status'
import Link from 'next/link'
import { ordersForTab, tabCounts, orderQueries, parseTab, type OrderTab } from './tabs'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'

export const dynamic = 'force-dynamic'

type PaymentRow = {
  id: string; reference: string | null; proof_path: string | null
  status: string; recorded_at: string
}

type Row = {
  id: string; order_code: string; prep_status: PrepStatus; payment_status: PaymentStatus
  ticket_series: 'C' | 'W'; ticket_number: number; fulfilment: Fulfilment
  customer_name: string; customer_phone: string; customer_email: string
  delivery_address: string | null; delivery_barangay: string | null
  delivery_lat: string | null; delivery_lng: string | null
  delivery_distance_km: string | null
  fulfil_at: string; subtotal_centavos: number; delivery_fee_centavos: number
  total_centavos: number; customer_note: string | null
  created_at: string
  payments: PaymentRow[]
  order_lines: {
    item_name: string; variant_label: string; quantity: number
    ice_level: string | null; ice_serve: string | null; note: string | null
    order_line_options: { option_name: string }[]
  }[]
}

// Unverified first, then oldest first -- a queue, not a feed.
const RANK: Record<OrderStage, number> = {
  awaiting_verification: 0, confirmed: 1, preparing: 2,
  ready: 3, out_for_delivery: 3, completed: 4, rejected: 5, cancelled: 5,
}

/** The payment staff act on: the live (non-rejected) one, else the newest. */
function livePayment(payments: PaymentRow[]): PaymentRow | null {
  const newestFirst = [...payments].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))
  return newestFirst.find((p) => p.status !== 'rejected') ?? newestFirst[0] ?? null
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
  const select = `id, order_code, prep_status, payment_status, ticket_series, ticket_number,
       fulfilment, customer_name, customer_phone,
       customer_email, delivery_address, delivery_barangay,
       delivery_lat, delivery_lng, delivery_distance_km, fulfil_at,
       subtotal_centavos, delivery_fee_centavos, total_centavos,
       customer_note, created_at,
       payments ( id, reference, proof_path, status, recorded_at ),
       order_lines ( item_name, variant_label, quantity, ice_level, ice_serve, note,
                     order_line_options ( option_name ) )`

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
  ] as unknown as Row[]

  const orders: AdminOrder[] = rows
    .map((r) => {
      const payment = livePayment(r.payments ?? [])
      return {
        id: r.id,
        orderCode: r.order_code,
        ticket: ticketLabel(r.ticket_series, r.ticket_number),
        prepStatus: r.prep_status,
        paymentStatus: r.payment_status,
        stage: orderStage(r.prep_status, r.payment_status),
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
        paymentId: payment?.id ?? null,
        gcashReference: payment?.reference ?? null,
        proofPath: payment?.proof_path ?? null,
        customerNote: r.customer_note,
        createdAt: r.created_at,
        items: (r.order_lines ?? []).map((i) => ({
          name: i.item_name,
          variantLabel: i.variant_label,
          quantity: i.quantity,
          modifiers: (i.order_line_options ?? []).map((m) => m.option_name),
          ice: iceSummary(
            i.ice_level as IceLevel | null,
            i.ice_serve as IceServe | null,
          ),
          note: i.note,
        })),
      }
    })
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
