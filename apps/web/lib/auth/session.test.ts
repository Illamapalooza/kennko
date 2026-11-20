import { describe, expect, it, vi } from 'vitest'

const eq = vi.fn()
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } } }) },
    from: () => ({
      select: () => ({
        eq: (...a: unknown[]) => {
          eq(...a)
          return {
            maybeSingle: async () => ({
              data: { id: 's-1', email: null, full_name: 'Till Only', role: 'manager', is_active: true },
            }),
          }
        },
      }),
    }),
  }),
}))

import { getCurrentStaff, mapStaffRow } from './session'

describe('getCurrentStaff', () => {
  it('finds the staff row by the login (user_id), not by staff id', async () => {
    const staff = await getCurrentStaff()
    expect(eq).toHaveBeenCalledWith('user_id', 'auth-1')
    expect(staff).toMatchObject({ id: 's-1', role: 'manager', email: null })
  })
})

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
