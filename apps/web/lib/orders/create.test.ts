import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

// The published menu the checkout prices from.
let snapshot: unknown = null
vi.mock('@/lib/menu/api', () => ({ fetchMenuSnapshot: async () => snapshot }))

// Per-test failure injection: an insert error by table, and the proof upload result.
let insertErrors: Record<string, string> = {}
let uploadError: { message: string } | null = { message: 'stop here' }
let deleted: string[] = []
let removedProofs = 0

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    storage: {
      from: () => ({
        upload: async () => ({ error: uploadError }),
        remove: async () => {
          removedProofs += 1
          return { error: null }
        },
      }),
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
      }),
      insert: () => {
        const error = insertErrors[table] ? { message: insertErrors[table] } : null
        const result = { data: null, error }
        return {
          select: () => ({ single: async () => ({ data: error ? null : { id: `${table}-1` }, error }) }),
          then: (resolve: (v: typeof result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        }
      },
      delete: () => ({
        eq: async () => {
          deleted.push(table)
          return { error: null }
        },
      }),
    }),
  }),
}))

import { createOrder, type SubmittedOrder } from './create'

const PNG = new File(
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
  'p.png',
  { type: 'image/png' },
)

const variant = (code: string, priceCentavos: number, isAvailable = true) => ({
  id: `v-${code}`,
  code,
  label: code,
  priceCentavos,
  temperature: 'none',
  isAvailable,
})

const makeSnapshot = (variants = [variant('M', 8000), variant('L', 9000, false), variant('REG', 5000)]) => ({
  version: 1,
  publishedAt: '2026-11-20T00:00:00.000Z',
  categories: [
    {
      id: 'c1',
      name: 'Coffee',
      kind: 'drink',
      items: [
        {
          id: 'i1',
          name: 'Americano',
          description: null,
          imagePath: null,
          isBestseller: false,
          isAvailable: true,
          variants,
          optionGroupIds: ['g-milk'],
        },
      ],
    },
  ],
  optionGroups: [
    {
      id: 'g-milk',
      name: 'Milk',
      minSelect: 0,
      maxSelect: 1,
      options: [
        { id: 'o1', name: 'Oat Milk', priceCentavos: 4000, isAvailable: true },
        { id: 'o2', name: 'Soy Milk', priceCentavos: 3500, isAvailable: false },
      ],
    },
    { id: 'g-fries', name: 'Sauce', minSelect: 0, maxSelect: 1, options: [{ id: 'o3', name: 'BBQ', priceCentavos: 0, isAvailable: true }] },
  ],
  discountPresets: [],
})

const order = (size: string, modifierIds: string[] = []): SubmittedOrder =>
  ({
    name: 'Ana Cruz',
    email: 'ana@example.com',
    phone: '09171234567',
    fulfilment: 'pickup',
    address: '',
    barangay: '',
    fulfilAt: '2999-01-01T10:00:00+08:00',
    gcashReference: 'ABC123456',
    note: '',
    claimedTotalCentavos: 0,
    lines: [
      { menuItemId: 'i1', size, quantity: 1, modifierIds, iceLevel: null, iceServe: null },
    ],
  }) as SubmittedOrder

beforeEach(() => {
  insertErrors = {}
  uploadError = { message: 'stop here' }
  deleted = []
  removedProofs = 0
  snapshot = makeSnapshot()
})

describe('createOrder repricing from the published menu', () => {
  it('refuses a REG variant until Plan 2', async () => {
    const r = await createOrder(order('REG' as never), PNG)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses a sold-out size', async () => {
    const r = await createOrder(order('L'), PNG)
    expect(r).toMatchObject({ ok: false, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses an unavailable variant', async () => {
    snapshot = makeSnapshot([variant('M', 8000, false)])
    const r = await createOrder(order('M'), PNG)
    expect(r).toMatchObject({ ok: false, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses an unavailable option', async () => {
    const r = await createOrder(order('M', ['o2']), PNG)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'MODIFIER_UNAVAILABLE' })
  })

  it('refuses an option from a group not attached to the item', async () => {
    const r = await createOrder(order('M', ['o3']), PNG)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'MODIFIER_UNAVAILABLE' })
  })

  it('accepts the exact repriced total (variant 8000 + option 4000)', async () => {
    const o = order('M', ['o1'])
    o.claimedTotalCentavos = 12000
    // Past the price check the fake storage stops the order, proving the total matched.
    expect(await createOrder(o, PNG)).toMatchObject({ ok: false, code: 'UPLOAD_FAILED' })
  })

  it('rejects a total that is off by one centavo', async () => {
    const o = order('M', ['o1'])
    o.claimedTotalCentavos = 11999
    expect(await createOrder(o, PNG)).toMatchObject({ ok: false, code: 'PRICE_CHANGED' })
  })
})

describe('createOrder failure handling', () => {
  it('returns 503 MENU_UNAVAILABLE when there is no published menu', async () => {
    snapshot = null
    const r = await createOrder(order('M'), PNG)
    expect(r).toMatchObject({
      ok: false,
      status: 503,
      code: 'MENU_UNAVAILABLE',
      errors: ["The menu can't load right now. Please try again in a minute."],
    })
  })

  it('a draft price in the tables does not cause PRICE_CHANGED', async () => {
    const o = order('M')
    o.claimedTotalCentavos = 8000
    const r = await createOrder(o, PNG)
    expect(r).not.toMatchObject({ code: 'PRICE_CHANGED' })
    expect(r).toMatchObject({ ok: false, code: 'UPLOAD_FAILED' })
  })

  it('rolls the order back when the order_item_modifiers insert fails', async () => {
    uploadError = null
    insertErrors.order_item_modifiers = 'modifier insert failed'
    const o = order('M', ['o1'])
    o.claimedTotalCentavos = 12000
    const r = await createOrder(o, PNG)
    expect(r).toMatchObject({ ok: false, status: 500, code: 'ORDER_FAILED' })
    expect(deleted).toContain('orders')
    expect(removedProofs).toBe(1)
  })

  it('completes when every insert succeeds', async () => {
    uploadError = null
    const o = order('M', ['o1'])
    o.claimedTotalCentavos = 12000
    expect(await createOrder(o, PNG)).toMatchObject({ ok: true, totalCentavos: 12000 })
  })
})
