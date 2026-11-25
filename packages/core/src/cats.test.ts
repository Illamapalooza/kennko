import { COAT_KEYS, SLOTS } from '@kennko/cats/pixel'
import { describe, expect, it } from 'vitest'
import { COSMETIC_SLOTS, STARTER_COATS, checkCatName, normaliseCatName, checkinLink, CHECKIN_URL, isWallVisitor, parseLook, wallCode, wallMinute, cleanVisitorKey, findVisitor, sameLook } from './index.ts'

const ok = (raw: string) => {
  const r = checkCatName(raw)
  return r.ok ? r.name : null
}

describe('checkCatName', () => {
  it('trims and collapses spaces', () => expect(ok('  Mochi   Bun ')).toBe('Mochi Bun'))
  it('accepts accents', () => expect(ok('Niño')).toBe('Niño'))
  it('refuses 17 characters, empty, markup and emoji', () => {
    expect(checkCatName('a'.repeat(17))).toEqual({ ok: false, message: 'Up to 16 letters or numbers.' })
    expect(checkCatName('')).toEqual({ ok: false, message: 'Up to 16 letters or numbers.' })
    expect(checkCatName('<b>')).toEqual({ ok: false, message: "Letters, numbers, spaces and . , ' ! ? & - only." })
    expect(checkCatName('Mochi 🐱').ok).toBe(false)
  })
  it('limits digits', () => {
    expect(ok('Cat 202')).toBe('Cat 202')
    expect(checkCatName('Cat 2025')).toEqual({ ok: false, message: 'Too many numbers in a row.' })
    expect(ok('R2 D2 C3')).toBe('R2 D2 C3')
    expect(checkCatName('091 712 345')).toEqual({ ok: false, message: 'No more than 4 numbers.' })
  })
})

describe('checkCatName unicode', () => {
  it('accepts exactly 16, refuses 17', () => {
    expect(ok('a'.repeat(16))).toBe('a'.repeat(16))
    expect(checkCatName('a'.repeat(17)).ok).toBe(false)
  })
  it('treats precomposed and combining ñ the same', () => {
    const pre = 'Ni\u00f1o'
    const comb = 'Nin\u0303o'
    expect(ok(pre)).toBe(pre)
    expect(ok(comb)).toBe(pre)
    expect(normaliseCatName(comb)).toBe(pre)
    expect(ok('N' + 'n\u0303'.repeat(15))).not.toBeNull()
    expect(ok('a'.repeat(15) + 'n\u0303')).not.toBeNull()
    // a + combining tilde composes to one character, so 16 a's and a tilde are still 16
    expect(checkCatName('a'.repeat(16) + '\u0303').ok).toBe(true)
  })
  it('refuses mark-only and punctuation-only names', () => {
    for (const bad of ['\u0301', '...', '---', '! ?', '&']) expect(checkCatName(bad).ok).toBe(false)
  })
})

describe('core and cats agree', () => {
  it('has the same slots, in the same order', () => expect([...COSMETIC_SLOTS]).toEqual(SLOTS))
  it('starter coats are real coats', () => {
    for (const c of STARTER_COATS) expect(COAT_KEYS).toContain(c)
  })
  it('non-coat slots match', () => {
    expect(COSMETIC_SLOTS.filter((s) => s !== 'coat')).toEqual(SLOTS.filter((s) => s !== 'coat'))
  })
})

describe('wall code', () => {
  it('is deterministic, 8 base32 characters', async () => {
    const a = await wallCode('test-secret', 29_000_000)
    expect(a).toMatch(/^[a-z2-7]{8}$/)
    expect(await wallCode('test-secret', 29_000_000)).toBe(a)
  })
  it('matches the pinned vector', async () => {
    expect(await wallCode('test-secret', 29_000_000)).toBe('yxyemrb6')
  })
  it('differs by minute and by secret', async () => {
    const a = await wallCode('test-secret', 29_000_000)
    expect(await wallCode('test-secret', 29_000_001)).not.toBe(a)
    expect(await wallCode('other-secret', 29_000_000)).not.toBe(a)
  })
  it('is accepted for the current and previous minute only', async () => {
    const m = wallMinute(29_000_000 * 60_000 + 5)
    const accepted = new Set([await wallCode('s', m), await wallCode('s', m - 1)])
    expect(accepted.has(await wallCode('s', m))).toBe(true)
    expect(accepted.has(await wallCode('s', m - 1))).toBe(true)
    expect(accepted.has(await wallCode('s', m + 1))).toBe(false)
    expect(accepted.has(await wallCode('s', m - 2))).toBe(false)
  })
  it('floors the minute', () => expect(wallMinute(60_000 * 5 + 59_999)).toBe(5))
  it('builds the link', () => expect(checkinLink(CHECKIN_URL, 'abcd2345')).toBe('https://kennkokape.com/here?c=abcd2345'))
})

