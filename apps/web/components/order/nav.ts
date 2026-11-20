export type NavPlace = 'menu' | 'orders' | 'account' | 'status' | 'receipt'

export type NavLink = { label: string; href: string; current: boolean }

export function navLinks(place: NavPlace, signedIn: boolean, customerName?: string): NavLink[] {
  const first = customerName?.trim().split(/\s+/)[0] || 'Account'
  return [
    { label: 'Menu', href: '/order', current: place === 'menu' },
    { label: 'My orders', href: signedIn ? '/orders' : '/account', current: place === 'orders' },
    signedIn
      ? { label: first, href: '/orders', current: false }
      : { label: 'Sign in', href: '/account', current: place === 'account' },
  ]
}

export type Step = 'menu' | 'checkout' | 'pay'

export const STEP_LABELS: Record<Step, string> = { menu: 'Menu', checkout: 'Details', pay: 'Pay' }

export const STEP_ORDER: Step[] = ['menu', 'checkout', 'pay']

export function stepState(step: Step, current: Step): 'done' | 'current' | 'todo' {
  const a = STEP_ORDER.indexOf(step)
  const b = STEP_ORDER.indexOf(current)
  return a < b ? 'done' : a === b ? 'current' : 'todo'
}

export function backTarget(step: Step): { step: Step; label: string } | null {
  if (step === 'checkout') return { step: 'menu', label: 'Back to menu' }
  if (step === 'pay') return { step: 'checkout', label: 'Back to details' }
  return null
}

export const EMPTY_CART_NOTE = 'Your cart is empty — pick something first.'

/** The step to show for a `?step=` value: checkout and pay need something in the cart. */
export function resolveStep(
  urlStep: string | null,
  cartCount: number,
): { step: Step; note: string | null } {
  if (urlStep === 'checkout' || urlStep === 'pay') {
    return cartCount > 0
      ? { step: urlStep, note: null }
      : { step: 'menu', note: EMPTY_CART_NOTE }
  }
  return { step: 'menu', note: null }
}
