import { describe, expect, it } from 'vitest'
import { lineTotal, cartSubtotal, orderTotal, generateOrderCode } from './total'

describe('lineTotal', () => {
  it('multiplies base plus modifiers by quantity', () => {
    expect(
      lineTotal({
        basePriceCentavos: 10500,
        modifiers: [{ priceCentavos: 4000 }],
        quantity: 2,
      }),
    ).toBe(29000)
  })

  it('handles no modifiers', () => {
    expect(lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 1 })).toBe(8000)
  })

  it('sums several modifiers', () => {
    expect(
      lineTotal({
        basePriceCentavos: 11500,
        modifiers: [{ priceCentavos: 4000 }, { priceCentavos: 3500 }],
        quantity: 1,
      }),
    ).toBe(19000)
  })

  it('rejects quantity below 1', () => {
    expect(() => lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 0 })).toThrow(
      'at least 1',
    )
  })

  it('rejects quantity above 20', () => {
    expect(() => lineTotal({ basePriceCentavos: 8000, modifiers: [], quantity: 21 })).toThrow(
      'more than 20',
    )
  })
})

describe('cartSubtotal', () => {
  it('sums every line', () => {
    expect(
      cartSubtotal([
        { basePriceCentavos: 8000, modifiers: [], quantity: 1 },
        { basePriceCentavos: 10500, modifiers: [{ priceCentavos: 4000 }], quantity: 2 },
      ]),
    ).toBe(37000)
  })

  it('is zero for an empty cart', () => {
    expect(cartSubtotal([])).toBe(0)
  })
})

describe('orderTotal', () => {
  it('adds the delivery fee', () => {
    expect(orderTotal(29000, 5000)).toBe(34000)
  })

  it('adds nothing for pickup', () => {
    expect(orderTotal(29000, 0)).toBe(29000)
  })
})

describe('generateOrderCode', () => {
  it('is KNK- plus four unambiguous characters', () => {
    expect(generateOrderCode()).toMatch(/^KNK-[ACDEFHJKLMNPRTUVWXY34679]{4}$/)
  })

  it('drops one side of every confusable pair', () => {
    // Only one of each pair needs removing: 6 is unambiguous once G is gone,
    // and L is unambiguous once 1 and I are gone.
    const codes = Array.from({ length: 200 }, generateOrderCode).join('')
    expect(codes).not.toMatch(/[0O1IB8S5 2ZG]/)
  })

  it('does not repeat across many draws', () => {
    const codes = new Set(Array.from({ length: 500 }, generateOrderCode))
    expect(codes.size).toBeGreaterThan(490)
  })
})
