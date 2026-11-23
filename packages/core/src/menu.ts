/** A line's variant code. Drinks come in M/L/XL/HOT; food (Cookies, Empanada, Fries) has the one `REG` variant. */
export type DrinkSize = 'M' | 'L' | 'XL' | 'HOT' | 'REG'

/** A drink's cup size: every size but food's `REG`. */
export type CupSize = Exclude<DrinkSize, 'REG'>

/** The drink sizes, in board order. */
export const SIZE_ORDER: CupSize[] = ['M', 'L', 'XL', 'HOT']

/** Food's only variant code, as published in `menu_variants` (migration 0012). */
export const FOOD_SIZE: DrinkSize = 'REG'

export const SIZE_LABELS: Record<DrinkSize, string> = { M: 'Medium', L: 'Large', XL: 'XL', HOT: 'Hot', REG: 'Regular' }

/** The size shown next to a line's name ("Matcha L"). Food has one size, so it shows none. */
export function sizeTag(size: string): string {
  return size === FOOD_SIZE ? '' : size
}

export type MenuItemPrice = { size: DrinkSize; priceCentavos: number }

export type MenuItem = {
  id: string
  name: string
  isBestseller: boolean
  isAvailable: boolean
  prices: MenuItemPrice[]
  /** The add-on groups this drink offers (from a published snapshot). Absent: every group (built-in or old menu.json). */
  modifierGroupIds?: string[]
}

export type MenuCategory = {
  id: string
  name: string
  items: MenuItem[]
  /** Food categories hold items with the one `REG` size and no ice. Absent: drinks (built-in or old menu.json). */
  kind?: 'drink' | 'food'
}

export type Modifier = { id: string; name: string; priceCentavos: number; isAvailable: boolean }

export type ModifierGroup = {
  id: string
  name: string
  isMultiSelect: boolean
  modifiers: Modifier[]
  /** How many must be picked (a food flavour: 1). Absent or 0: optional, like a drink's add-ons. */
  minSelect?: number
}

export type Menu = {
  categories: MenuCategory[]
  modifierGroups: ModifierGroup[]
  /** Where this copy came from and when, so staff can tell a stale menu. */
  source: 'built-in' | 'website'
  updatedAt: number
  /** Published menu version this copy came from, when it came from a snapshot. */
  version?: number
}

/** True when the item sits in a food category. */
export function isFoodItem(menu: Menu, id: string): boolean {
  return menu.categories.some((c) => c.kind === 'food' && c.items.some((i) => i.id === id))
}

export function findItem(menu: Menu, id: string): MenuItem | undefined {
  for (const category of menu.categories) {
    const item = category.items.find((i) => i.id === id)
    if (item) return item
  }
  return undefined
}
