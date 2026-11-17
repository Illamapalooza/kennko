import { describe, expect, it } from 'vitest'
import { canDemote } from './guards'

const owner = { id: 'a', role: 'owner' as const }
const otherOwner = { id: 'b', role: 'owner' as const }
const barista = { id: 'c', role: 'barista' as const }

describe('canDemote', () => {
  it('allows demoting an owner while another owner remains', () => {
    expect(canDemote([owner, otherOwner], 'b')).toBe(true)
  })

  it('refuses to demote the only remaining owner', () => {
    expect(canDemote([owner, barista], 'a')).toBe(false)
  })

  it('always allows changing a barista', () => {
    expect(canDemote([owner, barista], 'c')).toBe(true)
  })
})
