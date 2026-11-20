import { describe, expect, it } from 'vitest'
import {
  CENTAVOS_PER_POINT,
  CODE_ALPHABET,
  LINKED_RECENT_MS,
  LOOKUPS_PER_MINUTE,
  STAMPS_PER_CARD,
  formatPublicCode,
  hasDrink,
  makePublicCode,
  normalisePublicCode,
  orderPoints,
} from './loyalty.ts'

/** A small seeded generator so the typo sweep is repeatable. */
function seeded(seed: number): (n: number) => number {
  let s = seed >>> 0
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return Math.floor((s / 2 ** 32) * n)
  }
}

describe('constants', () => {
  it('has the agreed values', () => {
    expect(CODE_ALPHABET).toBe('23456789ABCDEFGHJKMNPQRSTUVWXYZ')
    expect(CODE_ALPHABET).toHaveLength(31)
    expect(STAMPS_PER_CARD).toBe(8)
    expect(CENTAVOS_PER_POINT).toBe(1000)
    expect(LINKED_RECENT_MS).toBe(1_800_000)
    expect(LOOKUPS_PER_MINUTE).toBe(30)
  })
})

describe('the check character catching typos', () => {
  const rand = seeded(20261120)
  const codes = Array.from({ length: 200 }, () => makePublicCode(rand))

  it('makes 9 symbols from the alphabet that normalise to themselves', () => {
    for (const code of codes) {
      expect(code).toHaveLength(9)
      expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true)
      expect(normalisePublicCode(code)).toBe(code)
    }
    expect(new Set(codes).size).toBeGreaterThan(190)
  })

  it('refuses every single-symbol substitution', () => {
    for (const code of codes) {
      for (let pos = 0; pos < 9; pos++) {
        for (const sym of CODE_ALPHABET) {
          if (sym === code[pos]) continue
          const typo = code.slice(0, pos) + sym + code.slice(pos + 1)
          expect(normalisePublicCode(typo), typo).toBeNull()
        }
      }
    }
  })

  it('refuses every swap of two different neighbouring symbols', () => {
    for (const code of codes) {
      for (let pos = 0; pos < 8; pos++) {
        if (code[pos] === code[pos + 1]) continue
        const typo = code.slice(0, pos) + code[pos + 1] + code[pos] + code.slice(pos + 2)
        expect(normalisePublicCode(typo), typo).toBeNull()
      }
    }
  })

  it('reads a code written the way people write it', () => {
    const code = makePublicCode(seeded(7))
    const spaced = `kc ${code.slice(0, 3)}-${code.slice(3, 6)} ${code.slice(6)}`.toLowerCase()
    expect(normalisePublicCode(spaced)).toBe(code)
    expect(normalisePublicCode(formatPublicCode(code))).toBe(code)
    expect(normalisePublicCode(`  KC-${code}  `)).toBe(code)
  })

  it('refuses symbols outside the alphabet and the wrong length', () => {
    const code = makePublicCode(seeded(9))
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(normalisePublicCode(code.slice(0, 8) + bad)).toBeNull()
      expect(normalisePublicCode(bad + code.slice(1))).toBeNull()
    }
    expect(normalisePublicCode(code.slice(0, 8))).toBeNull()
    expect(normalisePublicCode(code + '2')).toBeNull()
    expect(normalisePublicCode('')).toBeNull()
    expect(normalisePublicCode('KC')).toBeNull()
  })
})

describe('formatPublicCode', () => {
  it('makes three groups of three behind KC-', () => {
    expect(formatPublicCode('7F3K9QXAM')).toBe('KC-7F3-K9Q-XAM')
  })
})

describe('orderPoints', () => {
  it('earns a point per ₱10 after discount', () => {
    expect(orderPoints({ subtotalCentavos: 24500, discountCentavos: 0, rewardLineCentavos: 0 })).toBe(24)
    expect(orderPoints({ subtotalCentavos: 999, discountCentavos: 0, rewardLineCentavos: 0 })).toBe(0)
  })
  it('takes the discount and the free drink off first', () => {
    expect(orderPoints({ subtotalCentavos: 30000, discountCentavos: 3000, rewardLineCentavos: 4000 })).toBe(23)
  })
  it('is never negative', () => {
    expect(orderPoints({ subtotalCentavos: 4000, discountCentavos: 0, rewardLineCentavos: 9000 })).toBe(0)
    expect(orderPoints({ subtotalCentavos: 0, discountCentavos: 0, rewardLineCentavos: 0 })).toBe(0)
  })
})

describe('hasDrink', () => {
  it('needs at least one drink', () => {
    expect(hasDrink([{ kind: 'food' }])).toBe(false)
    expect(hasDrink([{ kind: 'food' }, { kind: 'drink' }])).toBe(true)
    expect(hasDrink([{ kind: null }])).toBe(true)
    expect(hasDrink([])).toBe(false)
  })
})
