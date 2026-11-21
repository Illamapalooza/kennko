import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { randomHex, randomUuid, sameBytes, sha1Bytes, sha256Hex } from './portable-crypto.ts'
import { hashStaffPin } from './staff-pin.ts'
import { checkStaffPin } from './staff-pin-check.ts'

describe('portable-crypto', () => {
  it('sha256Hex matches node:crypto', () => {
    expect(sha256Hex('kennko')).toBe(createHash('sha256').update('kennko').digest('hex'))
  })

  it('sha1Bytes matches node:crypto', () => {
    const input = new TextEncoder().encode('x')
    const expected = new Uint8Array(createHash('sha1').update(input).digest())
    expect(sha1Bytes(input)).toEqual(expected)
  })

  it('randomHex returns hex of requested byte length', () => {
    const a = randomHex(16)
    const b = randomHex(16)
    expect(a).toMatch(/^[0-9a-f]{32}$/)
    expect(b).toMatch(/^[0-9a-f]{32}$/)
    expect(a).not.toBe(b)
  })

  it('randomUuid returns a v4 UUID', () => {
    const id = randomUuid()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('sameBytes checks equality in constant time', () => {
    const a = new Uint8Array([1, 2, 3, 4])
    const b = new Uint8Array([1, 2, 3, 4])
    const c = new Uint8Array([1, 2, 9, 4])
    const d = new Uint8Array([1, 2, 3])
    expect(sameBytes(a, b)).toBe(true)
    expect(sameBytes(a, c)).toBe(false)
    expect(sameBytes(a, d)).toBe(false)
  })
})

describe('staff-pin-check (portable)', () => {
  it('accepts a node hash and rejects wrong PIN', async () => {
    const stored = await hashStaffPin('482913')
    expect(await checkStaffPin('482913', stored)).toBe(true)
    expect(await checkStaffPin('482914', stored)).toBe(false)
  })

  it('refuses tampered cost', async () => {
    const stored = await hashStaffPin('482913')
    const parts = stored.split('$')
    const tampered = `scrypt$2097152$8$1$${parts[4]}$${parts[5]}`
    expect(await checkStaffPin('482913', tampered)).toBe(false)
  })
})
