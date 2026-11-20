import { describe, expect, it } from 'vitest'
import {
  OrderError, cleanDiscount, discountAmount, formatPesos, formatSignedPesos, parsePesos, priceLine, priceLines, quickCash, summarise, totals,
  nextStatus, prevStatus, manilaDay, type Menu, type Order, type LineInput,
} from './index.ts'

const menu: Menu = {
  source: 'built-in', updatedAt: 0,
  categories: [{
    id: 'c', name: 'Classics', items: [
      { id: 'latte', name: 'Café Latte', isBestseller: false, isAvailable: true, prices: [{ size: 'M', priceCentavos: 10000 }, { size: 'HOT', priceCentavos: 12500 }] },
      { id: 'gone', name: 'Gone', isBestseller: false, isAvailable: false, prices: [{ size: 'M', priceCentavos: 10000 }] },
    ],
  }],
  modifierGroups: [
    { id: 'add', name: 'Add-ons', isMultiSelect: true, modifiers: [{ id: 'shot', name: 'Espresso Shots', priceCentavos: 3500, isAvailable: true }, { id: 'milk', name: 'Milk', priceCentavos: 2000, isAvailable: true }] },
    { id: 'alt', name: 'Milk of Choice', isMultiSelect: false, modifiers: [{ id: 'oat', name: 'Oat Milk', priceCentavos: 4000, isAvailable: true }, { id: 'soy', name: 'Soy Milk', priceCentavos: 3500, isAvailable: true }] },
  ],
}
const line = (over: Partial<LineInput> = {}): LineInput => ({ menuItemId: 'latte', size: 'M', modifierIds: [], quantity: 1, iceLevel: null, iceServe: null, note: '', ...over })

describe('money', () => {
  it('formats and parses pesos', () => {
    expect(formatPesos(12500)).toBe('₱125')
    expect(formatPesos(12550)).toBe('₱125.50')
    expect(() => formatPesos(-500)).toThrow('must not be negative')
    expect(formatSignedPesos(-500)).toBe('-₱5')
    expect(formatSignedPesos(2000)).toBe('+₱20')
    expect(formatSignedPesos(0)).toBe('₱0')
    expect(parsePesos('1,250.5')).toBe(125050)
    expect(parsePesos('abc')).toBeNull()
    expect(parsePesos('1.234')).toBeNull()
  })
})

describe('pricing', () => {
  it('prices from the menu, never from the screen', () => {
    const priced = priceLine(menu, line({ modifierIds: ['shot', 'oat'], quantity: 2 }))
    expect(priced.basePriceCentavos).toBe(10000)
    expect(priced.lineTotalCentavos).toBe((10000 + 3500 + 4000) * 2)
    expect(priced.iceLevel).toBe('regular')
    expect(priced.iceServe).toBe('mixed')
  })
  it('drops ice from a hot drink', () => {
    const priced = priceLine(menu, line({ size: 'HOT', iceLevel: 'less', iceServe: 'side' }))
    expect(priced.iceLevel).toBeNull()
    expect(priced.iceServe).toBeNull()
  })
  it('refuses what the menu does not allow', () => {
    expect(() => priceLine(menu, line({ menuItemId: 'nope' }))).toThrow(OrderError)
    expect(() => priceLine(menu, line({ menuItemId: 'gone' }))).toThrow(/sold out/)
    expect(() => priceLine(menu, line({ size: 'XL' }))).toThrow(/size/)
    expect(() => priceLine(menu, line({ quantity: 0 }))).toThrow(/Quantity/)
    expect(() => priceLine(menu, line({ quantity: 21 }))).toThrow(/Quantity/)
    expect(() => priceLine(menu, line({ modifierIds: ['oat', 'soy'] }))).toThrow(/only one/)
    expect(() => priceLine(menu, line({ modifierIds: ['ghost'] }))).toThrow(/add-ons/)
    expect(() => priceLines(menu, [])).toThrow(/at least one/)
  })

  it('prices a free drink at zero with its add-ons', () => {
    const priced = priceLine(menu, line({ size: 'HOT', modifierIds: ['oat'], reward: true }))
    expect(priced.basePriceCentavos).toBe(0)
    expect(priced.lineTotalCentavos).toBe(4000)
    expect(priced.reward).toBe(true)
    expect(priceLine(menu, line()).reward).toBeUndefined()
  })
  it('keeps a free drink to one drink, one per order', () => {
    expect(() => priceLine(menu, line({ reward: true, quantity: 2 }))).toThrow('A free drink is one drink.')
    expect(() => priceLines(menu, [line({ reward: true }), line({ reward: true })])).toThrow('One free drink per order.')
    expect(priceLines(menu, [line({ reward: true }), line()])).toHaveLength(2)
  })
})

