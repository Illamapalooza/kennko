import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicReceiptView } from '@kennko/core'

vi.mock('server-only', () => ({}))

const publicFetch = vi.fn()
vi.mock('@/lib/api/client', () => ({ publicFetch: (...a: unknown[]) => publicFetch(...a) }))

const load = await import('./load')
const { loadReceipt, FALLBACK_SETTINGS } = load
const { buildReceipt } = await import('./receipt')

const shop = {
  displayName: 'Kennko Coffee', registeredName: 'Kennko Inc.', tin: '123', address: '7 Settings Rd, Butuan',
  phone: '0917', facebookUrl: 'fb.com/kennko', receiptFooter: 'Thanks!',
}

const view: PublicReceiptView = {
  order: {
    orderCode: 'KNK-7F3Q', ticket: 'W3', customerFirstName: 'Ana', fulfilment: 'delivery',
    deliveryBarangay: 'Villa Kananga', prepStatus: 'preparing', paymentStatus: 'paid', cancelledAt: null,
    subtotalCentavos: 29000, discountCentavos: 0, deliveryFeeCentavos: 2000, totalCentavos: 31000,
    payment: { referenceMasked: '••••1234', verifiedAt: '2026-11-20T04:30:00.000Z' },
    lines: [{
      itemName: 'Spanish Latte', variantLabel: '16oz', quantity: 2, unitPriceCentavos: 14500,
      lineTotalCentavos: 29000, options: [{ name: 'Oat milk', priceCentavos: 0 }],
    }],
  },
  shop,
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  publicFetch.mockReset()
  publicFetch.mockImplementation(async () => json(200, view))
})
afterEach(() => { vi.restoreAllMocks() })

const expectedOrder = {
  orderCode: 'KNK-7F3Q', ticket: 'W3', customerName: 'Ana', fulfilment: 'delivery',
  deliveryAddress: null, deliveryBarangay: 'Villa Kananga', paidAt: '2026-11-20T04:30:00.000Z',
  paymentStatus: 'paid', prepStatus: 'preparing', cancelledAt: null, reference: '••••1234',
  subtotalCentavos: 29000, discountCentavos: 0, deliveryFeeCentavos: 2000, totalCentavos: 31000,
  lines: view.order.lines,
}

describe('loadReceipt', () => {
  it('reads the public receipt endpoint once, with the encoded code', async () => {
    await loadReceipt('knk 7f3q')
    expect(publicFetch).toHaveBeenCalledTimes(1)
    expect(publicFetch.mock.calls[0]![0]).toBe('/v1/orders/by-code/knk%207f3q/receipt')
  })

  it('maps to the same ReceiptOrder as before and the shop settings', async () => {
    const r = await loadReceipt('KNK-7F3Q')
    expect(r).toEqual({ order: expectedOrder, settings: shop })
    expect(Object.keys(r!.order).sort()).toEqual(Object.keys(expectedOrder).sort())
  })

  it('renders the public receipt exactly as before', async () => {
    const r = await loadReceipt('KNK-7F3Q')
    const receipt = buildReceipt(r!.order, r!.settings, 'public')!
    expect(receipt.customer).toBe('Ana')
    expect(receipt.fulfilment).toBe('Delivery to Villa Kananga')
    expect(receipt.reference).toBe('••••1234')
  })

  it("an empty first name reads 'Customer'", async () => {
    publicFetch.mockResolvedValue(json(200, { ...view, order: { ...view.order, customerFirstName: '' } }))
    const r = await loadReceipt('KNK-7F3Q')
    expect(r!.order.customerName).toBe('Customer')
  })

  it('no payment yet: no paidAt, no reference, and no receipt to build', async () => {
    publicFetch.mockResolvedValue(json(200, {
      ...view, order: { ...view.order, paymentStatus: 'pending_verification', payment: null },
    }))
    const r = await loadReceipt('KNK-7F3Q')
    expect(r!.order).toMatchObject({ paidAt: null, reference: null })
    expect(buildReceipt(r!.order, r!.settings, 'public')).toBeNull()
  })

  it('shop: null uses FALLBACK_SETTINGS', async () => {
    publicFetch.mockResolvedValue(json(200, { ...view, shop: null }))
    expect((await loadReceipt('KNK-7F3Q'))!.settings).toEqual(FALLBACK_SETTINGS)
  })

  it('a 404 is null', async () => {
    publicFetch.mockResolvedValue(json(404, { code: 'NOT_FOUND' }))
    expect(await loadReceipt('KNK-NOPE')).toBeNull()
  })

  it('any other failure is logged and thrown, not treated as not found', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    publicFetch.mockResolvedValue(json(500, { code: 'INTERNAL' }))
    await expect(loadReceipt('KNK-7F3Q')).rejects.toThrow()
    publicFetch.mockRejectedValue(new Error('network'))
    await expect(loadReceipt('KNK-7F3Q')).rejects.toThrow()
    expect(error).toHaveBeenCalled()
  })
})

describe('exports', () => {
  it('only loadReceipt reads the receipt: the old loadReceiptOrder and loadShopSettings are gone', () => {
    expect(Object.keys(load).sort()).toEqual(['FALLBACK_SETTINGS', 'loadReceipt'])
  })
})
