import { notFound } from 'next/navigation'
import { getMenu } from '@/lib/menu/queries'
import { getPublicClient } from '@/lib/supabase/public'
import { OrderClient, type ModifierGroup, type Zone } from './OrderClient'
import './order.css'

export const dynamic = 'force-dynamic'

export default async function OrderPage() {
  if (process.env.NEXT_PUBLIC_ORDERING_ENABLED !== 'true') notFound()

  const db = getPublicClient()
  const categories = await getMenu()

  const { data: groups } = await db
    .from('modifier_groups')
    .select('id, name, is_multi_select, sort_order, modifiers ( id, name, price_centavos, is_available, sort_order )')
    .order('sort_order')

  const { data: zones } = await db
    .from('delivery_zones')
    .select('barangay, fee_centavos')
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

  const deliveryZones: Zone[] = (zones ?? []).map(
    (z: { barangay: string; fee_centavos: number }) => ({
      barangay: z.barangay,
      feeCentavos: z.fee_centavos,
    }),
  )

  return (
    <div className="order-shell">
      <div className="order-main">
        <OrderClient
          categories={categories}
          modifierGroups={modifierGroups}
          zones={deliveryZones}
        />
      </div>
    </div>
  )
}
