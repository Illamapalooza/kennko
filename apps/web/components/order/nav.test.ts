import { describe, it, expect } from 'vitest'
import { navLinks, stepState, backTarget, resolveStep, STEP_LABELS } from './nav'

describe('navLinks', () => {
  it('signed out on the menu', () => {
    const links = navLinks('menu', false)
    expect(links.map((l) => l.label)).toEqual(['Menu', 'My orders', 'Sign in'])
    expect(links.map((l) => l.href)).toEqual(['/order', '/account', '/account'])
    expect(links.map((l) => l.current)).toEqual([true, false, false])
  })

  it('signed in shows the first name and sends history to /orders', () => {
    const links = navLinks('orders', true, 'Julius Baliling')
    expect(links[links.length - 1]).toMatchObject({ label: 'Julius', href: '/orders' })
    expect(links[1]).toMatchObject({ label: 'My orders', href: '/orders', current: true })
    expect(links[0].current).toBe(false)
  })

  it('marks sign in current on the account page and nothing on status', () => {
    expect(navLinks('account', false)[2].current).toBe(true)
    expect(navLinks('status', false).some((l) => l.current)).toBe(false)
  })
})

describe('steps', () => {
  it('labels', () => {
    expect(STEP_LABELS).toEqual({ menu: 'Menu', checkout: 'Details', pay: 'Pay' })
  })
  it('stepState', () => {
    expect(stepState('menu', 'pay')).toBe('done')
    expect(stepState('pay', 'pay')).toBe('current')
    expect(stepState('pay', 'checkout')).toBe('todo')
  })
  it('backTarget', () => {
    expect(backTarget('pay')).toEqual({ step: 'checkout', label: 'Back to details' })
    expect(backTarget('checkout')).toEqual({ step: 'menu', label: 'Back to menu' })
    expect(backTarget('menu')).toBeNull()
  })
})

describe('resolveStep', () => {
  it('sends an empty cart back to the menu with a note', () => {
    expect(resolveStep('checkout', 0)).toEqual({
      step: 'menu',
      note: 'Your cart is empty — pick something first.',
    })
    expect(resolveStep('pay', 0).step).toBe('menu')
  })
  it('keeps the step when the cart has drinks', () => {
    expect(resolveStep('pay', 2)).toEqual({ step: 'pay', note: null })
  })
  it('defaults unknown or missing steps to the menu without a note', () => {
    expect(resolveStep(null, 0)).toEqual({ step: 'menu', note: null })
    expect(resolveStep('nonsense', 3)).toEqual({ step: 'menu', note: null })
  })
})
