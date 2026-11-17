import { notFound } from 'next/navigation'
import { getMenu } from '@/lib/menu/queries'
import { getPublicClient } from '@/lib/supabase/public'
import { getCurrentCustomer } from '@/lib/auth/customer'
import { ridingDistanceKm, deliveryFeeCentavos } from '@/lib/delivery/distance'
import { OrderClient, type ModifierGroup, type Zone } from './OrderClient'
import './order.css'

export const dynamic = 'force-dynamic'

export default async function OrderPage() {
  if (process.env.NEXT_PUBLIC_ORDERING_ENABLED !== 'true') notFound()

  const db = getPublicClient()
  const categories = await getMenu()
  const customer = await getCurrentCustomer()

  const { data: groups } = await db
    .from('modifier_groups')
    .select('id, name, is_multi_select, sort_order, modifiers ( id, name, price_centavos, is_available, sort_order )')
    .order('sort_order')

  const { data: zones } = await db
    .from('delivery_zones')
    .select('barangay, is_home, latitude, longitude, fee_override_centavos')
    .eq('is_active', true)
    .order('sort_order')

  const modifierGroups: ModifierGroup[] = (groups ?? []).map((g: {
    id: string; name: string; is_multi_select: boolean
    modifiers: { id: string; name: string; price_centavos: number; is_available: boolean; sort_order: number }[]
  }) => ({
    id: g.id,
    name: g.name,
    isMultiSelect: g.is_multi_select,
    modifiers: (g.modifiers ?? [])
      .filter((m) => m.is_available)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((m) => ({ id: m.id, name: m.name, priceCentavos: m.price_centavos })),
  }))

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
