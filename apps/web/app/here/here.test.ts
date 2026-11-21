import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/auth/redirect'
import { checkinMessage, hereNextPath, parseWallCode } from './here'

describe('parseWallCode', () => {
  it('accepts exactly 8 lower-case base32 characters', () => {
    expect(parseWallCode('abcd2345')).toBe('abcd2345')
    expect(parseWallCode('zzzzzzz7')).toBe('zzzzzzz7')
  })
  it('refuses anything else, so the page shows the scan prompt', () => {
    for (const bad of [undefined, null, '', 'abcd234', 'abcd23456', 'ABCD2345', 'abcd2341', 'abcd2348', 'abcd 345', 'abcd234\n', ['abcd2345', 'x']]) {
      expect(parseWallCode(bad as never), String(bad)).toBeNull()
    }
  })
})

describe('hereNextPath', () => {
  it('encodes the code into the sign-in next path and survives safeNextPath', () => {
    const next = hereNextPath('abcd2345')
    expect(next).toBe('/account?next=%2Fhere%3Fc%3Dabcd2345')
    const inner = new URLSearchParams(next.split('?')[1]).get('next')
    expect(inner).toBe('/here?c=abcd2345')
    expect(safeNextPath(inner, '/account')).toBe('/here?c=abcd2345')
  })
})

describe('checkinMessage', () => {
  const at = '2026-11-21T07:30:00.000Z' // 3:30 PM Manila
  it('on the wall: the cat walks in, with the end time', () => {
    const m = checkinMessage({ status: 'ok', onWall: true, endsAt: at }, 'Mochi')
    expect(m.tone).toBe('good')
    expect(m.title).toBe('Mochi is walking in. Look at the wall!')
    expect(m.detail).toMatch(/3:30\s?PM/i)
    expect(m.link).toBeUndefined()
  })
  it('staying home: checked in, with a link to turn the wall on', () => {
    const m = checkinMessage({ status: 'ok', onWall: false, endsAt: at }, 'Mochi')
    expect(m.tone).toBe('good')
    expect(m.title).toBe('Checked in. Your cat is set to stay home.')
    expect(m.link).toEqual({ href: '/account', label: 'Turn on "Show me on the wall"' })
  })
  it('hidden by Kennko: no link to turn the wall on', () => {
    const m = checkinMessage({ status: 'ok', onWall: false, endsAt: at }, 'Mochi', undefined, true)
    expect(m.tone).toBe('good')
    expect(m.title).toBe('Checked in. Kennko has paused your cat on the wall for now.')
    expect(m.link).toBeUndefined()
  })
  it('a changed code', () => {
    expect(checkinMessage({ status: 'error', reason: 'BAD_WALL_CODE' }, 'Mochi').title).toBe('That code has changed. Scan the wall again.')
  })
  it('a rate limit', () => {
    expect(checkinMessage({ status: 'error', reason: 'RATE_LIMITED' }, 'Mochi').title).toBe('Give it a minute and try again.')
  })
  it('not joined', () => {
    const m = checkinMessage({ status: 'error', reason: 'NOT_JOINED' }, 'Mochi')
    expect(m.title).toBe('Get your Kennko card first.')
    expect(m.link?.href).toBe('/account')
  })
  it('a missing or malformed code', () => {
    expect(checkinMessage({ status: 'error', reason: 'NO_CODE' }, 'Mochi').title).toBe('Scan the QR code on the wall at Kennko.')
  })
  it('signed out: sign in again, with a link back to /here', () => {
    const m = checkinMessage({ status: 'error', reason: 'SIGNED_OUT' }, 'Mochi', 'abcd2345')
    expect(m.tone).toBe('bad')
    expect(m.title).toBe('Your sign-in ended. Sign in again.')
    expect(m.link).toEqual({ href: '/account?next=%2Fhere%3Fc%3Dabcd2345', label: 'Sign in again' })
  })
  it('anything else is a generic retry', () => {
    expect(checkinMessage({ status: 'error', reason: 'FAILED' }, 'Mochi').tone).toBe('bad')
  })
})
