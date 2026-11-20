import { expect, test } from 'vitest'
import { liveDrinkMenu, type MenuSnapshot } from './snapshot.ts'
import { OrderError, priceLine } from './cart.ts'
import { repriceCounterOrder } from './sync.ts'

const variant = (code: string, priceCentavos: number, isAvailable = true) => ({
  id: `v-${code}`,
  code,
  label: code,
  priceCentavos,
  temperature: 'none' as const,
  isAvailable,
})

const snapshot: MenuSnapshot = {
  version: 3,
  publishedAt: '2026-11-20T00:00:00.000Z',
  categories: [
    {
      id: 'c-drinks',
      name: 'Coffee',
      kind: 'drink',
      items: [
        {
          id: 'i-latte',
          name: 'Latte',
          description: null,
          imagePath: null,
          isBestseller: true,
          isAvailable: true,
          variants: [variant('HOT', 9000), variant('XL', 14000), variant('M', 10000), variant('L', 12000), variant('SLICE', 5000)],
          optionGroupIds: ['g-sugar', 'g-addons'],
        },
        {
          id: 'i-off',
          name: 'Off Latte',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: false,
          variants: [variant('M', 10000)],
          optionGroupIds: [],
        },
        {
          id: 'i-novariant',
          name: 'Slice Only',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          variants: [variant('SLICE', 5000)],
          optionGroupIds: [],
        },
      ],
    },
    {
      id: 'c-food',
      name: 'Food',
      kind: 'food',
      items: [
        {
          id: 'i-cake',
          name: 'Cake',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          variants: [variant('M', 8000)],
          optionGroupIds: ['g-food'],
        },
      ],
    },
  ],
  optionGroups: [
    { id: 'g-sugar', name: 'Sugar', minSelect: 0, maxSelect: 1, options: [{ id: 'o-1', name: 'Less', priceCentavos: 0, isAvailable: true }] },
    { id: 'g-addons', name: 'Add-ons', minSelect: 0, maxSelect: 5, options: [{ id: 'o-2', name: 'Shot', priceCentavos: 2000, isAvailable: false }] },
    { id: 'g-food', name: 'Food only', minSelect: 0, maxSelect: 1, options: [] },
  ],
  discountPresets: [],
}

test('drops food categories', () => {
  const menu = liveDrinkMenu(snapshot, 123)
  expect(menu.categories.map((c) => c.id)).toEqual(['c-drinks'])
  expect(menu.source).toBe('website')
  expect(menu.updatedAt).toBe(123)
  expect(menu.modifierGroups.map((g) => g.id)).toEqual(['g-sugar', 'g-addons'])
})

test('keeps only M/L/XL/HOT variants in size order', () => {
  const menu = liveDrinkMenu(snapshot, 0)
  const latte = menu.categories[0]!.items.find((i) => i.id === 'i-latte')!
  expect(latte.prices).toEqual([
    { size: 'M', priceCentavos: 10000 },
    { size: 'L', priceCentavos: 12000 },
    { size: 'XL', priceCentavos: 14000 },
    { size: 'HOT', priceCentavos: 9000 },
  ])
  expect(menu.categories[0]!.items.some((i) => i.id === 'i-novariant')).toBe(false)
})

test('maps max_select 5 to multi-select and 1 to single', () => {
  const menu = liveDrinkMenu(snapshot, 0)
  const byId = Object.fromEntries(menu.modifierGroups.map((g) => [g.id, g]))
  expect(byId['g-addons']!.isMultiSelect).toBe(true)
  expect(byId['g-sugar']!.isMultiSelect).toBe(false)
  expect(byId['g-addons']!.modifiers).toEqual([{ id: 'o-2', name: 'Shot', priceCentavos: 2000, isAvailable: false }])
})

test('marks an item unavailable when isAvailable is false', () => {
  const menu = liveDrinkMenu(snapshot, 0)
  const off = menu.categories[0]!.items.find((i) => i.id === 'i-off')!
  expect(off.isAvailable).toBe(false)
})

test('drops a sold-out variant from prices', () => {
  const soldOut: MenuSnapshot = {
    ...snapshot,
    categories: snapshot.categories.map((c) => ({
      ...c,
      items: c.items.map((i) => ({
        ...i,
        variants: i.variants.map((v) => (v.code === 'XL' ? { ...v, isAvailable: false } : v)),
      })),
    })),
  }
  const latte = liveDrinkMenu(soldOut, 0).categories[0]!.items.find((i) => i.id === 'i-latte')!
  expect(latte.prices.map((p) => p.size)).toEqual(['M', 'L', 'HOT'])
})

test('liveDrinkMenu carries the snapshot version', () => {
  expect(liveDrinkMenu(snapshot, 0).version).toBe(snapshot.version)
})

test("a drink takes add-ons only from its own linked groups, like the API's repricing", () => {
  const snap: MenuSnapshot = {
    version: 7,
    publishedAt: '2026-11-20T00:00:00.000Z',
    categories: [{
      id: 'c', name: 'Coffee', kind: 'drink',
      items: [
        { id: 'latte', name: 'Latte', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: ['g-milk'],
          variants: [{ id: 'lm', code: 'M', label: 'Medium', priceCentavos: 12000, temperature: 'iced', isAvailable: true }] },
        { id: 'amer', name: 'Americano', description: null, imagePath: null, isBestseller: false, isAvailable: true, optionGroupIds: [],
          variants: [{ id: 'am', code: 'M', label: 'Medium', priceCentavos: 10000, temperature: 'iced', isAvailable: true }] },
      ],
    }],
    optionGroups: [{ id: 'g-milk', name: 'Milk', minSelect: 0, maxSelect: 1, options: [{ id: 'oat', name: 'Oat', priceCentavos: 2000, isAvailable: true }] }],
    discountPresets: [],
  }
  const menu = liveDrinkMenu(snap, 0)
  expect(menu.categories[0]!.items.map((i) => [i.id, i.modifierGroupIds])).toEqual([['latte', ['g-milk']], ['amer', []]])
  const line = (menuItemId: string) => ({ menuItemId, size: 'M' as const, modifierIds: ['oat'], quantity: 1, iceLevel: 'regular' as const, iceServe: 'mixed' as const, note: '' })
  const latte = priceLine(menu, line('latte'))
  expect(latte.lineTotalCentavos).toBe(14000)
  expect(() => priceLine(menu, line('amer'))).toThrow(OrderError)
  // What the till can ring up, the API's repricing accepts.
  const order = { menuVersion: 7, lines: [latte], discount: null, subtotalCentavos: 14000, discountCentavos: 0, totalCentavos: 14000 }
  expect(repriceCounterOrder(snap, order).matches).toBe(true)
  // A menu without links (built-in, old menu.json) still offers every group to every drink.
  const { modifierGroupIds: _drop, ...unlinked } = menu.categories[0]!.items[1]!
  const loose = { ...menu, categories: [{ ...menu.categories[0]!, items: [unlinked] }] }
  expect(priceLine(loose, line('amer')).lineTotalCentavos).toBe(12000)
})
