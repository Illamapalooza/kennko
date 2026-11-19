import type { IceLevel, IceServe } from './ice.ts'
import type { DrinkSize } from './menu.ts'
import type { Fulfilment as AnyFulfilment } from './order-status.ts'

/** What the online checkout offers; core's wider `Fulfilment` also covers the till. */
type CheckoutFulfilment = Extract<AnyFulfilment, 'pickup' | 'delivery'>

/** One drink as the customer submitted it: ids and choices only, never prices. */
export type CheckoutLine = {
  menuItemId: string
  size: DrinkSize
  quantity: number
  modifierIds: string[]
  iceLevel: IceLevel | null
  iceServe: IceServe | null
  note?: string
}

export type CheckoutInput = {
  name: string
  email: string
  phone: string
  fulfilment: CheckoutFulfilment
  address: string
  barangay: string
  fulfilAt: string
  gcashReference: string
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// PH mobile: 09XXXXXXXXX or +639XXXXXXXXX
const PH_MOBILE_PATTERN = /^(09\d{9}|\+639\d{9})$/
const REFERENCE_PATTERN = /^[A-Za-z0-9]{6,20}$/

/**
 * Returns every problem at once so the customer fixes one form rather than
 * discovering five errors one submit at a time.
 */
export function validateCheckout(input: CheckoutInput, now = new Date()): string[] {
  const errors: string[] = []

  if (!input.name.trim()) errors.push('Enter your name.')

  if (!input.email.trim()) errors.push('Enter your email address.')
  else if (!EMAIL_PATTERN.test(input.email.trim()))
    errors.push('Enter a valid email address.')

  const phone = input.phone.replace(/[\s-]/g, '')
  if (!phone) errors.push('Enter your mobile number.')
  else if (!PH_MOBILE_PATTERN.test(phone))
    errors.push('Enter a Philippine mobile number, like 0912 345 6789.')

  if (input.fulfilment === 'delivery') {
    if (!input.address.trim()) errors.push('Enter the delivery address.')
    if (!input.barangay.trim()) errors.push('Choose the barangay for delivery.')
  } else {
    // Not merely ignored: a pickup order carrying an address means the form is
    // confused, and the database rejects it anyway.
    if (input.address.trim() || input.barangay.trim())
      errors.push('Pickup orders do not take a delivery address.')
  }

  if (!input.fulfilAt) {
    errors.push('Choose a time.')
  } else {
    const when = new Date(input.fulfilAt)
    if (Number.isNaN(when.getTime())) errors.push('Choose a valid time.')
    else if (when.getTime() <= now.getTime()) errors.push('Choose a time in the future.')
  }

  if (!input.gcashReference.trim()) errors.push('Enter the GCash reference number.')
  else if (!REFERENCE_PATTERN.test(input.gcashReference.trim()))
    errors.push('A GCash reference is 6 to 20 letters and numbers.')

  return errors
}
