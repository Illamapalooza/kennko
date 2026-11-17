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
}

export type MenuCategoryWithItems = {
  id: string
  name: string
  items: MenuItemWithPrices[]
}