describe('discounts and totals', () => {
  it('applies percent and amount discounts, capped at the subtotal', () => {
    expect(discountAmount(10500, { label: 'x', kind: 'percent', value: 20 })).toBe(2100)
    expect(discountAmount(10000, { label: 'x', kind: 'amount', value: 50000 })).toBe(10000)
    expect(totals([{ lineTotalCentavos: 10000 }, { lineTotalCentavos: 2500 }], { label: 'x', kind: 'percent', value: 10 }))
      .toEqual({ subtotalCentavos: 12500, discountCentavos: 1250, totalCentavos: 11250 })
  })
  it('rejects a malformed discount', () => {
    expect(cleanDiscount(null)).toBeNull()
    expect(() => cleanDiscount({ label: 'x', kind: 'percent', value: 120 })).toThrow(OrderError)
    expect(() => cleanDiscount({ label: 'x', kind: 'amount', value: -5 })).toThrow(OrderError)
  })
  it('offers sensible cash buttons', () => {
    expect(quickCash(12500)).toEqual([12500, 14000, 15000, 20000, 50000])
    expect(quickCash(10000)[0]).toBe(10000)
  })
})

describe('orders', () => {
  it('walks the status flow', () => {
    expect(nextStatus('queued')).toBe('preparing')
    expect(nextStatus('done')).toBeNull()
    expect(nextStatus('voided')).toBeNull()
    expect(prevStatus('queued')).toBeNull()
    expect(prevStatus('serving')).toBe('preparing')
  })
  it('uses the Manila calendar day', () => {
    expect(manilaDay(Date.UTC(2026, 10, 16, 16, 30))).toBe('2026-11-17')
    expect(manilaDay(Date.UTC(2026, 10, 16, 15, 59))).toBe('2026-11-16')
  })
  it('summarises a shift and leaves voids out of sales and cash', () => {
    const base = { day: '2026-11-17', type: 'dine_in', customerName: '', discountLabel: null, tenderedCentavos: null, changeCentavos: null, paymentRef: null, shiftId: 1, createdAt: 0, updatedAt: 0, voidedAt: null, voidReason: null } as const
    const l = (name: string, quantity: number, lineTotalCentavos: number) => ({ ...priceLine(menu, line()), name, quantity, lineTotalCentavos })
    const orders: Order[] = [
      { ...base, id: 1, number: 1, status: 'done', lines: [l('Latte', 2, 20000)], subtotalCentavos: 20000, discountCentavos: 4000, totalCentavos: 16000, paymentMethod: 'cash' },
      { ...base, id: 2, number: 2, status: 'queued', type: 'takeout', lines: [l('Latte', 1, 10000), l('Matcha', 1, 11500)], subtotalCentavos: 21500, discountCentavos: 0, totalCentavos: 21500, paymentMethod: 'gcash' },
      { ...base, id: 3, number: 3, status: 'voided', lines: [l('Latte', 1, 10000)], subtotalCentavos: 10000, discountCentavos: 0, totalCentavos: 10000, paymentMethod: 'cash' },
    ]
    const s = summarise(orders, [{ id: 1, shiftId: 1, kind: 'out', amountCentavos: 5000, reason: 'ice', at: 0 }, { id: 2, shiftId: 1, kind: 'in', amountCentavos: 2000, reason: 'coins', at: 0 }], 100000)
    expect(s.orderCount).toBe(2)
    expect(s.grossCentavos).toBe(41500)
    expect(s.discountCentavos).toBe(4000)
    expect(s.netCentavos).toBe(37500)
    expect(s.cash).toEqual({ count: 1, totalCentavos: 16000 })
    expect(s.gcash).toEqual({ count: 1, totalCentavos: 21500 })
    expect(s.voidCount).toBe(1)
    expect(s.voidCentavos).toBe(10000)
    expect(s.expectedCashCentavos).toBe(100000 + 16000 + 2000 - 5000)
    expect(s.items[0]).toMatchObject({ name: 'Latte', quantity: 3 })
  })
})
