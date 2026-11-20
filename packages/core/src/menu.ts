export type DrinkSize = 'M' | 'L' | 'XL' | 'HOT'

export const SIZE_ORDER: DrinkSize[] = ['M', 'L', 'XL', 'HOT']

export const SIZE_LABELS: Record<DrinkSize, string> = { M: 'Medium', L: 'Large', XL: 'XL', HOT: 'Hot' }

export type MenuItemPrice = { size: DrinkSize; priceCentavos: number }

export type MenuItem = {
  id: string
  name: string
  isBestseller: boolean
  isAvailable: boolean
  prices: MenuItemPrice[]
}

export type MenuCategory = { id: string; name: string; items: MenuItem[] }

export type Modifier = { id: string; name: string; priceCentavos: number; isAvailable: boolean }

export type ModifierGroup = { id: string; name: string; isMultiSelect: boolean; modifiers: Modifier[] }

export type Menu = {
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  /** Where this copy came from and when, so staff can tell a stale menu. */
  source: 'built-in' | 'website'
  updatedAt: number
  /** Published menu version this copy came from, when it came from a snapshot. */
  version?: number
}

export function findItem(menu: Menu, id: string): MenuItem | undefined {
  for (const category of menu.categories) {
    const item = category.items.find((i) => i.id === id)
    if (item) return item
  }
  return undefined
}
