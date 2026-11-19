import { notFound } from 'next/navigation'
import Link from 'next/link'
import { liveDrinkMenu, type MenuSnapshot } from '@kennko/core'
import { fetchMenuSnapshot } from '@/lib/menu/api'
import { menuFromSnapshot } from '@/lib/menu/queries'
import { getPublicClient } from '@/lib/supabase/public'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { ridingDistanceKm, deliveryFeeCentavos } from '@/lib/delivery/distance'
import { OrderClient, type ModifierGroup, type Zone } from './OrderClient'
import './order.css'

export const dynamic = 'force-dynamic'

export default async function OrderPage() {
  if (process.env.NEXT_PUBLIC_ORDERING_ENABLED !== 'true') notFound()

  const db = getPublicClient()
  let snapshot: MenuSnapshot | null
  try {
    snapshot = await fetchMenuSnapshot()
  } catch (err) {
    console.error('Could not load the menu for /order', err)
    return (
      <div className="order-shell">
        <div className="order-card">
          <h1>The menu can&rsquo;t load right now</h1>
          <p>Please try again in a minute, or message us on Facebook.</p>
          <p>
            <Link href="/">Back to the home page</Link>
          </p>
        </div>
      </div>
    )
  }
  const categories = menuFromSnapshot(snapshot)
  const customer = await getCurrentCustomer()

  const { data: zones } = await db
    .from('delivery_zones')
    .select('barangay, is_home, latitude, longitude, fee_override_centavos')
    .eq('is_active', true)
    .order('sort_order')

  // An unavailable modifier is never offered.
  const modifierGroups: ModifierGroup[] = snapshot
    ? liveDrinkMenu(snapshot, Date.now()).modifierGroups.map((g) => ({
        id: g.id,
        name: g.name,
        isMultiSelect: g.isMultiSelect,
        modifiers: g.modifiers
          .filter((m) => m.isAvailable)
          .map((m) => ({ id: m.id, name: m.name, priceCentavos: m.priceCentavos })),
      }))
    : []

  // Quoted with the same function the server charges with, so the price shown
  // before payment is the price recomputed after it.
  const deliveryZones: Zone[] = (zones ?? []).map(
    (z: {
      barangay: string; is_home: boolean
      latitude: string | null; longitude: string | null
      fee_override_centavos: number | null
    }) => {
      const km =
        z.latitude !== null && z.longitude !== null
          ? ridingDistanceKm({ lat: Number(z.latitude), lng: Number(z.longitude) })
          : 0
      return {
        barangay: z.barangay,
        isHome: z.is_home,
        distanceKm: km,
        feeCentavos:
          z.fee_override_centavos ?? deliveryFeeCentavos(km, z.is_home),
      }
    },
  )

  return (
    <div className="order-shell">
      <OrderClient
        categories={categories}
        modifierGroups={modifierGroups}
        zones={deliveryZones}
        customer={
          customer ? { name: customer.name, email: customer.email } : null
        }
      />
    </div>
  )
}
