import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrentStaff = vi.fn()
const upsert = vi.fn(async () => ({ error: null }))
const revalidatePath = vi.fn()

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentStaff: () => getCurrentStaff(),
  requireStaff: vi.fn(),
  requireOwner: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({ from: () => ({ upsert }) }),
}))
vi.mock('@/lib/menu/publish', () => ({ publishMenu: vi.fn() }))

import { updateVariantPrice } from './actions'

describe('updateVariantPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('refuses a barista without throwing', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'barista' })
    expect(await updateVariantPrice('i1', 'M', '120')).toEqual({ ok: false, message: 'Only the owner can change prices.' })
    expect(upsert).not.toHaveBeenCalled()
  })

  it('returns the parse message for invalid input', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    expect(await updateVariantPrice('i1', 'M', 'abc')).toEqual({ ok: false, message: '"abc" is not a valid price' })
  })

  it('saves a valid price as centavos and revalidates', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    expect(await updateVariantPrice('i1', 'M', '120.50')).toEqual({ ok: true, priceCentavos: 12050 })
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
  })
})
