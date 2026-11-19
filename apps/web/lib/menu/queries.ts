import { liveDrinkMenu, type MenuSnapshot } from '@kennko/core'
import { fetchMenuSnapshot } from './api'
import type { DrinkSize, MenuCategoryWithItems } from './types'

// Row mapping for the admin screens, which still read the tables directly.
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

export type FoodItem = {
  id: string
  name: string
  options: string[]
  priceCentavos: number
  isAvailable: boolean
}

/** Drink categories in the website's shape, prices from the M/L/XL/HOT variants. */
export function menuFromSnapshot(s: MenuSnapshot | null): MenuCategoryWithItems[] {
  if (!s) return []
  const extras = new Map(
    s.categories.flatMap((c) => c.items).map((i) => [i.id, i] as const),
  )
  return liveDrinkMenu(s, 0).categories.map((category) => ({
    id: category.id,
    name: category.name,
    items: category.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: extras.get(item.id)?.description ?? null,
      imagePath: extras.get(item.id)?.imagePath ?? null,
      isBestseller: item.isBestseller,
      isAvailable: item.isAvailable,
      prices: item.prices,
    })),
  }))
}

/**
 * Food board rows. `options` are the option names of the item's first required group; an item
 * with no group shows its description as its single bullet.
 */
export function foodFromSnapshot(s: MenuSnapshot | null): FoodItem[] {
  if (!s) return []
  const groups = new Map(s.optionGroups.map((g) => [g.id, g] as const))
  return s.categories
    .filter((c) => c.kind === 'food')
    .flatMap((c) => c.items)
    .map((item) => {
      const group = item.optionGroupIds
        .map((id) => groups.get(id))
        .find((g) => g !== undefined && g.minSelect >= 1)
      const options = group
        ? group.options.filter((o) => o.isAvailable).map((o) => o.name)
        : item.description
          ? [item.description]
          : []
      const reg = item.variants.find((v) => v.code === 'REG')
      return {
        id: item.id,
        name: item.name,
        options,
        priceCentavos: reg?.priceCentavos ?? 0,
        isAvailable: item.isAvailable && (reg?.isAvailable ?? false),
      }
    })
}

export async function getMenu(): Promise<MenuCategoryWithItems[]> {
  return menuFromSnapshot(await fetchMenuSnapshot())
}

export async function getFoodMenu(): Promise<FoodItem[]> {
  return foodFromSnapshot(await fetchMenuSnapshot())
}
