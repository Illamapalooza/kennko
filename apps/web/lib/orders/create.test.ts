import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Tables = Record<string, unknown[]>
let tables: Tables = {}

// The fake refuses a select that leaves out the columns repricing depends on.
const REQUIRED: Record<string, string[]> = {
  menu_items: ['is_available', 'is_archived', 'menu_variants', 'price_centavos', 'code'],
  options: ['is_available', 'is_archived', 'group_id', 'price_centavos'],
  item_option_groups: ['item_id', 'group_id'],
}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    storage: {
      from: () => ({ upload: async () => ({ error: { message: 'stop here' } }) }),
    },
    from: (table: string) => ({
      select: (cols: string) => {
        for (const col of REQUIRED[table] ?? []) {
          if (!cols.includes(col)) throw new Error(`${table} select is missing ${col}`)
        }
        return {
          in: async () => ({ data: tables[table] ?? [], error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: null }) }),
        }
      },
    }),
  }),
}))

import { createOrder, type SubmittedOrder } from './create'

const PNG = new File(
  [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])],
  'p.png',
  { type: 'image/png' },
)

const variant = (code: string, price: number, over: Record<string, unknown> = {}) => ({
  code,
  price_centavos: price,
  is_available: true,
  is_archived: false,
  ...over,
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
  tables = {
    menu_items: [
      {
        id: 'i1',
        name: 'Americano',
        is_available: true,
        is_archived: false,
        menu_variants: [variant('M', 8000), variant('L', 9000, { is_archived: true }), variant('REG', 5000)],
      },
    ],
    options: [
      { id: 'o1', group_id: 'g-milk', name: 'Oat Milk', price_centavos: 4000, is_available: true, is_archived: false },
      { id: 'o2', group_id: 'g-milk', name: 'Soy Milk', price_centavos: 3500, is_available: false, is_archived: false },
      { id: 'o3', group_id: 'g-fries', name: 'BBQ', price_centavos: 0, is_available: true, is_archived: false },
    ],
    item_option_groups: [{ item_id: 'i1', group_id: 'g-milk' }],
  }
})

describe('createOrder repricing from variants', () => {
  it('refuses a REG variant until Plan 2', async () => {
    const r = await createOrder(order('REG' as never), PNG)
    expect(r).toMatchObject({ ok: false, status: 409, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses an archived variant', async () => {
    const r = await createOrder(order('L'), PNG)
    expect(r).toMatchObject({ ok: false, code: 'SIZE_UNAVAILABLE' })
  })

  it('refuses an unavailable variant', async () => {
    ;(tables.menu_items[0] as { menu_variants: unknown[] }).menu_variants = [
      variant('M', 8000, { is_available: false }),
    ]
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
