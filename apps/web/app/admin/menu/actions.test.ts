import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrentStaff = vi.fn()
const upsert = vi.fn(async () => ({ error: null }))
let found: { menu_categories: { kind: string } } | null = { menu_categories: { kind: 'drink' } }
const revalidatePath = vi.fn()

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentStaff: () => getCurrentStaff(),
  requireStaff: vi.fn(),
  requireOwner: vi.fn(),
}))
const itemUpdates: Record<string, unknown>[] = []
const storageUpload = vi.fn(async () => ({ error: null }))
const storageRemove = vi.fn(async () => ({ error: null }))
vi.mock('@/lib/supabase/server', () => ({
  getServerClient: async () => ({
    storage: { from: () => ({ upload: storageUpload, remove: storageRemove }) },
    from: (t: string) =>
      t === 'menu_items'
        ? {
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: found, error: null }) }) }),
            update: (payload: Record<string, unknown>) => {
              itemUpdates.push(payload)
              return { eq: async () => ({ error: null }) }
            },
          }
        : { upsert },
  }),
}))
vi.mock('@/lib/menu/publish', () => ({ publishMenu: vi.fn() }))

import { updateVariantPrice } from './actions'

describe('updateVariantPrice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    found = { menu_categories: { kind: 'drink' } }
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

  it('rejects an unknown item', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    found = null
    expect(await updateVariantPrice('nope', 'M', '10')).toEqual({ ok: false, message: 'Item not found.' })
  })

  it('rejects a size that does not apply to the category', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    found = { menu_categories: { kind: 'food' } }
    expect(await updateVariantPrice('i1', 'M', '10')).toEqual({ ok: false, message: 'That size does not apply to this item.' })
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('setItemOptionGroups', () => {
  it('refuses a barista', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'barista' })
    const { setItemOptionGroups } = await import('./actions')
    expect(await setItemOptionGroups('i1', ['g1'])).toEqual({ ok: false, message: 'Only the owner can change add-ons.' })
  })
})

describe('saveMenuItemDraft', () => {
  it('refuses a barista and returns a result instead of throwing', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'barista' })
    const { saveMenuItemDraft } = await import('./actions')
    const fd = new FormData()
    fd.set('name', 'x')
    expect(await saveMenuItemDraft(fd)).toEqual({ ok: false, message: 'Only the owner can edit menu items.' })
  })

  it('returns a message for a missing name', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    const { saveMenuItemDraft } = await import('./actions')
    expect(await saveMenuItemDraft(new FormData())).toEqual({ ok: false, message: 'Enter a name' })
  })
})

describe('archiveMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    itemUpdates.length = 0
  })

  it('archives as a draft: does not touch is_available', async () => {
    const { archiveMenuItem } = await import('./actions')
    await archiveMenuItem('i1')
    expect(itemUpdates).toEqual([{ is_archived: true }])
  })
})

describe('unarchiveMenuItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    itemUpdates.length = 0
  })

  it('refuses a barista', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'barista' })
    const { unarchiveMenuItem } = await import('./actions')
    expect(await unarchiveMenuItem('i1')).toEqual({ ok: false, message: 'Only the owner can change the menu.' })
    expect(itemUpdates).toEqual([])
  })

  it('restores the item for the owner without publishing', async () => {
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
    const { unarchiveMenuItem } = await import('./actions')
    const { publishMenu } = await import('@/lib/menu/publish')
    expect(await unarchiveMenuItem('i1')).toEqual({ ok: true })
    expect(itemUpdates).toEqual([{ is_archived: false }])
    expect(revalidatePath).toHaveBeenCalledWith('/admin', 'layout')
    expect(publishMenu).not.toHaveBeenCalled()
  })
})

describe('menu photos keep the published image alive', () => {
  const PNG = new File(
    [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
    'p.png',
    { type: 'image/png' },
  )

  beforeEach(() => {
    vi.clearAllMocks()
    itemUpdates.length = 0
    found = { image_path: 'menu/i1/old.png' } as never
  })

  it('replacing a photo does not delete the old object', async () => {
    const { uploadMenuImage } = await import('./actions')
    await uploadMenuImage('i1', PNG)
    expect(storageUpload).toHaveBeenCalledTimes(1)
    expect(storageRemove).not.toHaveBeenCalled()
  })

  it('removing a photo does not delete the object', async () => {
    const { removeMenuImage } = await import('./actions')
    await removeMenuImage('i1')
    expect(itemUpdates).toEqual([{ image_path: null }])
    expect(storageRemove).not.toHaveBeenCalled()
  })
})
