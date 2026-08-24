import { getServerClient } from '@/lib/supabase/server'
import type { DrinkSize, MenuCategoryWithItems } from './types'

const SIZE_ORDER: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

type PriceRow = { size: string; price_centavos: number }

type ItemRow = {
  id: string
  name: string
  description: string | null
  image_path: string | null
  is_bestseller: boolean
  is_available: boolean
  sort_order: number
  menu_item_prices: PriceRow[]
}

type CategoryRow = {
  id: string
  name: string
  sort_order: number
  menu_items: ItemRow[]
}

export function mapMenuRows(rows: CategoryRow[]): MenuCategoryWithItems[] {
  return rows.map((category) => ({
    id: category.id,
    name: category.name,
    items: [...category.menu_items]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        imagePath: item.image_path,
        isBestseller: item.is_bestseller,
        isAvailable: item.is_available,
        prices: [...item.menu_item_prices]
          .sort(
            (a, b) =>
              SIZE_ORDER.indexOf(a.size as DrinkSize) -
              SIZE_ORDER.indexOf(b.size as DrinkSize),
          )
          .map((price) => ({
            size: price.size as DrinkSize,
            priceCentavos: price.price_centavos,
          })),
      })),
  }))
}

export async function getMenu(): Promise<MenuCategoryWithItems[]> {
  const db = await getServerClient()

  const { data, error } = await db
    .from('menu_categories')
    .select(
      `id, name, sort_order,
       menu_items ( id, name, description, image_path, is_bestseller,
                    is_available, sort_order,
                    menu_item_prices ( size, price_centavos ) )`,
    )
    .order('sort_order')

  if (error) throw new Error(`Failed to load menu: ${error.message}`)

  return mapMenuRows((data ?? []) as CategoryRow[])
}
