import { beforeEach, describe, expect, it, vi } from 'vitest'

const getCurrentStaff = vi.fn()
const ops: string[] = []
const updates: Record<string, unknown>[] = []
let itemRow: unknown = { id: 'i1', category_id: 'c1', menu_categories: { kind: 'drink' } }
let existingGroups: { id: string }[] = [{ id: 'g1' }, { id: 'g2' }]
let wanted: string[] | null = null
let upsertError: { message: string } | null = null

// A chainable, awaitable query fake that records the operations performed.
function table(name: string) {
  let op = 'select'
  const q: Record<string, unknown> = {}
  const done = () => {
    if (name === 'item_option_groups' && op === 'upsert') {
      ops.push('upsert')
      return { error: upsertError }
    }
    if (name === 'item_option_groups' && op === 'delete') {
      ops.push('delete')
      return { error: null }
    }
    if (name === 'option_groups') return { data: existingGroups.filter((g) => !wanted || wanted.includes(g.id)), error: null }
    return { data: itemRow, error: null }
  }
  for (const m of ['select', 'eq', 'not', 'single', 'maybeSingle']) q[m] = () => q
  q.in = (_c: string, ids: string[]) => ((wanted = ids), q)
  q.upsert = () => ((op = 'upsert'), q)
  q.delete = () => ((op = 'delete'), q)
  q.update = (row: Record<string, unknown>) => ((op = 'update'), updates.push(row), q)
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(done()).then(res)
  return q
}

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth/session', () => ({
  getCurrentStaff: () => getCurrentStaff(),
  requireStaff: vi.fn(),
  requireOwner: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ getServerClient: async () => ({ from: (t: string) => table(t) }) }))
vi.mock('@/lib/menu/publish', () => ({ publishMenu: vi.fn() }))

import { saveMenuItemDraft, setItemOptionGroups } from './actions'

describe('setItemOptionGroups ordering and validation', () => {
  beforeEach(() => {
    ops.length = 0
    wanted = null
    updates.length = 0
    itemRow = { id: 'i1', category_id: 'c1', menu_categories: { kind: 'drink' } }
    existingGroups = [{ id: 'g1' }, { id: 'g2' }]
    upsertError = null
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
  })

  it('upserts before it deletes', async () => {
    expect(await setItemOptionGroups('i1', ['g1', 'g2', 'g1'])).toEqual({ ok: true })
    expect(ops).toEqual(['upsert', 'delete'])
  })

  it('does not delete when the upsert fails', async () => {
    upsertError = { message: 'boom' }
    const result = await setItemOptionGroups('i1', ['g1'])
    expect(result.ok).toBe(false)
    expect(ops).toEqual(['upsert'])
  })

  it('only deletes when the list is empty', async () => {
    expect(await setItemOptionGroups('i1', [])).toEqual({ ok: true })
    expect(ops).toEqual(['delete'])
  })

  it('rejects an unknown item', async () => {
    itemRow = null
    expect(await setItemOptionGroups('nope', ['g1'])).toEqual({ ok: false, message: 'Item not found.' })
    expect(ops).toEqual([])
  })

  it('rejects a group that no longer exists', async () => {
    existingGroups = [{ id: 'g1' }]
    expect(await setItemOptionGroups('i1', ['g1', 'gX'])).toEqual({
      ok: false,
      message: 'One of those add-on groups no longer exists.',
    })
    expect(ops).toEqual([])
  })
})

describe('saveMenuItemDraft on update', () => {
  beforeEach(() => {
    updates.length = 0
    itemRow = { id: 'i1', category_id: 'c1', menu_categories: { kind: 'drink' } }
    getCurrentStaff.mockResolvedValue({ role: 'owner' })
  })

  it('never writes the client category_id', async () => {
    const fd = new FormData()
    fd.set('id', 'i1')
    fd.set('name', 'Latte')
    fd.set('category_id', 'hacked')
    expect(await saveMenuItemDraft(fd)).toEqual({ ok: true, id: 'i1' })
    expect(updates).toHaveLength(1)
    expect('category_id' in updates[0]).toBe(false)
  })
})
