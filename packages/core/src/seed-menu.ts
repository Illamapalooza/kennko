export type SeedPrice = { M: number; L: number; XL: number | null; HOT: number | null }

export type SeedItem = {
  name: string
  isBestseller: boolean
  prices: SeedPrice
}

export type SeedCategory = {
  name: string
  sortOrder: number
  items: SeedItem[]
}

const p = (m: number, l: number, xl: number | null, hot: number | null): SeedPrice => ({
  M: m * 100,
  L: l * 100,
  XL: xl === null ? null : xl * 100,
  HOT: hot === null ? null : hot * 100,
})

export const SEED_CATEGORIES: SeedCategory[] = [
  {
    name: 'Premium Classics',
    sortOrder: 0,
    items: [
      { name: 'Americano',         isBestseller: false, prices: p(80, 90, 100, 95) },
      { name: 'Café Latte',        isBestseller: false, prices: p(100, 115, 130, 125) },
      { name: 'Vanilla Latte',     isBestseller: false, prices: p(105, 125, 135, 135) },
      { name: 'Hazelnut Latte',    isBestseller: false, prices: p(105, 125, 135, 135) },
      { name: 'Spanish Latte',     isBestseller: true,  prices: p(105, 125, 135, 135) },
      { name: 'White Café Mocha',  isBestseller: true,  prices: p(110, 130, 140, 135) },
      { name: 'Dark Café Mocha',   isBestseller: false, prices: p(110, 130, 140, 135) },
      { name: 'Caramel Macchiato', isBestseller: true,  prices: p(110, 130, 140, 135) },
    ],
  },
  {
    name: "Barista's Choice",
    sortOrder: 1,
    items: [
      { name: 'Vietnamese Coffee',    isBestseller: false, prices: p(110, 130, 140, 135) },
      { name: 'Egg Coffee',           isBestseller: true,  prices: p(125, 145, 165, 155) },
      { name: 'Coconut Coffee',       isBestseller: false, prices: p(125, 145, 160, 155) },
      { name: 'Sea Salt Caramel Oat', isBestseller: true,  prices: p(130, 150, 170, 160) },
      { name: 'Honey Oat Latte',      isBestseller: false, prices: p(130, 150, 170, 160) },
    ],
  },
  {
    name: 'Sweet Sips',
    sortOrder: 2,
    items: [
      { name: 'Strawberry Milk',   isBestseller: true,  prices: p(105, 125, 135, null) },
      { name: 'Strawberry Matcha', isBestseller: true,  prices: p(125, 145, 155, null) },
      { name: 'Signature Choco',   isBestseller: true,  prices: p(105, 125, 135, 135) },
      { name: 'Choco-Coconut',     isBestseller: true,  prices: p(125, 145, 155, null) },
      { name: 'Vanilla Milk',      isBestseller: false, prices: p(105, 125, 135, 135) },
    ],
  },
  {
    name: 'Matcha Series',
    sortOrder: 3,
    items: [
      { name: 'Matcha',       isBestseller: true,  prices: p(115, 135, 145, 145) },
      { name: 'Matcha Coco',  isBestseller: false, prices: p(135, 155, 175, 165) },
      { name: 'Dirty Matcha', isBestseller: false, prices: p(140, 160, 180, 170) },
      { name: 'Hojicha',      isBestseller: true,  prices: p(140, 160, null, 160) },
    ],
  },
]

export type SeedModifierGroup = {
  name: string
  isMultiSelect: boolean
  sortOrder: number
  modifiers: { name: string; priceCentavos: number }[]
}

export const SEED_MODIFIER_GROUPS: SeedModifierGroup[] = [
  {
    name: 'Add-ons',
    isMultiSelect: true,
    sortOrder: 0,
    modifiers: [
      { name: 'Espresso Shots', priceCentavos: 3500 },
      { name: 'Milk',           priceCentavos: 2000 },
      { name: 'Sugar Syrup',    priceCentavos: 2000 },
      { name: 'Milk Syrup',     priceCentavos: 2500 },
      { name: 'Flavor Sauce',   priceCentavos: 3000 },
    ],
  },
  {
    name: 'Milk of Choice',
    isMultiSelect: false,
    sortOrder: 1,
    modifiers: [
      { name: 'Oat Milk', priceCentavos: 4000 },
      { name: 'Soy Milk', priceCentavos: 3500 },
    ],
  },
  {
    name: 'Cream Supreme',
    isMultiSelect: false,
    sortOrder: 2,
    modifiers: [
      { name: 'Salty Vanilla Cream', priceCentavos: 5000 },
      { name: 'Choco Cream',         priceCentavos: 4500 },
      { name: 'Matcha Cream',        priceCentavos: 6500 },
      { name: 'Coconut Cream',       priceCentavos: 5000 },
    ],
  },
]

export type SeedFood = {
  name: string
  priceCentavos: number
  /** A required pick-one flavour group, when the item has one. */
  flavours: { groupName: string; options: string[] } | null
}

/**
 * The food the published menu carries (migration 0012: one `REG` variant each, flavours free). Only the till's built-in
 * menu reads this, so a till that never pulled the menu can still sell food; the website's seeder seeds drinks only.
 */
export const SEED_FOOD: SeedFood[] = [
  { name: 'Cookies',  priceCentavos: 6000, flavours: { groupName: 'Cookie flavour', options: ['Original', 'Chocolate', 'Red Velvet'] } },
  { name: 'Empanada', priceCentavos: 4500, flavours: null },
  { name: 'Fries',    priceCentavos: 8500, flavours: { groupName: 'Fries flavour', options: ['Original', 'Cheese', 'BBQ', 'Sour Cream'] } },
]
