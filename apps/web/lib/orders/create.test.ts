import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Tables = Record<string, unknown[]>
let tables: Tables = {}

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ data: tables[table] ?? [], error: null }),
        eq: () => ({ maybeSingle: async () => ({ data: null }) }),
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
      { id: 'o1', name: 'Oat Milk', price_centavos: 4000, is_available: true },
      { id: 'o2', name: 'Soy Milk', price_centavos: 3500, is_available: false },
    ],
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

  it('prices from the variant and option: a wrong claimed total is PRICE_CHANGED', async () => {
    const r = await createOrder(order('M', ['o1']), PNG)
    expect(r).toMatchObject({ ok: false, code: 'PRICE_CHANGED' })
  })
})
