export type DrinkSize = 'M' | 'L' | 'XL' | 'HOT'

export type MenuItemPrice = {
  size: DrinkSize
  priceCentavos: number
}

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