describe('parseLook', () => {
  it('needs a coat', () => expect(parseLook({ hat: 'crown' })).toBeNull())
  it('refuses unknown keys and non-strings', () => {
    expect(parseLook({ coat: 'ginger', tail: 'x' })).toBeNull()
    expect(parseLook({ coat: 'ginger', hat: 3 })).toBeNull()
    expect(parseLook(null)).toBeNull()
    expect(parseLook({ coat: '' })).toBeNull()
  })
  it('round-trips', () => {
    const look = { coat: 'ginger', hat: 'crown', held: 'fish' }
    expect(parseLook(look)).toEqual(look)
  })
})

describe('isWallVisitor', () => {
  const v = { key: 'k', name: 'Mochi', look: { coat: 'ginger' }, endsAt: '2026-01-01T00:00:00.000Z' }
  it('accepts exactly the four keys', () => expect(isWallVisitor(v)).toBe(true))
  it('refuses an extra key or a missing one', () => {
    expect(isWallVisitor({ ...v, customerId: 'x' })).toBe(false)
    const { endsAt: _e, ...rest } = v
    expect(isWallVisitor(rest)).toBe(false)
  })
})

describe('one cat per customer', () => {
  const mochi = { key: 'a', name: 'Mochi', look: { coat: 'ginger', hat: 'beanie' } }
  const kape = { key: 'b', name: 'Kape', look: { coat: 'black' } }
  const twin = { key: 'c', name: 'Biko', look: { coat: 'black' } }

  it('sameLook ignores key order and treats a missing slot as empty', () => {
    expect(sameLook({ coat: 'ginger', hat: 'beanie' }, { hat: 'beanie', coat: 'ginger' })).toBe(true)
    expect(sameLook({ coat: 'ginger' }, { coat: 'ginger', hat: 'beanie' })).toBe(false)
    expect(sameLook(null, { coat: 'ginger' })).toBe(false)
  })

  it('finds a cat by name and look together', () => {
    expect(findVisitor([mochi, kape], { name: 'Mochi', look: { coat: 'ginger', hat: 'beanie' } })).toBe('a')
    expect(findVisitor([mochi, kape], { name: ' mochi ', look: { hat: 'beanie', coat: 'ginger' } })).toBe('a')
    expect(findVisitor([mochi, kape], { name: 'Mochi', look: { coat: 'black' } })).toBeNull()
  })

  it('with only a name or only a look, matches when exactly one cat fits', () => {
    expect(findVisitor([mochi, kape], { name: 'Kape' })).toBe('b')
    expect(findVisitor([mochi, kape], { look: { coat: 'black' } })).toBe('b')
    expect(findVisitor([mochi, kape, twin], { look: { coat: 'black' } })).toBeNull()
    expect(findVisitor([mochi, kape, twin], { name: 'Biko', look: { coat: 'black' } })).toBe('c')
  })

  it('finds nobody for a customer with no cat', () => {
    expect(findVisitor([mochi], { name: null, look: null })).toBeNull()
    expect(findVisitor([], { name: 'Mochi' })).toBeNull()
  })

  it('a visit key is a short non-empty string or nothing', () => {
    expect(cleanVisitorKey('abc')).toBe('abc')
    expect(cleanVisitorKey('')).toBeNull()
    expect(cleanVisitorKey('x'.repeat(65))).toBeNull()
    expect(cleanVisitorKey(12)).toBeNull()
  })
})
