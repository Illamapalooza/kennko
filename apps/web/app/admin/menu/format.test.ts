import { describe, expect, it } from 'vitest'
import { priceRange, parsePriceInput } from './format'

describe('priceRange', () => {
  it('shows a range when sizes differ', () => {
    expect(
      priceRange([
        { size: 'M', priceCentavos: 8000 },
        { size: 'XL', priceCentavos: 10000 },
      ]),
    ).toBe('₱80 – ₱100')
  })

  it('shows one price when every size costs the same', () => {
    expect(
      priceRange([
        { size: 'M', priceCentavos: 10500 },
        { size: 'L', priceCentavos: 10500 },
      ]),
    ).toBe('₱105')
  })

  it('flags an item with no prices set', () => {
    expect(priceRange([])).toBe('No price set')
  })
})

describe('parsePriceInput', () => {
  it('parses a whole peso amount to centavos', () => {
    expect(parsePriceInput('105')).toBe(10500)
  })

  it('parses a decimal amount', () => {
    expect(parsePriceInput('95.50')).toBe(9550)
  })

  it('tolerates a peso sign, commas, and spaces', () => {
    expect(parsePriceInput(' ₱1,234.50 ')).toBe(123450)
  })

  it('treats an empty value as "size not offered"', () => {
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('   ')).toBeNull()
  })

  it('rejects a negative amount', () => {
    expect(() => parsePriceInput('-5')).toThrow('cannot be negative')
  })

  it('rejects non-numeric text', () => {
    expect(() => parsePriceInput('free')).toThrow('is not a valid price')
  })

  it('rejects fractions of a centavo', () => {
    expect(() => parsePriceInput('10.555')).toThrow('more than two decimal places')
  })
})
