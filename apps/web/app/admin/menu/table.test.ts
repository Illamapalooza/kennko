import { describe, expect, it } from 'vitest'
import { filterMenu, rowCells } from './table'
import type { AdminMenu, AdminTableItem } from '@/lib/menu/types'

function item(over: Partial<AdminTableItem> & { id: string; name: string }): AdminTableItem {
  return {
    description: null,
    imagePath: null,
    isBestseller: false,
    isAvailable: true,
    isArchived: false,
    categoryId: 'c1',
    prices: [{ code: 'M', priceCentavos: 8000, isArchived: false }],
    optionGroupIds: [],
    ...over,
  }
}

const menu: AdminMenu = {
  optionGroups: [],
  categories: [
    {
      id: 'c1',
      name: 'Coffee',
      kind: 'drink',
      items: [
        item({ id: 'i1', name: 'Café Latte' }),
        item({ id: 'i2', name: 'Americano', isAvailable: false }),
        item({ id: 'i3', name: 'Old Brew', isArchived: true }),
      ],
    },
    { id: 'c2', name: 'Food', kind: 'food', items: [item({ id: 'i4', name: 'Toast', categoryId: 'c2' })] },
  ],
}
const base = { query: '', categoryId: null, showArchived: false, soldOutOnly: false }
const names = (m: AdminMenu) => m.categories.flatMap((c) => c.items.map((i) => i.name))

describe('filterMenu', () => {
  it('finds accented names without accents, any case', () => {
    expect(names(filterMenu(menu, { ...base, query: 'CAFE' }))).toEqual(['Café Latte'])
    expect(names(filterMenu(menu, { ...base, query: 'café' }))).toEqual(['Café Latte'])
  })
  it('filters by category', () => {
    expect(names(filterMenu(menu, { ...base, categoryId: 'c2' }))).toEqual(['Toast'])
  })
  it('hides archived by default and shows them on request', () => {
    expect(names(filterMenu(menu, base))).not.toContain('Old Brew')
    expect(names(filterMenu(menu, { ...base, showArchived: true }))).toContain('Old Brew')
  })
  it('sold-out only', () => {
    expect(names(filterMenu(menu, { ...base, soldOutOnly: true }))).toEqual(['Americano'])
  })
  it('drops empty categories', () => {
    expect(filterMenu(menu, { ...base, query: 'toast' }).categories.map((c) => c.id)).toEqual(['c2'])
  })
})

describe('rowCells', () => {
  it('gives drinks M, L, XL, HOT with null for absent or archived', () => {
    const i = item({
      id: 'x',
      name: 'x',
      prices: [
        { code: 'M', priceCentavos: 8000, isArchived: false },
        { code: 'L', priceCentavos: 9000, isArchived: true },
      ],
    })
    expect(rowCells(i, 'drink')).toEqual([
      { code: 'M', label: 'M', priceCentavos: 8000 },
      { code: 'L', label: 'L', priceCentavos: null },
      { code: 'XL', label: 'XL', priceCentavos: null },
      { code: 'HOT', label: 'HOT', priceCentavos: null },
    ])
  })
  it('gives food one Single price cell', () => {
    const i = item({ id: 'x', name: 'x', prices: [{ code: 'REG', priceCentavos: 12000, isArchived: false }] })
    expect(rowCells(i, 'food')).toEqual([{ code: 'REG', label: 'Single price', priceCentavos: 12000 }])
  })
})
