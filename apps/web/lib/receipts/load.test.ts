import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

type Call = [string, ...unknown[]]
let calls: Call[] = []
let result: { data: unknown; error: unknown } = { data: null, error: null }

vi.mock('@/lib/supabase/admin', () => ({
  getAdminClient: () => {
    const chain: Record<string, unknown> = {}
    for (const name of ['from', 'select', 'eq', 'order']) {
      chain[name] = (...args: unknown[]) => { calls.push([name, ...args]); return chain }
    }
    chain.maybeSingle = async () => result
    return chain
  },
}))

const { loadReceiptOrder } = await import('./load')

const row = {
  order_code: 'KNK-7F3Q', ticket_series: 'W', ticket_number: 3, customer_name: 'Ana', fulfilment: 'pickup',
  delivery_address: null, delivery_barangay: null, prep_status: 'preparing', payment_status: 'paid',
  cancelled_at: null, subtotal_centavos: 100, discount_centavos: 0, delivery_fee_centavos: 0, total_centavos: 100,
  payments: [], order_lines: [],
}

describe('loadReceiptOrder', () => {
  beforeEach(() => { calls = [] })
  afterEach(() => { vi.restoreAllMocks() })

  it('a query error is logged and thrown, not treated as not found', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    result = { data: null, error: { message: 'connection reset' } }
    await expect(loadReceiptOrder('knk-7f3q')).rejects.toThrow()
    expect(error).toHaveBeenCalled()
  })

  it('a missing order is null', async () => {
    result = { data: null, error: null }
    expect(await loadReceiptOrder('KNK-NOPE')).toBeNull()
  })

  it('orders lines by created_at then id, and options by id', async () => {
    result = { data: row, error: null }
    expect(await loadReceiptOrder('knk-7f3q')).toMatchObject({ orderCode: 'KNK-7F3Q' })
    const orders = calls.filter((c) => c[0] === 'order').map((c) => c.slice(1))
    expect(orders).toEqual([
      ['created_at', { ascending: true, referencedTable: 'order_lines' }],
      ['id', { ascending: true, referencedTable: 'order_lines' }],
      ['id', { ascending: true, referencedTable: 'order_lines.order_line_options' }],
    ])
  })
})
