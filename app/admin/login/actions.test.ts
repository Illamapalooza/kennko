import { describe, expect, it } from 'vitest'
import { validateCredentials } from './actions'

describe('validateCredentials', () => {
  it('accepts a well-formed email and password', () => {
    expect(validateCredentials('kenn@example.com', 'a-long-password')).toBeNull()
  })

  it('rejects a missing email', () => {
    expect(validateCredentials('', 'a-long-password')).toBe('Enter your email address.')
  })

  it('rejects a malformed email', () => {
    expect(validateCredentials('not-an-email', 'a-long-password')).toBe(
      'Enter a valid email address.',
    )
  })

  it('rejects a missing password', () => {
    expect(validateCredentials('kenn@example.com', '')).toBe('Enter your password.')
  })
})
