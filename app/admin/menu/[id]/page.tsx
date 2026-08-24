import { notFound } from 'next/navigation'
import { requireOwner } from '@/lib/auth/session'
import { getServerClient } from '@/lib/supabase/server'
import { menuImageUrl } from '../format'
import { MenuItemForm } from '@/components/admin/MenuItemForm'
import type { DrinkSize } from '@/lib/menu/types'

export default async function EditMenuItemPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireOwner()
  const { id } = await params
  const db = await getServerClient()

  const { data: item } = await db
    .from('menu_items')
    .select(
      'id, name, description, image_path, is_bestseller, is_available, category_id, menu_item_prices ( size, price_centavos )',
    )
    .eq('id', id)
    .maybeSingle()

  if (!item) notFound()

  const { data: categories } = await db
    .from('menu_categories')
    .select('id, name')
    .order('sort_order')

  return (
    <>
      <h1>Edit {item.name}</h1>
      <MenuItemForm
        categories={categories ?? []}
        item={{
          id: item.id,
          name: item.name,
          description: item.description,
          imagePath: item.image_path,
          imageUrl: menuImageUrl(item.image_path),
          isBestseller: item.is_bestseller,
          isAvailable: item.is_available,
          categoryId: item.category_id,
          prices: (item.menu_item_prices ?? []).map(
            (p: { size: string; price_centavos: number }) => ({
              size: p.size as DrinkSize,
              priceCentavos: p.price_centavos,
            }),
          ),
        }}
      />
    </>
  )
}
