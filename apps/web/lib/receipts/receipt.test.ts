import { describe, expect, it } from 'vitest'
import { buildReceipt, type ReceiptOrder, type ShopSettings } from './receipt'

const settings: ShopSettings = {
  displayName: 'Kennko Coffee',
  registeredName: null,
  tin: null,
  address: 'CT. Montalban St., Villa Kananga, Butuan City',
  phone: '0930 599 2729',
  facebookUrl: null,
  receiptFooter: 'Ask for your official receipt at the counter.',
}

const base: ReceiptOrder = {
  orderCode: 'KNK-ABC123',
  ticket: 'W3',
  customerName: 'Ana Cruz',
  fulfilment: 'pickup',
  deliveryAddress: null,
  deliveryBarangay: null,
  paidAt: '2026-11-20T04:30:00Z',
  paymentStatus: 'paid',
  prepStatus: 'preparing',
  cancelledAt: null,
  reference: '1234567891234',
  subtotalCentavos: 30000,
  discountCentavos: 3000,
  deliveryFeeCentavos: 0,
  totalCentavos: 27000,
  lines: [
    {
      itemName: 'Spanish Latte', variantLabel: 'L', quantity: 2,
      unitPriceCentavos: 12000, lineTotalCentavos: 24000,
      options: [{ name: 'Oat milk', priceCentavos: 2000 }],
    },
  ],
}

describe('buildReceipt', () => {
  it('is null until payment was verified', () => {
    expect(buildReceipt({ ...base, paymentStatus: 'pending_verification' }, settings, 'public')).toBeNull()
    expect(buildReceipt({ ...base, paymentStatus: 'unpaid' }, settings, 'public')).toBeNull()
    expect(buildReceipt({ ...base, paymentStatus: 'rejected' }, settings, 'public')).toBeNull()
  })

  it('builds the public view of a paid pickup order', () => {
    const r = buildReceipt(base, settings, 'public')!
    expect(r.title).toBe('ORDER RECEIPT')
    expect(r.notice).toBe('THIS IS NOT AN OFFICIAL RECEIPT')
    expect(r.customer).toBe('Ana')
    expect(r.reference).toBe('••••1234')
    expect(r.stamp).toBeNull()
    expect(r.seller.name).toBe('Kennko Coffee')
    expect(r.seller.registeredName).toBeNull()
    expect(r.seller.tin).toBeNull()
    expect(r.footer).toBe(settings.receiptFooter)
  })

  it('copies totals from the order, never sums the lines', () => {
    const r = buildReceipt(base, settings, 'public')!
    expect(r.subtotal).toBe(30000)
    expect(r.discount).toBe(3000)
    expect(r.deliveryFee).toBe(0)
    expect(r.total).toBe(27000)
  })

  it('masks the reference to the last four digits', () => {
    const r = buildReceipt({ ...base, reference: '9876541234' }, settings, 'public')!
    expect(r.reference).toBe('••••1234')
  })

  it('shows only the barangay for public delivery, never the street', () => {
    const order: ReceiptOrder = {
      ...base, fulfilment: 'delivery',
      deliveryAddress: '12 Mabini St., Purok 3', deliveryBarangay: 'Libertad',
    }
    const r = buildReceipt(order, settings, 'public')!
    expect(r.fulfilment).toContain('Libertad')
    expect(JSON.stringify(r)).not.toContain('Mabini')
  })

  it('email view carries the full name, address and reference', () => {
    const order: ReceiptOrder = {
      ...base, fulfilment: 'delivery',
      deliveryAddress: '12 Mabini St., Purok 3', deliveryBarangay: 'Libertad',
    }
    const r = buildReceipt(order, settings, 'email')!
    expect(r.customer).toBe('Ana Cruz')
    expect(r.reference).toBe('1234567891234')
    expect(r.fulfilment).toContain('12 Mabini St., Purok 3')
  })

  it('stamps REFUNDED when the payment was refunded', () => {
    expect(buildReceipt({ ...base, paymentStatus: 'refunded' }, settings, 'public')!.stamp).toBe('REFUNDED')
  })

  it('stamps CANCELLED when paid then cancelled', () => {
    const r = buildReceipt({ ...base, prepStatus: 'cancelled', cancelledAt: '2026-11-20T05:00:00Z' }, settings, 'public')!
    expect(r.stamp).toBe('CANCELLED')
  })

  it('keeps registered name and TIN when present', () => {
    const r = buildReceipt(base, { ...settings, registeredName: 'Kennko OPC', tin: '123-456-789-000' }, 'public')!
    expect(r.seller.registeredName).toBe('Kennko OPC')
    expect(r.seller.tin).toBe('123-456-789-000')
  })

  it('formats paidAt in Manila time across UTC midnight', () => {
    const r = buildReceipt({ ...base, paidAt: '2026-11-20T17:00:00Z' }, settings, 'public')!
    expect(r.paidAt).toMatch(/Nov 21, 2026/)
  })

  it('masks a short reference fully', () => {
    expect(buildReceipt({ ...base, reference: '1234' }, settings, 'public')!.reference).toBe('••••')
    expect(buildReceipt({ ...base, reference: '12345' }, settings, 'public')!.reference).toBe('••••2345')
  })

  it('falls back to "Customer" for an empty name in both views', () => {
    for (const view of ['public', 'email'] as const) {
      expect(buildReceipt({ ...base, customerName: '   ' }, settings, view)!.customer).toBe('Customer')
    }
  })

  it('public delivery with no barangay never shows the street', () => {
    const order: ReceiptOrder = {
      ...base, fulfilment: 'delivery', deliveryAddress: '12 Mabini St.', deliveryBarangay: null,
    }
    const r = buildReceipt(order, settings, 'public')!
    expect(r.fulfilment).toBe('Delivery')
    expect(JSON.stringify(r)).not.toContain('Mabini')
  })
})
