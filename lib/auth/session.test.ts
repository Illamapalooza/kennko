import { describe, expect, it } from 'vitest'
import { mapStaffRow } from './session'

describe('mapStaffRow', () => {
  it('maps a snake_case row to a StaffMember', () => {
    expect(
      mapStaffRow({
        id: 'u-1',
        email: 'kenn@example.com',
        full_name: 'Kenn Baliling',
        role: 'owner',
        is_active: true,
      }),
    ).toEqual({
      id: 'u-1',
      email: 'kenn@example.com',
      fullName: 'Kenn Baliling',
      role: 'owner',
      isActive: true,
    })
  })

  it('returns null for a missing row', () => {
    expect(mapStaffRow(null)).toBeNull()
  })

  it('returns null for a deactivated staff member', () => {
    expect(
      mapStaffRow({
        id: 'u-2',
        email: 'ex@example.com',
        full_name: 'Former Barista',
        role: 'barista',
        is_active: false,
      }),
    ).toBeNull()
  })
})
