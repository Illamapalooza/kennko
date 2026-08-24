import { describe, expect, it } from 'vitest'
import { formatPesos } from './money'

describe('formatPesos', () => {
  it('formats whole pesos without decimals', () => {
    expect(formatPesos(10500)).toBe('₱105')
  })

  it('formats centavos with two decimals', () => {
    expect(formatPesos(9550)).toBe('₱95.50')
  })

  it('formats zero', () => {
    expect(formatPesos(0)).toBe('₱0')
  })

  it('adds thousands separators', () => {
    expect(formatPesos(123400)).toBe('₱1,234')
  })

  it('throws on non-integer input', () => {
    expect(() => formatPesos(105.5)).toThrow('centavos must be an integer')
  })

  it('throws on negative input', () => {
    expect(() => formatPesos(-100)).toThrow('centavos must not be negative')
  })
})
