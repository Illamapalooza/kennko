import { describe, expect, it } from 'vitest'
import { buildReceipt, type ReceiptOrder, type ShopSettings } from './receipt'
import { receiptHtml, receiptText } from './email'

const settings: ShopSettings = {
  displayName: 'Kennko Coffee',
  registeredName: null,
  tin: null,
  address: 'CT. Montalban St., Villa Kananga, Butuan City',
  phone: '0930 599 2729',
  facebookUrl: null,
  receiptFooter: 'Ask for your official receipt at the counter.',
}

const order: ReceiptOrder = {
  orderCode: 'KNK-ABC123', ticket: 'W3', customerName: 'Ana <script>alert(1)</script>',
  fulfilment: 'pickup', deliveryAddress: null, deliveryBarangay: null,
  paidAt: '2026-11-20T04:30:00Z', paymentStatus: 'paid', prepStatus: 'preparing', cancelledAt: null,
  reference: '1234567891234',
  subtotalCentavos: 30000, discountCentavos: 3000, deliveryFeeCentavos: 0, totalCentavos: 27000,
  lines: [{
    itemName: 'Latte <b>x</b>', variantLabel: '16oz', quantity: 2,
    unitPriceCentavos: 15000, lineTotalCentavos: 30000,
    options: [{ name: 'Oat "milk"', priceCentavos: 1000 }],
  }],
}

const receipt = buildReceipt(order, settings, 'email')!

describe('receiptHtml', () => {
  const html = receiptHtml(receipt)
  it('escapes customer and item names', () => {
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Oat &quot;milk&quot;')
  })
  it('shows the notice, total and brand blue', () => {
    expect(html).toContain('THIS IS NOT AN OFFICIAL RECEIPT')
    expect(html).toContain('₱270')
    expect(html).toContain('#0055FF')
  })
})

describe('receiptText', () => {
  const text = receiptText(receipt)
  it('shows the notice, total, ticket and lines', () => {
    expect(text).toContain('THIS IS NOT AN OFFICIAL RECEIPT')
    expect(text).toContain('₱270')
    expect(text).toContain('KNK-ABC123')
    expect(text).toContain('Latte <b>x</b>')
  })
})

describe('refunded stamp and brand notice', () => {
  const refunded = buildReceipt({ ...order, paymentStatus: 'refunded' }, settings, 'email')!
  it('renders REFUNDED in both versions', () => {
    expect(receiptHtml(refunded)).toContain('REFUNDED')
    expect(receiptText(refunded)).toContain('*** REFUNDED ***')
  })
  it('uses no dark notice bar', () => {
    const html = receiptHtml(receipt)
    expect(html).not.toContain('background:#111111')
    expect(html).toContain('#FFB800')
  })
})
