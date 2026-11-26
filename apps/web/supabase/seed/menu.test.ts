import { describe, expect, it } from 'vitest'
import { SEED_CATEGORIES, SEED_MODIFIER_GROUPS } from './menu'

describe('menu seed data', () => {
  it('has the four printed categories in board order', () => {
    expect(SEED_CATEGORIES.map((c) => c.name)).toEqual([
      'Premium Classics',
      "Barista's Choice",
      'Sweet Sips',
      'Matcha Series',
    ])
  })

  it('has 24 drinks', () => {
    const total = SEED_CATEGORIES.reduce((n, c) => n + c.items.length, 0)
    expect(total).toBe(24)
  })

  it('marks 14 bestsellers', () => {
    const stars = SEED_CATEGORIES.flatMap((c) => c.items).filter((i) => i.isBestseller)
    expect(stars).toHaveLength(14)
  })

  it('prices the cheapest and priciest items correctly', () => {
    const items = SEED_CATEGORIES.flatMap((c) => c.items)
    const americano = items.find((i) => i.name === 'Americano')
    expect(americano?.prices).toEqual({ M: 8000, L: 9000, XL: 10500, HOT: 9500 })

    const dirty = items.find((i) => i.name === 'Dirty Matcha')
    expect(dirty?.prices).toEqual({ M: 14000, L: 16000, XL: 18500, HOT: 17000 })
  })

  it('omits sizes the board does not offer', () => {
    const items = SEED_CATEGORIES.flatMap((c) => c.items)
    expect(items.find((i) => i.name === 'Strawberry Milk')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Strawberry Matcha')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Choco-Coconut')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Flamed Chocolate')?.prices.HOT).toBeNull()
    expect(items.find((i) => i.name === 'Honey Citron Tea')?.prices.M).toBeNull()
    expect(items.find((i) => i.name === 'Honey Citron Tea')?.prices.XL).toBeNull()
    expect(items.find((i) => i.name === 'Hojicha')?.prices.XL).toBeNull()
  })

  it('offers exactly 89 priced size cells', () => {
    const cells = SEED_CATEGORIES.flatMap((c) => c.items).flatMap((i) =>
      Object.values(i.prices).filter((v) => v !== null),
    )
    expect(cells).toHaveLength(89)
  })

  it('stores every price as a whole number of centavos', () => {
    for (const item of SEED_CATEGORIES.flatMap((c) => c.items)) {
      for (const value of Object.values(item.prices)) {
        if (value === null) continue
        expect(Number.isInteger(value)).toBe(true)
        expect(value % 100).toBe(0)
      }
    }
  })

  it('prices every size tier upward from M', () => {
    for (const item of SEED_CATEGORIES.flatMap((c) => c.items)) {
      if (item.prices.M !== null && item.prices.L !== null) expect(item.prices.L).toBeGreaterThan(item.prices.M)
      if (item.prices.L !== null && item.prices.XL !== null) expect(item.prices.XL).toBeGreaterThan(item.prices.L)
    }
  })

  it('has 11 modifiers across 3 groups', () => {
    expect(SEED_MODIFIER_GROUPS).toHaveLength(3)
    const total = SEED_MODIFIER_GROUPS.reduce((n, g) => n + g.modifiers.length, 0)
    expect(total).toBe(11)
  })

  it('makes only Add-ons multi-select', () => {
    const multi = SEED_MODIFIER_GROUPS.filter((g) => g.isMultiSelect)
    expect(multi.map((g) => g.name)).toEqual(['Add-ons'])
  })
})
