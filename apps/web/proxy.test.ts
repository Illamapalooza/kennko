import { describe, expect, it } from 'vitest'
import { config } from './proxy'

describe('proxy matcher', () => {
  it('refreshes the session for /here, so a stale token is rewritten before the check-in tap', () => {
    expect(config.matcher).toContain('/here/:path*')
  })
  it('leaves the public home page and the menu out, so they stay statically cached', () => {
    expect(config.matcher).not.toContain('/')
    expect(config.matcher.every((m) => m.startsWith('/admin') || /^\/(orders|account|auth|here)\//.test(m))).toBe(true)
  })
})
