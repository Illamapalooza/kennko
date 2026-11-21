import { describe, expect, it } from 'vitest'
import { gateNote } from '../src/gateText.ts'

describe('gateNote', () => {
  it('tells staff when no owner or manager PIN is issued yet on Android', () => {
    expect(gateNote({ pinMode: 'per-person', host: 'android', noLeads: true }))
      .toBe('No PINs yet. The owner issues them in admin › Staff, then tap Try again.')
  })

  it('returns null when leads exist', () => {
    expect(gateNote({ pinMode: 'per-person', host: 'android', noLeads: false })).toBeNull()
  })
})
