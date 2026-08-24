import { describe, expect, it } from 'vitest'
import { mapMenuRows } from './queries'

const rows = [
  {
    id: 'cat-1',
    name: 'Premium Classics',
    sort_order: 0,
    menu_items: [
      {
        id: 'item-2',
        name: 'Café Latte',
        description: null,
        image_path: null,
        is_bestseller: false,
        is_available: true,
        sort_order: 1,
        menu_item_prices: [{ size: 'M', price_centavos: 10000 }],
      },
      {
        id: 'item-1',
        name: 'Americano',
        description: null,
        image_path: null,
        is_bestseller: false,
        is_available: true,
        sort_order: 0,
        menu_item_prices: [
          { size: 'HOT', price_centavos: 9500 },
          { size: 'L', price_centavos: 9000 },
          { size: 'M', price_centavos: 8000 },
        ],
      },
    ],
  },
]

describe('mapMenuRows', () => {
  it('maps snake_case rows to camelCase domain types', () => {
    const [category] = mapMenuRows(rows)
    expect(category.name).toBe('Premium Classics')
    expect(category.items[0].isBestseller).toBe(false)
    expect(category.items[0].prices[0].priceCentavos).toBe(8000)
  })

  it('orders items by sort_order regardless of row order', () => {
    const [category] = mapMenuRows(rows)
    expect(category.items.map((i) => i.name)).toEqual(['Americano', 'Café Latte'])
  })

  it('orders prices M, L, XL, HOT regardless of row order', () => {
    const [category] = mapMenuRows(rows)
    expect(category.items[0].prices.map((p) => p.size)).toEqual(['M', 'L', 'HOT'])
  })

  it('returns an empty list for no rows', () => {
    expect(mapMenuRows([])).toEqual([])
  })
})
