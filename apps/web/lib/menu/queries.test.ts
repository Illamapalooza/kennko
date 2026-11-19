import { describe, expect, it } from 'vitest'
import type { MenuSnapshot } from '@kennko/core'
import { foodFromSnapshot, mapMenuRows, menuFromSnapshot } from './queries'

const rows = [
  {
    id: 'cat-1',
    name: 'Premium Classics',
    kind: 'drink' as const,
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
        menu_variants: [{ code: 'M', price_centavos: 10000, is_archived: false }],
      },
      {
        id: 'item-1',
        name: 'Americano',
        description: null,
        image_path: null,
        is_bestseller: false,
        is_available: true,
        sort_order: 0,
        menu_variants: [
          { code: 'HOT', price_centavos: 9500, is_archived: false },
          { code: 'L', price_centavos: 9000, is_archived: false },
          { code: 'M', price_centavos: 8000, is_archived: false },
          { code: 'XL', price_centavos: 9900, is_archived: true },
        ],
      },
    ],
  },
]

const v = (code: string, priceCentavos: number, isAvailable = true) => ({
  id: `v-${code}-${priceCentavos}`,
  code,
  label: code,
  priceCentavos,
  temperature: 'none' as const,
  isAvailable,
})

const snapshot: MenuSnapshot = {
  version: 1,
  publishedAt: '2026-11-20T00:00:00.000Z',
  discountPresets: [],
  optionGroups: [
    {
      id: 'g-cookie',
      name: 'Cookie flavour',
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: 'o1', name: 'Original', priceCentavos: 0, isAvailable: true },
        { id: 'o2', name: 'Chocolate', priceCentavos: 0, isAvailable: true },
        { id: 'o3', name: 'Red Velvet', priceCentavos: 0, isAvailable: true },
      ],
    },
  ],
  categories: [
    {
      id: 'c1',
      name: 'Premium Classics',
      kind: 'drink',
      items: [
        {
          id: 'i1',
          name: 'Americano',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          optionGroupIds: [],
          variants: [v('HOT', 9500), v('L', 9000), v('M', 8000)],
        },
      ],
    },
    {
      id: 'c2',
      name: 'Food',
      kind: 'food',
      items: [
        {
          id: 'f1',
          name: 'Cookies',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          optionGroupIds: ['g-cookie'],
          variants: [v('REG', 6000)],
        },
        {
          id: 'f2',
          name: 'Empanada',
          description: 'Chicken',
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          optionGroupIds: [],
          variants: [v('REG', 4500)],
        },
      ],
    },
  ],
}

describe('menuFromSnapshot', () => {
  it('returns [] for null', () => {
    expect(menuFromSnapshot(null)).toEqual([])
  })

  it('maps drink variants to sizes in order', () => {
    const [category] = menuFromSnapshot(snapshot)
    expect(category.items[0].prices).toEqual([
      { size: 'M', priceCentavos: 8000 },
      { size: 'L', priceCentavos: 9000 },
      { size: 'HOT', priceCentavos: 9500 },
    ])
  })

  it("carries each item's own optionGroupIds through", () => {
    const withGroups: MenuSnapshot = {
      ...snapshot,
      categories: snapshot.categories.map((c) =>
        c.kind === 'drink'
          ? { ...c, items: c.items.map((i) => ({ ...i, optionGroupIds: ['g-milk'] })) }
          : c,
      ),
    }
    expect(menuFromSnapshot(withGroups)[0].items[0].optionGroupIds).toEqual(['g-milk'])
    expect(menuFromSnapshot(snapshot)[0].items[0].optionGroupIds).toEqual([])
  })

  it('leaves food out of the drink list', () => {
    expect(menuFromSnapshot(snapshot).map((c) => c.name)).toEqual(['Premium Classics'])
  })
})

describe('foodFromSnapshot', () => {
  it('returns [] for null', () => {
    expect(foodFromSnapshot(null)).toEqual([])
  })

  it('lists Cookies with its three flavours at ₱60', () => {
    const cookies = foodFromSnapshot(snapshot).find((f) => f.name === 'Cookies')
    expect(cookies?.options).toEqual(['Original', 'Chocolate', 'Red Velvet'])
    expect(cookies?.priceCentavos).toBe(6000)
  })

  it('shows the description as the single bullet when there is no group', () => {
    const empanada = foodFromSnapshot(snapshot).find((f) => f.name === 'Empanada')
    expect(empanada?.options).toEqual(['Chicken'])
  })

  it('skips a food item with no REG variant instead of showing 0', () => {
    const noReg: MenuSnapshot = {
      ...snapshot,
      categories: snapshot.categories.map((c) =>
        c.kind === 'food'
          ? {
              ...c,
              items: c.items.map((i) =>
                i.name === 'Empanada' ? { ...i, variants: i.variants.filter((v) => v.code !== 'REG') } : i,
              ),
            }
          : c,
      ),
    }
    const names = foodFromSnapshot(noReg).map((f) => f.name)
    expect(names).not.toContain('Empanada')
    expect(names).toContain('Cookies')
  })
})

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

  it('leaves archived variants out and carries the category kind', () => {
    const [category] = mapMenuRows(rows)
    expect(category.kind).toBe('drink')
    expect(category.items[0].prices.map((p) => p.size)).not.toContain('XL')
  })

  it('returns an empty list for no rows', () => {
    expect(mapMenuRows([])).toEqual([])
  })
})
