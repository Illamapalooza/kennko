import type { DrinkSize, MenuItemPrice } from '@kennko/core'

// Sizes and prices are shared with the till.
export type { DrinkSize, MenuItemPrice }

export type MenuItemWithPrices = {
  id: string
  name: string
  description: string | null
  imagePath: string | null
  isBestseller: boolean
  isAvailable: boolean
  prices: MenuItemPrice[]
  /** The option groups linked to this item; only these may be offered (and accepted at checkout). */
  optionGroupIds: string[]
}

export type MenuCategoryWithItems = {
  id: string
  name: string
  items: MenuItemWithPrices[]
}

/** A variant code the admin can price: a drink size, or REG for food. */
export type VariantCode = DrinkSize | 'REG'

export type AdminMenuItem = Omit<MenuItemWithPrices, 'prices' | 'optionGroupIds'> & {
  prices: { size: VariantCode; priceCentavos: number }[]
}

export type AdminMenuCategory = {
  id: string
  name: string
  kind: 'drink' | 'food'
  items: AdminMenuItem[]
}
