import { describe, expect, it, beforeEach } from 'vitest'
import { allowRequest, resetRateLimit } from './rate-limit'

describe('allowRequest', () => {
  beforeEach(resetRateLimit)

  it('allows the first request', () => {
    expect(allowRequest('1.2.3.4')).toBe(true)
  })

  it('allows up to 8 in a window then blocks', () => {
    for (let i = 0; i < 8; i += 1) expect(allowRequest('1.2.3.4')).toBe(true)
    expect(allowRequest('1.2.3.4')).toBe(false)
  })

  it('tracks addresses independently', () => {
    for (let i = 0; i < 8; i += 1) allowRequest('1.2.3.4')
    expect(allowRequest('5.6.7.8')).toBe(true)
  })

  it('lets the window expire', () => {
    const start = 1_000_000
    for (let i = 0; i < 8; i += 1) allowRequest('1.2.3.4', start)
    expect(allowRequest('1.2.3.4', start)).toBe(false)
    expect(allowRequest('1.2.3.4', start + 10 * 60 * 1000)).toBe(true)
  })
})
