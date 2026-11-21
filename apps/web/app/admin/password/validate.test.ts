import { describe, expect, it } from 'vitest'
import { validateNewPassword } from './validate'

describe('validateNewPassword', () => {
  it('accepts a long enough matching password', () => {
    expect(validateNewPassword('kennko-coffee-1', 'kennko-coffee-1')).toBeNull()
  })

  it('refuses a short password', () => {
    expect(validateNewPassword('short', 'short')).toBe('Use at least 8 characters.')
  })

  it('refuses a password over 72 bytes', () => {
    const long = 'a'.repeat(73)
    expect(validateNewPassword(long, long)).toBe('That password is too long.')
  })

  it('refuses passwords that do not match', () => {
    expect(validateNewPassword('kennko-coffee-1', 'kennko-coffee-2')).toBe('The two passwords do not match.')
  })
})
