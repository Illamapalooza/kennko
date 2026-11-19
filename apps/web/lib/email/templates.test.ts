import { describe, expect, it } from 'vitest'
import {
  staffAlertSubject,
  staffAlertBody,
  customerConfirmSubject,
  customerConfirmBody,
  customerRejectBody,
  type OrderEmailData,
} from './templates'

const base: OrderEmailData = {
  orderCode: 'KNK-7F3Q',
  customerName: 'Ana Cruz',
  fulfilment: 'pickup',
  fulfilAt: '24 Aug 2026, 3:00 PM',
  totalCentavos: 29000,
  items: [{ name: 'Spanish Latte', variantLabel: 'L', quantity: 2 }],
}

const delivery: OrderEmailData = {
  ...base,
  fulfilment: 'delivery',
  deliveryAddress: '12 Montalban St., Villa Kananga',
  totalCentavos: 34000,
}

describe('staff alert', () => {
  it('leads the subject with the ticket when there is one', () => {
    const subject = staffAlertSubject({ ...base, ticket: 'W3' })
    expect(subject.startsWith('New order W3 · KNK-7F3Q — ₱290')).toBe(true)
  })

  it('prints the variant label', () => {
    const body = staffAlertBody({
      ...base,
      items: [{ name: 'Spanish Latte', variantLabel: '16oz', quantity: 1 }],
    })
    expect(body).toContain('1x Spanish Latte (16oz)')
  })

  it('puts the code and total in the subject so it is actionable from a lock screen', () => {
    const subject = staffAlertSubject(base)
    expect(subject).toContain('KNK-7F3Q')
    expect(subject).toContain('₱290')
  })

  it('says plainly that payment is not verified', () => {
    expect(staffAlertBody(base)).toContain('PAYMENT IS NOT VERIFIED YET')
  })

  it('names the delivery address for delivery orders', () => {
    expect(staffAlertBody(delivery)).toContain('12 Montalban St., Villa Kananga')
  })

  it('says pickup for pickup orders', () => {
    expect(staffAlertBody(base)).toContain('pickup')
  })

  it('lists items with quantity and size', () => {
    expect(staffAlertBody(base)).toContain('2x Spanish Latte (L)')
  })
})

describe('customer confirmation', () => {
  it('names the order in the subject', () => {
    expect(customerConfirmSubject(base)).toContain('KNK-7F3Q')
  })

  it('tells a pickup customer where to collect', () => {
    expect(customerConfirmBody(base)).toContain('CT. Montalban St., Villa Kananga')
  })

  it('tells a delivery customer where it is going', () => {
    expect(customerConfirmBody(delivery)).toContain('deliver it to 12 Montalban St.')
  })
})

describe('customer rejection', () => {
  it('states the reason and how to get help', () => {
    const body = customerRejectBody(base, 'Reference number not found')
    expect(body).toContain('Reference number not found')
    expect(body).toContain('kennco.cafebxu')
  })

  it('makes clear nothing is being prepared', () => {
    expect(customerRejectBody(base, 'x')).toContain('not started preparing')
  })
})
