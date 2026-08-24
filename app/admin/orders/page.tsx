import { requireStaff } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { OrderCard, type AdminOrder } from '@/components/admin/OrderCard'
import { duplicateReferences, type OrderStatus, type Fulfilment } from './status'
import { iceSummary, type IceLevel, type IceServe } from '@/lib/cart/ice'

export const dynamic = 'force-dynamic'

type Row = {
  id: string; order_code: string; status: OrderStatus; fulfilment: Fulfilment
  customer_name: string; customer_phone: string; customer_email: string
  delivery_address: string | null; delivery_barangay: string | null
  fulfil_at: string; subtotal_centavos: number; delivery_fee_centavos: number
  total_centavos: number; gcash_reference: string; payment_proof_path: string
  customer_note: string | null
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

export default async function AdminOrdersPage() {
  await requireStaff()
  const db = await getServerClient()

  const { data } = await db
    .from('orders')
    .select(
      `id, order_code, status, fulfilment, customer_name, customer_phone,
       customer_email, delivery_address, delivery_barangay, fulfil_at,
       subtotal_centavos, delivery_fee_centavos, total_centavos,
       gcash_reference, payment_proof_path, customer_note,
       order_items ( name_snapshot, size, quantity, ice_level, ice_serve, item_note,
                     order_item_modifiers ( name_snapshot ) )`,
    )
    .order('created_at', { ascending: false })
    .limit(100)

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
      fulfilAt: r.fulfil_at,
      subtotalCentavos: r.subtotal_centavos,
      deliveryFeeCentavos: r.delivery_fee_centavos,
      totalCentavos: r.total_centavos,
      gcashReference: r.gcash_reference,
      paymentProofPath: r.payment_proof_path,
      customerNote: r.customer_note,
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

  const dupes = duplicateReferences(
    orders.map((o) => ({ gcashReference: o.gcashReference, status: o.status })),
  )
  const unverified = orders.filter((o) => o.status === 'awaiting_verification').length

  return (
    <>
      <title>{unverified > 0 ? `(${unverified}) Kennko Admin` : 'Kennko Admin'}</title>
      <h1>Orders</h1>

      {orders.length === 0 ? (
        <p className="admin-notice">No orders yet.</p>
      ) : (
        <>
          {unverified > 0 ? (
            <p className="admin-notice">
              {unverified} order(s) awaiting a payment check. Verify the GCash
              reference before anyone starts making drinks.
            </p>
          ) : null}

          <div className="admin-order-list">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                isDuplicateReference={dupes.has(order.gcashReference.toUpperCase())}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
