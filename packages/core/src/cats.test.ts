import { describe, expect, it } from 'vitest'
import { checkCatName, checkinLink, CHECKIN_URL, isWallVisitor, parseLook, wallCode, wallMinute } from './index.ts'

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
  it('builds the link', () => expect(checkinLink(CHECKIN_URL, 'abcd2345')).toBe('https://kennko.vercel.app/here?c=abcd2345'))
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
