import { expect, test } from 'vitest'
import { canMovePrep, nextPrepStatus, orderStage, ticketLabel } from './order-status.ts'

test('orderStage maps every prep/payment pair the website shows', () => {
  expect(orderStage('placed', 'pending_verification')).toBe('awaiting_verification')
  expect(orderStage('placed', 'paid')).toBe('confirmed')
  expect(orderStage('preparing', 'paid')).toBe('preparing')
  expect(orderStage('ready', 'paid')).toBe('ready')
  expect(orderStage('out_for_delivery', 'paid')).toBe('out_for_delivery')
  expect(orderStage('completed', 'paid')).toBe('completed')
  expect(orderStage('cancelled', 'rejected')).toBe('rejected')
  expect(orderStage('cancelled', 'refunded')).toBe('cancelled')
  expect(orderStage('cancelled', 'paid')).toBe('cancelled')
})
test('pickup and delivery flows', () => {
  expect(nextPrepStatus('placed', 'pickup')).toBe('preparing')
  expect(nextPrepStatus('preparing', 'pickup')).toBe('ready')
  expect(nextPrepStatus('preparing', 'delivery')).toBe('out_for_delivery')
  expect(nextPrepStatus('ready', 'pickup')).toBe('completed')
  expect(nextPrepStatus('out_for_delivery', 'delivery')).toBe('completed')
  expect(nextPrepStatus('completed', 'pickup')).toBeNull()
  expect(nextPrepStatus('cancelled', 'delivery')).toBeNull()
  expect(canMovePrep('placed', 'completed', 'pickup')).toBe(false)
  expect(canMovePrep('preparing', 'ready', 'delivery')).toBe(false)
  expect(canMovePrep('preparing', 'ready', 'pickup')).toBe(true)
})
test('counter flows', () => {
  expect(nextPrepStatus('placed', 'dine_in')).toBe('preparing')
  expect(nextPrepStatus('preparing', 'dine_in')).toBe('ready')
  expect(nextPrepStatus('ready', 'dine_in')).toBe('completed')
  expect(nextPrepStatus('placed', 'takeout')).toBe('preparing')
  expect(nextPrepStatus('preparing', 'takeout')).toBe('ready')
  expect(nextPrepStatus('ready', 'takeout')).toBe('completed')
})
test('ticket label', () => {
  expect(ticketLabel('W', 12)).toBe('W12')
  expect(ticketLabel('C', 3)).toBe('C3')
})
