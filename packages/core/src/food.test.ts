import { expect, test } from 'vitest'
import { liveDrinkMenu, liveTillMenu, type MenuSnapshot, type SnapshotVariant } from './snapshot.ts'
import { OrderError, priceLine } from './cart.ts'
import { normaliseIce, takesIce } from './ice.ts'
import { isFoodItem, sizeTag } from './menu.ts'

// The food as migration 0012 publishes it: one REG variant each, Cookies and Fries with a required free flavour.
const reg = (id: string, priceCentavos: number, isAvailable = true) =>
  ({ id, code: 'REG', label: 'Regular', priceCentavos, temperature: 'none' as const, isAvailable })
const item = (id: string, name: string, variants: SnapshotVariant[], optionGroupIds: string[] = []) =>
  ({ id, name, description: null, imagePath: null, isBestseller: false, isAvailable: true, variants, optionGroupIds })

const snapshot: MenuSnapshot = {
  version: 9,
  publishedAt: '2026-11-23T00:00:00.000Z',
  categories: [
    { id: 'c-coffee', name: 'Coffee', kind: 'drink', items: [
      item('i-latte', 'Latte', [{ id: 'v-m', code: 'M', label: 'Medium', priceCentavos: 10000, temperature: 'iced', isAvailable: true }], ['g-milk']),
    ] },
    { id: 'c-food', name: 'Food', kind: 'food', items: [
      item('i-cookies', 'Cookies', [reg('v-c', 6000)], ['g-cookie']),
      item('i-empanada', 'Empanada', [reg('v-e', 4500)]),
      item('i-fries', 'Fries', [reg('v-f', 8500)], ['g-fries']),
      item('i-gone', 'Gone', [reg('v-g', 1000, false)]),
    ] },
  ],
  optionGroups: [
    { id: 'g-milk', name: 'Milk of Choice', minSelect: 0, maxSelect: 1, options: [{ id: 'o-oat', name: 'Oat Milk', priceCentavos: 4000, isAvailable: true }] },
    { id: 'g-cookie', name: 'Cookie flavour', minSelect: 1, maxSelect: 1, options: [
      { id: 'o-orig', name: 'Original', priceCentavos: 0, isAvailable: true },
      { id: 'o-choc', name: 'Chocolate', priceCentavos: 0, isAvailable: true },
    ] },
    { id: 'g-fries', name: 'Fries flavour', minSelect: 1, maxSelect: 1, options: [{ id: 'o-bbq', name: 'BBQ', priceCentavos: 0, isAvailable: true }] },
  ],
  discountPresets: [],
}

const till = liveTillMenu(snapshot, 5)
const line = (menuItemId: string, modifierIds: string[] = [], extra: object = {}) =>
  ({ menuItemId, size: 'REG' as const, modifierIds, quantity: 1, iceLevel: null, iceServe: null, note: '', ...extra })

test('the till menu keeps the drinks and adds the food, each priced by its REG variant', () => {
  expect(till.categories.map((c) => [c.id, c.kind])).toEqual([['c-coffee', undefined], ['c-food', 'food']])
  expect(till.categories[1]!.items.map((i) => [i.name, i.prices])).toEqual([
    ['Cookies', [{ size: 'REG', priceCentavos: 6000 }]],
    ['Empanada', [{ size: 'REG', priceCentavos: 4500 }]],
    ['Fries', [{ size: 'REG', priceCentavos: 8500 }]],
  ])
  expect(till.version).toBe(9)
})

test('a required flavour group carries minSelect; the drink groups do not', () => {
  const byId = Object.fromEntries(till.modifierGroups.map((g) => [g.id, g]))
  expect(byId['g-cookie']).toMatchObject({ minSelect: 1, isMultiSelect: false })
  expect(byId['g-milk']!.minSelect).toBeUndefined()
})

test('the website drink menu is unchanged: no food, no flavour groups', () => {
  const web = liveDrinkMenu(snapshot, 5)
  expect(web.categories.map((c) => c.id)).toEqual(['c-coffee'])
  expect(web.modifierGroups.map((g) => g.id)).toEqual(['g-milk'])
})

test('a food line prices at its REG price with no ice', () => {
  const priced = priceLine(till, line('i-cookies', ['o-choc'], { quantity: 2, iceLevel: 'regular', iceServe: 'mixed' }))
  expect(priced).toMatchObject({ name: 'Cookies', size: 'REG', basePriceCentavos: 6000, iceLevel: null, iceServe: null, lineTotalCentavos: 12000 })
  expect(priced.modifiers).toEqual([{ id: 'o-choc', name: 'Chocolate', priceCentavos: 0 }])
  expect(priceLine(till, line('i-empanada')).lineTotalCentavos).toBe(4500)
})

test('a required flavour must be picked, and only one', () => {
  expect(() => priceLine(till, line('i-cookies'))).toThrow(new OrderError('Pick a cookie flavour for Cookies.'))
  expect(() => priceLine(till, line('i-cookies', ['o-orig', 'o-choc']))).toThrow(/Pick only one/)
  expect(() => priceLine(till, line('i-cookies', ['o-orig', 'o-bbq']))).toThrow(/no longer on the menu/)
})

test('a drink still prices without any pick from its optional groups', () => {
  expect(priceLine(till, { ...line('i-latte'), size: 'M' }).lineTotalCentavos).toBe(10000)
})

test('the free drink cannot be food', () => {
  expect(() => priceLine(till, line('i-empanada', [], { reward: true }))).toThrow('The free drink has to be a drink.')
})

test('food takes no ice and shows no size tag', () => {
  expect(takesIce('REG')).toBe(false)
  expect(normaliseIce('REG', 'less', 'side')).toEqual({ level: null, serve: null })
  expect(sizeTag('REG')).toBe('')
  expect(sizeTag('L')).toBe('L')
  expect(isFoodItem(till, 'i-fries')).toBe(true)
  expect(isFoodItem(till, 'i-latte')).toBe(false)
})
