import { describe, expect, it } from 'vitest'
import { formatCountdown, secondsLeft, spacedCode, tillStatus, type TillView } from './tills'

const NOW = Date.parse('2026-11-20T10:00:00Z')
const till = (over: Partial<TillView>): TillView => ({
  id: 'd', name: 'Counter', status: 'paired', expiresAt: null, pairedAt: null, lastSeenAt: null, ...over,
})

describe('till helpers', () => {
  it('spaces a 6-digit code', () => expect(spacedCode('482913')).toBe('482 913'))
  it('formats a countdown', () => {
    expect(formatCountdown(581)).toBe('9:41')
    expect(formatCountdown(5)).toBe('0:05')
    expect(formatCountdown(0)).toBe('0:00')
  })
  it('counts seconds left and floors at zero', () => {
    expect(secondsLeft('2026-11-20T10:09:41Z', NOW)).toBe(581)
    expect(secondsLeft('2026-11-20T09:00:00Z', NOW)).toBe(0)
  })
  it('describes each status', () => {
    expect(tillStatus(till({ status: 'waiting' }), NOW)).toBe('Waiting for the code')
    expect(tillStatus(till({ status: 'expired' }), NOW)).toBe('Code expired')
    expect(tillStatus(till({}), NOW)).toBe('Connected · not seen yet')
    expect(tillStatus(till({ lastSeenAt: '2026-11-20T09:57:00Z' }), NOW)).toBe('Connected · last seen 3 min ago')
  })
})
