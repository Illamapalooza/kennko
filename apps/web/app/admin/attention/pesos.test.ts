import { describe, expect, it } from 'vitest'
import { parsePesos } from './pesos'

describe('parsePesos', () => {
  it('parses to centavos', () => {
    expect(parsePesos('1,480.50')).toBe(148050)
    expect(parsePesos(' 0 ')).toBe(0)
    expect(parsePesos('20')).toBe(2000)
    expect(parsePesos('0.1')).toBe(10)
    expect(parsePesos('₱350.05')).toBe(35005)
  })
  it('refuses anything else', () => {
    for (const bad of ['', 'abc', '-5', '1.234', '1..2', '12abc', '1,48', '1e3']) expect(parsePesos(bad), bad).toBeNull()
  })
  it('refuses more than the API accepts', () => {
    expect(parsePesos('1000000.01')).toBeNull()
    expect(parsePesos('1000000')).toBe(100_000_000)
  })
})
